import type { ReactNode } from "react";

/** A row is opaque - SchemaTable never assumes a shape beyond what resolved columns tell it to render. */
export type EntityRow = Record<string, unknown>;

export interface SchemaTableColumnOverride {
  fieldKey: string;
  /** List-specific label, e.g. a shorter column title than the form's field label. */
  title?: string;
  width?: number;
  sortable?: boolean;
  render?: (value: unknown, row: EntityRow) => ReactNode;
}

export interface SchemaTableFilterOption {
  label: string;
  value: string;
}

export interface SchemaTableFilter {
  key: string;
  label: string;
  /** "dateRange" sends two params, `${key}From`/`${key}To` (both YYYY-MM-DD) - there's no single query param for a range. */
  type: "select" | "text" | "boolean" | "dateRange";
  options?: SchemaTableFilterOption[];
}

export interface SchemaTableAction {
  key: string;
  label: string;
  /** Absent = always visible; present = gated the same way as any other action (frontend rule 4 - UX only, the backend is the real gate). */
  permission?: string;
  onClick: (row: EntityRow) => void;
  isVisible?: (row: EntityRow) => boolean;
  danger?: boolean;
}

export interface SchemaTableProps {
  module: string;
  entity: string;
  /**
   * The real list REST path, e.g. "/masters/countries" or "/suppliers" -
   * NOT derived from module/entity, because the backend's list routes
   * don't share one URL shape (masters nests by urlSegment under
   * /masters/..., suppliers/purchases mount standalone). module/entity
   * here drive ONLY the field-definitions column lookup, which IS uniform.
   */
  endpoint: string;
  columns?: SchemaTableColumnOverride[];
  filters?: SchemaTableFilter[];
  actions?: SchemaTableAction[];
  pageSizeOptions?: number[];
}
