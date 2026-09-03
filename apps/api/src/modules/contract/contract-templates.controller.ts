import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as contractTemplatesService from "./contract-templates.service.js";
import {
  addTemplateClauseSchema,
  contractTemplateIdParamsSchema,
  contractTemplatesListQuerySchema,
  createContractTemplateSchema,
  templateClauseIdParamsSchema,
  updateContractTemplateSchema,
} from "./contract-templates.validator.js";

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
    const query = contractTemplatesListQuerySchema.parse(req.query);
    const result = await contractTemplatesService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractTemplateIdParamsSchema.parse(req.params);
    const template = await contractTemplatesService.getById(ctx, id);
    res.status(200).json(template);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createContractTemplateSchema.parse(req.body);
    const template = await contractTemplatesService.create(ctx, input);
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractTemplateIdParamsSchema.parse(req.params);
    const input = updateContractTemplateSchema.parse(req.body);
    const template = await contractTemplatesService.update(ctx, id, input);
    res.status(200).json(template);
  } catch (error) {
    next(error);
  }
}

export async function addClause(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractTemplateIdParamsSchema.parse(req.params);
    const input = addTemplateClauseSchema.parse(req.body);
    const rows = await contractTemplatesService.addClause(ctx, id, input);
    res.status(201).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function removeClause(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, clauseId } = templateClauseIdParamsSchema.parse(req.params);
    const rows = await contractTemplatesService.removeClause(ctx, id, clauseId);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}
