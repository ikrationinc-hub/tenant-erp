import { Router } from "express";
import { platformAdminAuthMiddleware } from "../../common/middleware/platform-admin-auth.js";
import { platformLoginIpRateLimiter } from "../../common/middleware/platform-login-rate-limit.js";
import * as platformController from "./platform.controller.js";

export const platformRouter: Router = Router();

// /auth/login and /auth/refresh are structurally exempt from
// platformAdminAuthMiddleware: there is no token yet at login, and refresh
// authenticates via the refresh token itself, not a bearer access token
// (mirrors modules/auth/auth.routes.ts's same exemption).
platformRouter.post("/auth/login", platformLoginIpRateLimiter, platformController.login);
platformRouter.post("/auth/refresh", platformController.refresh);
platformRouter.post("/auth/logout", platformAdminAuthMiddleware, platformController.logout);
platformRouter.get("/auth/me", platformAdminAuthMiddleware, platformController.me);

platformRouter.get("/modules", platformAdminAuthMiddleware, platformController.listModuleCatalogue);

platformRouter.get("/tenants", platformAdminAuthMiddleware, platformController.listAllTenants);
platformRouter.post("/tenants", platformAdminAuthMiddleware, platformController.createTenant);
platformRouter.get("/tenants/:id", platformAdminAuthMiddleware, platformController.getTenant);
platformRouter.post("/tenants/:id/suspend", platformAdminAuthMiddleware, platformController.suspendTenant);
platformRouter.post(
  "/tenants/:id/reactivate",
  platformAdminAuthMiddleware,
  platformController.reactivateTenant,
);
platformRouter.get(
  "/tenants/:id/modules",
  platformAdminAuthMiddleware,
  platformController.getTenantModules,
);
platformRouter.patch(
  "/tenants/:id/modules",
  platformAdminAuthMiddleware,
  platformController.patchTenantModule,
);
