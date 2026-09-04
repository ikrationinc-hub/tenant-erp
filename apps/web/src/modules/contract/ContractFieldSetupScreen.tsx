import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { App as AntApp, Alert, Select, Space, Typography } from "antd";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { CONTRACTS_LIST_PATH } from "./ContractsListScreen";

/**
 * C-3a (docs/CONTRACT-MODULE-BUILD.md Part 2): proves the division-scoped
 * field engine end to end - pick a division, <SchemaForm/> renders THAT
 * division's own contract fields (plus any all-divisions field), fed by
 * GET /field-definitions/contract/header?divisionId=... Selecting a
 * DIFFERENT division re-fetches and re-renders a DIFFERENT field set with
 * zero code change here - this screen never branches on which division is
 * selected, it only ever passes the id through.
 *
 * Deliberately minimal (create-only, no list/edit UI) - the full Contract
 * screen (division-scoped fields alongside templates, clause assembly,
 * the real contract document) is C-3b's job. This is the field engine's
 * own proof, not the finished module - it still calls the real POST
 * /contracts endpoint though (there's no separate "test" endpoint), so
 * every contract created here is a genuine, real Draft contract sitting
 * on the Contracts list alongside everything else, not a throwaway
 * sandbox row. The success message links straight to it (rather than
 * showing a bare UUID) since that's the whole point of proving this
 * worked - to actually go look at the contract it just created.
 */
export function ContractFieldSetupScreen(): ReactElement | null {
  return (
    <Can permission="admin.field.manage">
      <ContractFieldSetupScreenContent />
    </Can>
  );
}

function ContractFieldSetupScreenContent(): ReactElement {
  const { message } = AntApp.useApp();
  const [divisionId, setDivisionId] = useState<string | undefined>(undefined);
  const [createdContractId, setCreatedContractId] = useState<string | undefined>(undefined);

  const divisionsQuery = useQuery({
    queryKey: ["field-options", "divisions"],
    queryFn: () => apiFetch(endpoints.masterOptions("divisions"), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    try {
      const contract = await apiFetch<{ id: string }>(endpoints.contracts, {
        method: "POST",
        // contractDate is required by createContractSchema but isn't one of
        // this division's own Tier-2 fields in `values` - this screen only
        // proves the field engine renders/persists per-division fields
        // (frontend rule 1), so a fixed "today" satisfies the real
        // endpoint's own validation without inventing a date picker this
        // screen was never asked to have.
        body: { contractDate: new Date().toISOString().slice(0, 10), ...values, ...(divisionId ? { divisionId } : {}) },
      });
      setCreatedContractId(contract.id);
      void message.success(`Contract saved (${contract.id})`);
    } catch {
      void message.error("Could not save this contract");
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        Contract Field Setup
      </Typography.Title>
      <Typography.Text type="secondary">
        Select a division to preview and create a contract with that division&apos;s own fields.
      </Typography.Text>

      <Select
        placeholder="Select a division"
        style={{ width: 280 }}
        value={divisionId ?? null}
        onChange={(value: string) => {
          setDivisionId(value);
          setCreatedContractId(undefined);
        }}
        options={divisionsQuery.data?.options ?? []}
        loading={divisionsQuery.isLoading}
        aria-label="Division"
      />

      {divisionId && (
        <SchemaForm
          key={divisionId}
          module="contract"
          entity="header"
          mode="create"
          divisionId={divisionId}
          onSubmit={handleSubmit}
        />
      )}

      {createdContractId && (
        <Alert
          type="success"
          showIcon
          message={
            <>
              Contract created. <Link to={`${CONTRACTS_LIST_PATH}/${createdContractId}`}>Open it</Link> to assemble clauses and generate documents.
            </>
          }
        />
      )}

      {!divisionId && <Typography.Text type="secondary">Choose a division to render its contract fields.</Typography.Text>}
    </Space>
  );
}
