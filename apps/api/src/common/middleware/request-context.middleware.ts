import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "../context/request-context.js";

const REQUEST_ID_HEADER = "x-request-id";

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = req.header(REQUEST_ID_HEADER);
  const requestId = incomingRequestId && incomingRequestId.length > 0 ? incomingRequestId : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, requestId);

  const userAgent = req.header("user-agent");
  runWithRequestContext(
    {
      requestId,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    },
    () => {
      next();
    },
  );
}
