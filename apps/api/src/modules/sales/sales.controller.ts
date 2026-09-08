import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesService from "./sales.service.js";
import { createSalesSchema, salesIdParamsSchema, salesListQuerySchema, updateSalesSchema } from "./sales.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = salesListQuerySchema.parse(req.query);
    const result = await salesService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const row = await salesService.getById(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createSalesSchema.parse(req.body);
    const row = await salesService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const input = updateSalesSchema.parse(req.body);
    const row = await salesService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const row = await salesService.approve(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const row = await salesService.cancel(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
