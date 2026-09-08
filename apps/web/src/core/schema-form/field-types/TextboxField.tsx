import type { ReactElement } from "react";
import { useState } from "react";
import { useController, useWatch, type Control } from "react-hook-form";
import { App, Button, Input } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { suggestCodeResponseSchema } from "@ikration/contracts";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { ReadOnlyValue } from "./ReadOnlyValue";
import { asString } from "./field-value-utils";
import { apiFetch } from "../../api/client";
import { endpoints } from "../../api/endpoints";

/**
 * Masters' `code` field only (core/masters' generic module pattern - every
 * master table has both `code` and `name` as universal Tier-1 columns, so
 * this is safe to key off field identity rather than a new field-definition
 * flag). Lets the user derive a mnemonic code from whatever they've typed
 * into `name` instead of inventing one by hand. Only ever mounted for the
 * `code` field itself (TextboxField below renders it conditionally) so its
 * own `useWatch` on the sibling "name" field doesn't add a re-render
 * subscription to every OTHER Textbox on the form.
 */
function GenerateCodeButton({
  control,
  endpoint,
  onGenerated,
}: {
  control: Control<Record<string, unknown>>;
  endpoint: string;
  onGenerated: (code: string) => void;
}): ReactElement {
  const { message } = App.useApp();
  const [isGenerating, setIsGenerating] = useState(false);
  const trimmedName = asString(useWatch({ control, name: "name" })).trim();

  async function handleClick(): Promise<void> {
    setIsGenerating(true);
    try {
      const result = await apiFetch(endpoints.suggestMasterCode(endpoint, trimmedName), {}, { schema: suggestCodeResponseSchema });
      onGenerated(result.code);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Could not generate a code");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Button
      type="link"
      size="small"
      icon={<ThunderboltOutlined />}
      loading={isGenerating}
      disabled={trimmedName.length === 0}
      onClick={() => void handleClick()}
    >
      Generate
    </Button>
  );
}

export function TextboxField({ field, control, readOnly, module, endpoint }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asString(rhf.value);
  const showGenerate = module === "masters" && field.fieldKey === "code" && !readOnly && Boolean(endpoint);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <ReadOnlyValue id={field.fieldKey} value={value} />
      ) : (
        <Input
          id={field.fieldKey}
          value={value}
          onChange={(event) => rhf.onChange(event.target.value)}
          onBlur={rhf.onBlur}
          suffix={
            showGenerate && endpoint ? (
              <GenerateCodeButton control={control} endpoint={endpoint} onGenerated={rhf.onChange} />
            ) : undefined
          }
        />
      )}
    </FieldShell>
  );
}
