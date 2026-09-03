import { promisify } from "node:util";
import libre from "libreoffice-convert";

// libreoffice-convert's `convert` is callback-based per its own .d.ts (the
// contract promisify is designed for), but its implementation internally
// wraps async.auto() and happens to also return that internal Promise -
// Node's util.promisify prints a DEP0174 warning about "promisifying a
// function that already returns a Promise" because of this, even though
// the actual result delivery is via the callback, exactly as promisify
// expects. Harmless upstream wrinkle, not a bug in this wrapper.
const convertAsync = promisify(libre.convert);

/**
 * C-2 item 2: DOCX -> PDF via LibreOffice headless, invoked here (the
 * worker), never the API process. libreoffice-convert shells out to
 * `soffice --headless --convert-to pdf`, using a per-call
 * `-env:UserInstallation` temp profile internally - this is what makes
 * concurrent conversions safe without profile-lock collisions, which a
 * hand-rolled execFile of the same CLI would not get for free.
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  return convertAsync(docxBuffer, ".pdf", undefined);
}
