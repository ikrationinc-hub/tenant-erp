import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesItemsService from "./sales-items.service.js";
import { addSalesItemSchema, salesItemParamsSchema, updateSalesItemSchema } from "./sales-items.validator.js";
import { salesIdParamsSchema } from "./sales.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const input = addSalesItemSchema.parse(req.body);
    const row = await salesItemsService.addItem(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, itemId } = salesItemParamsSchema.parse(req.params);
    const input = updateSalesItemSchema.parse(req.body);
    const row = await salesItemsService.updateSalesItem(ctx, id, itemId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
