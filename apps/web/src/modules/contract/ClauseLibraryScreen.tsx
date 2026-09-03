import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";

interface CreateClauseFormValues {
  clauseTitle: string;
  category: "general_tc" | "division_specific";
  divisionId?: string;
  clauseText: string;
  effectiveFrom: string;
  changeReason: string;
}

interface AddVersionFormValues {
  clauseText: string;
  effectiveFrom: string;
  changeReason: string;
}

interface ClauseRow {
  id: string;
  clauseCode: string;
  clauseTitle: string;
  category: "general_tc" | "division_specific";
  divisionId: string | null;
  isActive: boolean;
}
interface ClauseListResponse {
  items: ClauseRow[];
}
interface ClauseVersionRow {
  id: string;
  versionNumber: number;
  status: string;
  effectiveFrom: string;
}

function useDivisionOptions() {
  const query = useQuery({
    queryKey: ["field-options", "divisions"],
    queryFn: () => apiFetch(endpoints.masterOptions("divisions"), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

/**
 * C-1's own menu node (Settings -> Contract -> Clause Library) never got a
 * screen behind it (C-1 was deliberately backend-only). Built here, item
 * 10's own requirement, minimally: list clauses, create one (with its
 * required first version), add a new version, approve a version - the
 * full C-1 API surface, no more.
 */
export function ClauseLibraryScreen(): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const divisionOptions = useDivisionOptions();
  const divisionLabelById = new Map(divisionOptions.map((o) => [o.value, o.label]));
  const [createOpen, setCreateOpen] = useState(false);
  const [managingClauseId, setManagingClauseId] = useState<string | null>(null);
  const [form] = Form.useForm<CreateClauseFormValues>();

  const clausesQuery = useQuery({
    queryKey: ["clause-library"],
    queryFn: () => apiFetch<ClauseListResponse>(withQuery(endpoints.clauses, { pageSize: "200" })),
  });

  async function handleCreate(values: CreateClauseFormValues): Promise<void> {
    await apiFetch(endpoints.clauses, { method: "POST", body: values });
    void queryClient.invalidateQueries({ queryKey: ["clause-library"] });
    setCreateOpen(false);
    form.resetFields();
    void message.success("Clause created");
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Clause Library
        </Typography.Title>
        <Can permission="contract.clause.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Clause
          </Button>
        </Can>
      </Space>

      <Table<ClauseRow>
        rowKey="id"
        loading={clausesQuery.isLoading}
        dataSource={clausesQuery.data?.items ?? []}
        columns={[
          { key: "clauseCode", title: "Code", dataIndex: "clauseCode" },
          { key: "clauseTitle", title: "Title", dataIndex: "clauseTitle" },
          { key: "category", title: "Category", render: (_v, row) => <Tag>{row.category === "division_specific" ? "Division Specific" : "General T&C"}</Tag> },
          { key: "division", title: "Division", render: (_v, row) => (row.divisionId ? (divisionLabelById.get(row.divisionId) ?? row.divisionId) : "All divisions") },
          {
            key: "actions",
            title: "",
            render: (_v, row) => (
              <Button size="small" onClick={() => setManagingClauseId(row.id)}>
                Versions
              </Button>
            ),
          },
        ]}
      />

      <Modal title="New Clause" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden width={560}>
        <Form form={form} layout="vertical" onFinish={(values) => void handleCreate(values)}>
          <Form.Item name="clauseTitle" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "general_tc", label: "General T&C" },
                { value: "division_specific", label: "Division Specific" },
              ]}
            />
          </Form.Item>
          <Form.Item name="divisionId" label="Division">
            <Select allowClear options={divisionOptions} placeholder="All divisions" />
          </Form.Item>
          <Form.Item name="clauseText" label="Clause Text" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 4 }} placeholder="Use {{dotted.tokens}} for placeholders" />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="Effective From (YYYY-MM-DD)" rules={[{ required: true }]}>
            <Input placeholder="2026-01-01" />
          </Form.Item>
          <Form.Item name="changeReason" label="Change Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>

      {managingClauseId && <ManageClauseVersionsModal clauseId={managingClauseId} onClose={() => setManagingClauseId(null)} />}
    </Space>
  );
}

function ManageClauseVersionsModal({ clauseId, onClose }: { clauseId: string; onClose: () => void }): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<AddVersionFormValues>();

  const versionsQuery = useQuery({
    queryKey: ["clause-versions", clauseId],
    queryFn: () => apiFetch<{ items: ClauseVersionRow[] }>(endpoints.clauseVersions(clauseId)),
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["clause-versions", clauseId] });
  }

  async function handleAddVersion(values: AddVersionFormValues): Promise<void> {
    await apiFetch(endpoints.clauseVersions(clauseId), { method: "POST", body: values });
    invalidate();
    setAddOpen(false);
    form.resetFields();
    void message.success("Version added");
  }

  async function handleApprove(versionId: string): Promise<void> {
    await apiFetch(endpoints.approveClauseVersion(clauseId, versionId), { method: "PATCH" });
    invalidate();
    void message.success("Version approved");
  }

  return (
    <Modal title="Clause Versions" open onCancel={onClose} footer={null} destroyOnHidden width={640}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Can permission="contract.clause.version">
          <Button size="small" onClick={() => setAddOpen(true)}>
            Add Version
          </Button>
        </Can>

        <Table<ClauseVersionRow>
          rowKey="id"
          size="small"
          loading={versionsQuery.isLoading}
          dataSource={versionsQuery.data?.items ?? []}
          columns={[
            { key: "versionNumber", title: "Version", dataIndex: "versionNumber" },
            { key: "status", title: "Status", render: (_v, row) => <Tag>{row.status}</Tag> },
            { key: "effectiveFrom", title: "Effective From", dataIndex: "effectiveFrom" },
            {
              key: "actions",
              title: "",
              render: (_v, row) =>
                row.status === "draft" ? (
                  <Can permission="contract.clause.approve">
                    <Button size="small" onClick={() => void handleApprove(row.id)}>
                      Approve
                    </Button>
                  </Can>
                ) : null,
            },
          ]}
        />
      </Space>

      <Modal title="Add Version" open={addOpen} onCancel={() => setAddOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => void handleAddVersion(values)}>
          <Form.Item name="clauseText" label="Clause Text" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 4 }} />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="Effective From (YYYY-MM-DD)" rules={[{ required: true }]}>
            <Input placeholder="2026-01-01" />
          </Form.Item>
          <Form.Item name="changeReason" label="Change Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Add
          </Button>
        </Form>
      </Modal>
    </Modal>
  );
}
