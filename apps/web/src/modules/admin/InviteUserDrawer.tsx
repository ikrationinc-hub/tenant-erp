import type { ReactElement } from "react";
import { App as AntApp, Drawer } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";

export interface InviteUserDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Still schema-driven (module="users" entity="invite" - field-definitions
 * supplies email/mobile/name/roles, so no hardcoded label - frontend rule
 * 1), just posting to the real, fixed BE-7 endpoint instead of a generic
 * REST convention. NO password field renders here: it's not in the
 * invite entity's field-definitions at all, and the backend's own
 * .strict() schema would 422 one anyway if it somehow did.
 */
export function InviteUserDrawer({ open, onClose }: InviteUserDrawerProps): ReactElement {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.inviteUser, { method: "POST", body: values });
    void message.success("Invitation sent");
    onClose();
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.users] });
  }

  return (
    <Drawer title="Invite User" open={open} onClose={onClose} width={480} destroyOnHidden>
      {open && <SchemaForm module="users" entity="invite" mode="create" onSubmit={handleSubmit} />}
    </Drawer>
  );
}
