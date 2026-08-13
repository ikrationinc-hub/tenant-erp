import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { addLmeRecordSchema, lmeRecordIdParamsSchema, updateLmeRecordSchema } from "./purchase-lme.validator.js";
import * as purchaseLmeService from "./purchase-lme.service.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function addLmeRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = addLmeRecordSchema.parse(req.body);
    const row = await purchaseLmeService.addLmeRecord(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function updateLmeRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, lmeRecordId } = lmeRecordIdParamsSchema.parse(req.params);
    const input = updateLmeRecordSchema.parse(req.body);
    const row = await purchaseLmeService.updateLmeRecordEntry(ctx, id, lmeRecordId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function removeLmeRecord(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, lmeRecordId } = lmeRecordIdParamsSchema.parse(req.params);
    await purchaseLmeService.removeLmeRecord(ctx, id, lmeRecordId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
