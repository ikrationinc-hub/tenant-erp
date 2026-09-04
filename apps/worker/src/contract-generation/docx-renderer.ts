import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/**
 * C-2: renders a .docx TEMPLATE (a Word file whose body contains
 * {{dotted.token}} placeholders, e.g. produced by exporting a clause's
 * text into a .docx shell) against already-resolved values.
 *
 * Delimiters are configured as {{ }} (docxtemplater's own default is
 * single braces, {token}) so the SAME token syntax used everywhere else
 * in this module - clause_text's own {{tokens}}, C-1's extractPlaceholder
 * Tokens - is also what the .docx template author types into Word. A dot
 * in a docxtemplater tag is a nested-path lookup by default; passing a
 * FLAT `{ "seller.name": "..." }` object (dotted keys, not nested objects)
 * bypasses that path resolution entirely, since placeholder-resolver.ts's
 * ResolvedPlaceholders is already fully resolved, flat, display-ready
 * strings - docxtemplater is only ever asked to substitute, never to
 * itself walk the context object.
 *
 * nullGetter is set to THROW, not docxtemplater's own default (which
 * renders the literal string "undefined" into the document - a
 * spec-flagged risk this module deliberately does not accept). In
 * practice this should never fire: placeholder-resolver.ts already threw
 * MissingPlaceholderError before this function is ever called, for every
 * token clauseText itself declares. This guards the DIFFERENT case where
 * the .docx template file contains a tag that clauseText's own {{}} scan
 * never saw (e.g. the template was hand-edited and now references a
 * token nobody validated) - it must fail exactly as loudly as a missing
 * clauseText token would.
 */
export class UnresolvedTemplateTagError extends Error {
  constructor(readonly tag: string) {
    super(`The .docx template contains {{${tag}}}, which was never resolved - refusing to render a blank`);
    this.name = "UnresolvedTemplateTagError";
  }
}

export function renderDocx(templateBuffer: Buffer, resolvedValues: Record<string, string>): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part: { value: string }) => {
      throw new UnresolvedTemplateTagError(part.value);
    },
  });

  doc.render(resolvedValues);
  return doc.toBuffer();
}
