import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { verifyAccessToken } from "../../core/auth/jwt.js";
import * as authService from "./auth.service.js";
import { loginSchema, logoutSchema, refreshSchema } from "./auth.validator.js";

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(req: Request): string {
  const header = req.header("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return header.slice(BEARER_PREFIX.length);
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const userAgent = req.header("user-agent");

    const result = await authService.login(input, {
      hostname: req.hostname,
      ...(req.ip ? { ip: req.ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = refreshSchema.parse(req.body);
    const result = await authService.refresh(input.refreshToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = logoutSchema.parse(req.body);
    const ctx = getRequestContext();
    if (!ctx) {
      throw new UnauthorizedError("Missing bearer token");
    }

    const claims = await verifyAccessToken(extractBearerToken(req));

    await authService.logout(ctx, input.refreshToken);
    await authService.denylistCurrentAccessToken(claims.jti, claims.exp);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function me(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getRequestContext();
    if (!ctx) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const result = await authService.me(ctx);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
