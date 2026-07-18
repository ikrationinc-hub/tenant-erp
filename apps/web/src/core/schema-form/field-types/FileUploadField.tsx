import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Button, Typography, Upload, type UploadFile, type UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asUploadedFile, type UploadedFileValue } from "./field-value-utils";

function toUploadFile(value: UploadedFileValue): UploadFile {
  return { uid: value.uid, name: value.name, status: "done" };
}

/**
 * Storage isn't built yet (backend prompt 13) - this tracks the selected
 * file locally (beforeUpload returns false, so nothing actually uploads)
 * so the form can round-trip a value now. Swap the onChange wiring for a
 * real upload call once the storage API exists; the field-type contract
 * (a `{uid, name}` value) doesn't need to change.
 */
export function FileUploadField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asUploadedFile(rhf.value);

  const handleChange: UploadProps["onChange"] = (info) => {
    const latest = info.fileList.at(-1);
    rhf.onChange(latest ? { uid: latest.uid, name: latest.name } : null);
  };

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Text id={field.fieldKey}>{value?.name ?? "No file"}</Typography.Text>
      ) : (
        <Upload
          id={field.fieldKey}
          fileList={value ? [toUploadFile(value)] : []}
          beforeUpload={() => false}
          onChange={handleChange}
          onRemove={() => rhf.onChange(null)}
          maxCount={1}
        >
          <Button icon={<UploadOutlined />}>Select file</Button>
        </Upload>
      )}
    </FieldShell>
  );
}
