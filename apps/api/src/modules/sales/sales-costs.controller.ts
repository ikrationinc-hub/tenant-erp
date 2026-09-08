import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesCostsService from "./sales-costs.service.js";
import { upsertSalesAdditionalCostsSchema } from "./sales-costs.validator.js";
import { salesIdParamsSchema } from "./sales.validator.js";

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
    const { id } = salesIdParamsSchema.parse(req.params);
    const input = upsertSalesAdditionalCostsSchema.parse(req.body);
    const row = await salesCostsService.setAdditionalCosts(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
