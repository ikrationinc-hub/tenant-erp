import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Select, Space, Typography } from "antd";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";

export interface ContractPartyValue {
  supplierId: string | null;
  customerId: string | null;
}

export interface ContractPartiesFormProps {
  contractId: string;
  seller: ContractPartyValue | null;
  buyer: ContractPartyValue | null;
  editable: boolean;
  onSaved: () => void;
}

function useSupplierOptions() {
  const query = useQuery({
    queryKey: ["field-options", endpoints.supplierOptions],
    queryFn: () => apiFetch(endpoints.supplierOptions, {}, { schema: masterOptionsResponseSchema }),
  });
  return query.data?.options ?? [];
}

function useCustomerOptions() {
  const query = useQuery({
    queryKey: ["field-options", "customers"],
    queryFn: () => apiFetch(endpoints.masterOptions("customers"), {}, { schema: masterOptionsResponseSchema }),
  });
  return query.data?.options ?? [];
}

/**
 * Seller side always resolves to Supplier, buyer side always resolves to
 * Customer - the build doc's own stated rule (docs/CONTRACT-MODULE-
 * BUILD.md: "Seller side resolves to Supplier, buyer side to Customer"),
 * confirmed with the user rather than kept as a free-choice toggle. One
 * plain dropdown per role, matching the prototype's own simplicity - the
 * backend's partySchema technically accepts either supplierId or
 * customerId for either role, but this screen only ever sends the fixed
 * mapping.
 */
export function ContractPartiesForm({ contractId, seller, buyer, editable, onSaved }: ContractPartiesFormProps): ReactElement {
  const { message } = AntApp.useApp();
  const supplierOptions = useSupplierOptions();
  const customerOptions = useCustomerOptions();

  async function handlePartyChange(role: "seller" | "buyer", id: string): Promise<void> {
    try {
      await apiFetch(endpoints.contract(contractId), {
        method: "PATCH",
        body: { [role]: role === "seller" ? { supplierId: id } : { customerId: id } },
      });
      onSaved();
      void message.success(`${role === "seller" ? "Seller" : "Buyer"} saved`);
    } catch {
      void message.error(`Could not save the ${role}`);
    }
  }

  const sellerId = seller?.supplierId ?? null;
  const buyerId = buyer?.customerId ?? null;

  return (
    <div className="field-grid">
      <Space direction="vertical" size={4}>
        <Typography.Text type="secondary">Seller</Typography.Text>
        {editable ? (
          <Select
            style={{ width: "100%" }}
            placeholder="Select a supplier"
            value={sellerId}
            options={supplierOptions}
            showSearch
            optionFilterProp="label"
            onChange={(id: string) => void handlePartyChange("seller", id)}
          />
        ) : (
          <Typography.Text>{supplierOptions.find((o) => o.value === sellerId)?.label ?? "Not set"}</Typography.Text>
        )}
      </Space>
      <Space direction="vertical" size={4}>
        <Typography.Text type="secondary">Buyer (Customer)</Typography.Text>
        {editable ? (
          <Select
            style={{ width: "100%" }}
            placeholder="Select a customer"
            value={buyerId}
            options={customerOptions}
            showSearch
            optionFilterProp="label"
            onChange={(id: string) => void handlePartyChange("buyer", id)}
          />
        ) : (
          <Typography.Text>{customerOptions.find((o) => o.value === buyerId)?.label ?? "Not set"}</Typography.Text>
        )}
      </Space>
    </div>
  );
}
