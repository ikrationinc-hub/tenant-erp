import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as purchaseItemsService from "./purchase-items.service.js";
import { addPurchaseItemSchema, purchaseItemParamsSchema, updatePurchaseItemSchema } from "./purchase-items.validator.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

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
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = addPurchaseItemSchema.parse(req.body);
    const row = await purchaseItemsService.addItem(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, itemId } = purchaseItemParamsSchema.parse(req.params);
    const input = updatePurchaseItemSchema.parse(req.body);
    const row = await purchaseItemsService.updatePurchaseItem(ctx, id, itemId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
