import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { buildGenerationContext, MONEY_TOKENS } from "../build-context.js";
import { renderDocx, UnresolvedTemplateTagError } from "../docx-renderer.js";
import { convertDocxToPdf } from "../pdf-converter.js";
import { MissingPlaceholderError, resolvePlaceholders } from "../placeholder-resolver.js";
import { buildSpikeClauseTemplate, SPIKE_CLAUSE_TEXT } from "../../../test/fixtures/build-clause-template.js";

/**
 * THE spike docs/CONTRACT-MODULE-BUILD.md C-2 exists to prove: a clause
 * with {{placeholders}} resolves against live data and renders to Word
 * AND PDF that match, on ONE clause, before any contract UI exists.
 * generateDocument itself (the full pipeline including S3 storage) needs
 * a running MinIO, so it's exercised separately/manually per this task's
 * README note - these tests prove every step UP TO storage: resolution,
 * DOCX rendering, and PDF conversion via a REAL LibreOffice invocation,
 * against a REAL (if minimal) .docx file, not a mock.
 */
const REALISTIC_CONTEXT = buildGenerationContext({
  seller: { name: "Ikration Global LTD", address: "Jebel Ali Free Zone, Dubai, UAE" },
  buyer: { name: "Pacific Metals Trading Pte Ltd", address: "1 Raffles Place, Singapore" },
  commercial: { rate: "8432.75", currency: "USD", quantity: "500" },
  shipment: { port: "Jebel Ali Port", eta: "2026-11-15" },
  payment: { terms: "Net 30", dueDate: "2026-12-15" },
});

function extractDocxBodyText(docxBuffer: Buffer): string {
  const zip = new PizZip(docxBuffer);
  const documentXml = zip.file("word/document.xml")?.asText();
  if (!documentXml) {
    throw new Error("word/document.xml missing from generated docx");
  }
  return documentXml;
}

describe("C-2 spike: placeholder resolution", () => {
  it("resolves all 11 placeholders across seller/buyer/commercial/shipment/payment", () => {
    const { values } = resolvePlaceholders(SPIKE_CLAUSE_TEXT, REALISTIC_CONTEXT, { moneyTokens: MONEY_TOKENS });

    expect(Object.keys(values)).toHaveLength(11);
    expect(values["seller.name"]).toBe("Ikration Global LTD");
    expect(values["seller.address"]).toBe("Jebel Ali Free Zone, Dubai, UAE");
    expect(values["buyer.name"]).toBe("Pacific Metals Trading Pte Ltd");
    expect(values["buyer.address"]).toBe("1 Raffles Place, Singapore");
    expect(values["commercial.quantity"]).toBe("500");
    expect(values["commercial.currency"]).toBe("USD");
    expect(values["shipment.port"]).toBe("Jebel Ali Port");
    expect(values["shipment.eta"]).toBe("2026-11-15");
    expect(values["payment.terms"]).toBe("Net 30");
    expect(values["payment.dueDate"]).toBe("2026-12-15");
  });

  it("money renders formatted and correct - 8,432.75, not 8432.749999", () => {
    const { values } = resolvePlaceholders(SPIKE_CLAUSE_TEXT, REALISTIC_CONTEXT, { moneyTokens: MONEY_TOKENS });
    expect(values["commercial.rate"]).toBe("8,432.75");
  });

  it("rounds a full-precision decimal string correctly via decimal.js, never float drift", () => {
    const context = buildGenerationContext({
      seller: { name: "x", address: "x" },
      buyer: { name: "x", address: "x" },
      commercial: { rate: "8432.7499999999999", currency: "USD", quantity: "1" },
      shipment: { port: "x", eta: "x" },
      payment: { terms: "x", dueDate: "x" },
    });
    const { values } = resolvePlaceholders("{{commercial.rate}}", context, { moneyTokens: MONEY_TOKENS });
    expect(values["commercial.rate"]).toBe("8,432.75");
  });

  it("a missing placeholder raises a clear error, not a blank", () => {
    const incompleteContext = buildGenerationContext({
      seller: { name: "Ikration Global LTD", address: "Jebel Ali Free Zone, Dubai, UAE" },
      buyer: { name: "Pacific Metals Trading Pte Ltd", address: "1 Raffles Place, Singapore" },
      commercial: { rate: "8432.75", currency: "USD", quantity: "500" },
      shipment: { port: "Jebel Ali Port", eta: "2026-11-15" },
      payment: { terms: "Net 30", dueDate: "2026-12-15" },
    });
    // Simulate a clause referencing a token the namespace doesn't provide.
    const clauseTextWithUnknownToken = "Special condition: {{commercial.brokerFee}}.";

    expect(() => resolvePlaceholders(clauseTextWithUnknownToken, incompleteContext)).toThrow(MissingPlaceholderError);
    expect(() => resolvePlaceholders(clauseTextWithUnknownToken, incompleteContext)).toThrow(/commercial\.brokerFee/);
  });
});

describe("C-2 spike: DOCX rendering (real docxtemplater against a real .docx)", () => {
  it("all placeholders resolve; the generated DOCX contains the substituted values", () => {
    const { values } = resolvePlaceholders(SPIKE_CLAUSE_TEXT, REALISTIC_CONTEXT, { moneyTokens: MONEY_TOKENS });
    const template = buildSpikeClauseTemplate();

    const outputDocx = renderDocx(template, values);
    const bodyText = extractDocxBodyText(outputDocx);

    expect(bodyText).toContain("Ikration Global LTD");
    expect(bodyText).toContain("Jebel Ali Free Zone, Dubai, UAE");
    expect(bodyText).toContain("Pacific Metals Trading Pte Ltd");
    expect(bodyText).toContain("8,432.75");
    expect(bodyText).toContain("Jebel Ali Port");
    expect(bodyText).toContain("2026-11-15");
    expect(bodyText).toContain("Net 30");
    // No unsubstituted {{token}} survives into the output.
    expect(bodyText).not.toMatch(/\{\{[a-zA-Z0-9_.]+\}\}/);
    // docxtemplater's own default missing-value rendering ("undefined")
    // must never appear - this is the exact spec-flagged risk.
    expect(bodyText).not.toContain("undefined");
  });

  it("a template tag with no resolved value throws, never renders a blank or the word 'undefined'", () => {
    const template = buildSpikeClauseTemplate();
    // Deliberately omit commercial.rate from the resolved values passed to
    // the renderer - simulates a template that references a tag the
    // resolver never saw/populated.
    const { values } = resolvePlaceholders(SPIKE_CLAUSE_TEXT, REALISTIC_CONTEXT, { moneyTokens: MONEY_TOKENS });
    delete values["commercial.rate"];

    expect(() => renderDocx(template, values)).toThrow(UnresolvedTemplateTagError);
  });
});

describe("C-2 spike: DOCX -> PDF (real LibreOffice headless conversion)", () => {
  it(
    "converts the generated DOCX to a real PDF",
    async () => {
      const { values } = resolvePlaceholders(SPIKE_CLAUSE_TEXT, REALISTIC_CONTEXT, { moneyTokens: MONEY_TOKENS });
      const template = buildSpikeClauseTemplate();
      const docxBuffer = renderDocx(template, values);

      const pdfBuffer = await convertDocxToPdf(docxBuffer);

      // %PDF- magic bytes - proves this is a real PDF, not an empty/error buffer.
      expect(pdfBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(pdfBuffer.length).toBeGreaterThan(1000);

      const pdfText = pdfBuffer.toString("latin1");
      // PDF text is stream-encoded, not plain-text-searchable in general,
      // but short ASCII runs without compression often survive - this is a
      // best-effort automated signal, not a substitute for the manual
      // visual check the spec explicitly calls for (see this test file's
      // own top-level doc comment and the ADR).
      const hasReadableFragment = pdfText.includes("Ikration") || pdfText.includes("Jebel");
      if (!hasReadableFragment) {
        console.warn(
          "PDF content is compressed (expected for LibreOffice output) - substituted text could not be verified via raw string search. Manual visual check required (see ADR).",
        );
      }
    },
    60_000,
  );
});
