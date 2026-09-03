import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Space, Table, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { useEntityList } from "../../core/schema-table/use-entity-list";
import { useEntityListState } from "../../core/schema-table/use-entity-list-state";
import type { EntityRow } from "../../core/schema-table/types";
import { Can } from "../../core/permissions/Can";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { CONTRACT_STATUS_COLORS } from "../../core/status-tag/status-colors";

export const CONTRACTS_LIST_PATH = "/contracts";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
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
 */
export function ContractsListScreen(): ReactElement {
  const navigate = useNavigate();
  const { state, setPage, setPageSize } = useEntityListState([]);
  const listQuery = useEntityList(withQuery(endpoints.contracts, {}), state);

  async function handleCreate(): Promise<void> {
    const contract = await apiFetch<{ id: string }>(endpoints.contracts, {
      method: "POST",
      body: { contractDate: new Date().toISOString().slice(0, 10) },
    });
    void navigate(`${CONTRACTS_LIST_PATH}/${contract.id}`);
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Contracts
        </Typography.Title>
        <Can permission="contract.document.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void handleCreate()}>
            New Contract
          </Button>
        </Can>
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
          { key: "contractNumber", title: "Contract #", dataIndex: "contractNumber" },
          { key: "contractDate", title: "Date", dataIndex: "contractDate" },
          {
            key: "status",
            title: "Status",
            render: (_value: unknown, row: EntityRow) => <StatusTag value={asDisplayString(row.status)} colorMap={CONTRACT_STATUS_COLORS} />,
          },
        ]}
      />
    </Space>
  );
}
