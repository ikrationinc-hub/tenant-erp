import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDbPool } from "../../../config/db.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, numberSeries } from "../../../database/tenant/schema.js";
import { nextNumber } from "../next-number.js";

const TEST_TIMEOUT_MS = 120_000;

interface SeededCompany {
  tenant: ProvisionedTenant;
  companyId: string;
}

async function seedCompany(label: string, fiscalYearStartMonth = 1): Promise<SeededCompany> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const companyId = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        name: `${label} Co`,
        countryCode: "US",
        currencyCode: "USD",
        fiscalYearStartMonth,
        timezone: "America/New_York",
        createdBy: randomUUID(),
      })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    return company.id;
  });

  return { tenant, companyId };
}

async function seedSeries(
  tenant: ProvisionedTenant,
  companyId: string,
  input: { docType: string; fiscalYear: number; prefixPattern: string; padding: number },
): Promise<void> {
  await withTenantSchema(tenant.schemaName, (tx) =>
    tx.insert(numberSeries).values({
      companyId,
      docType: input.docType,
      prefixPattern: input.prefixPattern,
      fiscalYear: input.fiscalYear,
      padding: input.padding,
      createdBy: randomUUID(),
    }),
  );
}

describe("core/numbering: nextNumber", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });

  it(
    "100 concurrent transactions issue 100 unique, sequential, gapless numbers",
    async () => {
      const { tenant, companyId } = await seedCompany("numbering-concurrency");
      await seedSeries(tenant, companyId, {
        docType: "PO",
        fiscalYear: 2024,
        prefixPattern: "PO-{FY}-{0000}",
        padding: 4,
      });

      const date = new Date("2024-06-15T00:00:00Z");
      const CONCURRENCY = 100;

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          withTenantSchema(tenant.schemaName, (tx) =>
            nextNumber(tx, { companyId, docType: "PO", date }),
          ),
        ),
      );

      expect(new Set(results).size).toBe(CONCURRENCY);

      const sequenceNumbers = results
        .map((docNumber) => {
          const match = /PO-2024-(\d{4})/.exec(docNumber);
          if (!match?.[1]) {
            throw new Error(`unexpected document number shape: ${docNumber}`);
          }
          return Number(match[1]);
        })
        .sort((a, b) => a - b);

      expect(sequenceNumbers).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));

      const [series] = await withTenantSchema(tenant.schemaName, (tx) =>
        tx
          .select()
          .from(numberSeries)
          .where(
            and(
              eq(numberSeries.companyId, companyId),
              eq(numberSeries.docType, "PO"),
              eq(numberSeries.fiscalYear, 2024),
            ),
          ),
      );
      expect(series?.currentValue).toBe(CONCURRENCY);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a rolled-back transaction does not consume a number",
    async () => {
      const { tenant, companyId } = await seedCompany("numbering-rollback");
      await seedSeries(tenant, companyId, {
        docType: "INV",
        fiscalYear: 2024,
        prefixPattern: "INV-{0000}",
        padding: 4,
      });

      const date = new Date("2024-03-01T00:00:00Z");

      let numberFromRolledBackAttempt: string | undefined;
      await expect(
        withTenantSchema(tenant.schemaName, async (tx) => {
          numberFromRolledBackAttempt = await nextNumber(tx, { companyId, docType: "INV", date });
          throw new Error("deliberate rollback");
        }),
      ).rejects.toThrow("deliberate rollback");

      expect(numberFromRolledBackAttempt).toBe("INV-0001");

      const realNumber = await withTenantSchema(tenant.schemaName, (tx) =>
        nextNumber(tx, { companyId, docType: "INV", date }),
      );

      // The rolled-back attempt's number is issued again - proving it was
      // never actually consumed - rather than skipped as a gap.
      expect(realNumber).toBe("INV-0001");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fiscal year is derived from the company's fiscal_year_start_month, not the calendar year",
    async () => {
      const { tenant, companyId } = await seedCompany("numbering-fiscal-year", 4);
      // FY start month = April: Feb 2025 falls in the fiscal year that
      // started April 2024, so fiscal year label is 2024.
      await seedSeries(tenant, companyId, {
        docType: "PO",
        fiscalYear: 2024,
        prefixPattern: "PO-{FY}-{00}",
        padding: 2,
      });

      const result = await withTenantSchema(tenant.schemaName, (tx) =>
        nextNumber(tx, { companyId, docType: "PO", date: new Date("2025-02-15T00:00:00Z") }),
      );

      expect(result).toBe("PO-2024-01");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rolls over to a new fiscal year automatically, inheriting the prior year's pattern/padding",
    async () => {
      const { tenant, companyId } = await seedCompany("numbering-rollover");
      await seedSeries(tenant, companyId, {
        docType: "PO",
        fiscalYear: 2023,
        prefixPattern: "PO-{FY}-{000}",
        padding: 3,
      });
      // Issue one number in 2023 so we can confirm 2024 starts fresh at 1, not 2.
      await withTenantSchema(tenant.schemaName, (tx) =>
        nextNumber(tx, { companyId, docType: "PO", date: new Date("2023-06-01T00:00:00Z") }),
      );

      const result = await withTenantSchema(tenant.schemaName, (tx) =>
        nextNumber(tx, { companyId, docType: "PO", date: new Date("2024-01-15T00:00:00Z") }),
      );

      expect(result).toBe("PO-2024-001");
    },
    TEST_TIMEOUT_MS,
  );
});
