import type { ReactElement, ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, Form, Input, Result, Spin, Typography } from "antd";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { AcceptInvitationRequest } from "@hyperion/contracts";
import { ApiError } from "../../core/api/api-error";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { useAcceptInvitationMutation, useValidateInvitationQuery } from "./api";

const acceptFormSchema = z
  .object({
    password: z.string().min(12, "Must be at least 12 characters"),
    confirmPassword: z.string().min(1, "Required"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type AcceptFormValues = z.infer<typeof acceptFormSchema>;

export function AcceptInvitationPage(): ReactElement {
  const { token = "" } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const tenantCode = searchParams.get("tenantCode") ?? undefined;

  const invitationQuery = useValidateInvitationQuery(token, tenantCode);
  const acceptMutation = useAcceptInvitationMutation(token);

  const { control, handleSubmit, formState } = useForm<AcceptFormValues>({
    resolver: zodResolver(acceptFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const password = useWatch({ control, name: "password" });

  const onSubmit = handleSubmit((values) => {
    const input: AcceptInvitationRequest = {
      password: values.password,
      ...(tenantCode ? { tenantCode } : {}),
    };
    acceptMutation.mutate(input);
  });

  if (invitationQuery.isLoading) {
    return (
      <CenteredCard>
        <Spin />
      </CenteredCard>
    );
  }

  if (invitationQuery.isError) {
    return (
      <CenteredCard>
        <Result
          status="error"
          title="Invitation not found or expired"
          subTitle={
            invitationQuery.error instanceof ApiError
              ? invitationQuery.error.message
              : "Ask whoever invited you to resend it."
          }
        />
      </CenteredCard>
    );
  }

  if (acceptMutation.isSuccess) {
    return (
      <CenteredCard>
        <Result
          status="success"
          title="Password set"
          subTitle="Your account is active. Sign in with your new password."
          extra={
            <Link to="/login">
              <Button type="primary">Go to login</Button>
            </Link>
          }
        />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Accept invitation
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {invitationQuery.data?.email} — {invitationQuery.data?.companyName}
      </Typography.Paragraph>
      <Form layout="vertical" onFinish={() => void onSubmit()}>
        <Controller
          name="password"
          control={control}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Password"
              htmlFor="accept-invitation-password"
              validateStatus={fieldState.error ? "error" : ""}
              help={fieldState.error?.message}
            >
              <Input.Password {...field} id="accept-invitation-password" autoComplete="new-password" autoFocus />
            </Form.Item>
          )}
        />
        <PasswordStrengthMeter password={password ?? ""} />
        <Controller
          name="confirmPassword"
          control={control}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Confirm password"
              htmlFor="accept-invitation-confirm-password"
              validateStatus={fieldState.error ? "error" : ""}
              help={fieldState.error?.message}
            >
              <Input.Password {...field} id="accept-invitation-confirm-password" autoComplete="new-password" />
            </Form.Item>
          )}
        />
        {acceptMutation.isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              acceptMutation.error instanceof ApiError ? acceptMutation.error.message : "Could not set password"
            }
          />
        )}
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={formState.isSubmitting || acceptMutation.isPending}
        >
          Set password
        </Button>
      </Form>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: ReactNode }): ReactElement {
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
      <Card style={{ width: 400 }}>{children}</Card>
    </div>
  );
}
