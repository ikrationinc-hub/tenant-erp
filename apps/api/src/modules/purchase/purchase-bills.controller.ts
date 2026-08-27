import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as purchaseBillsService from "./purchase-bills.service.js";
import {
  billsListQuerySchema,
  createPurchaseInvoiceSchema,
  purchaseInvoiceIdParamsSchema,
  updatePurchaseInvoiceSchema,
} from "./purchase-bills.validator.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

/**
 * PL-2: file/route/param names (`invoiceId`) deliberately kept from
 * Prompt 22 - the REST surface (/purchases/:id/invoices) is unrenamed in
 * this prompt (PL-4 does the coordinated cutover). Internally this
 * delegates to purchase-bills.service.ts, the renamed Bill domain.
 */
function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

/** PL-4: the standalone "Purchase Bills" list screen's own endpoint (GET /purchase-bills), distinct from `list` below which is scoped to one purchase. */
export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = billsListQuerySchema.parse(req.query);
    const result = await purchaseBillsService.listAll(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** PL-4: exposes the per-purchase bill list (with nested items) that purchase-bills.service.ts's `list` already computed - previously used only internally by purchase.service.ts's getById via attachInvoiceVariance (a header-only, no-items view). This is the itemized view the Bill form's "default to un-billed qty" needs. */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const rows = await purchaseBillsService.list(ctx, id);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = createPurchaseInvoiceSchema.parse(req.body);
    const row = await purchaseBillsService.create(ctx, id, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, invoiceId } = purchaseInvoiceIdParamsSchema.parse(req.params);
    const input = updatePurchaseInvoiceSchema.parse(req.body);
    const row = await purchaseBillsService.update(ctx, id, invoiceId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, invoiceId } = purchaseInvoiceIdParamsSchema.parse(req.params);
    const row = await purchaseBillsService.approve(ctx, id, invoiceId);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
