import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as purchaseCostsService from "./purchase-costs.service.js";
import { upsertAdditionalCostsSchema } from "./purchase-costs.validator.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function setAdditionalCosts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = upsertAdditionalCostsSchema.parse(req.body);
    const row = await purchaseCostsService.setAdditionalCosts(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
