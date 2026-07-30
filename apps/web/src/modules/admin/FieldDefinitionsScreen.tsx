import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Checkbox, Input, Select, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import {
  fieldDefinitionModulesResponseSchema,
  fieldDefinitionsResponseSchema,
  type FieldDefinitionsResponse,
} from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";

interface ModuleEntityOption {
  label: string;
  value: string;
  module: string;
  entity: string;
}

interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  tier: number;
  isVisible: boolean;
  isMandatory: boolean;
  isSystem: boolean;
  sortOrder: number;
}

/**
 * Deliberately NOT resolveFieldSections - that helper drops any field
 * with isVisible: false, which is exactly right for SchemaForm/SchemaTable
 * (a data-entry consumer has no business rendering a field the company
 * hid) but wrong here: an admin unchecking Visible and saving must not
 * make that same field disappear from the one screen that could ever
 * turn it back on again.
 */
function toRows(schema: FieldDefinitionsResponse): FieldRow[] {
  const fields = schema.sections ? schema.sections.flatMap((section) => section.fields) : (schema.fields ?? []);
  return fields
    .map((field) => ({
      id: field.id ?? "",
      fieldKey: field.fieldKey,
      label: field.label,
      tier: typeof field.tier === "number" ? field.tier : 2,
      isVisible: field.isVisible ?? true,
      isMandatory: field.isMandatory,
      isSystem: field.isSystem,
      sortOrder: field.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Tier 2 field configuration (docs task: field-definitions management) -
 * every screen in this app already renders forms/tables FROM field
 * definitions (frontend rule 1); this is the one place that edits the
 * definitions themselves - label, visibility, mandatory, and display
 * order, never data_type or field_key (CLAUDE.md's field model: those
 * are structural, not configurable). is_system rows can be tightened but
 * never loosened (core/field-engine/mutations.ts's guardrail) - toggles
 * for those are disabled here too, so an admin can't even attempt the
 * rejected edit, not just get a 403 after trying.
 */
/**
 * The menu tree already keeps an unauthorized user from ever navigating
 * here (DynamicRoutes never resolves a path outside their own resolved
 * menu), but this <Can> wrapper is the same belt-and-suspenders every
 * other admin screen's individual actions already get - here applied at
 * screen scope since the whole screen IS the sensitive action, and it's
 * directly testable independent of routing (unlike the menu gate, which
 * needs a full router render to exercise).
 */
export function FieldDefinitionsScreen(): ReactElement | null {
  return (
    <Can permission="admin.field.manage">
      <FieldDefinitionsScreenContent />
    </Can>
  );
}

function FieldDefinitionsScreenContent(): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [originalRows, setOriginalRows] = useState<FieldRow[]>([]);
  const [saving, setSaving] = useState(false);

  const modulesQuery = useQuery({
    queryKey: ["field-definition-modules"],
    queryFn: () => apiFetch(endpoints.fieldDefinitionModules, {}, { schema: fieldDefinitionModulesResponseSchema }),
    staleTime: 5 * 60_000,
  });

  const moduleEntityOptions = useMemo<ModuleEntityOption[]>(
    () =>
      (modulesQuery.data?.modules ?? []).map((pair) => ({
        label: `${pair.module} / ${pair.entity}`,
        value: `${pair.module}.${pair.entity}`,
        module: pair.module,
        entity: pair.entity,
      })),
    [modulesQuery.data],
  );

  const selected = moduleEntityOptions.find((option) => option.value === selectedKey) ?? null;

  const fieldDefsQuery = useQuery({
    queryKey: ["field-definitions", selected?.module ?? "", selected?.entity ?? ""],
    queryFn: () =>
      apiFetch(
        endpoints.fieldDefinitions(selected?.module ?? "", selected?.entity ?? ""),
        {},
        { schema: fieldDefinitionsResponseSchema },
      ),
    enabled: selected !== null,
  });

  useEffect(() => {
    // One-way sync from server data, same reasoning as FieldPermissionMatrix:
    // after this runs, local edits must not be clobbered by a background
    // refetch of the same query.
    if (!fieldDefsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      setOriginalRows([]);
      return;
    }
    const next = toRows(fieldDefsQuery.data);
    setRows(next);
    setOriginalRows(next);
  }, [fieldDefsQuery.data]);

  function updateRow(fieldKey: string, patch: Partial<Pick<FieldRow, "label" | "isVisible" | "isMandatory">>): void {
    setRows((current) => current.map((row) => (row.fieldKey === fieldKey ? { ...row, ...patch } : row)));
  }

  function moveRow(index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }
    setRows((current) => {
      const next = [...current];
      const a = next[index];
      const b = next[targetIndex];
      if (!a || !b) {
        return current;
      }
      const aSortOrder = a.sortOrder;
      next[index] = { ...a, sortOrder: b.sortOrder };
      next[targetIndex] = { ...b, sortOrder: aSortOrder };
      next.sort((x, y) => x.sortOrder - y.sortOrder);
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    if (!selected) {
      return;
    }
    const originalByKey = new Map(originalRows.map((row) => [row.fieldKey, row]));
    const changed = rows.filter((row) => {
      const original = originalByKey.get(row.fieldKey);
      return (
        !original ||
        original.label !== row.label ||
        original.isVisible !== row.isVisible ||
        original.isMandatory !== row.isMandatory ||
        original.sortOrder !== row.sortOrder
      );
    });
    if (changed.length === 0) {
      void message.info("No changes to save");
      return;
    }

    // A field without a real id has no field_definitions row for this
    // company yet (core/provisioning/seed-field-definitions.ts should
    // always create one - its absence means this company's rows are out
    // of sync with the code defaults, a backend data gap, not something
    // this screen can fix by inventing an id to PATCH).
    const savable = changed.filter((row) => row.id.length > 0);
    const unsavable = changed.filter((row) => row.id.length === 0);
    if (unsavable.length > 0) {
      void message.error(
        `${unsavable.map((row) => row.fieldKey).join(", ")} have no provisioned field_definitions row and can't be saved`,
      );
    }
    if (savable.length === 0) {
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        savable.map((row) =>
          apiFetch(endpoints.fieldDefinition(row.id), {
            method: "PATCH",
            body: {
              label: row.label,
              isVisible: row.isVisible,
              isMandatory: row.isMandatory,
              sortOrder: row.sortOrder,
            },
          }),
        ),
      );
      void message.success("Field definitions saved");
      void queryClient.invalidateQueries({
        queryKey: ["field-definitions", selected.module, selected.entity],
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        Field Definitions
      </Typography.Title>

      <Select
        placeholder="Select a module / entity"
        style={{ width: 320 }}
        value={selectedKey}
        onChange={setSelectedKey}
        options={moduleEntityOptions}
        loading={modulesQuery.isLoading}
        aria-label="Module / entity"
      />

      {selected && fieldDefsQuery.isLoading && <Spin />}

      {selected && !fieldDefsQuery.isLoading && (
        <>
          <Table<FieldRow>
            rowKey="fieldKey"
            size="small"
            pagination={false}
            dataSource={rows}
            columns={[
              { key: "fieldKey", title: "Key", dataIndex: "fieldKey" },
              {
                key: "tier",
                title: "Tier",
                render: (_value: unknown, row: FieldRow) => <Tag>Tier {row.tier}</Tag>,
              },
              {
                key: "label",
                title: "Label",
                render: (_value: unknown, row: FieldRow) => (
                  <Input
                    aria-label={`${row.fieldKey} - Label`}
                    value={row.label}
                    onChange={(event) => updateRow(row.fieldKey, { label: event.target.value })}
                  />
                ),
              },
              {
                key: "isVisible",
                title: "Visible",
                render: (_value: unknown, row: FieldRow) =>
                  row.isSystem ? (
                    <Tooltip title="A system field can't be hidden">
                      <Checkbox aria-label={`${row.fieldKey} - Visible`} checked={row.isVisible} disabled />
                    </Tooltip>
                  ) : (
                    <Checkbox
                      aria-label={`${row.fieldKey} - Visible`}
                      checked={row.isVisible}
                      onChange={(event) => updateRow(row.fieldKey, { isVisible: event.target.checked })}
                    />
                  ),
              },
              {
                key: "isMandatory",
                title: "Mandatory",
                render: (_value: unknown, row: FieldRow) =>
                  row.isSystem ? (
                    <Tooltip title="A system field can't be made optional">
                      <Checkbox aria-label={`${row.fieldKey} - Mandatory`} checked={row.isMandatory} disabled />
                    </Tooltip>
                  ) : (
                    <Checkbox
                      aria-label={`${row.fieldKey} - Mandatory`}
                      checked={row.isMandatory}
                      onChange={(event) => updateRow(row.fieldKey, { isMandatory: event.target.checked })}
                    />
                  ),
              },
              {
                key: "sortOrder",
                title: "Order",
                render: (_value: unknown, row: FieldRow, index: number) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      aria-label={`${row.fieldKey} - Move up`}
                      disabled={index === 0}
                      onClick={() => moveRow(index, -1)}
                    />
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      aria-label={`${row.fieldKey} - Move down`}
                      disabled={index === rows.length - 1}
                      onClick={() => moveRow(index, 1)}
                    />
                  </Space>
                ),
              },
            ]}
          />
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            Save field definitions
          </Button>
        </>
      )}

      {!selected && <Typography.Text type="secondary">Choose a module / entity to edit its field definitions.</Typography.Text>}
    </Space>
  );
}
