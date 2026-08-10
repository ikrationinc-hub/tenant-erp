import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as brokersService from "./brokers.service.js";
import {
  brokerIdParamsSchema,
  brokersListQuerySchema,
  brokersOptionsQuerySchema,
  createBrokerSchema,
  updateBrokerSchema,
} from "./brokers.validator.js";

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
    const query = brokersListQuerySchema.parse(req.query);
    const result = await brokersService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = brokersOptionsQuerySchema.parse(req.query);
    const options = await brokersService.listOptions(ctx, query);
    res.status(200).json({ options });
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = brokerIdParamsSchema.parse(req.params);
    const row = await brokersService.getById(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createBrokerSchema.parse(req.body);
    const row = await brokersService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = brokerIdParamsSchema.parse(req.params);
    const input = updateBrokerSchema.parse(req.body);
    const row = await brokersService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = brokerIdParamsSchema.parse(req.params);
    await brokersService.remove(ctx, id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = brokerIdParamsSchema.parse(req.params);
    const row = await brokersService.setStatus(ctx, id, "active");
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = brokerIdParamsSchema.parse(req.params);
    const row = await brokersService.setStatus(ctx, id, "inactive");
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
