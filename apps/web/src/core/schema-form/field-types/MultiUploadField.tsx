import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Button, Typography, Upload, type UploadFile, type UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asUploadedFileArray, type UploadedFileValue } from "./field-value-utils";

function toUploadFile(value: UploadedFileValue): UploadFile {
  return { uid: value.uid, name: value.name, status: "done" };
}

/** Same storage-not-built-yet caveat as FileUploadField, just an array value. */
export function MultiUploadField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const values = asUploadedFileArray(rhf.value);

  const handleChange: UploadProps["onChange"] = (info) => {
    rhf.onChange(info.fileList.map((file) => ({ uid: file.uid, name: file.name })));
  };

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Text id={field.fieldKey}>
          {values.length > 0 ? values.map((file) => file.name).join(", ") : "No files"}
        </Typography.Text>
      ) : (
        <Upload
          id={field.fieldKey}
          fileList={values.map(toUploadFile)}
          beforeUpload={() => false}
          onChange={handleChange}
          onRemove={(removed) => rhf.onChange(values.filter((file) => file.uid !== removed.uid))}
          multiple
        >
          <Button icon={<UploadOutlined />}>Select files</Button>
        </Upload>
      )}
    </FieldShell>
  );
}
