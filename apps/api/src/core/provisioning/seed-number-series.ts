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
const DEFAULT_SERIES: DefaultSeries[] = [
  { docType: "PO", prefixPattern: "PO-{FY}-{0000}", padding: 4 },
  // FR-002 (docs/spec/Purchase-V2.md Sub Tab 1): supplier code is auto-generated,
  // company-wide (no fiscal year in the pattern - a supplier isn't a fiscal document).
  { docType: "SUPPLIER", prefixPattern: "SUP-{0000}", padding: 4 },
  // Prompt 21 item 4: broker code, same reasoning as SUPPLIER above.
  { docType: "BROKER", prefixPattern: "BRK-{0000}", padding: 4 },
  // Prompt 22: a supplier invoice is its own fiscal document (rule 7),
  // numbered independently of the purchase it's linked to - same {FY}
  // pattern as PO, not SUPPLIER/BROKER's company-wide one.
  { docType: "SUPPLIER_INVOICE", prefixPattern: "SINV-{FY}-{0000}", padding: 4 },
  // PL-1: a purchase receipt is its own fiscal document too - same {FY}
  // pattern as PO/SUPPLIER_INVOICE, numbered independently of both.
  // CLAUDE.md's Vocabulary section: "Purchase Receipt" is the provisional
  // canonical term (PR-) until the client confirms GRN, which would win
  // if/when they do - not a hard rename now.
  { docType: "PURCHASE_RECEIPT", prefixPattern: "PR-{FY}-{0000}", padding: 4 },
  // PL-2: the Bill (renamed from Prompt 22's "Supplier Invoice",
  // CLAUDE.md's Vocabulary section) gets its own series going forward -
  // SUPPLIER_INVOICE is left alone, never reused, so historical
  // SINV-numbered bills keep their numbers (numbering is never rewritten,
  // rule 8's spirit).
  { docType: "BILL", prefixPattern: "BILL-{FY}-{0000}", padding: 4 },
  // PL-5: Payment, the 4th and final lifecycle document - its own fiscal
  // document, same {FY} pattern as PO/BILL/PURCHASE_RECEIPT.
  { docType: "PAYMENT", prefixPattern: "PAY-{FY}-{0000}", padding: 4 },
];

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
