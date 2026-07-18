import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as menusService from "./menus.service.js";

export async function getMenuTree(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getRequestContext();
    if (!ctx) {
      throw new UnauthorizedError("Missing bearer token");
    }

    const tree = await menusService.getMenuTree(ctx);
    res.status(200).json({ menus: tree });
  } catch (error) {
    next(error);
  }
}
