import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { getFieldSections } from "../../core/field-engine/defaults.js";
import { groupFieldsIntoSections } from "../../core/field-engine/group-sections.js";
import * as fieldDefinitionsService from "./field-definitions.service.js";
import {
  getFieldDefinitionsParamsSchema,
  getFieldDefinitionsQuerySchema,
  updateFieldDefinitionSchema,
} from "./field-definitions.validator.js";

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
    const { divisionId } = getFieldDefinitionsQuerySchema.parse(req.query);
    const fields = await fieldDefinitionsService.getFieldDefinitions(ctx, module, entity, divisionId);
    const sections = groupFieldsIntoSections(getFieldSections(module, entity), fields);
    res.status(200).json({ module, entity, fields, ...(sections ? { sections } : {}) });
  } catch (error) {
    next(error);
  }
}

export function listFieldDefinitionModules(_req: Request, res: Response, next: NextFunction): void {
  try {
    requireContext();
    const modules = fieldDefinitionsService.listFieldDefinitionModules();
    res.status(200).json({ modules });
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
