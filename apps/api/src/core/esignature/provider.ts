import { randomUUID } from "node:crypto";
import { logger } from "../../config/logger.js";

/**
 * C-4 item 5 - "provider is an open client question; on-prem may block
 * outbound. Build an ESignatureProvider abstraction (send, status,
 * webhook) with ONE stub/mock implementation. Do NOT integrate a real
 * provider until the client names one and confirms network access."
 *
 * Mirrors core/notification/mailer.ts's own shape exactly (interface +
 * one real-ish implementation + getX/setX/resetX test seam) since that's
 * this codebase's own established pattern for "one abstraction, one
 * pluggable implementation, swappable in tests" - no new pattern invented
 * here. `send` returns a provider-assigned request id the caller stores
 * (contracts.esignatureRequestId) to correlate a later `status`/webhook
 * call back to the right contract.
 */
export interface ESignatureSendInput {
  contractId: string;
  contractNumber: string;
  signerEmail: string;
  pdfBytes: Buffer;
}

export interface ESignatureSendResult {
  requestId: string;
}

export type ESignatureStatus = "sent" | "signed" | "declined";

export interface ESignatureStatusResult {
  requestId: string;
  status: ESignatureStatus;
}

/**
 * The shape a real provider's webhook payload is expected to reduce to,
 * once one is chosen - deliberately minimal (requestId + status) since no
 * real provider's actual webhook schema is known yet.
 */
export interface ESignatureWebhookPayload {
  requestId: string;
  status: ESignatureStatus;
}

export interface ESignatureProvider {
  send(input: ESignatureSendInput): Promise<ESignatureSendResult>;
  getStatus(requestId: string): Promise<ESignatureStatusResult>;
  parseWebhook(payload: unknown): ESignatureWebhookPayload;
}

/**
 * The ONE stub/mock implementation the spec asks for - no outbound call,
 * no real signing, ever. `send` immediately records the request as "sent"
 * in an in-process map; `getStatus` reads it back. There is deliberately
 * no way to make a stub request become "signed" other than through
 * parseWebhook (see the contract module's own test for how a test
 * simulates a signed callback) - this stub exists to prove the
 * abstraction and the UI/API wiring work end-to-end, not to simulate real
 * signer behavior.
 */
class StubESignatureProvider implements ESignatureProvider {
  private readonly requests = new Map<string, ESignatureStatus>();

  send(input: ESignatureSendInput): Promise<ESignatureSendResult> {
    const requestId = `stub_${randomUUID()}`;
    this.requests.set(requestId, "sent");
    logger.info(
      { requestId, contractId: input.contractId, contractNumber: input.contractNumber, signerEmail: input.signerEmail },
      "stub e-signature request created (no real provider wired - C-4 item 5)",
    );
    return Promise.resolve({ requestId });
  }

  getStatus(requestId: string): Promise<ESignatureStatusResult> {
    const status = this.requests.get(requestId);
    if (!status) {
      throw new Error(`Unknown stub e-signature request: ${requestId}`);
    }
    return Promise.resolve({ requestId, status });
  }

  parseWebhook(payload: unknown): ESignatureWebhookPayload {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid e-signature webhook payload");
    }
    const { requestId, status } = payload as Record<string, unknown>;
    if (typeof requestId !== "string" || (status !== "sent" && status !== "signed" && status !== "declined")) {
      throw new Error("Invalid e-signature webhook payload");
    }
    this.requests.set(requestId, status);
    return { requestId, status };
  }
}

export const stubESignatureProvider: ESignatureProvider = new StubESignatureProvider();

let activeProvider: ESignatureProvider = stubESignatureProvider;

export function getESignatureProvider(): ESignatureProvider {
  return activeProvider;
}

/** Test-only seam, same shape as setMailer/resetMailer. */
export function setESignatureProvider(provider: ESignatureProvider): void {
  activeProvider = provider;
}

export function resetESignatureProvider(): void {
  activeProvider = stubESignatureProvider;
}
