import type { ReactElement, ReactNode } from "react";
import { Form } from "antd";

interface FieldShellProps {
  fieldKey: string;
  label: string;
  mandatory: boolean;
  error?: string | undefined;
  children: ReactNode;
}

/** The one thing every field type shares: label + mandatory marker + validation message, all from metadata (frontend rule 1) - never a literal label anywhere else in this registry. */
export function FieldShell({ fieldKey, label, mandatory, error, children }: FieldShellProps): ReactElement {
  return (
    <Form.Item label={label} htmlFor={fieldKey} required={mandatory} validateStatus={error ? "error" : ""} help={error}>
      {children}
    </Form.Item>
  );
}
