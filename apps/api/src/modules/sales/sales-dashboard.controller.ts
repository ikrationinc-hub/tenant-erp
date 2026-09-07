import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesDashboardService from "./sales-dashboard.service.js";
import { salesDashboardQuerySchema } from "./sales-dashboard.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = salesDashboardQuerySchema.parse(req.query);
    const result = await salesDashboardService.getDashboard(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
