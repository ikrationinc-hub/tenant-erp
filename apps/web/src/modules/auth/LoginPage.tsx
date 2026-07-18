import type { ReactElement } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import type { LoginRequest } from "@hyperion/contracts";
import { ApiError } from "../../core/api/api-error";
import { useAppStore } from "../../core/store/app-store";
import { useLoginMutation } from "./api";

const loginFormSchema = z.object({
  identifier: z.string().min(1, "Required"),
  password: z.string().min(1, "Required"),
  tenantCode: z.string().optional(),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAppStore((s) => s.setSession);
  const loginMutation = useLoginMutation();

  const { control, handleSubmit, formState } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { identifier: "", password: "", tenantCode: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input: LoginRequest = {
      identifier: values.identifier,
      password: values.password,
      ...(values.tenantCode ? { tenantCode: values.tenantCode } : {}),
    };
    const result = await loginMutation.mutateAsync(input);

    setSession({
      accessToken: result.accessToken,
      refreshToken: result.mustChangePassword ? null : result.refreshToken,
      user: result.user,
      mustChangePassword: result.mustChangePassword,
    });

    if (result.mustChangePassword) {
      void navigate("/password-change", { replace: true });
      return;
    }

    const from = (location.state as LocationState | null)?.from?.pathname ?? "/";
    void navigate(from, { replace: true });
  });

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f6f8",
      }}
    >
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Hyperion ERP
        </Typography.Title>
        <Form layout="vertical" onFinish={() => void onSubmit()}>
          <Controller
            name="identifier"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="Email"
                htmlFor="login-identifier"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
              >
                <Input {...field} id="login-identifier" autoComplete="username" autoFocus />
              </Form.Item>
            )}
          />
          <Controller
            name="password"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="Password"
                htmlFor="login-password"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
              >
                <Input.Password {...field} id="login-password" autoComplete="current-password" />
              </Form.Item>
            )}
          />
          <Controller
            name="tenantCode"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="Tenant Code (optional)"
                htmlFor="login-tenant-code"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message ?? "Only needed if your tenant can't be resolved from this URL"}
              >
                <Input {...field} id="login-tenant-code" />
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
