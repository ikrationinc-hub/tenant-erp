import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesInvoicesService from "./sales-invoices.service.js";
import { createSalesInvoiceSchema, invoicesListQuerySchema, salesInvoiceIdParamsSchema, updateSalesInvoiceSchema } from "./sales-invoices.validator.js";
import { salesIdParamsSchema } from "./sales.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

/** The standalone "Sales Invoices" list screen's own endpoint (GET /sales-invoices), distinct from `list` below which is scoped to one sale. */
export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = invoicesListQuerySchema.parse(req.query);
    const result = await salesInvoicesService.listAll(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const rows = await salesInvoicesService.list(ctx, id);
    res.status(200).json(rows);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = salesIdParamsSchema.parse(req.params);
    const input = createSalesInvoiceSchema.parse(req.body);
    const row = await salesInvoicesService.create(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, invoiceId } = salesInvoiceIdParamsSchema.parse(req.params);
    const input = updateSalesInvoiceSchema.parse(req.body);
    const row = await salesInvoicesService.update(ctx, id, invoiceId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, invoiceId } = salesInvoiceIdParamsSchema.parse(req.params);
    const row = await salesInvoicesService.approve(ctx, id, invoiceId);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
