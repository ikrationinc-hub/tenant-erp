import PizZip from "pizzip";

/**
 * Builds a minimal, REAL, valid .docx file in memory - not a mock, not a
 * stub. A .docx is just a zip archive of OOXML parts; this hand-assembles
 * the mandatory parts ([Content_Types].xml, _rels/.rels, word/document.xml,
 * word/_rels/document.xml.rels) so tests exercise docxtemplater and
 * LibreOffice against a genuine Word document, matching what a template
 * author would produce by typing {{tokens}} directly into Word and saving.
 *
 * The body paragraph text is the ONLY caller-supplied content - every
 * other part is fixed OOXML boilerplate every .docx needs.
 */
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

/** One <w:p> per line of `bodyLines`, each line its own paragraph - simplest possible valid body that still reads naturally as a real clause document. */
function buildDocumentXml(bodyLines: string[]): string {
  const paragraphs = bodyLines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr/>
  </w:body>
</w:document>`;
}

export function buildClauseDocxTemplate(bodyLines: string[]): Buffer {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS_XML);
  zip.file("word/document.xml", buildDocumentXml(bodyLines));
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS_XML);
  return zip.generate({ type: "nodebuffer" });
}

/**
 * The realistic ~8-placeholder clause C-2 item 5 asks for, spanning
 * seller/buyer/commercial/shipment - matches build-context.ts's proposed
 * token namespace exactly.
 */
export const SPIKE_CLAUSE_TEXT = [
  "SALE AND DELIVERY TERMS",
  "",
  "This agreement is between {{seller.name}}, of {{seller.address}} (the Seller),",
  "and {{buyer.name}}, of {{buyer.address}} (the Buyer).",
  "",
  "The Seller agrees to deliver {{commercial.quantity}} units at a rate of",
  "{{commercial.currency}} {{commercial.rate}} per unit, to be shipped via",
  "{{shipment.port}}, with an estimated arrival of {{shipment.eta}}.",
  "",
  "Payment terms: {{payment.terms}}, due by {{payment.dueDate}}.",
].join("\n");

export function buildSpikeClauseTemplate(): Buffer {
  return buildClauseDocxTemplate(SPIKE_CLAUSE_TEXT.split("\n"));
}
