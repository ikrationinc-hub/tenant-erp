import type { ReactElement } from "react";
import { Typography } from "antd";

interface ReadOnlyValueProps {
  id: string;
  /** Already formatted for display (e.g. "42%", a resolved dropdown label) - this component only handles presentation, never formatting/computation. */
  value: string;
  emptyText?: string;
  /** Muted, for a value the user didn't set or can't be proud of setting (e.g. CalculatedField). An empty value is always muted regardless of this prop. */
  secondary?: boolean;
  italic?: boolean;
}

/**
 * Shared read-only display for a field's non-editable branch - single
 * place to restyle "how a value looks when the form can't be edited"
 * instead of repeating a Typography.Text + empty-dash fallback across the
 * field-types registry. Fields with a genuinely different read-only
 * shape (TextArea's multi-line Paragraph, FileUpload's downloadable
 * Link) render their own - this is for the plain-value case only.
 */
export function ReadOnlyValue({ id, value, emptyText = "—", secondary = false, italic = false }: ReadOnlyValueProps): ReactElement {
  const muted = secondary || !value;
  return (
    <Typography.Text id={id} {...(muted ? { type: "secondary" as const } : {})} italic={italic}>
      {value || emptyText}
    </Typography.Text>
  );
}
