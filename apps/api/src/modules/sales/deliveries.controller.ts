import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as deliveriesService from "./deliveries.service.js";
import { createDeliverySchema, deliveriesListQuerySchema, deliveryIdParamsSchema } from "./deliveries.validator.js";
import { salesIdParamsSchema } from "./sales.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = deliveriesListQuerySchema.parse(req.query);
    const result = await deliveriesService.listAll(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const rows = await deliveriesService.list(ctx, id);
    res.status(200).json(rows);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const input = createDeliverySchema.parse(req.body);
    const row = await deliveriesService.create(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function confirm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, deliveryId } = deliveryIdParamsSchema.parse(req.params);
    const row = await deliveriesService.confirm(ctx, id, deliveryId);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
