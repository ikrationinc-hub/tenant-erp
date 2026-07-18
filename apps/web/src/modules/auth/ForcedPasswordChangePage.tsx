import type { ReactElement } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../core/api/api-error";
import { useAppStore } from "../../core/store/app-store";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { useChangePasswordMutation } from "./api";

const changePasswordFormSchema = z
  .object({
    newPassword: z.string().min(12, "Must be at least 12 characters"),
    confirmPassword: z.string().min(1, "Required"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

export function ForcedPasswordChangePage(): ReactElement {
  const navigate = useNavigate();
  const completePasswordChange = useAppStore((s) => s.completePasswordChange);
  const changePasswordMutation = useChangePasswordMutation();

  const { control, handleSubmit, formState } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });
  const newPassword = useWatch({ control, name: "newPassword" });

  const onSubmit = handleSubmit(async (values) => {
    const result = await changePasswordMutation.mutateAsync({ newPassword: values.newPassword });
    completePasswordChange({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    void navigate("/", { replace: true });
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
      <Card style={{ width: 400 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Set a new password
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          You must set your own password before continuing.
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={() => void onSubmit()}>
          <Controller
            name="newPassword"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="New password"
                htmlFor="forced-password-change-new"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
              >
                <Input.Password {...field} id="forced-password-change-new" autoComplete="new-password" autoFocus />
              </Form.Item>
            )}
          />
          <PasswordStrengthMeter password={newPassword ?? ""} />
          <Controller
            name="confirmPassword"
            control={control}
            render={({ field, fieldState }) => (
              <Form.Item
                label="Confirm password"
                htmlFor="forced-password-change-confirm"
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
              >
                <Input.Password {...field} id="forced-password-change-confirm" autoComplete="new-password" />
              </Form.Item>
            )}
          />
          {changePasswordMutation.isError && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                changePasswordMutation.error instanceof ApiError
                  ? changePasswordMutation.error.message
                  : "Could not change password"
              }
            />
          )}
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={formState.isSubmitting || changePasswordMutation.isPending}
          >
            Continue
          </Button>
        </Form>
      </Card>
    </div>
  );
}
