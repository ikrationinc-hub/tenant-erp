import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Button, Card, Popconfirm, Space, Spin, Typography } from "antd";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { CONTRACT_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { AddClauseFromLibrary } from "./AddClauseFromLibrary";
import { ContractClauseList, type ContractClauseItem } from "./ContractClauseList";
import { ContractGenerationPanel } from "./ContractGenerationPanel";

interface ContractWire {
  id: string;
  contractNumber: string;
  contractDate: string;
  status: "draft" | "approved" | "signed" | "closed";
  divisionId: string | null;
  materialType: string | null;
  weightKg: string | null;
  rateUsd: string | null;
  deliveryTerms: string | null;
  clauses: { id: string; clauseId: string; resolvedText: string; isMandatory: boolean; isEdited: boolean; isFromRule: boolean }[];
  linkedSource: { materialType?: string; weightKg?: string; rateUsd?: string; deliveryTerms?: string } | null;
}

interface ClauseTitleLookup {
  items: { id: string; clauseTitle: string }[];
}

function useContract(contractId: string) {
  return useQuery({
    queryKey: ["contract", contractId],
    queryFn: () => apiFetch<ContractWire>(endpoints.contract(contractId)),
  });
}

/**
 * C-3b: the full contract document screen - division-scoped header form
 * (C-3a's <SchemaForm/>, frontend rule 1), clause assembly (drag-drop,
 * add-from-library, inline edit - item 8), preview + generate/download
 * (item 9). The header form and the assembly panel are two independent
 * concerns sharing one contract id - the header's own onSubmit only ever
 * PATCHes /contracts/:id, never touches clause rows, and vice versa.
 */
export interface ContractDetailScreenProps {
  contractId: string;
}

export function ContractDetailScreen({ contractId }: ContractDetailScreenProps): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const contractQuery = useContract(contractId);

  const clauseTitlesQuery = useQuery({
    queryKey: ["clause-titles"],
    queryFn: () => apiFetch<ClauseTitleLookup>(endpoints.clauses),
    enabled: Boolean(contractQuery.data),
  });

  const [previewOpen, setPreviewOpen] = useState(false);

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["contract", contractId] });
  }

  async function handleHeaderSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.contract(contractId), { method: "PATCH", body: values });
    invalidate();
    void message.success("Contract saved");
  }

  async function handleAddClause(clauseId: string): Promise<void> {
    await apiFetch(endpoints.contractClauses(contractId), { method: "POST", body: { clauseId } });
    invalidate();
  }

  async function handleRemoveClause(contractClauseId: string): Promise<void> {
    await apiFetch(endpoints.contractClause(contractId, contractClauseId), { method: "DELETE" });
    invalidate();
  }

  async function handleReorder(orderedIds: string[]): Promise<void> {
    await apiFetch(endpoints.reorderContractClauses(contractId), { method: "PATCH", body: { contractClauseIds: orderedIds } });
    invalidate();
  }

  async function handleEditClauseText(contractClauseId: string, resolvedText: string): Promise<void> {
    await apiFetch(endpoints.contractClause(contractId, contractClauseId), { method: "PATCH", body: { resolvedText } });
    invalidate();
  }

  async function handleResnapshot(): Promise<void> {
    const diff = await apiFetch<{ items: { changed: boolean }[] }>(endpoints.resnapshotContractClauses(contractId), { method: "POST" });
    invalidate();
    const changedCount = diff.items.filter((d) => d.changed).length;
    void message.info(`${changedCount} of ${diff.items.length} clause(s) updated to the latest library version`);
  }

  async function handleTransition(action: "approve" | "sign" | "close"): Promise<void> {
    const endpoint = action === "approve" ? endpoints.approveContract(contractId) : action === "sign" ? endpoints.signContract(contractId) : endpoints.closeContract(contractId);
    await apiFetch(endpoint, { method: "PATCH" });
    invalidate();
    void message.success(`Contract ${action}d`);
  }

  if (contractQuery.isLoading) {
    return <Spin data-testid="contract-detail-loading" />;
  }
  if (contractQuery.isError || !contractQuery.data) {
    return <Alert type="error" showIcon message="Could not load this contract" />;
  }

  const contract = contractQuery.data;
  const isDraft = contract.status === "draft";
  const clauseTitleById = new Map((clauseTitlesQuery.data?.items ?? []).map((c) => [c.id, c.clauseTitle]));
  const clauseItems: ContractClauseItem[] = contract.clauses.map((c) => ({
    id: c.id,
    clauseTitle: clauseTitleById.get(c.clauseId) ?? c.clauseId,
    resolvedText: c.resolvedText,
    isMandatory: c.isMandatory,
    isEdited: c.isEdited,
    isFromRule: c.isFromRule,
  }));

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {contract.contractNumber}
          </Typography.Title>
          <StatusTag value={contract.status} colorMap={CONTRACT_STATUS_COLORS} />
        </Space>
        <Can permission="contract.document.assemble">
          <Space>
            {contract.status === "draft" && (
              <Popconfirm title="Approve this contract?" onConfirm={() => void handleTransition("approve")}>
                <Button>Approve</Button>
              </Popconfirm>
            )}
            {contract.status === "approved" && (
              <Popconfirm title="Sign this contract? Its clauses become permanently frozen." onConfirm={() => void handleTransition("sign")}>
                <Button type="primary">Sign</Button>
              </Popconfirm>
            )}
            {contract.status === "signed" && (
              <Popconfirm title="Close this contract?" onConfirm={() => void handleTransition("close")}>
                <Button>Close</Button>
              </Popconfirm>
            )}
          </Space>
        </Can>
      </Space>

      <Card title="Contract Details">
        <SchemaForm
          module="contract"
          entity="header"
          mode={isDraft ? "edit" : "view"}
          {...(contract.divisionId ? { divisionId: contract.divisionId } : {})}
          initialValues={{
            materialType: contract.materialType,
            weightKg: contract.weightKg,
            rateUsd: contract.rateUsd,
            deliveryTerms: contract.deliveryTerms,
          }}
          onSubmit={handleHeaderSubmit}
        />
      </Card>

      <Card
        title="Clauses"
        extra={
          <Can permission="contract.document.assemble">
            {isDraft && (
              <Popconfirm title="Re-snapshot every clause to its current library version?" onConfirm={() => void handleResnapshot()}>
                <Button size="small">Update clauses to latest</Button>
              </Popconfirm>
            )}
          </Can>
        }
      >
        {isDraft && (
          <Can permission="contract.document.assemble">
            <div style={{ marginBottom: 16 }}>
              <AddClauseFromLibrary {...(contract.divisionId ? { divisionId: contract.divisionId } : {})} onAdd={(clauseId) => void handleAddClause(clauseId)} />
            </div>
          </Can>
        )}
        <ContractClauseList
          clauses={clauseItems}
          editable={isDraft}
          onReorder={(ids) => void handleReorder(ids)}
          onRemove={(contractClauseId) => void handleRemoveClause(contractClauseId)}
          onEditText={(contractClauseId, text) => void handleEditClauseText(contractClauseId, text)}
        />
      </Card>

      <Card title="Preview & Generate">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Button onClick={() => setPreviewOpen((v) => !v)}>{previewOpen ? "Hide preview" : "Show preview"}</Button>
          {previewOpen && <ContractPreviewPane contractId={contractId} />}
          <Can permission="contract.document.generate">
            <ContractGenerationPanel contractId={contractId} />
          </Can>
        </Space>
      </Card>
    </Space>
  );
}

interface PreviewResponse {
  clauses: { contractClauseId: string; clauseTitle: string; resolvedText: string }[];
}

function ContractPreviewPane({ contractId }: { contractId: string }): ReactElement {
  const previewQuery = useQuery({
    queryKey: ["contract-preview", contractId],
    queryFn: () => apiFetch<PreviewResponse>(endpoints.contractPreview(contractId)),
  });

  if (previewQuery.isLoading) {
    return <Spin />;
  }
  if (previewQuery.isError || !previewQuery.data) {
    return <Alert type="error" showIcon message="Could not load the preview" />;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {previewQuery.data.clauses.map((clause) => (
        <Card key={clause.contractClauseId} size="small" title={clause.clauseTitle}>
          <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>{clause.resolvedText}</Typography.Paragraph>
        </Card>
      ))}
    </Space>
  );
}
