import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as clauseRulesService from "./clause-rules.service.js";
import { clauseRuleIdParamsSchema, createClauseRuleSchema, updateClauseRuleSchema } from "./clause-rules.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const rows = await clauseRulesService.list(ctx);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createClauseRuleSchema.parse(req.body);
    const row = await clauseRulesService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = clauseRuleIdParamsSchema.parse(req.params);
    const input = updateClauseRuleSchema.parse(req.body);
    const row = await clauseRulesService.update(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
