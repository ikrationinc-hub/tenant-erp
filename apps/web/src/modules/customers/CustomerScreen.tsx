import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Space, Spin, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema, type CustomerBank, type CustomerContact } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { Can } from "../../core/permissions/Can";
import type { EntityRow } from "../../core/schema-table/types";
import { CustomerContactsEditor } from "./CustomerContactsEditor";
import { CustomerBanksEditor } from "./CustomerBanksEditor";

const MODULE = "customers";
const ENTITY = "customer";

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/** Exact mirror of SupplierScreen's useMasterOptions - a select field backed by a masters:X optionsSource stores the master's row id, not a label. */
function useMasterOptions(master: string) {
  const query = useQuery({
    queryKey: ["field-options", master],
    queryFn: () => apiFetch(endpoints.masterOptions(master), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

type DrawerState = { mode: "create" } | { mode: "edit"; id: string } | null;

interface CustomerFormValues {
  contacts?: CustomerContact[];
  banks?: CustomerBank[];
  [key: string]: unknown;
}

/** Fetches the full customer (list rows don't carry contacts/banks - customers.service.ts's getById does) so the edit drawer starts from real sub-table data. */
function CustomerEditForm({
  customerId,
  onSubmit,
}: {
  customerId: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const customerQuery = useQuery({
    queryKey: ["customers", customerId],
    queryFn: () => apiFetch<CustomerFormValues>(`${endpoints.customers}/${customerId}`),
  });

  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [banks, setBanks] = useState<CustomerBank[]>([]);
  const [hydrated, setHydrated] = useState(false);

  if (customerQuery.data && !hydrated) {
    setContacts(customerQuery.data.contacts ?? []);
    setBanks(customerQuery.data.banks ?? []);
    setHydrated(true);
  }

  if (customerQuery.isLoading || !customerQuery.data) {
    return <Spin />;
  }

  return (
    <SchemaForm
      module={MODULE}
      entity={ENTITY}
      mode="edit"
      initialValues={customerQuery.data}
      onSubmit={(values) => onSubmit({ ...values, contacts, banks })}
      footer={
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <CustomerContactsEditor value={contacts} onChange={setContacts} />
          <CustomerBanksEditor value={banks} onChange={setBanks} />
        </Space>
      }
    />
  );
}

/**
 * S-1 (docs/SALES-MODULE-PLAN.md): SchemaTable (list, search, activate/
 * deactivate) + SchemaForm (the scalar fields) + two bespoke sub-table
 * editors (contacts, banks) in a Drawer. Exact mirror of SupplierScreen -
 * the submit payload isn't SchemaForm's flat values alone, contacts/banks
 * are merged in before the POST/PATCH (customers.validator.ts accepts
 * both inline on create and update).
 */
export function CustomerScreen(): ReactElement {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const customerTypes = useMasterOptions("customer-types");
  const countries = useMasterOptions("countries");
  const cities = useMasterOptions("cities");
  const paymentTerms = useMasterOptions("payment-terms");
  const currencies = useMasterOptions("currencies");

  const customerTypeLabels = useMemo(() => new Map(customerTypes.map((o) => [o.value, o.label])), [customerTypes]);
  const countryLabels = useMemo(() => new Map(countries.map((o) => [o.value, o.label])), [countries]);
  const cityLabels = useMemo(() => new Map(cities.map((o) => [o.value, o.label])), [cities]);
  const paymentTermLabels = useMemo(() => new Map(paymentTerms.map((o) => [o.value, o.label])), [paymentTerms]);
  const currencyLabels = useMemo(() => new Map(currencies.map((o) => [o.value, o.label])), [currencies]);

  function resolvedLabel(labels: Map<string, string>, value: unknown): string {
    const id = asDisplayString(value);
    return labels.get(id) ?? id;
  }

  function refreshList(): void {
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.customers] });
  }

  async function handleCreate(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.customers, { method: "POST", body: values });
    void message.success("Customer created");
    setDrawer(null);
    refreshList();
  }

  async function handleUpdate(id: string, values: Record<string, unknown>): Promise<void> {
    await apiFetch(`${endpoints.customers}/${id}`, { method: "PATCH", body: values });
    void message.success("Customer updated");
    setDrawer(null);
    refreshList();
    void queryClient.invalidateQueries({ queryKey: ["customers", id] });
  }

  async function setActive(row: EntityRow, isActive: boolean): Promise<void> {
    const endpoint = isActive ? endpoints.activateCustomer(rowId(row)) : endpoints.deactivateCustomer(rowId(row));
    await apiFetch(endpoint, { method: "PATCH" });
    void message.success(`Customer ${isActive ? "activated" : "deactivated"}`);
    refreshList();
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Customers
        </Typography.Title>
        <Can permission="customers.customer.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: "create" })}>
            New Customer
          </Button>
        </Can>
      </Space>

      <SchemaTable
        module={MODULE}
        entity={ENTITY}
        endpoint={endpoints.customers}
        columns={[
          { fieldKey: "customerTypeId", render: (value) => resolvedLabel(customerTypeLabels, value) },
          { fieldKey: "countryId", render: (value) => resolvedLabel(countryLabels, value) },
          { fieldKey: "cityId", render: (value) => resolvedLabel(cityLabels, value) },
          { fieldKey: "paymentTermId", render: (value) => resolvedLabel(paymentTermLabels, value) },
          { fieldKey: "currencyId", render: (value) => resolvedLabel(currencyLabels, value) },
        ]}
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { label: "Active", value: "active" },
              { label: "Inactive", value: "inactive" },
            ],
          },
        ]}
        actions={[
          {
            key: "edit",
            label: "Edit",
            permission: "customers.customer.update",
            onClick: (row) => setDrawer({ mode: "edit", id: rowId(row) }),
          },
          {
            key: "deactivate",
            label: "Deactivate",
            permission: "customers.customer.update",
            danger: true,
            isVisible: (row) => row.status === "active",
            onClick: (row) => void setActive(row, false),
          },
          {
            key: "activate",
            label: "Activate",
            permission: "customers.customer.update",
            isVisible: (row) => row.status === "inactive",
            onClick: (row) => void setActive(row, true),
          },
        ]}
      />

      <Drawer
        title={drawer?.mode === "edit" ? "Edit Customer" : "New Customer"}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={560}
        destroyOnHidden
      >
        {drawer?.mode === "create" && <CreateCustomerForm onSubmit={handleCreate} />}
        {drawer?.mode === "edit" && (
          <CustomerEditForm customerId={drawer.id} onSubmit={(values) => handleUpdate(drawer.id, values)} />
        )}
      </Drawer>
    </Space>
  );
}

function CreateCustomerForm({
  onSubmit,
}: {
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [banks, setBanks] = useState<CustomerBank[]>([]);

  return (
    <SchemaForm
      module={MODULE}
      entity={ENTITY}
      mode="create"
      onSubmit={(values) => onSubmit({ ...values, contacts, banks })}
      footer={
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <CustomerContactsEditor value={contacts} onChange={setContacts} />
          <CustomerBanksEditor value={banks} onChange={setBanks} />
        </Space>
      }
    />
  );
}
