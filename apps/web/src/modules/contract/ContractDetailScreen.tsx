import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Breadcrumb, Button, Card, DatePicker, Drawer, Flex, Popconfirm, Space, Spin, Steps, Tag, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  CheckCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  LockOutlined,
  PlusCircleOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { CONTRACT_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { AddClauseFromLibrary } from "./AddClauseFromLibrary";
import { ContractActionsPanel } from "./ContractActionsPanel";
import { ContractClauseList, type ContractClauseItem } from "./ContractClauseList";
import { ContractGenerationPanel } from "./ContractGenerationPanel";
import { ContractPartiesForm } from "./ContractPartiesForm";
import { CONTRACTS_LIST_PATH } from "./ContractsListScreen";

type ContractStatus = "draft" | "approved" | "signed" | "closed";

interface ContractWire {
  id: string;
  contractNumber: string;
  contractDate: string;
  status: ContractStatus;
  divisionId: string | null;
  templateId: string | null;
  contractType: "purchase" | "sale" | null;
  sourceType: "purchase" | "sale" | null;
  sourceId: string | null;
  materialType: string | null;
  weightKg: string | null;
  rateUsd: string | null;
  deliveryTerms: string | null;
  approvalRequestedFor: string | null;
  esignatureStatus: "not_sent" | "sent" | "signed" | "declined";
  lastEmailedTo: string | null;
  lastGeneratedPdfKey: string | null;
  parentContractId: string | null;
  revisionNumber: number;
  clauses: { id: string; clauseId: string; resolvedText: string; isMandatory: boolean; isEdited: boolean; isFromRule: boolean }[];
  parties: { partyRole: "seller" | "buyer"; supplierId: string | null; customerId: string | null }[];
  linkedSource: { materialType?: string; weightKg?: string; rateUsd?: string; deliveryTerms?: string } | null;
}

interface ClauseTitleLookup {
  items: { id: string; clauseTitle: string; clauseCode: string }[];
}

const CONTRACT_TYPE_LABELS: Record<string, string> = { sale: "Sales", purchase: "Purchase" };

function useContract(contractId: string) {
  return useQuery({
    queryKey: ["contract", contractId],
    queryFn: () => apiFetch<ContractWire>(endpoints.contract(contractId)),
  });
}

/** templateId/sourceType/sourceId are create-only (contracts.validator.ts's createContractSchema only - never in updateContractSchema, never PATCH-able) - read here purely for display, once. */
function useTemplateLabel(templateId: string | null) {
  const query = useQuery({
    queryKey: ["contract-templates-options-lookup"],
    queryFn: () => apiFetch<{ items: { id: string; name: string; contractType: string }[] }>(withQuery(endpoints.contractTemplates, { pageSize: "200" })),
    enabled: Boolean(templateId),
  });
  const template = query.data?.items.find((t) => t.id === templateId);
  return template ? `${template.name} (${template.contractType})` : null;
}

function usePurchaseLabel(sourceType: "purchase" | "sale" | null, sourceId: string | null) {
  const query = useQuery({
    queryKey: ["contract-linked-purchase", sourceId],
    queryFn: () => apiFetch<{ purchaseNumber: string }>(endpoints.purchase(sourceId ?? "")),
    enabled: sourceType === "purchase" && Boolean(sourceId),
  });
  return query.data?.purchaseNumber ?? null;
}

function useDivisionLabel(divisionId: string | null) {
  const query = useQuery({
    queryKey: ["field-options", "divisions"],
    queryFn: () => apiFetch(endpoints.masterOptions("divisions"), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
    enabled: Boolean(divisionId),
  });
  return query.data?.options.find((o) => o.value === divisionId)?.label ?? null;
}

/**
 * The 5-step visual lifecycle the redesign's own mockup shows (Draft ->
 * Assembled -> Approved -> Signed -> Closed) does NOT match the backend's
 * real 4-status enum (draft/approved/signed/closed - contracts.validator.ts).
 * "Assembled" has no backend counterpart; it's a UI-ONLY derived stage
 * (Draft with at least one clause already attached), never sent to or
 * read from the API as a status. Never conflate this with `contract.status`
 * itself - every real transition (approve/sign/close) still reads/writes
 * only the 4 real values.
 */
type VisualStep = "draft" | "assembled" | "approved" | "signed" | "closed";
const STEP_LABELS: { key: VisualStep; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "assembled", label: "Assembled" },
  { key: "approved", label: "Approved" },
  { key: "signed", label: "Signed" },
  { key: "closed", label: "Closed" },
];

function deriveVisualStep(contract: ContractWire): VisualStep {
  if (contract.status === "draft") {
    return contract.clauses.length > 0 ? "assembled" : "draft";
  }
  return contract.status;
}

function stepIndex(step: VisualStep): number {
  return STEP_LABELS.findIndex((s) => s.key === step);
}

interface StateBanner {
  type: "info" | "warning" | "success";
  message: string;
  description: string;
}

function bannerFor(contract: ContractWire, visualStep: VisualStep): StateBanner {
  switch (visualStep) {
    case "draft":
      return { type: "info", message: "Draft", description: "Fill in the details, assign parties, and assemble clauses. Nothing is locked yet." };
    case "assembled":
      return {
        type: "info",
        message: "Assembled",
        description: "Clauses are assembled. Run rules, reorder or edit freely, then preview and send for approval.",
      };
    case "approved":
      return {
        type: "warning",
        message: "Approved - clause set locked",
        description: "The clause snapshot is now frozen. To change terms, create a new revision.",
      };
    case "signed":
      return { type: "warning", message: "Signed", description: "Fully executed. The clause snapshot is permanently frozen." };
    case "closed":
    default:
      return {
        type: "success",
        message: "Closed",
        description: `Contract is closed. Renders forever from its frozen snapshot${contract.revisionNumber > 1 ? "" : " - any change requires a new revision"}.`,
      };
  }
}

/**
 * The full contract document screen, redesigned around the mockup in
 * docs/mockups/ikration-contract-prototype.html: breadcrumb, a lifecycle
 * Steps indicator, a state Alert banner, a single top action bar (the
 * mockup's own #cActions - Preview/Word/PDF/Email/lifecycle transition,
 * state-gated - there is deliberately no separate "Preview & Generate"
 * section, matching the mockup exactly), and numbered sections (1
 * Contract Information, 2 Parties, 3 Commercial Terms, 4 Clauses, 5
 * Signatures) - all built from real AntD components and our own theme,
 * never the mockup's own CSS. Every handler below already existed before
 * this redesign; only the JSX layout changed.
 */
export interface ContractDetailScreenProps {
  contractId: string;
}

export function ContractDetailScreen({ contractId }: ContractDetailScreenProps): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const contractQuery = useContract(contractId);

  const clauseTitlesQuery = useQuery({
    queryKey: ["clause-titles"],
    queryFn: () => apiFetch<ClauseTitleLookup>(endpoints.clauses),
    enabled: Boolean(contractQuery.data),
  });

  const [previewOpen, setPreviewOpen] = useState(false);

  const templateLabel = useTemplateLabel(contractQuery.data?.templateId ?? null);
  const purchaseLabel = usePurchaseLabel(contractQuery.data?.sourceType ?? null, contractQuery.data?.sourceId ?? null);
  const divisionLabel = useDivisionLabel(contractQuery.data?.divisionId ?? null);

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["contract", contractId] });
  }

  async function handleHeaderSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.contract(contractId), { method: "PATCH", body: values });
    invalidate();
    void message.success("Contract saved");
  }

  /**
   * contractDate is a Tier-1 column, not a field-definitions entry, so it
   * can't render through <SchemaForm/> the way materialType/weightKg/etc.
   * do - it gets its own small, directly-wired field instead, PATCHing
   * the same /contracts/:id endpoint the header form already uses.
   */
  async function handleContractDateChange(date: dayjs.Dayjs | null): Promise<void> {
    if (!date) {
      return;
    }
    try {
      await apiFetch(endpoints.contract(contractId), { method: "PATCH", body: { contractDate: date.format("YYYY-MM-DD") } });
      invalidate();
      void message.success("Contract date updated");
    } catch {
      void message.error("Could not update contract date");
    }
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

  async function handleRevise(): Promise<void> {
    try {
      const revision = await apiFetch<{ id: string }>(endpoints.reviseContract(contractId), { method: "POST" });
      void message.success("Revision created");
      void navigate(`${CONTRACTS_LIST_PATH}/${revision.id}`);
    } catch {
      void message.error("Could not create a revision");
    }
  }

  async function handleRunRules(): Promise<void> {
    try {
      const result = await apiFetch<{ added: unknown[]; alreadyPresent: unknown[] }>(endpoints.runContractRules(contractId), { method: "POST" });
      invalidate();
      if (result.added.length === 0) {
        void message.info("No new clauses were required by the active rules");
      } else {
        void message.success(`${result.added.length} clause(s) added, required by rule`);
      }
    } catch {
      void message.error("Could not run rules");
    }
  }

  if (contractQuery.isLoading) {
    return <Spin data-testid="contract-detail-loading" />;
  }
  if (contractQuery.isError || !contractQuery.data) {
    return <Alert type="error" showIcon message="Could not load this contract" />;
  }

  const contract = contractQuery.data;
  const isDraft = contract.status === "draft";
  const visualStep = deriveVisualStep(contract);
  const banner = bannerFor(contract, visualStep);
  const seller = contract.parties.find((p) => p.partyRole === "seller") ?? null;
  const buyer = contract.parties.find((p) => p.partyRole === "buyer") ?? null;
  const clauseLookupById = new Map((clauseTitlesQuery.data?.items ?? []).map((c) => [c.id, c]));
  const clauseItems: ContractClauseItem[] = contract.clauses.map((c) => {
    const lookup = clauseLookupById.get(c.clauseId);
    return {
      id: c.id,
      clauseTitle: lookup?.clauseTitle ?? c.clauseId,
      clauseCode: lookup?.clauseCode ?? "",
      resolvedText: c.resolvedText,
      isMandatory: c.isMandatory,
      isEdited: c.isEdited,
      isFromRule: c.isFromRule,
    };
  });

  const stepsItems = STEP_LABELS.map((s, i) => ({
    title: s.label,
    status: i < stepIndex(visualStep) ? ("finish" as const) : i === stepIndex(visualStep) ? ("process" as const) : ("wait" as const),
  }));
  const hasGeneratedDocument = Boolean(contract.lastGeneratedPdfKey);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          { title: <Typography.Link onClick={() => void navigate(CONTRACTS_LIST_PATH)}>Contracts</Typography.Link> },
          { title: contract.contractNumber },
        ]}
      />

      <Flex justify="space-between" align="flex-start" wrap="wrap" gap={12}>
        <Space align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {contract.contractNumber}
          </Typography.Title>
          <StatusTag value={contract.status} colorMap={CONTRACT_STATUS_COLORS} />
          {contract.revisionNumber > 1 && <Typography.Text type="secondary">Revision {contract.revisionNumber}</Typography.Text>}
          {contract.parentContractId && (
            <Typography.Link onClick={() => void navigate(`${CONTRACTS_LIST_PATH}/${contract.parentContractId}`)}>View original</Typography.Link>
          )}
        </Space>

        {/* Top action bar - matches the prototype's own #cActions: Preview always available, Word/PDF once generated, Email, then exactly the ONE lifecycle action valid for this state (Approve / Sign / Close / Create Revision). */}
        <Space wrap>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
          <Can permission="contract.document.generate">
            <ContractGenerationPanel contractId={contractId} />
          </Can>
          <ContractActionsPanel
            contractId={contractId}
            approvalRequestedFor={contract.approvalRequestedFor}
            esignatureStatus={contract.esignatureStatus}
            lastEmailedTo={contract.lastEmailedTo}
            hasGeneratedDocument={hasGeneratedDocument}
          />
          <Can permission="contract.document.assemble">
            <Space wrap>
              {contract.status === "draft" && (
                <Popconfirm title="Approve this contract?" onConfirm={() => void handleTransition("approve")}>
                  <Button icon={<CheckCircleOutlined />}>Approve</Button>
                </Popconfirm>
              )}
              {contract.status === "approved" && (
                <Popconfirm title="Sign this contract? Its clauses become permanently frozen." onConfirm={() => void handleTransition("sign")}>
                  <Button type="primary" icon={<SafetyCertificateOutlined />}>
                    Sign
                  </Button>
                </Popconfirm>
              )}
              {contract.status === "signed" && (
                <Popconfirm title="Close this contract?" onConfirm={() => void handleTransition("close")}>
                  <Button icon={<LockOutlined />}>Close</Button>
                </Popconfirm>
              )}
              {contract.status !== "draft" && (
                <Popconfirm title="Create a new revision? Its clauses start as an editable copy of this contract's own frozen snapshot." onConfirm={() => void handleRevise()}>
                  <Button icon={<PlusCircleOutlined />}>Create Revision</Button>
                </Popconfirm>
              )}
            </Space>
          </Can>
        </Space>
      </Flex>

      <Card size="small">
        <Steps size="small" current={stepIndex(visualStep)} items={stepsItems} />
      </Card>

      <Alert type={banner.type} showIcon message={banner.message} description={banner.description} />

      <Card title="1 · Contract Information">
        <div className="field-grid">
          <div>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
              Contract No.
            </Typography.Text>
            <Typography.Text code>{contract.contractNumber}</Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
              Contract Date
            </Typography.Text>
            {isDraft ? (
              <DatePicker
                style={{ width: "100%" }}
                format="YYYY-MM-DD"
                value={dayjs(contract.contractDate, "YYYY-MM-DD")}
                onChange={(date) => void handleContractDateChange(date)}
              />
            ) : (
              <Typography.Text>{contract.contractDate}</Typography.Text>
            )}
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
              Division
            </Typography.Text>
            <Typography.Text>{divisionLabel ?? "—"}</Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
              Type
            </Typography.Text>
            <Typography.Text>{CONTRACT_TYPE_LABELS[contract.contractType ?? ""] ?? "—"}</Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
              Linked Purchase
            </Typography.Text>
            <Typography.Text>{purchaseLabel ?? "Standalone"}</Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
              Template
            </Typography.Text>
            <Typography.Text>{templateLabel ?? "—"}</Typography.Text>
          </div>
        </div>
      </Card>

      <Card title="2 · Parties">
        <ContractPartiesForm contractId={contractId} seller={seller} buyer={buyer} editable={isDraft} onSaved={invalidate} />
      </Card>

      <Card title="3 · Commercial Terms">
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
        title="4 · Clauses"
        extra={
          <Can permission="contract.document.run_rules">
            {isDraft && (
              <Space>
                <Popconfirm title="Run active clause rules against this contract's data?" onConfirm={() => void handleRunRules()}>
                  <Button size="small" icon={<ThunderboltOutlined />}>
                    Run rules
                  </Button>
                </Popconfirm>
                <Can permission="contract.document.assemble">
                  <Popconfirm title="Re-snapshot every clause to its current library version?" onConfirm={() => void handleResnapshot()}>
                    <Button size="small">Update clauses to latest</Button>
                  </Popconfirm>
                </Can>
              </Space>
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

      {(contract.status === "signed" || contract.status === "closed") && (
        <Card title="5 · Signatures">
          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
            <SolutionOutlined /> E-signature status
          </Typography.Text>
          <Tag color="success">{contract.esignatureStatus.replace("_", " ")}</Tag>
          {contract.lastEmailedTo && (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              Last emailed to {contract.lastEmailedTo}
            </Typography.Text>
          )}
        </Card>
      )}

      <Drawer title="Preview - placeholders resolved" open={previewOpen} onClose={() => setPreviewOpen(false)} width={640} destroyOnHidden>
        <ContractPreviewPane contractId={contractId} />
      </Drawer>
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
        <Card key={clause.contractClauseId} size="small" title={<Space><FileTextOutlined />{clause.clauseTitle}</Space>}>
          <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>{clause.resolvedText}</Typography.Paragraph>
        </Card>
      ))}
    </Space>
  );
}
