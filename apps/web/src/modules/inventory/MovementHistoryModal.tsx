import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal, Table, Tag, Typography } from "antd";
import { paginatedRowsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import type { EntityRow } from "../../core/schema-table/types";
import { asDisplayString } from "./shared";

export interface MovementHistoryModalProps {
  itemId: string;
  warehouseId: string;
  itemLabel: string;
  warehouseLabel: string;
  onClose: () => void;
}

/** The movement history behind one balance row (FE requirement: row click -> history) - GET /inventory/movements/:itemId/:warehouseId, the same read-only ledger endpoint the Movements screen uses, just pinned to one item+warehouse. */
export function MovementHistoryModal({ itemId, warehouseId, itemLabel, warehouseLabel, onClose }: MovementHistoryModalProps): ReactElement {
  const query = useQuery({
    queryKey: ["inventory-movements-for-balance", itemId, warehouseId],
    queryFn: () =>
      apiFetch(endpoints.inventoryMovementsForBalance(itemId, warehouseId), {}, { schema: paginatedRowsResponseSchema }),
  });

  const rows = (query.data?.items ?? []) as EntityRow[];

  return (
    <Modal
      open
      title={`Movement history — ${itemLabel} @ ${warehouseLabel}`}
      onCancel={onClose}
      footer={null}
      width={720}
    >
      <Table<EntityRow>
        rowKey={(row) => asDisplayString(row.id)}
        size="small"
        loading={query.isLoading}
        dataSource={rows}
        pagination={false}
        columns={[
          { key: "movementDate", title: "Date", dataIndex: "movementDate" },
          {
            key: "movementType",
            title: "Type",
            render: (_value: unknown, row: EntityRow) => <Tag color="green">{asDisplayString(row.movementType)}</Tag>,
          },
          {
            key: "quantity",
            title: "Quantity",
            render: (_value: unknown, row: EntityRow) => {
              const quantity = asDisplayString(row.quantity);
              return quantity.startsWith("-") ? quantity : `+${quantity}`;
            },
          },
          {
            key: "source",
            title: "Source Document",
            render: (_value: unknown, row: EntityRow) =>
              row.sourcePurchaseNumber ? (
                <Typography.Link href={`/purchase/orders/${asDisplayString(row.sourcePurchaseId)}`}>
                  {asDisplayString(row.sourcePurchaseNumber)}
                </Typography.Link>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </Modal>
  );
}
