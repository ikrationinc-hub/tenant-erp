import { eq } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { companies, numberSeries } from "../../database/tenant/schema.js";
import { computeFiscalYear } from "../numbering/fiscal-year.js";

export interface SeedNumberSeriesInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
  /** Defaults to now() - a test can pin this to make the seeded fiscal year deterministic. */
  date?: Date;
}

interface DefaultSeries {
  docType: string;
  prefixPattern: string;
  padding: number;
}

/** Just enough to prove the mechanism works out of the box - a real tenant configures the rest via core/numbering directly once Purchase (or another numbered document type) has real routes. */
const DEFAULT_SERIES: DefaultSeries[] = [{ docType: "PO", prefixPattern: "PO-{FY}-{0000}", padding: 4 }];

/** Idempotent: number_series' own (company, branch, doc_type, fiscal_year) unique constraint (nullsNotDistinct) makes a second insert for the same series a no-op via onConflictDoNothing - re-running provisioning never resets an in-flight counter. */
export async function seedDefaultNumberSeries(input: SeedNumberSeriesInput): Promise<void> {
  await withTenantSchema(input.schemaName, async (tx) => {
    const [company] = await tx
      .select({ fiscalYearStartMonth: companies.fiscalYearStartMonth })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1);
    if (!company) {
      throw new Error(`No company found for id ${input.companyId}`);
    }
    const fiscalYear = computeFiscalYear(input.date ?? new Date(), company.fiscalYearStartMonth);

    for (const series of DEFAULT_SERIES) {
      await tx
        .insert(numberSeries)
        .values({
          companyId: input.companyId,
          docType: series.docType,
          prefixPattern: series.prefixPattern,
          fiscalYear,
          padding: series.padding,
          createdBy: input.createdBy,
        })
        .onConflictDoNothing();
    }
  });
}
