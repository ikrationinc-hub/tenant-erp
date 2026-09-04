import type { SendMailInput } from "../mailer.js";

export interface ContractApprovalEmailInput {
  to: string;
  contractNumber: string;
  requestedByName: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildContractApprovalEmail(input: ContractApprovalEmailInput): SendMailInput {
  const safeContractNumber = escapeHtml(input.contractNumber);
  const safeRequestedByName = escapeHtml(input.requestedByName);

  return {
    to: input.to,
    subject: `Approval requested: Contract ${input.contractNumber}`,
    text: [`${input.requestedByName} has requested your approval for contract ${input.contractNumber}.`].join("\n\n"),
    html: [`<p><strong>${safeRequestedByName}</strong> has requested your approval for contract <strong>${safeContractNumber}</strong>.</p>`].join("\n"),
  };
}
