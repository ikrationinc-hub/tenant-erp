import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(input: SendMailInput): Promise<void>;
}

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Native fetch, not the `resend` SDK - their send endpoint is a single JSON
 * POST, so a whole SDK dependency buys nothing here. Node 22 ships fetch
 * built in.
 */
export const resendMailer: Mailer = {
  async send(input: SendMailInput): Promise<void> {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_ADDRESS}>`,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Resend send failed");
      throw new Error(`Resend send failed with status ${response.status}`);
    }
  },
};

let activeMailer: Mailer = resendMailer;

export function getMailer(): Mailer {
  return activeMailer;
}

/**
 * Test-only seam: lets tests inject a fake Mailer that captures sends
 * in-process instead of calling the real Resend API - no network calls, no
 * real emails, deterministic, and the raw invite token (never present in
 * any HTTP response body) becomes observable to the test that sent it.
 */
export function setMailer(mailer: Mailer): void {
  activeMailer = mailer;
}

export function resetMailer(): void {
  activeMailer = resendMailer;
}
