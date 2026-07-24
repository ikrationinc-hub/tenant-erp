import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { attachmentRowSchema } from "@hyperion/contracts";
import { uploadAttachmentWithProgress } from "./upload-attachment";
import { useAppStore } from "../store/app-store";
import { endpoints } from "../api/endpoints";
import { server } from "../../mocks/server";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Drives the real XMLHttpRequest-with-progress code path end to end
 * through MSW, controlling the SERVER's response directly (rather than
 * relying on the uploaded file's name/content surviving jsdom's XHR+
 * FormData serialization - it doesn't; jsdom's polyfill collapses a real
 * File's name to "blob" before MSW's node interceptor ever sees it, a
 * jsdom limitation, not a product bug). This still exercises the thing
 * FE-6 actually needs proven: progress reporting, and resolve/reject
 * branching on the server's real HTTP status.
 */
describe("uploadAttachmentWithProgress", () => {
  it("reports upload progress and resolves with the server's attachment row once the (synchronous) scan clears it", async () => {
    useAppStore.setState({ accessToken: "access-token" });
    const row = attachmentRowSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "22222222-2222-4222-8222-222222222222",
      entity: "purchase",
      entityId: "44444444-4444-4444-8444-444444444444",
      fieldKey: "invoice",
      filename: "supplier-invoice.pdf",
      contentType: "application/pdf",
      size: 9,
      storageKey: "mock/purchase/purchase-attach/invoice/supplier-invoice.pdf",
      checksum: "mock-checksum",
      scannedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: "11111111-1111-4111-8111-111111111111",
    });
    server.use(
      http.post(`${API_BASE}${endpoints.uploadAttachment("purchase", "44444444-4444-4444-8444-444444444444", "invoice")}`, () =>
        HttpResponse.json(row, { status: 201 }),
      ),
    );
    const progressUpdates: number[] = [];

    const result = await uploadAttachmentWithProgress(
      "purchase",
      "44444444-4444-4444-8444-444444444444",
      "invoice",
      new File(["%PDF-1.4"], "supplier-invoice.pdf", { type: "application/pdf" }),
      (percent) => progressUpdates.push(percent),
    );

    expect(result).toEqual(row);
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.at(-1)).toBe(100);
  });

  it("rejects with the server's virus-scan message instead of resolving", async () => {
    useAppStore.setState({ accessToken: "access-token" });
    server.use(
      http.post(`${API_BASE}${endpoints.uploadAttachment("purchase", "44444444-4444-4444-8444-444444444444", "invoice")}`, () =>
        HttpResponse.json(
          { error: { code: "VIRUS_DETECTED", message: '"infected-invoice.pdf" failed the virus scan and was rejected' } },
          { status: 422 },
        ),
      ),
    );

    await expect(
      uploadAttachmentWithProgress(
        "purchase",
        "44444444-4444-4444-8444-444444444444",
        "invoice",
        new File(["x"], "infected-invoice.pdf", { type: "application/pdf" }),
        () => undefined,
      ),
    ).rejects.toThrow(/failed the virus scan/i);
  });
});
