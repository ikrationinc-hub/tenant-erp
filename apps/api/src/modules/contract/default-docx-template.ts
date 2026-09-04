import PizZip from "pizzip";

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

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraph(text: string, opts?: { bold?: boolean; center?: boolean; size?: number }): string {
  const rPr = [opts?.bold ? "<w:b/>" : "", opts?.size ? `<w:sz w:val="${opts.size}"/>` : ""].join("");
  const pPr = [opts?.center ? "<w:jc w:val=\"center\"/>" : "", rPr ? `<w:rPr>${rPr}</w:rPr>` : ""].join("");
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`;
}

/**
 * Builds a minimal but genuinely valid .docx (real OOXML zip, not a text
 * file) carrying the module's own {{token}} placeholders unfilled - this
 * is a STARTING SHELL for a template author to open in Word and restyle,
 * or the FALLBACK generation.service.ts reaches for when a contract has no
 * template attachment at all. Either way it's a plain letterhead: title,
 * {{contractBody}} (required - see contract-generation.service.ts's own
 * doc comment on why the assembled clause text is passed as this single
 * token, never inlined literally), and seller/buyer for context. No
 * dependency on docxtemplater here - this AUTHORS a fresh file rather than
 * filling one, so raw PizZip + hand-built OOXML is all that's needed.
 */
export function buildDefaultContractDocx(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph("CONTRACT", { bold: true, center: true, size: 32 })}
    <w:p/>
    ${paragraph("{{contractBody}}")}
    <w:p/>
    ${paragraph("Seller: {{seller.name}}")}
    ${paragraph("Buyer: {{buyer.name}}")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS_XML);
  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
