import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as inventoryService from "./inventory.service.js";
import {
  balancesListQuerySchema,
  movementsByBalanceParamsSchema,
  movementsByBalanceQuerySchema,
  movementsListQuerySchema,
} from "./inventory.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function balances(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = balancesListQuerySchema.parse(req.query);
    const result = await inventoryService.balances(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function movements(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = movementsListQuerySchema.parse(req.query);
    const result = await inventoryService.movements(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function movementsForBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { itemId, warehouseId } = movementsByBalanceParamsSchema.parse(req.params);
    const query = movementsByBalanceQuerySchema.parse(req.query);
    const result = await inventoryService.movementsForBalance(ctx, itemId, warehouseId, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
