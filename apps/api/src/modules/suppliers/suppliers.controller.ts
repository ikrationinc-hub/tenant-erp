import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as suppliersService from "./suppliers.service.js";
import {
  createSupplierSchema,
  supplierIdParamsSchema,
  suppliersListQuerySchema,
  suppliersOptionsQuerySchema,
  updateSupplierSchema,
} from "./suppliers.validator.js";

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
    const query = suppliersListQuerySchema.parse(req.query);
    const result = await suppliersService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = suppliersOptionsQuerySchema.parse(req.query);
    const options = await suppliersService.listOptions(ctx, query);
    res.status(200).json({ options });
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = supplierIdParamsSchema.parse(req.params);
    const row = await suppliersService.getById(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createSupplierSchema.parse(req.body);
    const row = await suppliersService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = supplierIdParamsSchema.parse(req.params);
    const input = updateSupplierSchema.parse(req.body);
    const row = await suppliersService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = supplierIdParamsSchema.parse(req.params);
    await suppliersService.remove(ctx, id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = supplierIdParamsSchema.parse(req.params);
    const row = await suppliersService.setStatus(ctx, id, "active");
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = supplierIdParamsSchema.parse(req.params);
    const row = await suppliersService.setStatus(ctx, id, "inactive");
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
