import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Space, Spin, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { BrokerBank, BrokerContact } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { Can } from "../../core/permissions/Can";
import type { EntityRow } from "../../core/schema-table/types";
import { BrokerContactsEditor } from "./BrokerContactsEditor";
import { BrokerBanksEditor } from "./BrokerBanksEditor";

const MODULE = "brokers";
const ENTITY = "broker";

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

type DrawerState = { mode: "create" } | { mode: "edit"; id: string } | null;

interface BrokerFormValues {
  contacts?: BrokerContact[];
  banks?: BrokerBank[];
  [key: string]: unknown;
}

/** Fetches the full broker (list rows don't carry contacts/banks - brokers.service.ts's getById does), same pattern as suppliers/SupplierScreen.tsx's SupplierEditForm. */
function BrokerEditForm({
  brokerId,
  onSubmit,
}: {
  brokerId: string;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const brokerQuery = useQuery({
    queryKey: ["brokers", brokerId],
    queryFn: () => apiFetch<BrokerFormValues>(`${endpoints.brokers}/${brokerId}`),
  });

  const [contacts, setContacts] = useState<BrokerContact[]>([]);
  const [banks, setBanks] = useState<BrokerBank[]>([]);
  const [hydrated, setHydrated] = useState(false);

  if (brokerQuery.data && !hydrated) {
    setContacts(brokerQuery.data.contacts ?? []);
    setBanks(brokerQuery.data.banks ?? []);
    setHydrated(true);
  }

  if (brokerQuery.isLoading || !brokerQuery.data) {
    return <Spin />;
  }

  return (
    <SchemaForm
      module={MODULE}
      entity={ENTITY}
      mode="edit"
      initialValues={brokerQuery.data}
      onSubmit={(values) => onSubmit({ ...values, contacts, banks })}
      footer={
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <BrokerContactsEditor value={contacts} onChange={setContacts} />
          <BrokerBanksEditor value={banks} onChange={setBanks} />
        </Space>
      }
    />
  );
}

/**
 * Prompt 21 item 4: Broker is its own full module (mirrors suppliers/
 * SupplierScreen.tsx exactly), not a generic master - own contacts/banks
 * sub-tables, own activate/deactivate, own permission namespace
 * "brokers.broker.*".
 */
export function BrokerScreen(): ReactElement {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  function refreshList(): void {
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.brokers] });
  }

  async function handleCreate(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.brokers, { method: "POST", body: values });
    void message.success("Broker created");
    setDrawer(null);
    refreshList();
  }

  async function handleUpdate(id: string, values: Record<string, unknown>): Promise<void> {
    await apiFetch(`${endpoints.brokers}/${id}`, { method: "PATCH", body: values });
    void message.success("Broker updated");
    setDrawer(null);
    refreshList();
    void queryClient.invalidateQueries({ queryKey: ["brokers", id] });
  }

  async function setActive(row: EntityRow, isActive: boolean): Promise<void> {
    const endpoint = isActive ? endpoints.activateBroker(rowId(row)) : endpoints.deactivateBroker(rowId(row));
    await apiFetch(endpoint, { method: "PATCH" });
    void message.success(`Broker ${isActive ? "activated" : "deactivated"}`);
    refreshList();
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Brokers
        </Typography.Title>
        <Can permission="brokers.broker.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: "create" })}>
            New Broker
          </Button>
        </Can>
      </Space>

      <SchemaTable
        module={MODULE}
        entity={ENTITY}
        endpoint={endpoints.brokers}
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
            permission: "brokers.broker.update",
            onClick: (row) => setDrawer({ mode: "edit", id: rowId(row) }),
          },
          {
            key: "deactivate",
            label: "Deactivate",
            permission: "brokers.broker.update",
            danger: true,
            isVisible: (row) => row.status === "active",
            onClick: (row) => void setActive(row, false),
          },
          {
            key: "activate",
            label: "Activate",
            permission: "brokers.broker.update",
            isVisible: (row) => row.status === "inactive",
            onClick: (row) => void setActive(row, true),
          },
        ]}
      />

      <Drawer
        title={drawer?.mode === "edit" ? "Edit Broker" : "New Broker"}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={560}
        destroyOnHidden
      >
        {drawer?.mode === "create" && <CreateBrokerForm onSubmit={handleCreate} />}
        {drawer?.mode === "edit" && <BrokerEditForm brokerId={drawer.id} onSubmit={(values) => handleUpdate(drawer.id, values)} />}
      </Drawer>
    </Space>
  );
}

function CreateBrokerForm({ onSubmit }: { onSubmit: (values: Record<string, unknown>) => Promise<void> }): ReactElement {
  const [contacts, setContacts] = useState<BrokerContact[]>([]);
  const [banks, setBanks] = useState<BrokerBank[]>([]);

  return (
    <SchemaForm
      module={MODULE}
      entity={ENTITY}
      mode="create"
      onSubmit={(values) => onSubmit({ ...values, contacts, banks })}
      footer={
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <BrokerContactsEditor value={contacts} onChange={setContacts} />
          <BrokerBanksEditor value={banks} onChange={setBanks} />
        </Space>
      }
    />
  );
}
