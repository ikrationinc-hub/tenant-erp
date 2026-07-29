import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Space, Spin, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema, type SupplierBank, type SupplierContact } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { Can } from "../../core/permissions/Can";
import type { EntityRow } from "../../core/schema-table/types";
import { SupplierContactsEditor } from "./SupplierContactsEditor";
import { SupplierBanksEditor } from "./SupplierBanksEditor";

const MODULE = "suppliers";
const ENTITY = "supplier";

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/** Same pattern as PurchaseListScreen's useMasterOptions - a select field
 * backed by a masters:X optionsSource stores the master's row id, not a
 * label, so the list needs its own resolved-value -> label lookup (the
 * form's Dropdown does this too, but via use-field-options.ts, which
 * SchemaTable's read-only grid doesn't use). */
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

interface SupplierFormValues {
  contacts?: SupplierContact[];
  banks?: SupplierBank[];
  [key: string]: unknown;
}

/** Fetches the full supplier (list rows don't carry contacts/banks - suppliers.service.ts's getById does) so the edit drawer starts from real sub-table data. */
function SupplierEditForm({
  supplierId,
  onSubmit,
}: {
  supplierId: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const supplierQuery = useQuery({
    queryKey: ["suppliers", supplierId],
    queryFn: () => apiFetch<SupplierFormValues>(`${endpoints.suppliers}/${supplierId}`),
  });

  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [banks, setBanks] = useState<SupplierBank[]>([]);
  const [hydrated, setHydrated] = useState(false);

  if (supplierQuery.data && !hydrated) {
    setContacts(supplierQuery.data.contacts ?? []);
    setBanks(supplierQuery.data.banks ?? []);
    setHydrated(true);
  }

  if (supplierQuery.isLoading || !supplierQuery.data) {
    return <Spin />;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <SchemaForm
        module={MODULE}
        entity={ENTITY}
        mode="edit"
        initialValues={supplierQuery.data}
        onSubmit={(values) => onSubmit({ ...values, contacts, banks })}
      />
      <SupplierContactsEditor value={contacts} onChange={setContacts} />
      <SupplierBanksEditor value={banks} onChange={setBanks} />
    </Space>
  );
}

/**
 * FR-001..006: SchemaTable (list, search, activate/deactivate) +
 * SchemaForm (the 11 scalar fields) + two bespoke sub-table editors
 * (contacts, banks) in a Drawer. Unlike MasterScreen/RecordScreen, the
 * submit payload isn't SchemaForm's flat values alone - contacts/banks
 * are merged in before the POST/PATCH (suppliers.validator.ts accepts
 * both inline on create and update).
 */
export function SupplierScreen(): ReactElement {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const supplierTypes = useMasterOptions("supplier-types");
  const countries = useMasterOptions("countries");
  const cities = useMasterOptions("cities");
  const paymentTerms = useMasterOptions("payment-terms");
  const currencies = useMasterOptions("currencies");

  const supplierTypeLabels = useMemo(() => new Map(supplierTypes.map((o) => [o.value, o.label])), [supplierTypes]);
  const countryLabels = useMemo(() => new Map(countries.map((o) => [o.value, o.label])), [countries]);
  const cityLabels = useMemo(() => new Map(cities.map((o) => [o.value, o.label])), [cities]);
  const paymentTermLabels = useMemo(() => new Map(paymentTerms.map((o) => [o.value, o.label])), [paymentTerms]);
  const currencyLabels = useMemo(() => new Map(currencies.map((o) => [o.value, o.label])), [currencies]);

  function resolvedLabel(labels: Map<string, string>, value: unknown): string {
    const id = asDisplayString(value);
    return labels.get(id) ?? id;
  }

  function refreshList(): void {
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.suppliers] });
  }

  async function handleCreate(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.suppliers, { method: "POST", body: values });
    void message.success("Supplier created");
    setDrawer(null);
    refreshList();
  }

  async function handleUpdate(id: string, values: Record<string, unknown>): Promise<void> {
    await apiFetch(`${endpoints.suppliers}/${id}`, { method: "PATCH", body: values });
    void message.success("Supplier updated");
    setDrawer(null);
    refreshList();
    void queryClient.invalidateQueries({ queryKey: ["suppliers", id] });
  }

  async function setActive(row: EntityRow, isActive: boolean): Promise<void> {
    const endpoint = isActive ? endpoints.activateSupplier(rowId(row)) : endpoints.deactivateSupplier(rowId(row));
    await apiFetch(endpoint, { method: "PATCH" });
    void message.success(`Supplier ${isActive ? "activated" : "deactivated"}`);
    refreshList();
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Suppliers
        </Typography.Title>
        <Can permission="suppliers.supplier.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: "create" })}>
            New Supplier
          </Button>
        </Can>
      </Space>

      <SchemaTable
        module={MODULE}
        entity={ENTITY}
        endpoint={endpoints.suppliers}
        columns={[
          { fieldKey: "supplierTypeId", render: (value) => resolvedLabel(supplierTypeLabels, value) },
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
            permission: "suppliers.supplier.update",
            onClick: (row) => setDrawer({ mode: "edit", id: rowId(row) }),
          },
          {
            key: "deactivate",
            label: "Deactivate",
            permission: "suppliers.supplier.update",
            danger: true,
            isVisible: (row) => row.status === "active",
            onClick: (row) => void setActive(row, false),
          },
          {
            key: "activate",
            label: "Activate",
            permission: "suppliers.supplier.update",
            isVisible: (row) => row.status === "inactive",
            onClick: (row) => void setActive(row, true),
          },
        ]}
      />

      <Drawer
        title={drawer?.mode === "edit" ? "Edit Supplier" : "New Supplier"}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={560}
        destroyOnHidden
      >
        {drawer?.mode === "create" && <CreateSupplierForm onSubmit={handleCreate} />}
        {drawer?.mode === "edit" && (
          <SupplierEditForm supplierId={drawer.id} onSubmit={(values) => handleUpdate(drawer.id, values)} />
        )}
      </Drawer>
    </Space>
  );
}

function CreateSupplierForm({
  onSubmit,
}: {
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [banks, setBanks] = useState<SupplierBank[]>([]);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <SchemaForm
        module={MODULE}
        entity={ENTITY}
        mode="create"
        onSubmit={(values) => onSubmit({ ...values, contacts, banks })}
      />
      <SupplierContactsEditor value={contacts} onChange={setContacts} />
      <SupplierBanksEditor value={banks} onChange={setBanks} />
    </Space>
  );
}
