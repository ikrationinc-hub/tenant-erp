import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Spin, Typography } from "antd";
import { meResponseSchema, type MeResponse } from "@hyperion/contracts";
import { apiFetch } from "../core/api/client";
import { endpoints } from "../core/api/endpoints";

/**
 * Not a screen (FE-1 builds no screens) - a scaffold-verification probe
 * proving the provider stack (AntD theme, TanStack Query, the fetch
 * wrapper, MSW) is wired end to end. FE-2 replaces this with the real app
 * shell and auth flow.
 */
export function BootstrapStatus(): ReactElement {
  const meQuery = useQuery<MeResponse>({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch(endpoints.me, {}, meResponseSchema),
  });

  return (
    <Card title="Hyperion ERP — scaffold" style={{ maxWidth: 480, margin: "48px auto" }}>
      {meQuery.isLoading && <Spin />}
      {meQuery.isError && (
        <Alert type="error" message="Failed to load current user" description={meQuery.error.message} />
      )}
      {meQuery.data && (
        <Typography.Text data-testid="bootstrap-user">
          Signed in as {meQuery.data.name} ({meQuery.data.email})
        </Typography.Text>
      )}
    </Card>
  );
}
