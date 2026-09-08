import { and, eq, isNull } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { countries, currencies, customers, customerTypes, paymentTerms } from "../src/database/tenant/schema.js";

/**
 * One-off, REQUIRED before migration 0044's customer_type_id/country_id/
 * payment_term_id/currency_id columns can be tightened to NOT NULL (see
 * that migration file's own doc comment): a schema-diff migration can't
 * invent a safe default for a FK to a specific country/currency/payment-
 * term/customer-type, so those 4 columns were added NULLABLE, and any
 * customer row that predates S-1 (docs/SALES-MODULE-PLAN.md) has NULLs in
 * them. This script assigns each such row the first available master row
 * of the right kind for its own company (creating a "General" customer
 * type if the company has none yet, since customer_types is a brand-new
 * table with nothing seeded for any pre-existing tenant) - not a
 * meaningful business default, just enough for the row to satisfy the
 * eventual NOT NULL constraint; a real admin can correct it via the new
 * /customers screen afterward. Idempotent: only touches rows that still
 * have a NULL in one of these columns.
 */
async function backfillTenant(schemaName: string): Promise<{ touched: number }> {
  return withTenantSchema(schemaName, async (tx) => {
    const incompleteRows = await tx
      .select()
      .from(customers)
      .where(
        and(
          isNull(customers.deletedAt),
          // Any one of the 4 newly-nullable FKs being null means this row predates S-1.
          isNull(customers.customerTypeId),
        ),
      );

    let touched = 0;
    for (const row of incompleteRows) {
      let [customerType] = await tx
        .select()
        .from(customerTypes)
        .where(and(eq(customerTypes.companyId, row.companyId), isNull(customerTypes.deletedAt)))
        .limit(1);
      if (!customerType) {
        [customerType] = await tx
          .insert(customerTypes)
          .values({ companyId: row.companyId, code: "GENERAL", name: "General", createdBy: row.createdBy })
          .returning();
      }
      const [country] = await tx
        .select()
        .from(countries)
        .where(and(eq(countries.companyId, row.companyId), isNull(countries.deletedAt)))
        .limit(1);
      const [paymentTerm] = await tx
        .select()
        .from(paymentTerms)
        .where(and(eq(paymentTerms.companyId, row.companyId), isNull(paymentTerms.deletedAt)))
        .limit(1);
      const [currency] = await tx
        .select()
        .from(currencies)
        .where(and(eq(currencies.companyId, row.companyId), isNull(currencies.deletedAt)))
        .limit(1);

      if (!customerType || !country || !paymentTerm || !currency) {
        logger.warn(
          { schemaName, customerId: row.id, companyId: row.companyId },
          "cannot backfill customer - company is missing a required master row (country/payment-term/currency) - fix manually before tightening NOT NULL",
        );
        continue;
      }

      await tx
        .update(customers)
        .set({
          customerTypeId: customerType.id,
          countryId: country.id,
          paymentTermId: paymentTerm.id,
          currencyId: currency.id,
          updatedBy: row.createdBy,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, row.id));
      touched += 1;
      logger.info({ schemaName, customerId: row.id, code: row.code }, "customer required fields backfilled");
    }
    return { touched };
  });
}

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
  let totalTouched = 0;
  for (const tenant of activeTenants) {
    const { touched } = await backfillTenant(tenant.schemaName);
    totalTouched += touched;
    console.log(`  ${tenant.slug} (${tenant.schemaName}): ${touched} customer row(s) backfilled`);
  }
  console.log(`\nOK: ${activeTenants.length} tenant(s) processed, ${totalTouched} customer row(s) backfilled total\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "customer required-fields backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
