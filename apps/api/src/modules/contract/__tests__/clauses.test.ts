import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { seedDefaultNumberSeries } from "../../../core/provisioning/seed-number-series.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, divisions, permissions, users } from "../../../database/tenant/schema.js";
import { promoteDueVersions } from "../clause-promotion.js";

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
  "contract.clause.version",
  "contract.clause.approve",
  "contract.clause.deactivate",
];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, divisionId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    const [division] = await tx.insert(divisions).values({ companyId: company.id, code: "SCRAP", name: "Scrap", createdBy: user.id }).returning();
    if (!division) {
      throw new Error("failed to insert division");
    }

    return { companyId: company.id, userId: user.id, divisionId: division.id };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, divisionId };
}

interface CreateClauseOptions {
  clauseText?: string;
  effectiveFrom?: string;
  changeReason?: string;
  category?: "general_tc" | "division_specific";
  divisionId?: string;
}

async function createClause(
  app: ReturnType<typeof createApp>,
  authHeader: string,
  options: CreateClauseOptions = {},
): Promise<{ status: number; body: { clause?: { id: string; clauseCode: string }; version?: { id: string; versionNumber: number } } }> {
  const res = await request(app)
    .post("/api/v1/clauses")
    .set("Authorization", authHeader)
    .send({
      clauseTitle: "Force Majeure",
      category: options.category ?? "general_tc",
      ...(options.divisionId ? { divisionId: options.divisionId } : {}),
      clauseText: options.clauseText ?? "Neither party shall be liable for {{delay.reason}}.",
      effectiveFrom: options.effectiveFrom ?? "2024-01-01",
      changeReason: options.changeReason ?? "Initial clause",
    });
  return { status: res.status, body: res.body as { clause?: { id: string; clauseCode: string }; version?: { id: string; versionNumber: number } } };
}

describe("clause library (C-1)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "editing a clause inserts a new version; the prior version's text is unchanged and still readable",
    async () => {
      const tenant = await seedTenant("clause-edit");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = await createClause(app, authHeader, { clauseText: "Original wording.", effectiveFrom: "2024-01-01" });
      expect(created.status).toBe(201);
      const clauseId = created.body.clause?.id;
      if (!clauseId) throw new Error("expected a clause id");

      const addRes = await request(app)
        .post(`/api/v1/clauses/${clauseId}/versions`)
        .set("Authorization", authHeader)
        .send({ clauseText: "Amended wording.", effectiveFrom: "2024-06-01", changeReason: "Law changed" });
      expect(addRes.status).toBe(201);

      const versionsRes = await request(app).get(`/api/v1/clauses/${clauseId}/versions`).set("Authorization", authHeader);
      expect(versionsRes.status).toBe(200);
      const items = (versionsRes.body as { items: Array<{ versionNumber: number; clauseText: string }> }).items;
      expect(items).toHaveLength(2);
      expect(items.find((v) => v.versionNumber === 1)?.clauseText).toBe("Original wording.");
      expect(items.find((v) => v.versionNumber === 2)?.clauseText).toBe("Amended wording.");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "change_reason is required - a version without one is rejected",
    async () => {
      const tenant = await seedTenant("clause-reason");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = await createClause(app, authHeader);
      const clauseId = created.body.clause?.id;
      if (!clauseId) throw new Error("expected a clause id");

      const res = await request(app)
        .post(`/api/v1/clauses/${clauseId}/versions`)
        .set("Authorization", authHeader)
        .send({ clauseText: "Amended wording.", effectiveFrom: "2024-06-01" });
      expect(res.status).toBe(422);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "only one Active version per clause ever - promoting flips the old to Superseded with effectiveTo stamped, atomically",
    async () => {
      const tenant = await seedTenant("clause-promote");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = await createClause(app, authHeader, { effectiveFrom: "2024-01-01" });
      const clauseId = created.body.clause?.id;
      const v1Id = created.body.version?.id;
      if (!clauseId || !v1Id) throw new Error("expected clause+version ids");

      const approveV1 = await request(app).patch(`/api/v1/clauses/${clauseId}/versions/${v1Id}/approve`).set("Authorization", authHeader);
      expect(approveV1.status).toBe(200);
      // effectiveFrom (2024-01-01) is in the past - approving triggers the
      // on-access fallback, which should promote it to Active immediately.
      expect((approveV1.body as { status: string }).status).toBe("active");

      const addV2 = await request(app)
        .post(`/api/v1/clauses/${clauseId}/versions`)
        .set("Authorization", authHeader)
        .send({ clauseText: "Version 2 text.", effectiveFrom: "2024-06-01", changeReason: "Update" });
      expect(addV2.status).toBe(201);
      const v2Id = (addV2.body as { id: string }).id;

      const approveV2 = await request(app).patch(`/api/v1/clauses/${clauseId}/versions/${v2Id}/approve`).set("Authorization", authHeader);
      expect(approveV2.status).toBe(200);
      expect((approveV2.body as { status: string }).status).toBe("active");

      const versionsRes = await request(app).get(`/api/v1/clauses/${clauseId}/versions`).set("Authorization", authHeader);
      const items = (versionsRes.body as { items: Array<{ id: string; status: string; effectiveTo: string | null }> }).items;
      const activeVersions = items.filter((v) => v.status === "active");
      expect(activeVersions).toHaveLength(1);
      expect(activeVersions[0]?.id).toBe(v2Id);

      const v1After = items.find((v) => v.id === v1Id);
      expect(v1After?.status).toBe("superseded");
      expect(v1After?.effectiveTo).toBe("2024-06-01");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a future-dated version stays Approved until its date; promoteDueVersions proves the scheduler-side promotion",
    async () => {
      const tenant = await seedTenant("clause-future");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const farFuture = "2099-01-01";
      const created = await createClause(app, authHeader, { effectiveFrom: farFuture });
      const clauseId = created.body.clause?.id;
      const v1Id = created.body.version?.id;
      if (!clauseId || !v1Id) throw new Error("expected clause+version ids");

      const approveRes = await request(app).patch(`/api/v1/clauses/${clauseId}/versions/${v1Id}/approve`).set("Authorization", authHeader);
      expect(approveRes.status).toBe(200);
      // Still Approved - effectiveFrom is far in the future, so neither the
      // on-access fallback inside approveVersion nor a real scheduler tick
      // should have promoted it.
      expect((approveRes.body as { status: string }).status).toBe("approved");

      // Simulate the scheduler's own tick, pinned to a time AFTER
      // effectiveFrom, without waiting for real wall-clock time to pass -
      // this is the direct unit-level proof that the promotion transaction
      // (shared by both the BullMQ job and the on-access fallback) correctly
      // promotes a due version.
      const promotedCount = await withTenantSchema(tenant.schemaName, (tx) => promoteDueVersions(tx, new Date("2099-06-01")));
      expect(promotedCount).toBe(1);

      const versionsRes = await request(app).get(`/api/v1/clauses/${clauseId}/versions`).set("Authorization", authHeader);
      const items = (versionsRes.body as { items: Array<{ id: string; status: string }> }).items;
      expect(items.find((v) => v.id === v1Id)?.status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "overlapping/gapping effective windows are rejected",
    async () => {
      const tenant = await seedTenant("clause-overlap");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = await createClause(app, authHeader, { effectiveFrom: "2024-06-01" });
      const clauseId = created.body.clause?.id;
      if (!clauseId) throw new Error("expected a clause id");

      // Same effectiveFrom as v1 - overlap.
      const sameDate = await request(app)
        .post(`/api/v1/clauses/${clauseId}/versions`)
        .set("Authorization", authHeader)
        .send({ clauseText: "v2", effectiveFrom: "2024-06-01", changeReason: "test" });
      expect(sameDate.status).toBe(409);

      // Earlier than v1's effectiveFrom - overlap the other direction.
      const earlier = await request(app)
        .post(`/api/v1/clauses/${clauseId}/versions`)
        .set("Authorization", authHeader)
        .send({ clauseText: "v2", effectiveFrom: "2024-01-01", changeReason: "test" });
      expect(earlier.status).toBe(409);

      // Strictly after - accepted.
      const after = await request(app)
        .post(`/api/v1/clauses/${clauseId}/versions`)
        .set("Authorization", authHeader)
        .send({ clauseText: "v2", effectiveFrom: "2024-07-01", changeReason: "test" });
      expect(after.status).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "placeholder extraction lists a version's tokens; clause_code is gapless",
    async () => {
      const tenant = await seedTenant("clause-tokens");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const first = await createClause(app, authHeader, {
        clauseText: "Delivery to {{shipment.port}} by {{shipment.eta}}, priced at {{commercial.rate}}.",
      });
      expect(first.status).toBe(201);
      const firstCode = first.body.clause?.clauseCode;
      expect(firstCode).toMatch(/^CL-\d{4}$/);

      const second = await createClause(app, authHeader, { clauseText: "No placeholders here." });
      expect(second.status).toBe(201);
      const secondCode = second.body.clause?.clauseCode;
      // Gapless, sequential within this company (rule 7).
      const firstSeq = Number(firstCode?.split("-")[1]);
      const secondSeq = Number(secondCode?.split("-")[1]);
      expect(secondSeq).toBe(firstSeq + 1);

      const clauseId = first.body.clause?.id;
      if (!clauseId) throw new Error("expected a clause id");
      const versionsRes = await request(app).get(`/api/v1/clauses/${clauseId}/versions`).set("Authorization", authHeader);
      const items = (versionsRes.body as { items: Array<{ placeholderTokens: string[] }> }).items;
      expect(items[0]?.placeholderTokens.sort()).toEqual(["commercial.rate", "shipment.eta", "shipment.port"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "division-scoped clauses: divisionId nullable = all divisions",
    async () => {
      const tenant = await seedTenant("clause-division");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const scoped = await createClause(app, authHeader, { category: "division_specific", divisionId: tenant.divisionId });
      expect(scoped.status).toBe(201);
      const universal = await createClause(app, authHeader, { category: "general_tc" });
      expect(universal.status).toBe(201);

      const filtered = await request(app).get(`/api/v1/clauses?divisionId=${tenant.divisionId}`).set("Authorization", authHeader);
      const filteredIds = (filtered.body as { items: Array<{ id: string }> }).items.map((c) => c.id);
      expect(filteredIds).toContain(scoped.body.clause?.id);
      expect(filteredIds).not.toContain(universal.body.clause?.id);
    },
    TEST_TIMEOUT_MS,
  );
});
