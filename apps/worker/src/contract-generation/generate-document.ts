import { convertDocxToPdf } from "./pdf-converter.js";
import { renderDocx } from "./docx-renderer.js";
import { resolvePlaceholders, type PlaceholderContext } from "./placeholder-resolver.js";
import { storeGeneratedDocument } from "./store-generated-document.js";

export interface GenerateDocumentInput {
  tenantSchema: string;
  companyId: string;
  /** clause_versions.clause_text - the source of truth for which tokens MUST resolve (C-1). */
  clauseText: string;
  /** The .docx TEMPLATE file - a Word document whose body contains the same {{tokens}} as clauseText, typed by whoever authored the template in Word. */
  templateBuffer: Buffer;
  context: PlaceholderContext;
  moneyTokens: readonly string[];
  filenameBase: string;
  /** Where the generated files get stored - a clause spike (C-2) keyed by clauseVersionId; a whole-contract generation (C-3b) keys by contractId. Kept generic rather than clause-specific now that this function serves both callers. */
  storageScopeId: string;
}

export interface GenerateDocumentResult {
  docxStorageKey: string;
  pdfStorageKey: string;
}

/**
 * THE pipeline docs/CONTRACT-MODULE-BUILD.md C-2 item 4 asks for: clause +
 * context -> substitute -> render DOCX -> convert to PDF -> store both ->
 * return both references. Runs entirely in the worker process (item 4's
 * own requirement, CLAUDE.md's "document generation runs in the worker,
 * never the API"). Fails fast and loud on the first unresolvable token
 * (MissingPlaceholderError/UnresolvedTemplateTagError) - no partial
 * output is ever stored for a clause with an unresolved placeholder.
 *
 * C-3b reuses this UNCHANGED for whole-contract generation: the caller
 * (contract-generation.worker.ts) passes a single `clauseText` that is
 * the ALREADY-SNAPSHOTTED, already-resolved concatenation of every
 * contract_clauses.resolved_text row (assembled in the API, at snapshot
 * time - see contract-assembly.service.ts) - resolvePlaceholders below is
 * then a no-op pass-through for a whole-contract job (no {{tokens}}
 * remain in already-resolved text), and only genuinely substitutes
 * anything for C-2's own single-clause spike path, which still calls this
 * with a raw, unresolved clause_versions.clause_text.
 */
export async function generateDocument(input: GenerateDocumentInput): Promise<GenerateDocumentResult> {
  const { values } = resolvePlaceholders(input.clauseText, input.context, { moneyTokens: input.moneyTokens });

  const docxBuffer = renderDocx(input.templateBuffer, values);
  const pdfBuffer = await convertDocxToPdf(docxBuffer);

  const [docxStorageKey, pdfStorageKey] = await Promise.all([
    storeGeneratedDocument({
      tenantSchema: input.tenantSchema,
      companyId: input.companyId,
      storageScopeId: input.storageScopeId,
      filename: `${input.filenameBase}.docx`,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: docxBuffer,
    }),
    storeGeneratedDocument({
      tenantSchema: input.tenantSchema,
      companyId: input.companyId,
      storageScopeId: input.storageScopeId,
      filename: `${input.filenameBase}.pdf`,
      contentType: "application/pdf",
      body: pdfBuffer,
    }),
  ]);

  return { docxStorageKey, pdfStorageKey };
}
