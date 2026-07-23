import type { ReactElement } from "react";
import { App as AntApp, Drawer, Typography } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";

export interface ProvisionUserDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The ops-staff exception (BE-7): no email, so no invite link - an admin
 * sets a temp password directly, audited, forced-change on first login.
 * The backend rejects (403) if any chosen role holds an approval
 * permission ("financial approvals require self-set credentials");
 * SchemaForm's onSubmit catch (see SchemaForm.tsx) surfaces that 403
 * inline instead of it disappearing as an unhandled rejection.
 */
export function ProvisionUserDrawer({ open, onClose }: ProvisionUserDrawerProps): ReactElement {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.provisionUser, { method: "POST", body: values });
    void message.success("User provisioned");
    onClose();
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.users] });
  }

  return (
    <Drawer title="Provision User (no email)" open={open} onClose={onClose} width={480} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        For staff with no email address. They sign in with the temp password below and must change it immediately.
        A role that can approve financial transactions cannot be assigned here.
      </Typography.Paragraph>
      {open && <SchemaForm module="users" entity="provision" mode="create" onSubmit={handleSubmit} />}
    </Drawer>
  );
}
