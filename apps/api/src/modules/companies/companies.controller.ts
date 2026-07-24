import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as companiesService from "./companies.service.js";
import { companiesListQuerySchema, createCompanySchema, updateCompanySchema } from "./companies.validator.js";

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
    const query = companiesListQuerySchema.parse(req.query);
    const result = await companiesService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createCompanySchema.parse(req.body);
    const row = await companiesService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "id");
    const input = updateCompanySchema.parse(req.body);
    const row = await companiesService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
