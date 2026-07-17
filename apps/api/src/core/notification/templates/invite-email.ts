import { env } from "../../../config/env.js";
import type { SendMailInput } from "../mailer.js";

export interface InviteEmailInput {
  to: string;
  companyName: string;
  token: string;
}

/**
 * The link points at a not-yet-built frontend route (this is a backend-only
 * prototype - see CLAUDE.md). A frontend would call GET
 * /api/v1/invitations/:token first to render the "you're invited" screen,
 * then POST .../accept with the chosen password; the raw token in this URL
 * is what makes both of those calls possible.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildInviteEmail(input: InviteEmailInput): SendMailInput {
  const acceptUrl = `${env.APP_BASE_URL}/accept-invite?token=${encodeURIComponent(input.token)}`;
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
