import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as fieldDefinitionsService from "./field-definitions.service.js";
import { getFieldDefinitionsParamsSchema, updateFieldDefinitionSchema } from "./field-definitions.validator.js";

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

export async function getFieldDefinitions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { module, entity } = getFieldDefinitionsParamsSchema.parse(req.params);
    const fields = await fieldDefinitionsService.getFieldDefinitions(ctx, module, entity);
    res.status(200).json({ module, entity, fields });
  } catch (error) {
    next(error);
  }
}

export async function updateFieldDefinition(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "field definition id");
    const input = updateFieldDefinitionSchema.parse(req.body);
    const result = await fieldDefinitionsService.updateFieldDefinition(ctx, id, input);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
