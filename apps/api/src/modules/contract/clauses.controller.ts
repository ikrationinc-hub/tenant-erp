import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as clausesService from "./clauses.service.js";
import {
  addClauseVersionSchema,
  clauseIdParamsSchema,
  clauseVersionIdParamsSchema,
  clausesListQuerySchema,
  createClauseSchema,
} from "./clauses.validator.js";

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
    const query = clausesListQuerySchema.parse(req.query);
    const result = await clausesService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createClauseSchema.parse(req.body);
    const result = await clausesService.create(ctx, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listVersions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = clauseIdParamsSchema.parse(req.params);
    const versions = await clausesService.getVersions(ctx, id);
    res.status(200).json({
      items: versions.map((version) => ({ ...version, placeholderTokens: clausesService.getVersionTokens(version) })),
    });
  } catch (error) {
    next(error);
  }
}

export async function addVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = clauseIdParamsSchema.parse(req.params);
    const input = addClauseVersionSchema.parse(req.body);
    const version = await clausesService.addVersion(ctx, id, input);
    res.status(201).json(version);
  } catch (error) {
    next(error);
  }
}

export async function approveVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, versionId } = clauseVersionIdParamsSchema.parse(req.params);
    const version = await clausesService.approveVersion(ctx, id, versionId);
    res.status(200).json(version);
  } catch (error) {
    next(error);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = clauseIdParamsSchema.parse(req.params);
    const clause = await clausesService.deactivate(ctx, id);
    res.status(200).json(clause);
  } catch (error) {
    next(error);
  }
}
