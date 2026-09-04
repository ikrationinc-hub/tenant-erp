import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as customersService from "./customers.service.js";
import {
  createCustomerSchema,
  customerIdParamsSchema,
  customersListQuerySchema,
  customersOptionsQuerySchema,
  updateCustomerSchema,
} from "./customers.validator.js";

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
    const query = customersListQuerySchema.parse(req.query);
    const result = await customersService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** Also mounted directly by core/masters/registry.ts at GET /masters/customers/options (deliberate exception - see that file's comment). */
export async function listOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = customersOptionsQuerySchema.parse(req.query);
    const options = await customersService.listOptions(ctx, query);
    res.status(200).json({ options });
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = customerIdParamsSchema.parse(req.params);
    const row = await customersService.getById(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createCustomerSchema.parse(req.body);
    const row = await customersService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = customerIdParamsSchema.parse(req.params);
    const input = updateCustomerSchema.parse(req.body);
    const row = await customersService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = customerIdParamsSchema.parse(req.params);
    await customersService.remove(ctx, id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = customerIdParamsSchema.parse(req.params);
    const row = await customersService.setStatus(ctx, id, "active");
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = customerIdParamsSchema.parse(req.params);
    const row = await customersService.setStatus(ctx, id, "inactive");
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
