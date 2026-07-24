import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as branchesService from "./branches.service.js";
import { branchesListQuerySchema, createBranchSchema, updateBranchSchema } from "./branches.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

function requireStringParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new UnauthorizedError(`Missing ${name}`);
  }
  return value;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = branchesListQuerySchema.parse(req.query);
    const result = await branchesService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listOptions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const options = await branchesService.listOptions(ctx);
    res.status(200).json({ options });
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createBranchSchema.parse(req.body);
    const row = await branchesService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "id");
    const input = updateBranchSchema.parse(req.body);
    const row = await branchesService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
