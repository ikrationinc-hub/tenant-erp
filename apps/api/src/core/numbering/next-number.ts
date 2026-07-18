import { and, desc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { branches, companies, numberSeries } from "../../database/tenant/schema.js";
import { computeFiscalYear } from "./fiscal-year.js";
import { formatDocumentNumber } from "./format.js";

export interface NextNumberInput {
  companyId: string;
  branchId?: string;
  docType: string;
  date: Date;
}

function seriesWhereClause(input: NextNumberInput, fiscalYear: number) {
  const branchCondition = input.branchId
    ? eq(numberSeries.branchId, input.branchId)
    : isNull(numberSeries.branchId);

  return and(
    eq(numberSeries.companyId, input.companyId),
    branchCondition,
    eq(numberSeries.docType, input.docType),
    eq(numberSeries.fiscalYear, fiscalYear),
  );
}

/**
 * Gapless document numbers (CLAUDE.md rule 7). MUST be called with a `tx`
 * already open on the caller's business transaction - this function never
 * opens its own, so the number issued and the document row it's stamped
 * onto commit or roll back together. `SELECT ... FOR UPDATE` on the series
 * row, never a Postgres SEQUENCE: a SEQUENCE hands out its next value
 * immediately and never gives it back on rollback (nextval() is not
 * transactional), which is precisely the gap this function exists to
 * prevent. The row lock here IS the concurrency control - two concurrent
 * callers for the same series serialize on it, one blocking until the
 * other's transaction commits or rolls back, exactly the guarantee a
 * financial document numbering scheme needs.
 */
export async function nextNumber(tx: TenantTx, input: NextNumberInput): Promise<string> {
  const [company] = await tx
    .select({ fiscalYearStartMonth: companies.fiscalYearStartMonth })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);
  if (!company) {
    throw new Error(`No company found for id ${input.companyId}`);
  }
  const fiscalYear = computeFiscalYear(input.date, company.fiscalYearStartMonth);

  let [series] = await tx
    .select()
    .from(numberSeries)
    .where(seriesWhereClause(input, fiscalYear))
    .for("update");

  if (!series) {
    // No row yet for THIS fiscal year - roll the series over from the most
    // recent prior fiscal year's config (same pattern/padding, a fresh
    // counter), rather than requiring every fiscal year to be pre-configured
    // by hand. A doc_type that has genuinely never been configured at all
    // (no prior row in any fiscal year) has nothing to roll over from, and
    // is a setup error, not a numbering one.
    const [priorYearConfig] = await tx
      .select()
      .from(numberSeries)
      .where(
        and(
          eq(numberSeries.companyId, input.companyId),
          input.branchId ? eq(numberSeries.branchId, input.branchId) : isNull(numberSeries.branchId),
          eq(numberSeries.docType, input.docType),
        ),
      )
      .orderBy(desc(numberSeries.fiscalYear))
      .limit(1);

    if (!priorYearConfig) {
      throw new Error(
        `No number series configured for company ${input.companyId}, docType "${input.docType}" - create one before calling nextNumber`,
      );
    }

    // onConflictDoNothing, not a plain insert: two concurrent callers can
    // both reach this branch for the same brand-new fiscal year (a SELECT
    // ... FOR UPDATE on a row that doesn't exist yet locks nothing) and
    // both attempt this insert. Exactly one wins; the loser's insert is a
    // no-op rather than a thrown unique-violation, and the re-select FOR
    // UPDATE below is what actually serializes them from this point on.
    await tx
      .insert(numberSeries)
      .values({
        companyId: input.companyId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        docType: input.docType,
        prefixPattern: priorYearConfig.prefixPattern,
        fiscalYear,
        currentValue: 0,
        padding: priorYearConfig.padding,
        createdBy: priorYearConfig.createdBy,
      })
      .onConflictDoNothing();

    [series] = await tx
      .select()
      .from(numberSeries)
      .where(seriesWhereClause(input, fiscalYear))
      .for("update");
    if (!series) {
      throw new Error("number series disappeared immediately after insert - this should be impossible");
    }
  }

  const nextValue = series.currentValue + 1;
  await tx
    .update(numberSeries)
    .set({ currentValue: nextValue, updatedAt: new Date() })
    .where(eq(numberSeries.id, series.id));

  let branchCode: string | undefined;
  if (input.branchId) {
    const [branch] = await tx
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, input.branchId))
      .limit(1);
    branchCode = branch?.code;
  }

  return formatDocumentNumber({
    pattern: series.prefixPattern,
    branchCode,
    fiscalYear,
    sequence: nextValue,
    padding: series.padding,
  });
}
