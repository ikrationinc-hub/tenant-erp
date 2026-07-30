import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { withTenantDb } from "../../database/get-db.js";
import {
  getStockBalances,
  listStockMovements,
  type StockBalanceRow,
  type StockMovementWithSourceRow,
} from "./stock-movements.repository.js";
import type {
  BalancesListQuery,
  MovementsByBalanceQuery,
  MovementsListQuery,
} from "./inventory.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export async function balances(ctx: RequestContext, query: BalancesListQuery): Promise<PaginatedRows<StockBalanceRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => getStockBalances(tx, scope.companyId, query));
}

export async function movements(ctx: RequestContext, query: MovementsListQuery): Promise<PaginatedRows<StockMovementWithSourceRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listStockMovements(tx, scope.companyId, query));
}

/** The movement history behind one balance row - same underlying query, itemId/warehouseId pinned from the path rather than the query string. */
export async function movementsForBalance(
  ctx: RequestContext,
  itemId: string,
  warehouseId: string,
  query: MovementsByBalanceQuery,
): Promise<PaginatedRows<StockMovementWithSourceRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) =>
    listStockMovements(tx, scope.companyId, { ...query, itemId, warehouseId }),
  );
}
