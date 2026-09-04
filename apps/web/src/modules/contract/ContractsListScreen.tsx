import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, DatePicker, Flex, Form, Input, Modal, Select, Space, Table, Typography } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { ApiError } from "../../core/api/api-error";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { useEntityList } from "../../core/schema-table/use-entity-list";
import { useEntityListState } from "../../core/schema-table/use-entity-list-state";
import type { EntityRow } from "../../core/schema-table/types";
import { Can } from "../../core/permissions/Can";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { CONTRACT_STATUS_COLORS } from "../../core/status-tag/status-colors";

export const CONTRACTS_LIST_PATH = "/contracts";
const DATE_FORMAT = "YYYY-MM-DD";
const FILTER_KEYS = ["status", "divisionId"] as const;

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "signed", label: "Signed" },
  { value: "closed", label: "Closed" },
];

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function useDivisionOptions() {
  const query = useQuery({
    queryKey: ["field-options", "divisions"],
    queryFn: () => apiFetch(endpoints.masterOptions("divisions"), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

/** Seller always resolves to Supplier, buyer always resolves to Customer - same fixed mapping as ContractPartiesForm.tsx. */
function useSupplierOptions() {
  const query = useQuery({
    queryKey: ["field-options", endpoints.supplierOptions],
    queryFn: () => apiFetch(endpoints.supplierOptions, {}, { schema: masterOptionsResponseSchema }),
  });
  return query.data?.options ?? [];
}
function useCustomerOptions() {
  const query = useQuery({
    queryKey: ["field-options", "customers"],
    queryFn: () => apiFetch(endpoints.masterOptions("customers"), {}, { schema: masterOptionsResponseSchema }),
  });
  return query.data?.options ?? [];
}

interface TemplateOption {
  id: string;
  name: string;
  contractType: string;
}
function useTemplateOptions() {
  const query = useQuery({
    queryKey: ["contract-templates-options"],
    queryFn: () => apiFetch<{ items: TemplateOption[] }>(withQuery(endpoints.contractTemplates, { pageSize: "200" })),
  });
  return query.data?.items ?? [];
}

interface PurchaseOption {
  id: string;
  purchaseNumber: string;
}
/** No Sales module yet (ADR 0023) - only "purchase" is a resolvable link source; offering "sale" here would 404 at create time. */
function usePurchaseOptions(search: string) {
  const query = useQuery({
    queryKey: ["contract-link-purchases", search],
    queryFn: () => apiFetch<{ items: PurchaseOption[] }>(withQuery(endpoints.purchases, { pageSize: "50", search: search || undefined })),
  });
  return query.data?.items ?? [];
}

const CONTRACT_TYPE_OPTIONS = [
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchase" },
];

/** Templates store contractType as free text ("Sale Contract"/"Purchase Contract" - see ContractTemplatesScreen.tsx's own CONTRACT_TYPE_OPTIONS); map to the contract's own sale/purchase enum to filter the Template picker by the selected contract Type. */
const TEMPLATE_TYPE_TO_CONTRACT_TYPE: Record<string, "sale" | "purchase"> = {
  "Sale Contract": "sale",
  "Purchase Contract": "purchase",
};

interface CreateContractFormValues {
  divisionId: string;
  contractDate: string;
  contractType?: "sale" | "purchase";
  templateId?: string;
  sourcePurchaseId?: string;
  sellerSupplierId?: string;
  buyerCustomerId?: string;
}

/**
 * C-3b: a flat, filterable, server-paginated table of every contract
 * (rule 10). Plain AntD Table, not <SchemaTable/> - contractNumber/
 * status/contractDate are Tier-1 system columns with no field-
 * definitions row at all (they're not part of the division-scoped Tier-2
 * form fields C-3a introduced), so there is nothing for <SchemaTable/>'s
 * field-definitions-driven column derivation to key off of here; the
 * detail screen's own header form still renders entirely from field
 * definitions (frontend rule 1), this list just isn't that form.
 *
 * The division picker below exists because a contract created with no
 * divisionId has nothing for the field engine to scope its Tier-2 header
 * fields to - <SchemaForm/> on ContractDetailScreen then has no fields to
 * render at all (frontend rule 1: it renders exactly what field-
 * definitions resolves, never a hardcoded fallback), which read as a
 * broken/empty "Scrap Details" box with no way to fix it after creation.
 * Division is required here so every contract this screen creates has one
 * from the start. contractDate defaults to today but is a real picker
 * here (and editable on the detail screen's own header while Draft) -
 * it's a Tier-1 column, not a field-definitions entry, so it can't render
 * through <SchemaForm/>; this is its own explicit field for that reason.
 */
export function ContractsListScreen(): ReactElement {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { state, setPage, setPageSize, setSearch, setFilter } = useEntityListState(FILTER_KEYS);
  const listQuery = useEntityList(endpoints.contracts, state);
  const divisionOptions = useDivisionOptions();
  const divisionLabelById = new Map(divisionOptions.map((o) => [o.value, o.label]));
  const templateOptions = useTemplateOptions();
  const [createOpen, setCreateOpen] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const purchaseOptions = usePurchaseOptions(purchaseSearch);
  const supplierOptions = useSupplierOptions();
  const customerOptions = useCustomerOptions();
  const [form] = Form.useForm<CreateContractFormValues>();
  const selectedContractType = Form.useWatch("contractType", form);
  const selectedTemplateId = Form.useWatch("templateId", form);
  const templateOptionsForType = selectedContractType
    ? templateOptions.filter((t) => TEMPLATE_TYPE_TO_CONTRACT_TYPE[t.contractType] === selectedContractType)
    : templateOptions;

  async function handleCreate(values: CreateContractFormValues): Promise<void> {
    try {
      const contract = await apiFetch<{ id: string }>(endpoints.contracts, {
        method: "POST",
        body: {
          contractDate: values.contractDate,
          divisionId: values.divisionId,
          ...(values.contractType ? { contractType: values.contractType } : {}),
          ...(values.templateId ? { templateId: values.templateId } : {}),
          ...(values.sourcePurchaseId ? { source: { sourceType: "purchase", sourceId: values.sourcePurchaseId } } : {}),
          ...(values.sellerSupplierId ? { seller: { supplierId: values.sellerSupplierId } } : {}),
          ...(values.buyerCustomerId ? { buyer: { customerId: values.buyerCustomerId } } : {}),
        },
      });
      setCreateOpen(false);
      form.resetFields();
      void navigate(`${CONTRACTS_LIST_PATH}/${contract.id}`);
    } catch (error) {
      void message.error(error instanceof ApiError ? error.message : "Could not create contract");
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Flex justify="space-between" align="flex-start">
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Contracts
          </Typography.Title>
          <Typography.Text type="secondary">{listQuery.data?.total ?? 0} contracts</Typography.Text>
        </Space>
        <Can permission="contract.document.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New Contract
          </Button>
        </Can>
      </Flex>

      <Space wrap>
        <Input
          placeholder="Search"
          prefix={<SearchOutlined />}
          style={{ width: 220 }}
          defaultValue={state.search}
          onPressEnter={(e) => setSearch(e.currentTarget.value || undefined)}
          allowClear
          onClear={() => setSearch(undefined)}
        />
        <Select
          placeholder="Status"
          allowClear
          style={{ width: 160 }}
          value={state.filters.status ?? null}
          onChange={(value) => setFilter("status", value ?? undefined)}
          options={STATUS_OPTIONS}
        />
        <Select
          placeholder="Division"
          allowClear
          style={{ width: 180 }}
          value={state.filters.divisionId ?? null}
          onChange={(value) => setFilter("divisionId", value ?? undefined)}
          options={divisionOptions}
        />
      </Space>

      <Table<EntityRow>
        rowKey="id"
        loading={listQuery.isLoading}
        dataSource={listQuery.data?.items ?? []}
        onRow={(row) => ({ onClick: () => void navigate(`${CONTRACTS_LIST_PATH}/${asDisplayString(row.id)}`) })}
        pagination={{
          current: state.page,
          pageSize: state.pageSize,
          total: listQuery.data?.total ?? 0,
          onChange: (page, pageSize) => {
            setPage(page);
            setPageSize(pageSize);
          },
        }}
        columns={[
          { key: "contractNumber", title: "Contract #", dataIndex: "contractNumber", render: (v: unknown) => <Typography.Text code>{asDisplayString(v)}</Typography.Text> },
          {
            key: "revisionNumber",
            title: "Rev",
            render: (_value: unknown, row: EntityRow) => asDisplayString(row.revisionNumber),
          },
          {
            key: "division",
            title: "Division",
            render: (_value: unknown, row: EntityRow) => {
              const divisionId = asDisplayString(row.divisionId);
              return divisionId ? (divisionLabelById.get(divisionId) ?? divisionId) : "—";
            },
          },
          {
            key: "contractType",
            title: "Type",
            render: (_value: unknown, row: EntityRow) => {
              const type = asDisplayString(row.contractType);
              return CONTRACT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? "—";
            },
          },
          { key: "contractDate", title: "Date", dataIndex: "contractDate" },
          {
            key: "status",
            title: "Status",
            render: (_value: unknown, row: EntityRow) => <StatusTag value={asDisplayString(row.status)} colorMap={CONTRACT_STATUS_COLORS} />,
          },
        ]}
      />

      <Modal title="New Contract" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => void handleCreate(values)} initialValues={{ contractDate: dayjs().format(DATE_FORMAT) }}>
          <Form.Item name="divisionId" label="Division" rules={[{ required: true, message: "Select a division" }]}>
            <Select placeholder="Select a division" options={divisionOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="contractType" label="Type">
            <Select
              placeholder="Select a type"
              allowClear
              options={CONTRACT_TYPE_OPTIONS}
              onChange={() => form.setFieldValue("templateId", undefined)}
            />
          </Form.Item>
          <Form.Item
            name="contractDate"
            label="Contract Date"
            rules={[{ required: true, message: "Select a date" }]}
            getValueProps={(value?: string) => ({ value: value ? dayjs(value, DATE_FORMAT) : undefined })}
            normalize={(value: Dayjs | null) => (value ? value.format(DATE_FORMAT) : undefined)}
          >
            <DatePicker style={{ width: "100%" }} format={DATE_FORMAT} />
          </Form.Item>
          <Form.Item name="sourcePurchaseId" label="Link to Purchase">
            <Select
              placeholder="Standalone (no linked document)"
              allowClear
              showSearch
              filterOption={false}
              onSearch={setPurchaseSearch}
              options={purchaseOptions.map((p) => ({ value: p.id, label: p.purchaseNumber }))}
            />
          </Form.Item>
          <Form.Item name="templateId" label="Template">
            <Select
              placeholder={selectedContractType ? "No template" : "Select a type first, or pick from all templates"}
              allowClear
              showSearch
              optionFilterProp="label"
              options={templateOptionsForType.map((t) => ({ value: t.id, label: `${t.name} (${t.contractType})` }))}
            />
          </Form.Item>
          {selectedTemplateId && (
            <>
              <Form.Item
                name="sellerSupplierId"
                label="Seller"
                extra="The chosen template may reference the seller/buyer in its clauses - set them now to avoid a placeholder error."
              >
                <Select placeholder="Select a supplier" allowClear showSearch optionFilterProp="label" options={supplierOptions} />
              </Form.Item>
              <Form.Item name="buyerCustomerId" label="Buyer">
                <Select placeholder="Select a customer" allowClear showSearch optionFilterProp="label" options={customerOptions} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Space>
  );
}
