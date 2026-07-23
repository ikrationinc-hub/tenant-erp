import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { addAllocationSchema } from "./purchase-allocations.validator.js";
import * as purchaseAllocationsService from "./purchase-allocations.service.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function addAllocation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = addAllocationSchema.parse(req.body);
    const row = await purchaseAllocationsService.addAllocation(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}
