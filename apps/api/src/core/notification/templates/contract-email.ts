import type { MailAttachment, SendMailInput } from "../mailer.js";

export interface ContractEmailInput {
  to: string;
  contractNumber: string;
  companyName: string;
  pdfBytes: Buffer;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildContractEmail(input: ContractEmailInput): SendMailInput {
  const safeCompanyName = escapeHtml(input.companyName);
  const safeContractNumber = escapeHtml(input.contractNumber);
  const attachment: MailAttachment = {
    filename: `${input.contractNumber}.pdf`,
    content: input.pdfBytes,
  };

  return {
    to: input.to,
    subject: `Contract ${input.contractNumber} from ${input.companyName}`,
    text: [`Please find attached contract ${input.contractNumber} from ${input.companyName}.`].join("\n\n"),
    html: [`<p>Please find attached contract <strong>${safeContractNumber}</strong> from <strong>${safeCompanyName}</strong>.</p>`].join("\n"),
    attachments: [attachment],
  };
}
