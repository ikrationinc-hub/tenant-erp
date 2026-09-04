import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Form, Input, Modal, Select, Space, Tag, Tooltip } from "antd";
import { FileDoneOutlined, MailOutlined, PrinterOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";

interface UserOption {
  value: string;
  label: string;
}

const ESIGNATURE_STATUS_COLORS: Record<string, string> = {
  not_sent: "default",
  sent: "blue",
  signed: "green",
  declined: "red",
};

export interface ContractActionsPanelProps {
  contractId: string;
  approvalRequestedFor: string | null;
  esignatureStatus: "not_sent" | "sent" | "signed" | "declined";
  lastEmailedTo: string | null;
  hasGeneratedDocument: boolean;
}

/**
 * C-4 item 4/5/6's own action surface, kept as one panel so the contract
 * detail screen's own Card layout stays simple - Send for Approval /
 * Send for E-signature (stub) / Email / Print. "Print" is just the
 * browser's own print dialog against the preview pane already on this
 * screen - no server endpoint exists or is needed for it.
 *
 * Email and Send for E-signature both need lastGeneratedPdfKey to exist
 * server-side (the backend already 409s without it - contracts.service.ts's
 * own emailContract/sendForESignature guards) - hasGeneratedDocument
 * disables both buttons up front instead of letting the user submit a
 * modal only to get a rejection, since "generate a document first" is
 * discoverable without a round-trip.
 */
export function ContractActionsPanel({ contractId, approvalRequestedFor, esignatureStatus, lastEmailedTo, hasGeneratedDocument }: ContractActionsPanelProps): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [esignModalOpen, setEsignModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [approvalForm] = Form.useForm<{ approverId: string }>();
  const [esignForm] = Form.useForm<{ signerEmail: string }>();
  const [emailForm] = Form.useForm<{ to: string }>();

  const userOptionsQuery = useQuery({
    queryKey: ["user-options"],
    queryFn: () => apiFetch<{ options: UserOption[] }>(endpoints.userOptions),
    enabled: approvalModalOpen,
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["contract", contractId] });
  }

  async function handleSendForApproval(values: { approverId: string }): Promise<void> {
    try {
      await apiFetch(endpoints.sendContractForApproval(contractId), { method: "POST", body: values });
      void message.success("Sent for approval");
      setApprovalModalOpen(false);
      invalidate();
    } catch {
      void message.error("Could not send for approval");
    }
  }

  async function handleSendForESignature(values: { signerEmail: string }): Promise<void> {
    try {
      await apiFetch(endpoints.sendContractForESignature(contractId), { method: "POST", body: values });
      void message.success("Sent for e-signature (stub provider - no real signature request was sent)");
      setEsignModalOpen(false);
      invalidate();
    } catch {
      void message.error("Could not send for e-signature - has this contract been generated yet?");
    }
  }

  async function handleEmail(values: { to: string }): Promise<void> {
    try {
      await apiFetch(endpoints.emailContract(contractId), { method: "POST", body: values });
      void message.success("Contract emailed");
      setEmailModalOpen(false);
      invalidate();
    } catch {
      void message.error("Could not email this contract - has it been generated yet?");
    }
  }

  /**
   * window.print() on the app page itself would print the SPA's own
   * chrome (sidebar, nav, buttons) - not the contract. This opens the
   * actual generated PDF in a new tab so the browser's native PDF viewer
   * (and its own print affordance) takes over, printing the real document.
   */
  async function handlePrint(): Promise<void> {
    try {
      const presigned = await apiFetch<{ url: string }>(endpoints.contractDocumentUrl(contractId));
      window.open(presigned.url, "_blank", "noopener,noreferrer");
    } catch {
      void message.error("Could not open this contract's document - has it been generated yet?");
    }
  }

  return (
    <Space direction="vertical">
      <Space wrap>
        <Can permission="contract.document.assemble">
          <Button icon={<FileDoneOutlined />} onClick={() => setApprovalModalOpen(true)}>
            Send for Approval
          </Button>
        </Can>
        <Can permission="contract.document.esign">
          <Tooltip title={hasGeneratedDocument ? undefined : "Generate a Word/PDF document first"}>
            <Button icon={<SafetyCertificateOutlined />} disabled={!hasGeneratedDocument} onClick={() => setEsignModalOpen(true)}>
              Send for E-signature
            </Button>
          </Tooltip>
        </Can>
        <Can permission="contract.document.email">
          <Tooltip title={hasGeneratedDocument ? undefined : "Generate a Word/PDF document first"}>
            <Button icon={<MailOutlined />} disabled={!hasGeneratedDocument} onClick={() => setEmailModalOpen(true)}>
              Email
            </Button>
          </Tooltip>
        </Can>
        <Tooltip title={hasGeneratedDocument ? undefined : "Generate a Word/PDF document first"}>
          <Button icon={<PrinterOutlined />} disabled={!hasGeneratedDocument} onClick={() => void handlePrint()}>
            Print
          </Button>
        </Tooltip>
      </Space>
      <Space wrap size="small">
        {approvalRequestedFor && <Tag>Approval requested</Tag>}
        <Tag color={ESIGNATURE_STATUS_COLORS[esignatureStatus] ?? "default"}>E-signature: {esignatureStatus.replace("_", " ")}</Tag>
        {lastEmailedTo && <Tag color="blue">Last emailed to {lastEmailedTo}</Tag>}
      </Space>

      <Modal title="Send for Approval" open={approvalModalOpen} onCancel={() => setApprovalModalOpen(false)} onOk={() => approvalForm.submit()} destroyOnHidden>
        <Form form={approvalForm} layout="vertical" onFinish={(values) => void handleSendForApproval(values)}>
          <Form.Item name="approverId" label="Approver" rules={[{ required: true, message: "Select an approver" }]}>
            <Select
              placeholder="Select a user"
              options={userOptionsQuery.data?.options ?? []}
              loading={userOptionsQuery.isLoading}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Send for E-signature" open={esignModalOpen} onCancel={() => setEsignModalOpen(false)} onOk={() => esignForm.submit()} destroyOnHidden>
        <Form form={esignForm} layout="vertical" onFinish={(values) => void handleSendForESignature(values)}>
          <Form.Item name="signerEmail" label="Signer email" rules={[{ required: true, type: "email", message: "Enter a valid email" }]}>
            <Input placeholder="signer@example.com" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Email Contract" open={emailModalOpen} onCancel={() => setEmailModalOpen(false)} onOk={() => emailForm.submit()} destroyOnHidden>
        <Form form={emailForm} layout="vertical" onFinish={(values) => void handleEmail(values)}>
          <Form.Item name="to" label="Recipient email" rules={[{ required: true, type: "email", message: "Enter a valid email" }]}>
            <Input placeholder="recipient@example.com" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
