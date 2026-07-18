import type { ReactElement } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, Form, Input, Tag, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import type { PlatformLoginRequest } from "@hyperion/contracts";
import { ApiError } from "../../core/api/api-error";
import { useAdminStore } from "../../core/store/admin-store";
import { PLATFORM_ACCENT_COLOR } from "../../theme/tokens";
import { usePlatformLoginMutation } from "./api";

const loginFormSchema = z.object({
  email: z.string().min(1, "Required"),
  password: z.string().min(1, "Required"),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

interface LocationState {
  from?: { pathname: string };
}

/** No tenant-code field (ADM-3 task item 4) - platform admins aren't tenant-scoped, so there's nothing to resolve. */
export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAdminStore((s) => s.setSession);
  const loginMutation = usePlatformLoginMutation();

  const { control, handleSubmit, formState } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input: PlatformLoginRequest = { email: values.email, password: values.password };
    const result = await loginMutation.mutateAsync(input);

    setSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      admin: result.admin,
    });

    const from = (location.state as LocationState | null)?.from?.pathname ?? "/tenants";
    void navigate(from, { replace: true });
  });

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
      }}
    >
      <Card style={{ width: 360 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 0 }}>
            Hyperion
          </Typography.Title>
          <Tag color={PLATFORM_ACCENT_COLOR}>PLATFORM ADMIN</Tag>
        </div>
        <Typography.Text type="secondary">Tenant provisioning &amp; health console</Typography.Text>
        <Form layout="vertical" style={{ marginTop: 16 }} onFinish={() => void onSubmit()}>
          <Controller
            name="email"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="Email"
                htmlFor="platform-login-email"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
              >
                <Input {...field} id="platform-login-email" autoComplete="username" autoFocus />
              </Form.Item>
            )}
          />
          <Controller
            name="password"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="Password"
                htmlFor="platform-login-password"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
              >
                <Input.Password {...field} id="platform-login-password" autoComplete="current-password" />
              </Form.Item>
            )}
          />
          {loginMutation.isError && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                loginMutation.error instanceof ApiError ? loginMutation.error.message : "Login failed"
              }
            />
          )}
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={formState.isSubmitting || loginMutation.isPending}
          >
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
