import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as salesPaymentsReceivedService from "./sales-payments-received.service.js";
import {
  createPaymentReceivedSchema,
  outstandingInvoicesParamsSchema,
  paymentReceivedIdParamsSchema,
  paymentsReceivedListQuerySchema,
} from "./sales-payments-received.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

/** The standalone "Payments Received" list screen's own endpoint. */
export async function listAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = paymentsReceivedListQuerySchema.parse(req.query);
    const result = await salesPaymentsReceivedService.listAll(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = paymentReceivedIdParamsSchema.parse(req.params);
    const row = await salesPaymentsReceivedService.getById(ctx, id);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createPaymentReceivedSchema.parse(req.body);
    const row = await salesPaymentsReceivedService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

/** The Payment Received form's own invoice picker - every approved, not-yet-fully-paid invoice for a chosen customer, with its own outstanding balance already computed server-side (rule 3). */
export async function listOutstandingInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { customerId } = outstandingInvoicesParamsSchema.parse(req.params);
    const rows = await salesPaymentsReceivedService.listOutstandingInvoicesFor(ctx, customerId);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}
