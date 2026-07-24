import type { ReactElement } from "react";
import { useState } from "react";
import { Button, Input, Space, Table, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { SupplierContact } from "@hyperion/contracts";

/**
 * FR-... Sub Tab 1's "Contact Person"/"Mobile Number"/"Email Address" are
 * modeled as a repeatable sub-table by the real backend (suppliers.
 * validator.ts's supplierContactSchema, one row per contact), not a flat
 * field - no fieldType in the 13-type spec fits a repeating row group, so
 * this is a bespoke component (same category as FE-5.5's
 * PermissionAssignment), not field-definitions-driven.
 */
export function SupplierContactsEditor({
  value,
  onChange,
}: {
  value: SupplierContact[];
  onChange: (next: SupplierContact[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState<SupplierContact>({ contactPerson: "", mobile: "", email: "" });

  function addContact(): void {
    if (!draft.contactPerson.trim()) {
      return;
    }
    onChange([...value, draft]);
    setDraft({ contactPerson: "", mobile: "", email: "" });
  }

  function removeContact(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      <Typography.Text strong>Contacts</Typography.Text>
      <Table
        size="small"
        rowKey={(_, index) => `contact-${index ?? 0}`}
        dataSource={value}
        pagination={false}
        style={{ marginTop: 8, marginBottom: 8 }}
        locale={{ emptyText: "No contacts added" }}
        columns={[
          { title: "Contact Person", dataIndex: "contactPerson" },
          { title: "Mobile", dataIndex: "mobile" },
          { title: "Email", dataIndex: "email" },
          {
            title: "",
            key: "actions",
            width: 48,
            render: (_value, _row, index) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Remove contact ${index + 1}`}
                onClick={() => removeContact(index)}
              />
            ),
          },
        ]}
      />
      <Space wrap>
        <Input
          placeholder="Contact person"
          aria-label="New contact person"
          value={draft.contactPerson}
          onChange={(event) => setDraft({ ...draft, contactPerson: event.target.value })}
          style={{ width: 160 }}
        />
        <Input
          placeholder="Mobile"
          aria-label="New contact mobile"
          value={draft.mobile}
          onChange={(event) => setDraft({ ...draft, mobile: event.target.value })}
          style={{ width: 140 }}
        />
        <Input
          placeholder="Email"
          aria-label="New contact email"
          value={draft.email}
          onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          style={{ width: 180 }}
        />
        <Button icon={<PlusOutlined />} onClick={addContact}>
          Add contact
        </Button>
      </Space>
    </div>
  );
}
