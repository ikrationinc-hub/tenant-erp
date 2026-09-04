import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Button, Space, Spin, Typography } from "antd";
import { CheckCircleFilled, FilePdfOutlined, FileWordOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { semantic } from "../../theme/palette";

interface GenerationStatus {
  jobId: string;
  state: string;
  downloadUrls?: { docx: string; pdf: string };
  failedReason?: string;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

/**
 * Item 9: "Download Word / Download PDF (call the worker job, poll,
 * present files)". Generation is asynchronous (a BullMQ job the API only
 * enqueues, apps/worker actually runs - CLAUDE.md: document generation
 * never happens in the API process) - this panel starts the job, polls
 * GET /contracts/:id/generate/:jobId on a fixed interval until it settles,
 * then presents the two presigned download links the completed job
 * carries. No native download trigger here (Artifact-viewer sandboxes
 * block those, and this isn't one anyway) - a plain link the user clicks,
 * same as every other file-download affordance in this app
 * (openAttachmentDownload's own precedent).
 */
export function ContractGenerationPanel({ contractId }: { contractId: string }): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const pollCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  function schedulePoll(jobId: string): void {
    timerRef.current = setTimeout(() => void poll(jobId), POLL_INTERVAL_MS);
  }

  async function poll(jobId: string): Promise<void> {
    pollCountRef.current += 1;
    try {
      const next = await apiFetch<GenerationStatus>(endpoints.contractGenerationStatus(contractId, jobId));
      setStatus(next);
      if (next.state === "completed" || next.state === "failed") {
        setGenerating(false);
        if (next.state === "failed") {
          void message.error(next.failedReason ?? "Generation failed");
        } else {
          // lastGeneratedDocxKey/PdfKey were just persisted onto the
          // contract row (contract-generation.service.ts's own
          // getGenerationJobStatus) - refetch so ContractActionsPanel's
          // Email/Send for E-signature buttons enable immediately,
          // without a manual page refresh.
          void queryClient.invalidateQueries({ queryKey: ["contract", contractId] });
        }
        return;
      }
      if (pollCountRef.current >= MAX_POLL_ATTEMPTS) {
        setGenerating(false);
        void message.error("Generation is taking longer than expected - check back shortly");
        return;
      }
      schedulePoll(jobId);
    } catch {
      setGenerating(false);
      void message.error("Could not check generation status");
    }
  }

  async function handleGenerate(): Promise<void> {
    setGenerating(true);
    setStatus(null);
    pollCountRef.current = 0;
    try {
      const handle = await apiFetch<{ jobId: string }>(endpoints.generateContract(contractId), { method: "POST" });
      schedulePoll(handle.jobId);
    } catch {
      setGenerating(false);
      void message.error("Could not start generation");
    }
  }

  return (
    <Space direction="vertical">
      <Button icon={<FileWordOutlined />} loading={generating} onClick={() => void handleGenerate()}>
        Generate Word &amp; PDF
      </Button>
      {generating && !status?.downloadUrls && <Spin size="small" />}
      {status?.state === "failed" && <Alert type="error" showIcon message={status.failedReason ?? "Generation failed"} />}
      {status?.downloadUrls && (
        <Space direction="vertical">
          <Typography.Text style={{ color: semantic.success }}>
            <CheckCircleFilled /> Generation complete.
          </Typography.Text>
          <Space>
            <a href={status.downloadUrls.docx} target="_blank" rel="noreferrer">
              <FileWordOutlined /> Download Word
            </a>
            <a href={status.downloadUrls.pdf} target="_blank" rel="noreferrer">
              <FilePdfOutlined /> Download PDF
            </a>
          </Space>
        </Space>
      )}
    </Space>
  );
}
