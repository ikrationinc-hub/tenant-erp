import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/index.js";
import { logger } from "../../config/logger.js";
import { getRequestId } from "../context/request-context.js";

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    requestId: string | undefined;
    details?: Record<string, unknown>;
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = getRequestId();

  if (err instanceof AppError) {
    logger.warn({ err, code: err.code }, "handled application error");

    const body: ErrorResponseBody = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    };

    res.status(err.httpStatus).json(body);
    return;
  }

  if (err instanceof ZodError) {
    logger.warn({ err }, "unhandled zod validation error");

    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        requestId,
        details: { issues: err.issues },
      },
    } satisfies ErrorResponseBody);
    return;
  }

  logger.error({ err }, "unhandled error");

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  } satisfies ErrorResponseBody);
}
