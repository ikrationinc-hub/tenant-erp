import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Checkbox, Select, Space, Spin, Table, Typography } from "antd";
import {
  fieldDefinitionsResponseSchema,
  fieldPermissionsResponseSchema,
  permissionCatalogueResponseSchema,
  type FieldPermissionRow,
} from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { resolveFieldSections } from "../../core/field-definitions/resolve-sections";

export interface FieldPermissionMatrixProps {
  roleId: string;
}

interface ModuleEntityOption {
  label: string;
  value: string;
  module: string;
  entity: string;
}

interface MatrixRow {
  fieldKey: string;
  label: string;
  canView: boolean;
  canEdit: boolean;
}

/**
 * Field-permission assignment (FE-5.5) - what makes FE-7's "hide Purchase
 * Rate from the Sales Officer role" demo possible. A simple grid: fields
 * down the side (from the REAL field-definitions endpoint, so it's always
 * in sync with what the form actually renders), view/edit checkboxes
 * across. Absence of a row = unrestricted (core/rbac/resolve.ts only
 * narrows isVisible/isEditable when a field_permissions row exists), so
 * unlisted fields default to view+edit checked here.
 */
export function FieldPermissionMatrix({ roleId }: FieldPermissionMatrixProps): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [saving, setSaving] = useState(false);

  const catalogueQuery = useQuery({
    queryKey: ["permission-catalogue"],
    queryFn: () => apiFetch(endpoints.permissionCatalogue, {}, { schema: permissionCatalogueResponseSchema }),
    staleTime: 5 * 60_000,
  });

  const moduleEntityOptions = useMemo<ModuleEntityOption[]>(() => {
    const seen = new Map<string, ModuleEntityOption>();
    for (const entry of catalogueQuery.data?.permissions ?? []) {
      const value = `${entry.module}.${entry.entity}`;
      if (!seen.has(value)) {
        seen.set(value, { label: value, value, module: entry.module, entity: entry.entity });
      }
    }
    return [...seen.values()].sort((a, b) => a.value.localeCompare(b.value));
  }, [catalogueQuery.data]);

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

  const rolePermsQuery = useQuery({
    queryKey: ["role-field-permissions", roleId, selected?.module ?? "", selected?.entity ?? ""],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.roleFieldPermissions(roleId), { module: selected?.module, entity: selected?.entity }),
        {},
        { schema: fieldPermissionsResponseSchema },
      ),
    enabled: selected !== null,
  });

  useEffect(() => {
    // Seeds locally-editable rows (checkboxes) from server data whenever
    // the module.entity selection changes - a deliberate one-way sync, not
    // a derived value: after this runs, local edits must NOT be
    // overwritten by a background refetch of the same query.
    if (!fieldDefsQuery.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      return;
    }
    const existing = new Map(
      (rolePermsQuery.data?.fieldPermissions ?? []).map((row) => [row.fieldKey, row]),
    );
    const fields = resolveFieldSections(fieldDefsQuery.data).flatMap((section) => section.fields);
    setRows(
      fields.map((field) => {
        const override = existing.get(field.fieldKey);
        return {
          fieldKey: field.fieldKey,
          label: field.label,
          canView: override?.canView ?? true,
          canEdit: override?.canEdit ?? true,
        };
      }),
    );
    // rolePermsQuery.data intentionally omitted: it resolves alongside
    // fieldDefsQuery.data for the same (module, entity) selection, and
    // re-including it here would re-seed local edits on every background
    // refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldDefsQuery.data]);

  function updateRow(fieldKey: string, patch: Partial<Pick<MatrixRow, "canView" | "canEdit">>): void {
    setRows((current) => current.map((row) => (row.fieldKey === fieldKey ? { ...row, ...patch } : row)));
  }

  async function handleSave(): Promise<void> {
    if (!selected) {
      return;
    }
    setSaving(true);
    try {
      const payload: { fieldPermissions: FieldPermissionRow[] } = {
        fieldPermissions: rows.map(({ fieldKey, canView, canEdit }) => ({ fieldKey, canView, canEdit })),
      };
      await apiFetch(endpoints.roleFieldPermissions(roleId), {
        method: "PUT",
        body: { module: selected.module, entity: selected.entity, rows: payload.fieldPermissions },
      });
      void message.success("Field permissions saved");
      void queryClient.invalidateQueries({
        queryKey: ["role-field-permissions", roleId, selected.module, selected.entity],
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Select
        placeholder="Select a module.entity"
        style={{ width: 320 }}
        value={selectedKey}
        onChange={setSelectedKey}
        options={moduleEntityOptions}
        loading={catalogueQuery.isLoading}
        aria-label="Module.entity"
      />

      {selected && (fieldDefsQuery.isLoading || rolePermsQuery.isLoading) && <Spin />}

      {selected && !fieldDefsQuery.isLoading && !rolePermsQuery.isLoading && (
        <>
          <Table<MatrixRow>
            rowKey="fieldKey"
            size="small"
            pagination={false}
            dataSource={rows}
            columns={[
              { key: "label", title: "Field", dataIndex: "label" },
              {
                key: "canView",
                title: "View",
                render: (_value: unknown, row: MatrixRow) => (
                  <Checkbox
                    aria-label={`${row.label} - View`}
                    checked={row.canView}
                    onChange={(event) => updateRow(row.fieldKey, { canView: event.target.checked })}
                  />
                ),
              },
              {
                key: "canEdit",
                title: "Edit",
                render: (_value: unknown, row: MatrixRow) => (
                  <Checkbox
                    aria-label={`${row.label} - Edit`}
                    checked={row.canEdit}
                    onChange={(event) => updateRow(row.fieldKey, { canEdit: event.target.checked })}
                  />
                ),
              },
            ]}
          />
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            Save field permissions
          </Button>
        </>
      )}

      {!selected && <Typography.Text type="secondary">Choose a module.entity to edit its field permissions.</Typography.Text>}
    </Space>
  );
}
