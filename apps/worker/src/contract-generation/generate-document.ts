import { convertDocxToPdf } from "./pdf-converter.js";
import { renderDocx } from "./docx-renderer.js";
import { resolvePlaceholders, type PlaceholderContext } from "./placeholder-resolver.js";
import { storeGeneratedDocument } from "./store-generated-document.js";

export interface GenerateDocumentInput {
  tenantSchema: string;
  companyId: string;
  clauseVersionId: string;
  /** clause_versions.clause_text - the source of truth for which tokens MUST resolve (C-1). */
  clauseText: string;
  /** The .docx TEMPLATE file - a Word document whose body contains the same {{tokens}} as clauseText, typed by whoever authored the template in Word. */
  templateBuffer: Buffer;
  context: PlaceholderContext;
  moneyTokens: readonly string[];
  filenameBase: string;
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
 */
export async function generateDocument(input: GenerateDocumentInput): Promise<GenerateDocumentResult> {
  const { values } = resolvePlaceholders(input.clauseText, input.context, { moneyTokens: input.moneyTokens });

  const docxBuffer = renderDocx(input.templateBuffer, values);
  const pdfBuffer = await convertDocxToPdf(docxBuffer);

  const [docxStorageKey, pdfStorageKey] = await Promise.all([
    storeGeneratedDocument({
      tenantSchema: input.tenantSchema,
      companyId: input.companyId,
      clauseVersionId: input.clauseVersionId,
      filename: `${input.filenameBase}.docx`,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: docxBuffer,
    }),
    storeGeneratedDocument({
      tenantSchema: input.tenantSchema,
      companyId: input.companyId,
      clauseVersionId: input.clauseVersionId,
      filename: `${input.filenameBase}.pdf`,
      contentType: "application/pdf",
      body: pdfBuffer,
    }),
  ]);

  return { docxStorageKey, pdfStorageKey };
}
