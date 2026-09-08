import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { withTenantDb } from "../../database/get-db.js";
import { periodMonthOf } from "../../core/reporting/sales-dashboard-refresh.js";
import {
  findSnapshot,
  listCountryBreakdown,
  listCustomerBreakdown,
  listItemBreakdown,
  type SalesDashboardCountryBreakdownRow,
  type SalesDashboardCustomerBreakdownRow,
  type SalesDashboardItemBreakdownRow,
  type SalesDashboardSnapshotRow,
} from "./sales-dashboard.repository.js";
import type { SalesDashboardQuery } from "./sales-dashboard.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export interface SalesDashboardResponse {
  periodMonth: string;
  snapshot: SalesDashboardSnapshotRow | null;
  customerBreakdown: SalesDashboardCustomerBreakdownRow[];
  itemBreakdown: SalesDashboardItemBreakdownRow[];
  countryBreakdown: SalesDashboardCountryBreakdownRow[];
}

/**
 * S-6 (docs/SALES-MODULE-PLAN.md): reads ONLY the four cache tables the
 * refresh job (core/reporting/sales-dashboard-refresh.ts) already
 * populated - no live aggregation over sales/deliveries/invoices/etc in
 * this request path at all, satisfying the plan's own "dashboard doesn't
 * query OLTP directly" acceptance criterion literally. `snapshot: null`
 * (not a 404) when the refresh job hasn't run for the requested month yet
 * - a genuinely empty dashboard state, not an error.
 */
export async function getDashboard(ctx: RequestContext, params: SalesDashboardQuery): Promise<SalesDashboardResponse> {
  const scope = requireTenantScope(ctx);
  const periodMonth = params.month ? `${params.month}-01` : periodMonthOf(new Date());

  return withTenantDb(ctx, async (tx) => {
    // Sequential, not Promise.all - all four queries share the SAME
    // transaction/connection (a single pooled pg client), which cannot
    // safely run concurrent queries (pg's own "client already executing
    // a query" deprecation warning is exactly this misuse).
    const snapshot = await findSnapshot(tx, scope.companyId, periodMonth);
    const customerBreakdown = await listCustomerBreakdown(tx, scope.companyId, periodMonth);
    const itemBreakdown = await listItemBreakdown(tx, scope.companyId, periodMonth);
    const countryBreakdown = await listCountryBreakdown(tx, scope.companyId, periodMonth);

    return { periodMonth, snapshot: snapshot ?? null, customerBreakdown, itemBreakdown, countryBreakdown };
  });
}
