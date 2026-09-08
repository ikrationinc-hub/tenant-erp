import { z } from "zod";

/** "YYYY-MM" only (no day) - the dashboard's own period granularity is always a whole month, unlike every other date field in this module which is a full YYYY-MM-DD. */
const monthStringSchema = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");

export const salesDashboardQuerySchema = z.object({
  month: monthStringSchema.optional(),
});
export type SalesDashboardQuery = z.infer<typeof salesDashboardQuerySchema>;
