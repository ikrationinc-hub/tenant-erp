import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Card, Checkbox, Form, Input, List, Modal, Popconfirm, Select, Space, Table, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { Can } from "../../core/permissions/Can";

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
interface ClauseOption {
  id: string;
  clauseTitle: string;
  clauseCode: string;
}

function useDivisionOptions() {
  const query = useQuery({
    queryKey: ["field-options", "divisions"],
    queryFn: () => apiFetch(endpoints.masterOptions("divisions"), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

/** Item 1: "Template management is master-style CRUD." */
export function ContractTemplatesScreen(): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const divisionOptions = useDivisionOptions();
  const divisionLabelById = new Map(divisionOptions.map((o) => [o.value, o.label]));
  const [createOpen, setCreateOpen] = useState(false);
  const [managingTemplateId, setManagingTemplateId] = useState<string | null>(null);
  const [form] = Form.useForm<{ name: string; contractType: string; divisionId?: string }>();

  const templatesQuery = useQuery({
    queryKey: ["contract-templates"],
    queryFn: () => apiFetch<TemplateListResponse>(withQuery(endpoints.contractTemplates, { pageSize: "200" })),
  });

  async function handleCreate(values: { name: string; contractType: string; divisionId?: string }): Promise<void> {
    await apiFetch(endpoints.contractTemplates, { method: "POST", body: values });
    void queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
    setCreateOpen(false);
    form.resetFields();
    void message.success("Template created");
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Contract Templates
        </Typography.Title>
        <Can permission="contract.document.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Template
          </Button>
        </Can>
      </Space>

      <Table<TemplateRow>
        rowKey="id"
        loading={templatesQuery.isLoading}
        dataSource={templatesQuery.data?.items ?? []}
        columns={[
          { key: "name", title: "Name", dataIndex: "name" },
          { key: "contractType", title: "Contract Type", dataIndex: "contractType" },
          { key: "division", title: "Division", render: (_v, row) => (row.divisionId ? (divisionLabelById.get(row.divisionId) ?? row.divisionId) : "All divisions") },
          {
            key: "actions",
            title: "",
            render: (_v, row) => (
              <Button size="small" onClick={() => setManagingTemplateId(row.id)}>
                Manage clauses
              </Button>
            ),
          },
        ]}
      />

      <Modal title="New Template" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => void handleCreate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contractType" label="Contract Type" rules={[{ required: true }]}>
            <Input placeholder="e.g. Sale Contract" />
          </Form.Item>
          <Form.Item name="divisionId" label="Division">
            <Select allowClear options={divisionOptions} placeholder="All divisions" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>

      {managingTemplateId && <ManageTemplateClausesModal templateId={managingTemplateId} onClose={() => setManagingTemplateId(null)} />}
    </Space>
  );
}

function ManageTemplateClausesModal({ templateId, onClose }: { templateId: string; onClose: () => void }): ReactElement {
  const queryClient = useQueryClient();
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [isMandatory, setIsMandatory] = useState(false);

  const templateQuery = useQuery({
    queryKey: ["contract-template", templateId],
    queryFn: () => apiFetch<{ templateClauses: TemplateClauseRow[] }>(endpoints.contractTemplate(templateId)),
  });
  const clauseOptionsQuery = useQuery({
    queryKey: ["clause-library-options-all"],
    queryFn: () => apiFetch<{ items: ClauseOption[] }>(withQuery(endpoints.clauses, { pageSize: "200" })),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["contract-template", templateId] });
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

  const clauseOptions = (clauseOptionsQuery.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.clauseCode} — ${c.clauseTitle}` }));

  return (
    <Modal title="Manage Template Clauses" open onCancel={onClose} footer={null} destroyOnHidden width={640}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Card size="small">
          <Space>
            <Select style={{ width: 320 }} placeholder="Select a clause" value={selectedClauseId} onChange={setSelectedClauseId} options={clauseOptions} showSearch optionFilterProp="label" />
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
