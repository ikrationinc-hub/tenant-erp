import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { addHedgeSchema, hedgeParamsSchema, updateHedgeStatusSchema } from "./purchase-hedges.validator.js";
import * as purchaseHedgesService from "./purchase-hedges.service.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function addHedge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = addHedgeSchema.parse(req.body);
    const row = await purchaseHedgesService.addHedge(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, hedgeId } = hedgeParamsSchema.parse(req.params);
    const input = updateHedgeStatusSchema.parse(req.body);
    const row = await purchaseHedgesService.updateStatus(ctx, id, hedgeId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
