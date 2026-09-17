import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as shortCloseService from "./purchase-line-shortclose.service.js";
import { purchaseItemParamsSchema, shortCloseReasonSchema } from "./purchase-items.validator.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function shortCloseLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, itemId } = purchaseItemParamsSchema.parse(req.params);
    const { reason } = shortCloseReasonSchema.parse(req.body);
    const row = await shortCloseService.shortCloseLine(ctx, id, itemId, reason);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function shortCloseAllRemaining(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const { reason } = shortCloseReasonSchema.parse(req.body);
    const rows = await shortCloseService.shortCloseAllRemaining(ctx, id, reason);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function reopenLine(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, itemId } = purchaseItemParamsSchema.parse(req.params);
    const row = await shortCloseService.reopenLine(ctx, id, itemId);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
