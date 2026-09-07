import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import {
  salesDashboardCountryBreakdown,
  salesDashboardCustomerBreakdown,
  salesDashboardItemBreakdown,
  salesDashboardSnapshots,
} from "../../database/tenant/schema.js";

export type SalesDashboardSnapshotRow = typeof salesDashboardSnapshots.$inferSelect;
export type SalesDashboardCustomerBreakdownRow = typeof salesDashboardCustomerBreakdown.$inferSelect;
export type SalesDashboardItemBreakdownRow = typeof salesDashboardItemBreakdown.$inferSelect;
export type SalesDashboardCountryBreakdownRow = typeof salesDashboardCountryBreakdown.$inferSelect;

/** Only the repository layer touches SQL (rule 5). GET /sales/dashboard reads exclusively from these four cache tables - never a live OLTP aggregate (docs/SALES-MODULE-PLAN.md's own S-6 rule). Only core/reporting/sales-dashboard-refresh.ts ever writes to them. */

export async function findSnapshot(tx: TenantTx, companyId: string, periodMonth: string): Promise<SalesDashboardSnapshotRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesDashboardSnapshots)
    .where(and(eq(salesDashboardSnapshots.companyId, companyId), eq(salesDashboardSnapshots.periodMonth, periodMonth)))
    .limit(1);
  return row;
}

export async function listCustomerBreakdown(tx: TenantTx, companyId: string, periodMonth: string): Promise<SalesDashboardCustomerBreakdownRow[]> {
  return tx
    .select()
    .from(salesDashboardCustomerBreakdown)
    .where(and(eq(salesDashboardCustomerBreakdown.companyId, companyId), eq(salesDashboardCustomerBreakdown.periodMonth, periodMonth)));
}

export async function listItemBreakdown(tx: TenantTx, companyId: string, periodMonth: string): Promise<SalesDashboardItemBreakdownRow[]> {
  return tx
    .select()
    .from(salesDashboardItemBreakdown)
    .where(and(eq(salesDashboardItemBreakdown.companyId, companyId), eq(salesDashboardItemBreakdown.periodMonth, periodMonth)));
}

export async function listCountryBreakdown(tx: TenantTx, companyId: string, periodMonth: string): Promise<SalesDashboardCountryBreakdownRow[]> {
  return tx
    .select()
    .from(salesDashboardCountryBreakdown)
    .where(and(eq(salesDashboardCountryBreakdown.companyId, companyId), eq(salesDashboardCountryBreakdown.periodMonth, periodMonth)));
}
