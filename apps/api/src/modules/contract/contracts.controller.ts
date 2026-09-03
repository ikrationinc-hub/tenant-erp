import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as contractsService from "./contracts.service.js";
import { contractIdParamsSchema, createContractSchema, updateContractSchema } from "./contracts.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createContractSchema.parse(req.body);
    const contract = await contractsService.create(ctx, input);
    res.status(201).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const contract = await contractsService.getById(ctx, id);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = updateContractSchema.parse(req.body);
    const contract = await contractsService.update(ctx, id, input);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}
