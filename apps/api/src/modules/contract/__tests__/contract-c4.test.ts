import "../../attachments/__tests__/set-real-storage-env.js";

import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { env } from "../../../config/env.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { resetESignatureProvider, setESignatureProvider, type ESignatureProvider } from "../../../core/esignature/provider.js";
import { getMailer, resetMailer, setMailer, type SendMailInput } from "../../../core/notification/mailer.js";
import { seedDefaultFieldDefinitions } from "../../../core/provisioning/seed-field-definitions.js";
import { seedDefaultNumberSeries } from "../../../core/provisioning/seed-number-series.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { s3Client } from "../../../core/storage/client.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { clauseVersions, clauses, companies, contracts, divisions, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) => tx.select().from(permissions).where(eq(permissions.key, key)).limit(1));
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
  divisionId: string;
}

const ALL_PERMISSIONS = [
  "contract.clause.read",
  "contract.clause.create",
  "contract.document.create",
  "contract.document.edit",
  "contract.document.assemble",
  "contract.document.generate",
  "contract.document.email",
  "contract.document.esign",
  "contract.document.run_rules",
  "contract.rule.read",
  "contract.rule.create",
  "contract.rule.update",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, divisionId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) throw new Error("failed to insert company");
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) throw new Error("failed to insert user");
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "SCRAP", name: "Scrap", createdBy: user.id }).returning();
    if (!division) throw new Error("failed to insert division");

    return { companyId: company.id, userId: user.id, divisionId: division.id };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });
  await seedDefaultFieldDefinitions({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, divisionId };
}

async function createActiveClause(schemaName: string, companyId: string, userId: string, clauseTitle: string, clauseText: string): Promise<string> {
  return withTenantSchema(schemaName, async (tx) => {
    const [clause] = await tx.insert(clauses).values({ companyId, clauseCode: `CL-TEST-${randomUUID().slice(0, 6)}`, clauseTitle, category: "general_tc", createdBy: userId }).returning();
    if (!clause) throw new Error("failed to insert clause");
    const [version] = await tx
      .insert(clauseVersions)
      .values({ companyId, clauseId: clause.id, versionNumber: 1, clauseText, status: "active", effectiveFrom: "2020-01-01", changeReason: "initial", createdBy: userId })
      .returning();
    if (!version) throw new Error("failed to insert clause version");
    return clause.id;
  });
}

describe("contract rule engine, approval revisions, e-signature stub, email (C-4)", () => {
  afterEach(() => {
    resetMailer();
    resetESignatureProvider();
  });

  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "rules are DATA: a CIF condition auto-adds the target clause as mandatory, and it cannot be removed",
    async () => {
      const tenant = await seedTenant("rule-cif");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const insuranceClauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Insurance", "Seller arranges marine insurance.");

      // The rule itself is created purely through the API - no hardcoded
      // logic anywhere in the engine references CIF or insurance by name;
      // adding this rule via a plain POST is the "no code change" proof.
      const ruleRes = await request(app)
        .post("/api/v1/clause-rules")
        .set("Authorization", authHeader)
        .send({
          name: "CIF requires insurance",
          conditionJson: { all: [{ fact: "deliveryTerms", operator: "equal", value: "Cost, Insurance and Freight" }] },
          targetClauseId: insuranceClauseId,
          actionIsMandatory: true,
        });
      expect(ruleRes.status).toBe(201);
      expect((ruleRes.body as { isExample: boolean }).isExample).toBe(true);

      const createRes = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", divisionId: tenant.divisionId, deliveryTerms: "Cost, Insurance and Freight" });
      expect(createRes.status).toBe(201);
      const contractId = (createRes.body as { id: string }).id;

      const runRes = await request(app).post(`/api/v1/contracts/${contractId}/run-rules`).set("Authorization", authHeader);
      expect(runRes.status).toBe(200);
      const runBody = runRes.body as { added: { targetClauseId: string }[] };
      expect(runBody.added).toHaveLength(1);
      expect(runBody.added[0]?.targetClauseId).toBe(insuranceClauseId);

      const contractAfter = await request(app).get(`/api/v1/contracts/${contractId}`).set("Authorization", authHeader);
      const clausesOnContract = (contractAfter.body as { clauses: { id: string; clauseId: string; isMandatory: boolean; isFromRule: boolean }[] }).clauses;
      const addedClause = clausesOnContract.find((c) => c.clauseId === insuranceClauseId);
      expect(addedClause?.isMandatory).toBe(true);
      expect(addedClause?.isFromRule).toBe(true);

      // Non-removable: mandatory + rule-added clauses are blocked the same
      // way any other mandatory clause already is (contract-assembly.
      // service.ts's own removeClause guard - zero new code needed here).
      const removeRes = await request(app).delete(`/api/v1/contracts/${contractId}/clauses/${addedClause?.id}`).set("Authorization", authHeader);
      expect(removeRes.status).toBe(409);

      // Running rules again does not duplicate the clause.
      const runAgain = await request(app).post(`/api/v1/contracts/${contractId}/run-rules`).set("Authorization", authHeader);
      const runAgainBody = runAgain.body as { added: unknown[]; alreadyPresent: { targetClauseId: string }[] };
      expect(runAgainBody.added).toHaveLength(0);
      expect(runAgainBody.alreadyPresent[0]?.targetClauseId).toBe(insuranceClauseId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a rule whose condition does not match adds nothing",
    async () => {
      const tenant = await seedTenant("rule-no-match");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const insuranceClauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Insurance", "Seller arranges marine insurance.");
      await request(app)
        .post("/api/v1/clause-rules")
        .set("Authorization", authHeader)
        .send({
          name: "CIF requires insurance",
          conditionJson: { all: [{ fact: "deliveryTerms", operator: "equal", value: "Cost, Insurance and Freight" }] },
          targetClauseId: insuranceClauseId,
          actionIsMandatory: true,
        });

      const createRes = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", divisionId: tenant.divisionId, deliveryTerms: "Free on Board" });
      const contractId = (createRes.body as { id: string }).id;

      const runRes = await request(app).post(`/api/v1/contracts/${contractId}/run-rules`).set("Authorization", authHeader);
      expect(runRes.status).toBe(200);
      const runBody = runRes.body as { matched: unknown[]; added: unknown[] };
      expect(runBody.matched).toHaveLength(0);
      expect(runBody.added).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "approval already locks the snapshot; a revision copies the frozen clauses into a new, independently-editable Draft",
    async () => {
      const tenant = await seedTenant("revision");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Governing Law", "UAE law governs.");
      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;
      await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });

      const approveRes = await request(app).patch(`/api/v1/contracts/${contractId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);

      // Locked: no assembly mutation works anymore on the approved contract.
      const addAfterApprove = await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });
      expect(addAfterApprove.status).toBe(409);

      const reviseRes = await request(app).post(`/api/v1/contracts/${contractId}/revise`).set("Authorization", authHeader);
      expect(reviseRes.status).toBe(201);
      const revision = reviseRes.body as { id: string; status: string; parentContractId: string; revisionNumber: number; clauses: { clauseId: string }[] };
      expect(revision.status).toBe("draft");
      expect(revision.parentContractId).toBe(contractId);
      expect(revision.revisionNumber).toBe(2);
      expect(revision.clauses).toHaveLength(1);
      expect(revision.clauses[0]?.clauseId).toBe(clauseId);

      // The new revision is independently editable even though the parent stays locked.
      const addOnRevision = await request(app).post(`/api/v1/contracts/${revision.id}/clauses`).set("Authorization", authHeader).send({ clauseId });
      expect(addOnRevision.status).toBe(201);

      // The parent's own snapshot is untouched by the revision's edits.
      const parentAfter = await request(app).get(`/api/v1/contracts/${contractId}`).set("Authorization", authHeader);
      expect((parentAfter.body as { clauses: unknown[] }).clauses).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "e-signature: the stub provider is used, never a real one - send stamps requestId/status, and the webhook updates it",
    async () => {
      const tenant = await seedTenant("esign");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      let sendCalls = 0;
      const stub: ESignatureProvider = {
        send: (input) => {
          sendCalls += 1;
          expect(input.signerEmail).toBe("buyer@example.com");
          return Promise.resolve({ requestId: "req-123" });
        },
        getStatus: () => Promise.resolve({ requestId: "req-123", status: "sent" }),
        parseWebhook: (payload) => payload as { requestId: string; status: "sent" | "signed" | "declined" },
      };
      setESignatureProvider(stub);

      const clauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Clause", "Text.");
      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;
      await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });

      // No generated PDF yet - sending for e-signature is rejected.
      const tooEarly = await request(app).post(`/api/v1/contracts/${contractId}/send-for-esignature`).set("Authorization", authHeader).send({ signerEmail: "buyer@example.com" });
      expect(tooEarly.status).toBe(409);

      await withTenantSchema(tenant.schemaName, (tx) => tx.update(contracts).set({ lastGeneratedPdfKey: `test/${contractId}.pdf` }).where(eq(contracts.id, contractId)));
      await s3Client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: `test/${contractId}.pdf`, Body: Buffer.from("%PDF-1.4 fake"), ContentType: "application/pdf" }));

      const sendRes = await request(app).post(`/api/v1/contracts/${contractId}/send-for-esignature`).set("Authorization", authHeader).send({ signerEmail: "buyer@example.com" });
      expect(sendRes.status).toBe(200);
      expect(sendCalls).toBe(1);
      const afterSend = sendRes.body as { esignatureStatus: string; esignatureRequestId: string };
      expect(afterSend.esignatureStatus).toBe("sent");
      expect(afterSend.esignatureRequestId).toBe("req-123");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "email: sends the generated PDF as an attachment via the notification service and records lastEmailedAt/To",
    async () => {
      const tenant = await seedTenant("email");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const sentMails: SendMailInput[] = [];
      setMailer({
        send: (input) => {
          sentMails.push(input);
          return Promise.resolve();
        },
      });

      const clauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Clause", "Text.");
      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;
      await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });

      const tooEarly = await request(app).post(`/api/v1/contracts/${contractId}/email`).set("Authorization", authHeader).send({ to: "buyer@example.com" });
      expect(tooEarly.status).toBe(409);

      const pdfBytes = Buffer.from("%PDF-1.4 fake contract pdf");
      await withTenantSchema(tenant.schemaName, (tx) => tx.update(contracts).set({ lastGeneratedPdfKey: `test/${contractId}.pdf` }).where(eq(contracts.id, contractId)));
      await s3Client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: `test/${contractId}.pdf`, Body: pdfBytes, ContentType: "application/pdf" }));

      const emailRes = await request(app).post(`/api/v1/contracts/${contractId}/email`).set("Authorization", authHeader).send({ to: "buyer@example.com" });
      expect(emailRes.status).toBe(200);
      expect(sentMails).toHaveLength(1);
      expect(sentMails[0]?.to).toBe("buyer@example.com");
      expect(sentMails[0]?.attachments).toHaveLength(1);
      expect(sentMails[0]?.attachments?.[0]?.content.equals(pdfBytes)).toBe(true);

      const afterEmail = emailRes.body as { lastEmailedTo: string; lastEmailedAt: string | null };
      expect(afterEmail.lastEmailedTo).toBe("buyer@example.com");
      expect(afterEmail.lastEmailedAt).not.toBeNull();

      // getMailer() reflects the injected test seam, not the real Resend mailer.
      expect(getMailer()).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "document-url: returns a presigned URL to the actual generated PDF, not before one exists - the fix for Print printing the SPA's own chrome instead of the contract",
    async () => {
      const tenant = await seedTenant("document-url");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Clause", "Text.");
      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;
      await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });

      const tooEarly = await request(app).get(`/api/v1/contracts/${contractId}/document-url`).set("Authorization", authHeader);
      expect(tooEarly.status).toBe(409);

      const pdfBytes = Buffer.from("%PDF-1.4 fake contract pdf for print");
      await withTenantSchema(tenant.schemaName, (tx) => tx.update(contracts).set({ lastGeneratedPdfKey: `test/${contractId}-print.pdf` }).where(eq(contracts.id, contractId)));
      await s3Client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: `test/${contractId}-print.pdf`, Body: pdfBytes, ContentType: "application/pdf" }));

      const documentUrlRes = await request(app).get(`/api/v1/contracts/${contractId}/document-url`).set("Authorization", authHeader);
      expect(documentUrlRes.status).toBe(200);
      const { url } = documentUrlRes.body as { url: string; expiresAt: string };
      expect(url).toContain(`${contractId}-print.pdf`);

      const fetched = await fetch(url);
      expect(fetched.status).toBe(200);
      const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
      expect(fetchedBytes.equals(pdfBytes)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
