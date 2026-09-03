import { writeFile } from "node:fs/promises";
import { buildGenerationContext, MONEY_TOKENS } from "../../src/contract-generation/build-context.js";
import { renderDocx } from "../../src/contract-generation/docx-renderer.js";
import { convertDocxToPdf } from "../../src/contract-generation/pdf-converter.js";
import { resolvePlaceholders } from "../../src/contract-generation/placeholder-resolver.js";
import { buildSpikeClauseTemplate, SPIKE_CLAUSE_TEXT } from "./build-clause-template.js";

/**
 * One-off, run-by-hand script (NOT part of the automated test suite) that
 * writes the C-2 spike's generated DOCX and PDF to real files on disk, so
 * a human can open both and visually confirm they match - the spec's own
 * acceptance criterion that no automated assertion can fully substitute
 * for (a PDF's text is stream-encoded; grepping it proves content
 * survived, not that pagination/layout look right).
 *
 * Run with: pnpm tsx test/fixtures/manual-check.ts
 */
async function main(): Promise<void> {
  const context = buildGenerationContext({
    seller: { name: "Ikration Global LTD", address: "Jebel Ali Free Zone, Dubai, UAE" },
    buyer: { name: "Pacific Metals Trading Pte Ltd", address: "1 Raffles Place, Singapore" },
    commercial: { rate: "8432.75", currency: "USD", quantity: "500" },
    shipment: { port: "Jebel Ali Port", eta: "2026-11-15" },
    payment: { terms: "Net 30", dueDate: "2026-12-15" },
  });

  const { values } = resolvePlaceholders(SPIKE_CLAUSE_TEXT, context, { moneyTokens: MONEY_TOKENS });
  const template = buildSpikeClauseTemplate();
  const docxBuffer = renderDocx(template, values);
  const pdfBuffer = await convertDocxToPdf(docxBuffer);

  await writeFile("/tmp/c2-spike-output.docx", docxBuffer);
  await writeFile("/tmp/c2-spike-output.pdf", pdfBuffer);

  console.log("Wrote /tmp/c2-spike-output.docx and /tmp/c2-spike-output.pdf");
  console.log("Resolved values:", values);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
