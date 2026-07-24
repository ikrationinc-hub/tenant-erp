import type { ReactElement } from "react";
import { useState } from "react";
import { Button, Input, Space, Table, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { SupplierBank } from "@hyperion/contracts";

/** Same reasoning as SupplierContactsEditor - "Bank Details" is a repeatable sub-table in the real backend, not a flat field. */
export function SupplierBanksEditor({
  value,
  onChange,
}: {
  value: SupplierBank[];
  onChange: (next: SupplierBank[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState("");

  function addBank(): void {
    if (!draft.trim()) {
      return;
    }
    onChange([...value, { details: draft }]);
    setDraft("");
  }

  function removeBank(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      <Typography.Text strong>Banking</Typography.Text>
      <Table
        size="small"
        rowKey={(_, index) => `bank-${index ?? 0}`}
        dataSource={value}
        pagination={false}
        style={{ marginTop: 8, marginBottom: 8 }}
        locale={{ emptyText: "No bank details added" }}
        columns={[
          { title: "Bank Details", dataIndex: "details" },
          {
            title: "",
            key: "actions",
            width: 48,
            render: (_value, _row, index) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Remove bank ${index + 1}`}
                onClick={() => removeBank(index)}
              />
            ),
          },
        ]}
      />
      <Space wrap>
        <Input.TextArea
          placeholder="Bank details"
          aria-label="New bank details"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          style={{ width: 320 }}
        />
        <Button icon={<PlusOutlined />} onClick={addBank}>
          Add bank
        </Button>
      </Space>
    </div>
  );
}
