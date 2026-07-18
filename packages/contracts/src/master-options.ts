import { z } from "zod";

/**
 * Powers Dropdown/Lookup field-types' options_source (FE-3) - master-backed
 * options and cascading (Country -> City via parentValue). No backend
 * prompt has specced this endpoint yet (masters land in backend prompt 12).
 * Same forward-looking pattern as scope.ts in FE-2: a contract + MSW mock
 * so the frontend isn't blocked on backend sequencing. Reconcile with the
 * real shape when GET /api/v1/masters/:master/options is actually built.
 */
export const masterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  parentValue: z.string().optional(),
});
export type MasterOption = z.infer<typeof masterOptionSchema>;

// --- GET /api/v1/masters/:master/options?parentValue=&search= --------------

export const masterOptionsResponseSchema = z.object({
  options: z.array(masterOptionSchema),
});
export type MasterOptionsResponse = z.infer<typeof masterOptionsResponseSchema>;
