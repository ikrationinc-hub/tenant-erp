import { Router } from "express";
import { loginIpRateLimiter } from "../../common/middleware/login-rate-limit.js";
import { enforcePasswordChangeScope } from "../../common/middleware/password-change-scope.js";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as authController from "./auth.controller.js";

export const authRouter: Router = Router();

const requireAuthModule = requireModuleEnabled("auth");

// /login and /refresh are structurally exempt from module gating: there is
// no resolved tenant scope yet to check enablement against (see
// common/middleware/require-module-enabled.ts's doc comment).
authRouter.post("/login", loginIpRateLimiter, authController.login);
authRouter.post("/refresh", authController.refresh);
authRouter.post(
  "/logout",
  scopeResolverMiddleware,
  requireAuthModule,
  enforcePasswordChangeScope,
  authController.logout,
);
authRouter.get(
  "/me",
  scopeResolverMiddleware,
  requireAuthModule,
  enforcePasswordChangeScope,
  authController.me,
);
