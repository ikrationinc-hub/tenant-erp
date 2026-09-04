import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Card, Checkbox, Divider, Flex, Form, Input, List, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from "antd";
import { FileTextOutlined, InboxOutlined, PlusOutlined, SettingOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { masterOptionsResponseSchema, type AttachmentRow } from "@ikration/contracts";
import { Can } from "../../core/permissions/Can";
import { uploadAttachmentWithProgress } from "../../core/attachments/upload-attachment";
import { openAttachmentDownload } from "../../core/attachments/download-attachment";

const TEMPLATE_FILE_ENTITY = "contract_template";
const TEMPLATE_FILE_FIELD_KEY = "templateFile";

interface ClauseOption {
  id: string;
  clauseTitle: string;
  clauseCode: string;
}

/**
 * contractType is stored as free text (contract-templates.validator.ts:
 * z.string().min(1), not an enum) - purchases/sales are our own two real
 * document kinds (CLAUDE.md vocabulary), so the CREATE form constrains it
 * to exactly these two stored values via a dropdown rather than free
 * typing, while the table still falls back to the raw stored string for
 * any pre-existing row that predates this constraint.
 */
const CONTRACT_TYPE_OPTIONS = [
  { value: "Sale Contract", label: "Sales" },
  { value: "Purchase Contract", label: "Purchase" },
];
const CONTRACT_TYPE_LABELS: Record<string, string> = Object.fromEntries(CONTRACT_TYPE_OPTIONS.map((o) => [o.value, o.label]));

function useClauseOptions(enabled: boolean) {
  const query = useQuery({
    queryKey: ["clause-library-options-all"],
    queryFn: () => apiFetch<{ items: ClauseOption[] }>(withQuery(endpoints.clauses, { pageSize: "200" })),
    enabled,
  });
  return query.data?.items ?? [];
}

interface TemplateRow {
  id: string;
  name: string;
  contractType: string;
  divisionId: string | null;
  isActive: boolean;
}
interface TemplateListResponse {
  items: TemplateRow[];
  total: number;
}
interface TemplateClauseRow {
  id: string;
  clauseId: string;
  clauseTitle: string;
  clauseCode: string;
  isMandatory: boolean;
  sortOrder: number;
}

function useDivisionOptions() {
  const query = useQuery({
    queryKey: ["field-options", "divisions"],
    queryFn: () => apiFetch(endpoints.masterOptions("divisions"), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

interface CreateTemplateFormValues {
  name: string;
  contractType: string;
  divisionId?: string;
  clauseIds?: string[];
}

/**
 * Item 1: "Template management is master-style CRUD." The backend only
 * exposes template creation (name/type/division) and clause-attachment
 * (POST .../clauses, one clause per call) as separate endpoints - there
 * is no single "create template with clauses" endpoint. The clause
 * checklist below still lets a user pick every default clause in ONE
 * form submission, matching the prototype's own one-step feel: handleCreate
 * creates the template, then loops one POST per checked clause before
 * closing the modal, rather than requiring a second "manage clauses" trip
 * afterward for the common case.
 */
export function ContractTemplatesScreen(): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const divisionOptions = useDivisionOptions();
  const divisionLabelById = new Map(divisionOptions.map((o) => [o.value, o.label]));
  const [createOpen, setCreateOpen] = useState(false);
  const [managingTemplateId, setManagingTemplateId] = useState<string | null>(null);
  const [form] = Form.useForm<CreateTemplateFormValues>();
  const clauseOptions = useClauseOptions(createOpen);

  const templatesQuery = useQuery({
    queryKey: ["contract-templates"],
    queryFn: () => apiFetch<TemplateListResponse>(withQuery(endpoints.contractTemplates, { pageSize: "200" })),
  });

  async function handleCreate(values: CreateTemplateFormValues): Promise<void> {
    let templateId: string | undefined;
    try {
      const template = await apiFetch<{ id: string }>(endpoints.contractTemplates, {
        method: "POST",
        body: { name: values.name, contractType: values.contractType, ...(values.divisionId ? { divisionId: values.divisionId } : {}) },
      });
      templateId = template.id;
      for (const clauseId of values.clauseIds ?? []) {
        await apiFetch(endpoints.contractTemplateClauses(template.id), { method: "POST", body: { clauseId } });
      }
      void queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
      setCreateOpen(false);
      form.resetFields();
      void message.success(`Template created${values.clauseIds?.length ? ` with ${values.clauseIds.length} clause(s)` : ""}`);
    } catch {
      void queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
      // The template itself may already have been created even though a
      // clause-attach call in the loop failed - never claim total failure
      // when a real row now exists; point at "Manage clauses" to finish it.
      void message.error(templateId ? "Template created, but not every clause could be added - use Manage clauses to finish" : "Could not create template");
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Flex justify="space-between" align="flex-start">
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Contract Templates
          </Typography.Title>
          <Typography.Text type="secondary">Named default clause sets per division &amp; type</Typography.Text>
        </Space>
        <Can permission="contract.document.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Template
          </Button>
        </Can>
      </Flex>

      <Table<TemplateRow>
        rowKey="id"
        loading={templatesQuery.isLoading}
        dataSource={templatesQuery.data?.items ?? []}
        columns={[
          { key: "name", title: "Template", render: (_v, row) => <Space><FileTextOutlined />{row.name}</Space> },
          { key: "contractType", title: "Type", render: (_v, row) => CONTRACT_TYPE_LABELS[row.contractType] ?? row.contractType },
          { key: "division", title: "Division", render: (_v, row) => (row.divisionId ? (divisionLabelById.get(row.divisionId) ?? row.divisionId) : "All divisions") },
          { key: "status", title: "Status", render: (_v, row) => <Tag color={row.isActive ? "success" : "default"}>{row.isActive ? "Active" : "Inactive"}</Tag> },
          {
            key: "actions",
            title: "",
            render: (_v, row) => (
              <Button size="small" icon={<SettingOutlined />} onClick={() => setManagingTemplateId(row.id)}>
                Manage clauses
              </Button>
            ),
          },
        ]}
      />

      <Modal title="New Template" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden width={520}>
        <Form form={form} layout="vertical" onFinish={(values) => void handleCreate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Scrap Sales - CIF" />
          </Form.Item>
          <Form.Item name="contractType" label="Type" rules={[{ required: true, message: "Select a type" }]}>
            <Select placeholder="Select a type" options={CONTRACT_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="divisionId" label="Division">
            <Select allowClear options={divisionOptions} placeholder="All divisions" />
          </Form.Item>
          <Divider style={{ margin: "8px 0 16px" }} />
          <Form.Item
            name="clauseIds"
            label="Default Clauses"
            rules={[{ required: true, message: "Pick at least one clause" }]}
            extra="Pick which clauses load by default when this template is used."
          >
            <Checkbox.Group style={{ width: "100%" }}>
              <Space direction="vertical" size={8} style={{ width: "100%", maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                {clauseOptions.length === 0 && <Typography.Text type="secondary">No clauses in the library yet.</Typography.Text>}
                {clauseOptions.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "9px 12px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 7,
                    }}
                  >
                    <Typography.Text>
                      {c.clauseTitle} <Typography.Text type="secondary">({c.clauseCode})</Typography.Text>
                    </Typography.Text>
                    <Checkbox value={c.id} />
                  </div>
                ))}
              </Space>
            </Checkbox.Group>
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
            Every clause is added as optional, not mandatory - use "Manage clauses" afterward to mark one mandatory.
          </Typography.Text>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>

      {managingTemplateId && <ManageTemplateClausesModal templateId={managingTemplateId} onClose={() => setManagingTemplateId(null)} />}
    </Space>
  );
}

function useTemplateFileAttachment(templateId: string) {
  const query = useQuery({
    queryKey: ["contract-template-file", templateId],
    queryFn: () =>
      apiFetch<{ items: AttachmentRow[] }>(
        withQuery(endpoints.attachments, { entity: TEMPLATE_FILE_ENTITY, entityId: templateId, pageSize: "1" }),
      ),
  });
  return { attachment: query.data?.items[0] ?? null, isLoading: query.isLoading };
}

function ManageTemplateClausesModal({ templateId, onClose }: { templateId: string; onClose: () => void }): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [isMandatory, setIsMandatory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generatingDefault, setGeneratingDefault] = useState(false);

  const templateQuery = useQuery({
    queryKey: ["contract-template", templateId],
    queryFn: () => apiFetch<{ templateClauses: TemplateClauseRow[] }>(endpoints.contractTemplate(templateId)),
  });
  const clauseOptionsList = useClauseOptions(true);
  const { attachment: templateFile, isLoading: templateFileLoading } = useTemplateFileAttachment(templateId);

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["contract-template", templateId] });
  }

  function handleUploadTemplateFile(file: File): boolean {
    setUploading(true);
    setUploadProgress(0);
    uploadAttachmentWithProgress(TEMPLATE_FILE_ENTITY, templateId, TEMPLATE_FILE_FIELD_KEY, file, setUploadProgress)
      .then(() => {
        setUploading(false);
        void queryClient.invalidateQueries({ queryKey: ["contract-template-file", templateId] });
        void message.success("Word template uploaded");
      })
      .catch((error: unknown) => {
        setUploading(false);
        void message.error(error instanceof Error ? error.message : "Upload failed");
      });
    return false;
  }

  async function handleGenerateDefaultDocx(): Promise<void> {
    setGeneratingDefault(true);
    try {
      await apiFetch(endpoints.contractTemplateGenerateDefaultDocx(templateId), { method: "POST" });
      void queryClient.invalidateQueries({ queryKey: ["contract-template-file", templateId] });
      void message.success("Starter .docx generated - download it to customize, or use it as-is");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Could not generate a starter file");
    } finally {
      setGeneratingDefault(false);
    }
  }

  async function handleAdd(): Promise<void> {
    if (!selectedClauseId) {
      return;
    }
    await apiFetch(endpoints.contractTemplateClauses(templateId), { method: "POST", body: { clauseId: selectedClauseId, isMandatory } });
    setSelectedClauseId(null);
    setIsMandatory(false);
    invalidate();
  }

  async function handleRemove(clauseId: string): Promise<void> {
    await apiFetch(endpoints.contractTemplateClause(templateId, clauseId), { method: "DELETE" });
    invalidate();
  }

  const clauseSelectOptions = clauseOptionsList.map((c) => ({ value: c.id, label: `${c.clauseCode} — ${c.clauseTitle}` }));

  return (
    <Modal title="Manage Template Clauses" open onCancel={onClose} footer={null} destroyOnHidden width={640}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Card size="small" title="Word Template File" extra={<Typography.Text type="secondary">Used by Generate Word &amp; PDF</Typography.Text>}>
          {templateFileLoading ? (
            <Typography.Text type="secondary">Loading…</Typography.Text>
          ) : (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {templateFile ? (
                <Typography.Link onClick={() => void openAttachmentDownload(templateFile.id)}>{templateFile.filename}</Typography.Link>
              ) : (
                <Typography.Text type="secondary">No .docx file uploaded yet - Generate Word &amp; PDF will fail until one is added.</Typography.Text>
              )}
              <Space wrap>
                <Upload accept=".docx" showUploadList={false} beforeUpload={handleUploadTemplateFile} disabled={uploading}>
                  <Button icon={<InboxOutlined />} loading={uploading}>
                    {uploading ? `Uploading ${uploadProgress}%` : templateFile ? "Replace .docx file" : "Upload .docx file"}
                  </Button>
                </Upload>
                <Button icon={<ThunderboltOutlined />} loading={generatingDefault} onClick={() => void handleGenerateDefaultDocx()}>
                  Generate starter .docx
                </Button>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                A starter file has a plain layout with {"{{contractBody}}"} and seller/buyer placeholders - download and restyle it in Word, or use it as-is.
              </Typography.Text>
            </Space>
          )}
        </Card>

        <Card size="small">
          <Space>
            <Select style={{ width: 320 }} placeholder="Select a clause" value={selectedClauseId} onChange={setSelectedClauseId} options={clauseSelectOptions} showSearch optionFilterProp="label" />
            <Checkbox checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)}>
              Mandatory
            </Checkbox>
            <Button icon={<PlusOutlined />} disabled={!selectedClauseId} onClick={() => void handleAdd()}>
              Add
            </Button>
          </Space>
        </Card>

        <List
          dataSource={templateQuery.data?.templateClauses ?? []}
          renderItem={(clause) => (
            <List.Item
              actions={[
                <Popconfirm key="remove" title="Remove this clause from the template?" onConfirm={() => void handleRemove(clause.clauseId)}>
                  <Button size="small" danger>
                    Remove
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta title={`${clause.clauseCode} — ${clause.clauseTitle}`} description={clause.isMandatory ? "Mandatory" : "Optional"} />
            </List.Item>
          )}
        />
      </Space>
    </Modal>
  );
}
