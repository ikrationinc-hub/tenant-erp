import type { ReactElement } from "react";
import { useState } from "react";
import { useController } from "react-hook-form";
import { App as AntApp, Button, Typography, Upload, type UploadFile, type UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asUploadedFile, type UploadedFileValue } from "./field-value-utils";
import { uploadAttachmentWithProgress } from "../../attachments/upload-attachment";
import { openAttachmentDownload } from "../../attachments/download-attachment";

function toUploadFile(value: UploadedFileValue): UploadFile {
  return { uid: value.uid, name: value.name, status: "done" };
}

/**
 * Two modes: with an `uploadContext` (an existing record to attach to),
 * every file selection is a real POST /attachments/:entity/:entityId/
 * :fieldKey with live progress; without one (e.g. create mode, before the
 * record has an id) it falls back to local-only tracking so the field
 * still round-trips a value.
 */
export function FileUploadField({ field, control, readOnly, uploadContext }: FieldComponentProps): ReactElement {
  const { message } = AntApp.useApp();
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asUploadedFile(rhf.value);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleLocalChange: UploadProps["onChange"] = (info) => {
    if (uploadContext) {
      return;
    }
    const latest = info.fileList.at(-1);
    rhf.onChange(latest ? { uid: latest.uid, name: latest.name } : null);
  };

  const customRequest: UploadProps["customRequest"] = (options) => {
    if (!uploadContext || !(options.file instanceof File)) {
      return;
    }
    setUploading(true);
    setProgress(0);
    uploadAttachmentWithProgress(uploadContext.entity, uploadContext.entityId, field.fieldKey, options.file, (percent) => {
      setProgress(percent);
      options.onProgress?.({ percent });
    })
      .then((row) => {
        setUploading(false);
        rhf.onChange({ uid: row.id, name: row.filename });
        options.onSuccess?.(row);
      })
      .catch((error: unknown) => {
        setUploading(false);
        const normalized = error instanceof Error ? error : new Error("Upload failed");
        void message.error(normalized.message);
        options.onError?.(normalized);
      });
  };

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        uploadContext && value ? (
          <Typography.Link id={field.fieldKey} onClick={() => void openAttachmentDownload(value.uid)}>
            {value.name}
          </Typography.Link>
        ) : (
          <Typography.Text id={field.fieldKey}>{value?.name ?? "No file"}</Typography.Text>
        )
      ) : (
        <Upload
          id={field.fieldKey}
          fileList={value ? [toUploadFile(value)] : []}
          {...(uploadContext ? { customRequest, onPreview: () => void openAttachmentDownload(value?.uid ?? "") } : { beforeUpload: () => false })}
          onChange={handleLocalChange}
          onRemove={() => rhf.onChange(null)}
          maxCount={1}
        >
          <Button icon={<UploadOutlined />} loading={uploading}>
            {uploading ? `Uploading ${progress}%` : "Select file"}
          </Button>
        </Upload>
      )}
    </FieldShell>
  );
}
