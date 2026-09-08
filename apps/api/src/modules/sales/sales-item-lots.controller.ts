import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesItemLotsService from "./sales-item-lots.service.js";
import { addSalesItemLotSchema, availableStockLotsQuerySchema, salesItemLotParamsSchema } from "./sales-item-lots.validator.js";
import { salesItemParamsSchema } from "./sales-items.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function listAvailable(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = availableStockLotsQuerySchema.parse(req.query);
    const options = await salesItemLotsService.listAvailableLots(ctx, query);
    res.status(200).json({ options });
  } catch (error) {
    next(error);
  }
}

export async function addLot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, itemId } = salesItemParamsSchema.parse(req.params);
    const input = addSalesItemLotSchema.parse(req.body);
    const row = await salesItemLotsService.addLot(ctx, id, itemId, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function removeLot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, itemId, lotId } = salesItemLotParamsSchema.parse(req.params);
    await salesItemLotsService.removeLot(ctx, id, itemId, lotId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
