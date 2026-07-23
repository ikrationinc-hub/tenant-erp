import { useEffect, type ReactElement } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Form, Input, Modal, Select } from "antd";
import { App as AntApp } from "antd";
import type { TenantListItem } from "@hyperion/contracts";
import { ApiError } from "../../core/api/api-error";
import { useModuleCatalogueQuery, useProvisionTenantMutation } from "./api";

const onboardFormSchema = z.object({
  name: z.string().min(1, "Required"),
  slug: z
    .string()
    .min(1, "Required")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
  adminEmail: z.string().min(1, "Required").email("Must be a valid email"),
  adminName: z.string().min(1, "Required"),
  modules: z.array(z.string()),
});
type OnboardFormValues = z.infer<typeof onboardFormSchema>;

interface OnboardTenantModalProps {
  open: boolean;
  onClose: () => void;
  /** Already-fetched tenant list, reused for the slug-availability check (ADM-4 task item 2's "against the list" option - no dedicated HEAD endpoint exists). */
  existingTenants: TenantListItem[];
}

export function OnboardTenantModal({ open, onClose, existingTenants }: OnboardTenantModalProps): ReactElement {
  const { notification } = AntApp.useApp();
  const catalogueQuery = useModuleCatalogueQuery();
  const provisionMutation = useProvisionTenantMutation();

  const { control, handleSubmit, reset } = useForm<OnboardFormValues>({
    resolver: zodResolver(onboardFormSchema),
    defaultValues: { name: "", slug: "", adminEmail: "", adminName: "", modules: [] },
  });

  const slug = useWatch({ control, name: "slug" });
  const slugTaken = slug.length > 0 && existingTenants.some((t) => t.slug.toLowerCase() === slug.toLowerCase());

  useEffect(() => {
    if (open) {
      reset();
      provisionMutation.reset();
    }
    // Reset only on open/close, not on every render - mirrors the modal's own lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = handleSubmit(async (values) => {
    if (slugTaken) {
      return;
    }
    try {
      const result = await provisionMutation.mutateAsync(values);
      notification.success({
        message: result.created ? "Tenant created" : "Tenant re-provisioned",
        description: `Admin invited to ${values.adminEmail}`,
      });
      onClose();
    } catch {
      // Already surfaced reactively via provisionMutation.error/isError
      // above - mutateAsync rejects on failure (unlike mutate), and
      // `onOk={() => void onSubmit()}` would otherwise leave that
      // rejection unhandled.
    }
  });

  const errorMessage =
    provisionMutation.error instanceof ApiError
      ? provisionMutation.error.status === 409
        ? `Slug "${slug}" is already in use by a tenant that isn't active yet - choose another.`
        : provisionMutation.error.message
      : provisionMutation.isError
        ? "Provisioning failed"
        : null;

  return (
    <Modal
      title="Onboard tenant"
      open={open}
      onCancel={onClose}
      onOk={() => void onSubmit()}
      okText="Provision"
      okButtonProps={{ loading: provisionMutation.isPending, disabled: slugTaken }}
      confirmLoading={provisionMutation.isPending}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Tenant name"
              htmlFor="onboard-name"
              validateStatus={fieldState.error ? "error" : ""}
              help={fieldState.error?.message}
            >
              <Input {...field} id="onboard-name" autoFocus />
            </Form.Item>
          )}
        />
        <Controller
          name="slug"
          control={control}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Slug"
              htmlFor="onboard-slug"
              validateStatus={fieldState.error || slugTaken ? "error" : ""}
              help={fieldState.error?.message ?? (slugTaken ? "This slug is already taken" : undefined)}
            >
              <Input {...field} id="onboard-slug" placeholder="e.g. hyperion-metals" />
            </Form.Item>
          )}
        />
        <Controller
          name="adminEmail"
          control={control}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Admin email"
              htmlFor="onboard-admin-email"
              validateStatus={fieldState.error ? "error" : ""}
              help={fieldState.error?.message}
            >
              <Input {...field} id="onboard-admin-email" />
            </Form.Item>
          )}
        />
        <Controller
          name="adminName"
          control={control}
          render={({ field, fieldState }) => (
            <Form.Item
              label="Admin name"
              htmlFor="onboard-admin-name"
              validateStatus={fieldState.error ? "error" : ""}
              help={fieldState.error?.message}
            >
              <Input {...field} id="onboard-admin-name" />
            </Form.Item>
          )}
        />
        <Controller
          name="modules"
          control={control}
          render={({ field }) => (
            <Form.Item label="Modules">
              <Select
                {...field}
                mode="multiple"
                placeholder="Select modules to enable"
                loading={catalogueQuery.isLoading}
                options={catalogueQuery.data?.modules.map((m) => ({ value: m.key, label: m.name })) ?? []}
              />
            </Form.Item>
          )}
        />
        {errorMessage && <Alert type="error" showIcon message={errorMessage} style={{ marginBottom: 8 }} />}
        {provisionMutation.isPending && (
          <Alert type="info" showIcon message="Provisioning - creating schema, running migrations, seeding..." />
        )}
      </Form>
    </Modal>
  );
}
