import type { ReactElement } from "react";
import { useState } from "react";
import { useController } from "react-hook-form";
import { App as AntApp, Button, Space, Typography, Upload, type UploadFile, type UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asUploadedFileArray, type UploadedFileValue } from "./field-value-utils";
import { uploadAttachmentWithProgress } from "../../attachments/upload-attachment";
import { openAttachmentDownload } from "../../attachments/download-attachment";

function toUploadFile(value: UploadedFileValue): UploadFile {
  return { uid: value.uid, name: value.name, status: "done" };
}

/** Same real-vs-local-only split as FileUploadField, tracking however many uploads are currently in flight (files upload independently/concurrently). */
export function MultiUploadField({ field, control, readOnly, uploadContext }: FieldComponentProps): ReactElement {
  const { message } = AntApp.useApp();
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const values = asUploadedFileArray(rhf.value);
  const [inFlightCount, setInFlightCount] = useState(0);

  const handleLocalChange: UploadProps["onChange"] = (info) => {
    if (uploadContext) {
      return;
    }
    rhf.onChange(info.fileList.map((file) => ({ uid: file.uid, name: file.name })));
  };

  const customRequest: UploadProps["customRequest"] = (options) => {
    if (!uploadContext || !(options.file instanceof File)) {
      return;
    }
    setInFlightCount((count) => count + 1);
    uploadAttachmentWithProgress(uploadContext.entity, uploadContext.entityId, field.fieldKey, options.file, (percent) => {
      options.onProgress?.({ percent });
    })
      .then((row) => {
        setInFlightCount((count) => count - 1);
        rhf.onChange([...asUploadedFileArray(rhf.value), { uid: row.id, name: row.filename }]);
        options.onSuccess?.(row);
      })
      .catch((error: unknown) => {
        setInFlightCount((count) => count - 1);
        const normalized = error instanceof Error ? error : new Error("Upload failed");
        void message.error(normalized.message);
        options.onError?.(normalized);
      });
  };

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        values.length === 0 ? (
          <Typography.Text id={field.fieldKey}>No files</Typography.Text>
        ) : (
          <Space direction="vertical" size={0} id={field.fieldKey}>
            {values.map((file) =>
              uploadContext ? (
                <Typography.Link key={file.uid} onClick={() => void openAttachmentDownload(file.uid)}>
                  {file.name}
                </Typography.Link>
              ) : (
                <Typography.Text key={file.uid}>{file.name}</Typography.Text>
              ),
            )}
          </Space>
        )
      ) : (
        <Upload
          id={field.fieldKey}
          fileList={values.map(toUploadFile)}
          {...(uploadContext ? { customRequest, onPreview: (file: UploadFile) => void openAttachmentDownload(file.uid) } : { beforeUpload: () => false })}
          onChange={handleLocalChange}
          onRemove={(removed) => rhf.onChange(values.filter((file) => file.uid !== removed.uid))}
          multiple
        >
          <Button icon={<UploadOutlined />} loading={inFlightCount > 0}>
            {inFlightCount > 0 ? `Uploading ${inFlightCount} file(s)…` : "Select files"}
          </Button>
        </Upload>
      )}
    </FieldShell>
  );
}
