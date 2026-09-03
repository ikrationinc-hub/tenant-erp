import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { seedDefaultFieldDefinitions } from "../../../core/provisioning/seed-field-definitions.js";
import { seedDefaultNumberSeries } from "../../../core/provisioning/seed-number-series.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import {
  branches,
  clauseVersions,
  clauses,
  companies,
  containers,
  customers,
  divisions,
  permissions,
  purchaseItems,
  purchasePricing,
  purchaseShipments,
  purchases,
  suppliers,
  supplierTypes,
  countries,
  paymentTerms,
  currencies,
  transportModes,
  ports,
  warehouses,
  incoterms,
  items,
  uom,
  users,
} from "../../../database/tenant/schema.js";

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
  supplierId: string;
  customerId: string;
}

const ALL_PERMISSIONS = [
  "contract.clause.read",
  "contract.clause.create",
  "contract.clause.version",
  "contract.clause.approve",
  "contract.document.create",
  "contract.document.edit",
  "contract.document.assemble",
  "contract.document.generate",
  "purchase.po.create",
  "purchase.po.read",
  "purchase.po.update",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, divisionId, supplierId, customerId } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
    const [supplierType] = await tx.insert(supplierTypes).values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id }).returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx.insert(paymentTerms).values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!supplierType || !country || !paymentTerm || !currency) throw new Error("failed to insert prerequisite masters");
    const [supplier] = await tx
      .insert(suppliers)
      .values({
        companyId: company.id,
        code: "SUP-0001",
        name: "Acme Metals Trading",
        supplierTypeId: supplierType.id,
        countryId: country.id,
        paymentTermId: paymentTerm.id,
        currencyId: currency.id,
        address: "1 Metal Street",
        createdBy: user.id,
      })
      .returning();
    const [customer] = await tx.insert(customers).values({ companyId: company.id, code: "CUST-0001", name: "Pacific Metals Trading", createdBy: user.id }).returning();
    if (!supplier || !customer) throw new Error("failed to insert supplier/customer");

    return { companyId: company.id, userId: user.id, divisionId: division.id, supplierId: supplier.id, customerId: customer.id };
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

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, divisionId, supplierId, customerId };
}

/** Creates a clause with an immediately-Active version (effectiveFrom in the past, promoted via the on-access fallback the same way clauses.service.ts's approveVersion already does) - contract assembly needs a real Active version to snapshot against. */
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

async function createSeededPurchase(tenant: SeededTenant): Promise<string> {
  return withTenantSchema(tenant.schemaName, async (tx) => {
    const [branch] = await tx.insert(branches).values({ companyId: tenant.companyId, name: "Main Branch", code: "MAIN", createdBy: tenant.userId }).returning();
    const [transportMode] = await tx.insert(transportModes).values({ companyId: tenant.companyId, code: "SEA", name: "Sea", createdBy: tenant.userId }).returning();
    const [portA] = await tx.insert(ports).values({ companyId: tenant.companyId, code: "JEA", name: "Jebel Ali", createdBy: tenant.userId }).returning();
    const [portB] = await tx.insert(ports).values({ companyId: tenant.companyId, code: "SHA", name: "Shanghai", createdBy: tenant.userId }).returning();
    const [warehouse] = await tx.insert(warehouses).values({ companyId: tenant.companyId, code: "WH1", name: "Main Warehouse", createdBy: tenant.userId }).returning();
    const [incoterm] = await tx.insert(incoterms).values({ companyId: tenant.companyId, code: "CIF", name: "Cost, Insurance and Freight", createdBy: tenant.userId }).returning();
    const [item] = await tx.insert(items).values({ companyId: tenant.companyId, code: "CU-CATH", name: "Copper Cathode", itemType: "metals", createdBy: tenant.userId }).returning();
    const [unit] = await tx.insert(uom).values({ companyId: tenant.companyId, code: "MT", name: "Metric Ton", createdBy: tenant.userId }).returning();
    if (!branch || !transportMode || !portA || !portB || !warehouse || !incoterm || !item || !unit) {
      throw new Error("failed to insert prerequisite masters for purchase");
    }

    const [purchase] = await tx
      .insert(purchases)
      .values({
        companyId: tenant.companyId,
        purchaseNumber: `PO-TEST-${randomUUID().slice(0, 6)}`,
        purchaseDate: "2024-06-15",
        divisionId: tenant.divisionId,
        branchId: branch.id,
        buyerId: tenant.companyId,
        supplierId: tenant.supplierId,
        pricingType: "fixed",
        createdBy: tenant.userId,
      })
      .returning();
    if (!purchase) throw new Error("failed to insert purchase");

    const [container] = await tx.insert(containers).values({ companyId: tenant.companyId, code: "CONT-1", name: "CONT-1", createdBy: tenant.userId }).returning();
    if (!container) throw new Error("failed to insert container");

    await tx.insert(purchaseShipments).values({
      purchaseId: purchase.id,
      companyId: tenant.companyId,
      shipmentYear: 2024,
      lotNumber: "LOT-1",
      containerId: container.id,
      blNo: "BL-1",
      loadingDate: "2024-06-10",
      transportModeId: transportMode.id,
      portOfLoadingId: portA.id,
      portOfDischargeId: portB.id,
      warehouseId: warehouse.id,
      incotermId: incoterm.id,
      createdBy: tenant.userId,
    });

    const [purchaseItem] = await tx
      .insert(purchaseItems)
      .values({ purchaseId: purchase.id, companyId: tenant.companyId, itemId: item.id, quantity: "500", uomId: unit.id, createdBy: tenant.userId })
      .returning();
    if (!purchaseItem) throw new Error("failed to insert purchase item");

    await tx.insert(purchasePricing).values({
      purchaseItemId: purchaseItem.id,
      companyId: tenant.companyId,
      purchaseRateUsd: "8432.75",
      purchaseAmountUsd: "4216375.00",
      exchangeRate: "3.6725",
      purchaseAmountAed: "15484597.06",
      createdBy: tenant.userId,
    });

    return purchase.id;
  });
}

describe("contract document + assembly (C-3b)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "a template loads its default clauses in order when selected at create time",
    async () => {
      const tenant = await seedTenant("tpl-defaults");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseAId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Force Majeure", "Neither party shall be liable.");
      const clauseBId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Governing Law", "This contract is governed by UAE law.");

      const templateRes = await request(app)
        .post("/api/v1/contract-templates")
        .set("Authorization", authHeader)
        .send({ name: "Scrap Sale Template", contractType: "Sale Contract", divisionId: tenant.divisionId });
      expect(templateRes.status).toBe(201);
      const templateId = (templateRes.body as { id: string }).id;

      await request(app).post(`/api/v1/contract-templates/${templateId}/clauses`).set("Authorization", authHeader).send({ clauseId: clauseAId, isMandatory: true });
      await request(app).post(`/api/v1/contract-templates/${templateId}/clauses`).set("Authorization", authHeader).send({ clauseId: clauseBId });

      const createRes = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", templateId, divisionId: tenant.divisionId });
      expect(createRes.status).toBe(201);
      const contract = createRes.body as { clauses: { clauseId: string; sortOrder: number; isMandatory: boolean; resolvedText: string }[] };

      expect(contract.clauses).toHaveLength(2);
      expect(contract.clauses[0]?.clauseId).toBe(clauseAId);
      expect(contract.clauses[0]?.isMandatory).toBe(true);
      expect(contract.clauses[0]?.sortOrder).toBe(0);
      expect(contract.clauses[1]?.clauseId).toBe(clauseBId);
      expect(contract.clauses[1]?.sortOrder).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a linked contract prefills commercial fields from the purchase; a standalone contract starts blank - both work",
    async () => {
      const tenant = await seedTenant("link-prefill");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const purchaseId = await createSeededPurchase(tenant);

      const linked = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", divisionId: tenant.divisionId, source: { sourceType: "purchase", sourceId: purchaseId } });
      expect(linked.status).toBe(201);
      const linkedContract = linked.body as { weightKg: string; rateUsd: string; deliveryTerms: string | null };
      expect(linkedContract.weightKg).toBe("500.000000");
      expect(linkedContract.rateUsd).toBe("8432.75");
      expect(linkedContract.deliveryTerms).toBe("Cost, Insurance and Freight");

      const standalone = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      expect(standalone.status).toBe(201);
      const standaloneContract = standalone.body as { weightKg: string | null; rateUsd: string | null };
      expect(standaloneContract.weightKg).toBeNull();
      expect(standaloneContract.rateUsd).toBeNull();

      // Linked contract's own explicit override still wins over the prefill.
      const linkedWithOverride = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", divisionId: tenant.divisionId, source: { sourceType: "purchase", sourceId: purchaseId }, rateUsd: "9000.00" });
      expect(linkedWithOverride.status).toBe(201);
      expect((linkedWithOverride.body as { rateUsd: string }).rateUsd).toBe("9000.00");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "drag-drop reorder persists; a mandatory clause cannot be removed",
    async () => {
      const tenant = await seedTenant("reorder");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseAId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Clause A", "Text A.");
      const clauseBId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Clause B", "Text B.");

      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;

      const addA = await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId: clauseAId });
      const addB = await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId: clauseBId });
      expect(addA.status).toBe(201);
      expect(addB.status).toBe(201);
      const contractClauseAId = (addA.body as { id: string }).id;
      const contractClauseBId = (addB.body as { id: string }).id;

      const reorderRes = await request(app)
        .patch(`/api/v1/contracts/${contractId}/clauses/reorder`)
        .set("Authorization", authHeader)
        .send({ contractClauseIds: [contractClauseBId, contractClauseAId] });
      expect(reorderRes.status).toBe(200);
      const reordered = (reorderRes.body as { items: { id: string; sortOrder: number }[] }).items;
      expect(reordered.find((c) => c.id === contractClauseBId)?.sortOrder).toBe(0);
      expect(reordered.find((c) => c.id === contractClauseAId)?.sortOrder).toBe(1);

      // Mandatory block: add a mandatory clause via a template-backed flow instead - simplest direct proof is adding then attempting removal after marking it mandatory via direct approval flow isn't available on addClause (never mandatory) - so verify removal of a template-sourced mandatory clause instead.
      const templateRes = await request(app)
        .post("/api/v1/contract-templates")
        .set("Authorization", authHeader)
        .send({ name: "Mandatory Test Template", contractType: "Sale Contract" });
      const templateId = (templateRes.body as { id: string }).id;
      const clauseCId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Clause C", "Text C.");
      await request(app).post(`/api/v1/contract-templates/${templateId}/clauses`).set("Authorization", authHeader).send({ clauseId: clauseCId, isMandatory: true });

      const mandatoryContractRes = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({ contractDate: "2026-01-01", divisionId: tenant.divisionId, templateId });
      const mandatoryContract = mandatoryContractRes.body as { id: string; clauses: { id: string; isMandatory: boolean }[] };
      const mandatoryContractClauseId = mandatoryContract.clauses[0]?.id;
      expect(mandatoryContract.clauses[0]?.isMandatory).toBe(true);

      const removeMandatory = await request(app)
        .delete(`/api/v1/contracts/${mandatoryContract.id}/clauses/${mandatoryContractClauseId}`)
        .set("Authorization", authHeader);
      expect(removeMandatory.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "THE SNAPSHOT TEST: assembling a contract then editing that clause in the library leaves the contract's stored resolved_text and clause_version_id UNCHANGED",
    async () => {
      const tenant = await seedTenant("snapshot");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Snapshot Clause", "Original library text.");

      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;
      const addRes = await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });
      const snapshot = addRes.body as { resolvedText: string; clauseVersionId: string };
      expect(snapshot.resolvedText).toBe("Original library text.");

      // Now edit the clause in the LIBRARY - a genuinely new version,
      // immediately promoted to Active (effectiveFrom in the past). The
      // one-active-rule's partial unique index is checked per-statement,
      // not deferred - the prior version must be superseded BEFORE the new
      // one is inserted as active, or the insert itself violates the
      // constraint (this is what clause-promotion.ts's real promoteVersion
      // does too, in that exact order; this test mirrors it by hand
      // rather than going through the promotion flow, which C-1 already
      // tests on its own).
      await withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.update(clauseVersions).set({ status: "superseded" }).where(eq(clauseVersions.versionNumber, 1));
        await tx.insert(clauseVersions).values({
          companyId: tenant.companyId,
          clauseId,
          versionNumber: 2,
          clauseText: "EDITED library text - should never appear on the already-assembled contract.",
          status: "active",
          effectiveFrom: "2020-06-01",
          changeReason: "law changed",
          createdBy: tenant.userId,
        });
      });

      const getRes = await request(app).get(`/api/v1/contracts/${contractId}`).set("Authorization", authHeader);
      const afterLibraryEdit = (getRes.body as { clauses: { resolvedText: string; clauseVersionId: string }[] }).clauses[0];
      expect(afterLibraryEdit?.resolvedText).toBe("Original library text.");
      expect(afterLibraryEdit?.clauseVersionId).toBe(snapshot.clauseVersionId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Signed contract cannot be re-snapshotted; a Draft can, with a diff",
    async () => {
      const tenant = await seedTenant("resnapshot-lock");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseId = await createActiveClause(tenant.schemaName, tenant.companyId, tenant.userId, "Resnap Clause", "V1 text.");
      const createRes = await request(app).post("/api/v1/contracts").set("Authorization", authHeader).send({ contractDate: "2026-01-01", divisionId: tenant.divisionId });
      const contractId = (createRes.body as { id: string }).id;
      await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });

      await withTenantSchema(tenant.schemaName, async (tx) => {
        await tx.update(clauseVersions).set({ status: "superseded" }).where(eq(clauseVersions.versionNumber, 1));
        await tx.insert(clauseVersions).values({
          companyId: tenant.companyId,
          clauseId,
          versionNumber: 2,
          clauseText: "V2 text.",
          status: "active",
          effectiveFrom: "2020-06-01",
          changeReason: "update",
          createdBy: tenant.userId,
        });
      });

      const draftResnap = await request(app).post(`/api/v1/contracts/${contractId}/clauses/resnapshot`).set("Authorization", authHeader);
      expect(draftResnap.status).toBe(200);
      const diff = (draftResnap.body as { items: { changed: boolean; newResolvedText: string }[] }).items;
      expect(diff[0]?.changed).toBe(true);
      expect(diff[0]?.newResolvedText).toBe("V2 text.");

      const approveRes = await request(app).patch(`/api/v1/contracts/${contractId}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      const signRes = await request(app).patch(`/api/v1/contracts/${contractId}/sign`).set("Authorization", authHeader);
      expect(signRes.status).toBe(200);

      const signedResnap = await request(app).post(`/api/v1/contracts/${contractId}/clauses/resnapshot`).set("Authorization", authHeader);
      expect(signedResnap.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "preview resolves placeholders against real data",
    async () => {
      const tenant = await seedTenant("preview");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const clauseId = await createActiveClause(
        tenant.schemaName,
        tenant.companyId,
        tenant.userId,
        "Preview Clause",
        "Seller is {{seller.name}}, buyer is {{buyer.name}}, rate is {{commercial.rate}}.",
      );

      const createRes = await request(app)
        .post("/api/v1/contracts")
        .set("Authorization", authHeader)
        .send({
          contractDate: "2026-01-01",
          divisionId: tenant.divisionId,
          rateUsd: "8432.75",
          seller: { supplierId: tenant.supplierId },
          buyer: { customerId: tenant.customerId },
        });
      const contractId = (createRes.body as { id: string }).id;
      await request(app).post(`/api/v1/contracts/${contractId}/clauses`).set("Authorization", authHeader).send({ clauseId });

      const previewRes = await request(app).get(`/api/v1/contracts/${contractId}/preview`).set("Authorization", authHeader);
      expect(previewRes.status).toBe(200);
      const previewText = (previewRes.body as { clauses: { resolvedText: string }[] }).clauses[0]?.resolvedText;
      expect(previewText).toBe("Seller is Acme Metals Trading, buyer is Pacific Metals Trading, rate is 8,432.75.");
    },
    TEST_TIMEOUT_MS,
  );
});
