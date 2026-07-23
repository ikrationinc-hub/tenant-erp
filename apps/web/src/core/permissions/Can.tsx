import type { ReactElement, ReactNode } from "react";
import { useHasPermission } from "./use-permissions";

export interface CanProps {
  permission: string;
  children: ReactNode;
}

/** Renders nothing while the permission set is loading or the permission is absent - never a disabled-but-visible affordance, since that would leak which actions exist to a role that can't see them either. */
export function Can({ permission, children }: CanProps): ReactElement | null {
  const allowed = useHasPermission(permission);
  return allowed ? <>{children}</> : null;
}
