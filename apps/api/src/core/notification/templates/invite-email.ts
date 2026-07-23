import { env } from "../../../config/env.js";
import type { SendMailInput } from "../mailer.js";

export interface InviteEmailInput {
  to: string;
  companyName: string;
  token: string;
  tenantSlug: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildInviteEmail(input: InviteEmailInput): SendMailInput {
  /**
   * tenantCode is required here (not just a dev convenience): production
   * resolves tenants from a subdomain (see tenant-resolver.ts), which an
   * emailed link that must work regardless of how the recipient reaches it
   * cannot rely on - so every invite link is self-contained via this query
   * param instead of assuming the click lands on the right subdomain.
   */
  const acceptUrl = `${env.WEB_APP_BASE_URL}/accept-invitation/${encodeURIComponent(input.token)}?tenantCode=${encodeURIComponent(input.tenantSlug)}`;
  const safeCompanyName = escapeHtml(input.companyName);

  return {
    to: input.to,
    subject: `You're invited to join ${input.companyName}`,
    text: [
      `You've been invited to join ${input.companyName}.`,
      `Set your password here: ${acceptUrl}`,
      `This link expires in 72 hours and can only be used once.`,
    ].join("\n\n"),
    html: [
      `<p>You've been invited to join <strong>${safeCompanyName}</strong>.</p>`,
      `<p><a href="${acceptUrl}">Set your password</a></p>`,
      `<p>This link expires in 72 hours and can only be used once.</p>`,
    ].join("\n"),
  };
}
