import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as purchaseReceiptsService from "./purchase-receipts.service.js";
import { createPurchaseReceiptSchema, purchaseReceiptIdParamsSchema, receiptsListQuerySchema } from "./purchase-receipts.validator.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

/** PL-4: the standalone "Purchase Receipts" list screen's own endpoint (GET /purchase-receipts), distinct from `list` below which is scoped to one purchase. */
export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = receiptsListQuerySchema.parse(req.query);
    const result = await purchaseReceiptsService.listAll(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const rows = await purchaseReceiptsService.list(ctx, id);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = createPurchaseReceiptSchema.parse(req.body);
    const row = await purchaseReceiptsService.create(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, receiptId } = purchaseReceiptIdParamsSchema.parse(req.params);
    const row = await purchaseReceiptsService.confirm(ctx, id, receiptId);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
