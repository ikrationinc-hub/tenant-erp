import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as purchasePaymentsService from "./purchase-payments.service.js";
import { createPaymentSchema, outstandingBillsParamsSchema, paymentIdParamsSchema, paymentsListQuerySchema } from "./purchase-payments.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

/** PL-5: the standalone "Payments Made" list screen's own endpoint. */
export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = paymentsListQuerySchema.parse(req.query);
    const result = await purchasePaymentsService.listAll(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = paymentIdParamsSchema.parse(req.params);
    const row = await purchasePaymentsService.getById(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createPaymentSchema.parse(req.body);
    const row = await purchasePaymentsService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

/** The Payment form's own bill picker - every approved, not-yet-fully-paid bill for a chosen supplier, with its own outstanding balance already computed server-side (rule 3). */
export async function listOutstandingBills(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { supplierId } = outstandingBillsParamsSchema.parse(req.params);
    const rows = await purchasePaymentsService.listOutstandingBillsFor(ctx, supplierId);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}
