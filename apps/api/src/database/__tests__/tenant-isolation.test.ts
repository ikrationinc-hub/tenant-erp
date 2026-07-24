import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestContext } from "../../common/context/request-context.js";
import { closeDbPool } from "../../config/db.js";
import { createTenantSchema, type ProvisionedTenant } from "../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantDb, withTenantDbObservingSessionAfter } from "../get-db.js";
import { companies } from "../tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

function ctxFor(tenant: ProvisionedTenant, companyId: string): RequestContext {
  return {
    requestId: randomUUID(),
    tenantScope: {
      tenantId: tenant.id,
      tenantSchema: tenant.schemaName,
      companyId,
    },
  };
}

describe("tenant isolation (get-db.ts boundary)", () => {
  let alpha: ProvisionedTenant;
  let beta: ProvisionedTenant;

  beforeAll(async () => {
    const unique = randomUUID().slice(0, 8);
    alpha = await createTenantSchema({ name: "Alpha Trading", slug: `alpha-${unique}` });
    beta = await createTenantSchema({ name: "Beta Trading", slug: `beta-${unique}` });

    await withTenantDb(ctxFor(alpha, ""), (tx) =>
      tx.insert(companies).values({
        name: "alpha-seed",
        fiscalYearStartMonth: 1,
        timezone: "America/New_York",
        createdBy: randomUUID(),
      }),
    );
    await withTenantDb(ctxFor(beta, ""), (tx) =>
      tx.insert(companies).values({
        name: "beta-seed",
        fiscalYearStartMonth: 4,
        timezone: "Europe/London",
        createdBy: randomUUID(),
      }),
    );
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });

  it(
    "never lets alpha see beta's rows (or vice versa) across 100 concurrent interleaved reads/writes",
    async () => {
      const ROUNDS = 25; // 4 ops/round x 25 = 100 operations total

      function insertRow(tenant: ProvisionedTenant, label: string, index: number): Promise<void> {
        return withTenantDb(ctxFor(tenant, ""), async (tx) => {
          await tx.insert(companies).values({
            name: `${label}-row-${index}`,
            fiscalYearStartMonth: 1,
            timezone: "America/New_York",
            createdBy: randomUUID(),
          });
        });
      }

      function assertOnlyOwnRows(tenant: ProvisionedTenant, label: string): Promise<void> {
        return withTenantDb(ctxFor(tenant, ""), async (tx) => {
          const rows = await tx.select().from(companies);
          for (const row of rows) {
            expect(row.name.startsWith(`${label}-`)).toBe(true);
          }
        });
      }

      const operations: Promise<void>[] = [];
      for (let i = 0; i < ROUNDS; i += 1) {
        operations.push(insertRow(alpha, "alpha", i));
        operations.push(assertOnlyOwnRows(alpha, "alpha"));
        operations.push(insertRow(beta, "beta", i));
        operations.push(assertOnlyOwnRows(beta, "beta"));
      }

      await Promise.all(operations);

      const alphaFinal = await withTenantDb(ctxFor(alpha, ""), (tx) => tx.select().from(companies));
      const betaFinal = await withTenantDb(ctxFor(beta, ""), (tx) => tx.select().from(companies));

      expect(alphaFinal).toHaveLength(1 + ROUNDS);
      expect(betaFinal).toHaveLength(1 + ROUNDS);
      expect(alphaFinal.every((row) => row.name.startsWith("alpha-"))).toBe(true);
      expect(betaFinal.every((row) => row.name.startsWith("beta-"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it("does not retain the tenant scope in the session after a transaction commits", async () => {
    const { outcome, sessionScopeAfter } = await withTenantDbObservingSessionAfter(
      alpha.schemaName,
      async (tx) => {
        await tx.select().from(companies);
      },
    );

    expect(outcome.ok).toBe(true);
    expect(sessionScopeAfter).not.toContain(alpha.schemaName);
  });

  it("rolls back AND does not retain the tenant scope in the session when the callback throws", async () => {
    const marker = `alpha-rollback-${randomUUID()}`;

    const { outcome, sessionScopeAfter } = await withTenantDbObservingSessionAfter(
      alpha.schemaName,
      async (tx) => {
        await tx.insert(companies).values({
          name: marker,
          fiscalYearStartMonth: 1,
          timezone: "America/New_York",
          createdBy: randomUUID(),
        });
        throw new Error("boom");
      },
    );

    expect(outcome.ok).toBe(false);
    expect(sessionScopeAfter).not.toContain(alpha.schemaName);

    const rows = await withTenantDb(ctxFor(alpha, ""), (tx) =>
      tx.select().from(companies).where(eq(companies.name, marker)),
    );
    expect(rows).toHaveLength(0);
  });
});
