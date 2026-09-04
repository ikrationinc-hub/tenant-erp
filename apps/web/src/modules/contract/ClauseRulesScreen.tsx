import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Button, Flex, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";

/**
 * C-4 item 1/2 - the rule engine's own management screen. Every condition
 * this UI can author is deliberately a SINGLE fact/operator/value test
 * (json-rules-engine's own `{all: [{fact, operator, value}]}` shape) - the
 * backend's own conditionJson column accepts arbitrary nested AllConditions/
 * AnyConditions/NotConditions trees, but a general nested-condition builder
 * is scope this build was never asked for; a single-condition rule is what
 * both the prompt's own example (CIF -> insurance) and every rule the
 * client is likely to hand over next actually need. isExample is NEVER an
 * input here (the backend hard-codes it server-side and rejects the field
 * outright) - every rule this screen creates renders with the same
 * "Example" tag the seeded CIF rule already carries, by construction.
 */

const FACT_OPTIONS = [
  { value: "divisionId", label: "Division" },
  { value: "materialType", label: "Material Type" },
  { value: "weightKg", label: "Weight (kg)" },
  { value: "rateUsd", label: "Rate (USD)" },
  { value: "deliveryTerms", label: "Delivery Terms (Incoterm name)" },
  { value: "sourceType", label: "Source Type" },
];

const OPERATOR_OPTIONS = [
  { value: "equal", label: "equals" },
  { value: "notEqual", label: "does not equal" },
  { value: "in", label: "is one of" },
  { value: "contains", label: "contains" },
  { value: "greaterThan", label: "greater than" },
  { value: "lessThan", label: "less than" },
];
/** json-rules-engine's own "in" operator requires the condition's value to be an array (engine-default-operators.js: `b.indexOf(a) > -1`) - every other operator here compares against a plain scalar. */
const ARRAY_VALUE_OPERATORS = new Set(["in", "notIn"]);

interface ClauseRuleRow {
  id: string;
  name: string;
  divisionId: string | null;
  conditionJson: { all?: { fact: string; operator: string; value: unknown }[] };
  targetClauseId: string;
  actionIsMandatory: boolean;
  isActive: boolean;
  isExample: boolean;
}
interface ClauseRulesListResponse {
  items: ClauseRuleRow[];
}
interface ClauseOption {
  id: string;
  clauseTitle: string;
  clauseCode: string;
}
interface ClausesListResponse {
  items: ClauseOption[];
}

interface RuleFormValues {
  name: string;
  fact: string;
  operator: string;
  value: string;
  targetClauseId: string;
  actionIsMandatory: boolean;
}

export function ClauseRulesScreen(): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<RuleFormValues>();
  const selectedOperator = Form.useWatch("operator", form);
  const isArrayValue = ARRAY_VALUE_OPERATORS.has(selectedOperator);

  const rulesQuery = useQuery({
    queryKey: ["clause-rules"],
    queryFn: () => apiFetch<ClauseRulesListResponse>(endpoints.clauseRules),
  });

  const clausesQuery = useQuery({
    queryKey: ["clause-library-options-for-rules"],
    queryFn: () => apiFetch<ClausesListResponse>(withQuery(endpoints.clauses, { pageSize: "200" })),
  });
  const clauseTitleById = new Map((clausesQuery.data?.items ?? []).map((c) => [c.id, `${c.clauseCode} — ${c.clauseTitle}`]));

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["clause-rules"] });
  }

  async function handleCreate(values: RuleFormValues): Promise<void> {
    try {
      const conditionValue: unknown = ARRAY_VALUE_OPERATORS.has(values.operator)
        ? values.value.split(",").map((v) => v.trim()).filter((v) => v.length > 0)
        : values.value;
      await apiFetch(endpoints.clauseRules, {
        method: "POST",
        body: {
          name: values.name,
          conditionJson: { all: [{ fact: values.fact, operator: values.operator, value: conditionValue }] },
          targetClauseId: values.targetClauseId,
          actionIsMandatory: values.actionIsMandatory ?? false,
        },
      });
      invalidate();
      setCreateOpen(false);
      form.resetFields();
      void message.success("Rule created");
    } catch {
      void message.error("Could not create rule");
    }
  }

  async function handleToggleActive(rule: ClauseRuleRow): Promise<void> {
    try {
      await apiFetch(endpoints.clauseRule(rule.id), { method: "PATCH", body: { isActive: !rule.isActive } });
      invalidate();
    } catch {
      void message.error("Could not update rule");
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Flex justify="space-between" align="flex-start">
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Clause Rules
          </Typography.Title>
          <Typography.Text type="secondary">Auto-add required clauses based on contract data</Typography.Text>
        </Space>
        <Can permission="contract.rule.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Rule
          </Button>
        </Can>
      </Flex>

      <Alert
        type="warning"
        showIcon
        message="Example rules - the real rules come from the client"
        description="Rules created through this screen prove the engine works end-to-end. Real rules must come from the client before any rule should be treated as governing an actual contract."
      />

      <Table<ClauseRuleRow>
        rowKey="id"
        loading={rulesQuery.isLoading}
        dataSource={rulesQuery.data?.items ?? []}
        columns={[
          {
            key: "name",
            title: "Rule",
            render: (_v, row) => (
              <Space>
                <ThunderboltOutlined />
                <Typography.Text>{row.name}</Typography.Text>
                {row.isExample && <Tag color="gold">Example</Tag>}
              </Space>
            ),
          },
          {
            key: "condition",
            title: "When",
            render: (_v, row) => {
              const condition = row.conditionJson.all?.[0];
              if (!condition) return "—";
              return (
                <Typography.Text code>
                  {condition.fact} {condition.operator} {String(condition.value)}
                </Typography.Text>
              );
            },
          },
          {
            key: "action",
            title: "Then add",
            render: (_v, row) => (
              <Space>
                <Typography.Text>{clauseTitleById.get(row.targetClauseId) ?? row.targetClauseId}</Typography.Text>
                {row.actionIsMandatory && <Tag color="warning">Mandatory</Tag>}
              </Space>
            ),
          },
          {
            key: "isActive",
            title: "Active",
            render: (_v, row) => (
              <Can permission="contract.rule.update">
                <Switch checked={row.isActive} onChange={() => void handleToggleActive(row)} size="small" />
              </Can>
            ),
          },
        ]}
      />

      <Modal title="New Clause Rule" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} destroyOnHidden width={560}>
        <Form form={form} layout="vertical" onFinish={(values) => void handleCreate(values)} initialValues={{ actionIsMandatory: false }}>
          <Form.Item name="name" label="Rule Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. CIF shipments require an insurance clause" />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="fact" label="If" rules={[{ required: true }]} style={{ width: "40%" }}>
              <Select options={FACT_OPTIONS} placeholder="Field" />
            </Form.Item>
            <Form.Item name="operator" label=" " rules={[{ required: true }]} style={{ width: "30%" }}>
              <Select options={OPERATOR_OPTIONS} placeholder="Condition" />
            </Form.Item>
            <Form.Item name="value" label=" " rules={[{ required: true }]} style={{ width: "30%" }} extra={isArrayValue ? "Comma-separated" : undefined}>
              <Input placeholder={isArrayValue ? "CIF, CFR" : "Value"} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="targetClauseId" label="Then add clause" rules={[{ required: true }]}>
            <Select
              placeholder="Select a clause from the library"
              loading={clausesQuery.isLoading}
              showSearch
              optionFilterProp="label"
              options={(clausesQuery.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.clauseCode} — ${c.clauseTitle}` }))}
            />
          </Form.Item>
          <Form.Item name="actionIsMandatory" label="Mandatory (cannot be removed once added)" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Create
          </Button>
        </Form>
      </Modal>
    </Space>
  );
}
