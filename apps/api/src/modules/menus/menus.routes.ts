import { Router } from "express";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as menusController from "./menus.controller.js";

/**
 * Not requireModuleEnabled-gated: menus is the mechanism that tells a
 * client what's available at all, including which OTHER modules'
 * menu items to show - gating it behind its own toggle would be a
 * confusing trap with no real use case (see core/module-registry/
 * manifests.ts's doc comment on "auth"/"health" for the same reasoning).
 */
export const menusRouter: Router = Router();

menusRouter.get("/", scopeResolverMiddleware, menusController.getMenuTree);
