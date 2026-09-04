import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Card, DatePicker, Drawer, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { CheckCircleOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { semantic } from "../../theme/palette";

const DATE_FORMAT = "YYYY-MM-DD";

/**
 * Plain AntD Form (not <SchemaForm/> - clause metadata isn't part of the
 * field-definitions engine), so date handling has to be wired by hand:
 * getValueProps/normalize keep the FORM STATE (and what's POSTed to the
 * API) as the same "YYYY-MM-DD" string clauses.service.ts's validator
 * expects, with Dayjs mediating only the widget itself - same "never a
 * Date/dayjs object in form state" discipline as core/schema-form/field-
 * types/DatePickerField.tsx.
 */
const dateFieldProps = {
  getValueProps: (value?: string) => ({ value: value ? dayjs(value, DATE_FORMAT) : undefined }),
  normalize: (value: Dayjs | null) => (value ? value.format(DATE_FORMAT) : undefined),
};

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
  clauseText: string;
  changeReason: string;
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
      <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Clause Library
          </Typography.Title>
          <Typography.Text type="secondary">Versioned - edits create new versions; signed contracts keep their snapshot</Typography.Text>
        </Space>
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
              <Button size="small" icon={<HistoryOutlined />} onClick={() => setManagingClauseId(row.id)}>
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
          <Form.Item name="effectiveFrom" label="Effective From" rules={[{ required: true }]} {...dateFieldProps}>
            <DatePicker style={{ width: "100%" }} format={DATE_FORMAT} />
          </Form.Item>
          <Form.Item name="changeReason" label="Change Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>

      {managingClauseId && <ClauseVersionsDrawer clauseId={managingClauseId} onClose={() => setManagingClauseId(null)} />}
    </Space>
  );
}

const VERSION_STATUS_TAG_COLOR: Record<string, string> = {
  draft: "default",
  approved: "gold",
  active: "success",
  superseded: "default",
  expired: "default",
};

/**
 * Version history as a slide-in Drawer (mockup: docs/mockups/ikration-
 * contract-prototype.html's clause-version drawer) - the Active version
 * gets a highlighted border/background (semantic.success), matching the
 * mockup's `.ver.active` treatment but with our own theme color. Same
 * data/handlers as before this redesign (handleAddVersion, handleApprove)
 * - only the Modal->Drawer conversion and per-version card styling changed.
 */
function ClauseVersionsDrawer({ clauseId, onClose }: { clauseId: string; onClose: () => void }): ReactElement {
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

  const versions = versionsQuery.data?.items ?? [];

  return (
    <Drawer
      title="Clause Versions"
      open
      onClose={onClose}
      width={480}
      destroyOnHidden
      extra={
        <Can permission="contract.clause.version">
          <Button size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Add Version
          </Button>
        </Can>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Editing creates a new version. Signed contracts keep the version they were signed with - always.
      </Typography.Paragraph>

      {versionsQuery.isLoading && <Typography.Text type="secondary">Loading...</Typography.Text>}
      {!versionsQuery.isLoading && versions.length === 0 && <Empty description="No versions yet" />}

      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        {versions.map((version) => {
          const isActive = version.status === "active";
          return (
            <Card
              key={version.id}
              size="small"
              style={isActive ? { borderColor: semantic.success, background: "rgba(14, 159, 110, 0.06)" } : {}}
            >
              <Space align="center" style={{ marginBottom: 6 }}>
                <Tag color={VERSION_STATUS_TAG_COLOR[version.status] ?? "default"}>{isActive && <CheckCircleOutlined />} {version.status}</Tag>
                <Typography.Text strong>v{version.versionNumber}</Typography.Text>
              </Space>
              <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                {version.clauseText}
              </Typography.Paragraph>
              <Typography.Text type="secondary" style={{ fontSize: 11.5, display: "block", marginTop: 6 }}>
                Effective {version.effectiveFrom} · Reason: "{version.changeReason}"
              </Typography.Text>
              {version.status === "draft" && (
                <Can permission="contract.clause.approve">
                  <Button size="small" style={{ marginTop: 8 }} onClick={() => void handleApprove(version.id)}>
                    Approve
                  </Button>
                </Can>
              )}
            </Card>
          );
        })}
      </Space>

      <Modal title="Add Version" open={addOpen} onCancel={() => setAddOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => void handleAddVersion(values)}>
          <Form.Item name="clauseText" label="Clause Text" rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 4 }} />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="Effective From" rules={[{ required: true }]} {...dateFieldProps}>
            <DatePicker style={{ width: "100%" }} format={DATE_FORMAT} />
          </Form.Item>
          <Form.Item name="changeReason" label="Change Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Add
          </Button>
        </Form>
      </Modal>
    </Drawer>
  );
}
