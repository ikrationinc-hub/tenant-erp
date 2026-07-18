import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import type { createMasterService } from "./service.js";
import type { MasterTable } from "./types.js";
import { mastersListQuerySchema, mastersOptionsQuerySchema } from "./validators.js";

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

export interface MasterControllerSchemas<TCreate extends Record<string, unknown> & { code: string; name: string }, TUpdate extends Record<string, unknown>> {
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
}

/**
 * The controller half of the generic master-data pattern. Parameterized by
 * a concrete service (already bound to one table) and that table's
 * create/update Zod schemas - the list-query and options-query schemas are
 * the SAME for every master (validators.ts's mastersListQuerySchema/
 * mastersOptionsQuerySchema), so they're not part of this generic
 * signature at all.
 */
export function createMasterController<
  T extends MasterTable,
  TCreate extends Record<string, unknown> & { code: string; name: string },
  TUpdate extends Record<string, unknown>,
>(service: ReturnType<typeof createMasterService<T>>, schemas: MasterControllerSchemas<TCreate, TUpdate>) {
  async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const query = mastersListQuerySchema.parse(req.query);
      const result = await service.list(ctx, query);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async function listOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const query = mastersOptionsQuerySchema.parse(req.query);
      const options = await service.listOptions(ctx, query);
      res.status(200).json({ options });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const id = requireStringParam(req.params.id, "id");
      const row = await service.getById(ctx, id);
      res.status(200).json(row);
    } catch (error) {
      next(error);
    }
  }

  async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const input = schemas.createSchema.parse(req.body);
      const row = await service.create(ctx, input);
      res.status(201).json(row);
    } catch (error) {
      next(error);
    }
  }

  async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const id = requireStringParam(req.params.id, "id");
      const input = schemas.updateSchema.parse(req.body);
      const row = await service.update(ctx, id, input);
      res.status(200).json(row);
    } catch (error) {
      next(error);
    }
  }

  async function activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const id = requireStringParam(req.params.id, "id");
      const row = await service.setActive(ctx, id, true);
      res.status(200).json(row);
    } catch (error) {
      next(error);
    }
  }

  async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const ctx = requireContext();
      const id = requireStringParam(req.params.id, "id");
      const row = await service.setActive(ctx, id, false);
      res.status(200).json(row);
    } catch (error) {
      next(error);
    }
  }

  return { list, listOptions, getById, create, update, activate, deactivate };
}
