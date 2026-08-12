import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as purchaseInvoicesService from "./purchase-invoices.service.js";
import { createPurchaseInvoiceSchema, purchaseInvoiceIdParamsSchema, updatePurchaseInvoiceSchema } from "./purchase-invoices.validator.js";
import { purchaseIdParamsSchema } from "./purchase.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = purchaseIdParamsSchema.parse(req.params);
    const input = createPurchaseInvoiceSchema.parse(req.body);
    const row = await purchaseInvoicesService.create(ctx, id, input);
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
    const row = await purchaseInvoicesService.update(ctx, id, invoiceId, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, invoiceId } = purchaseInvoiceIdParamsSchema.parse(req.params);
    const row = await purchaseInvoicesService.approve(ctx, id, invoiceId);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}
