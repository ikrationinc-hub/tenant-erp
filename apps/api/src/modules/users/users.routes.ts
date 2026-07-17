import { Router } from "express";
import { enforcePasswordChangeScope } from "../../common/middleware/password-change-scope.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as usersController from "./users.controller.js";

export const usersRouter: Router = Router();

usersRouter.post(
  "/invite",
  scopeResolverMiddleware,
  enforcePasswordChangeScope,
  requirePermission("users.user.create"),
  usersController.invite,
);

usersRouter.post(
  "/provision",
  scopeResolverMiddleware,
  enforcePasswordChangeScope,
  requirePermission("users.user.provision"),
  usersController.provision,
);

usersRouter.post(
  "/invitations/:id/resend",
  scopeResolverMiddleware,
  enforcePasswordChangeScope,
  requirePermission("users.user.create"),
  usersController.resendInvitation,
);

usersRouter.post(
  "/invitations/:id/revoke",
  scopeResolverMiddleware,
  enforcePasswordChangeScope,
  requirePermission("users.user.create"),
  usersController.revokeInvitation,
);

/**
 * No enforcePasswordChangeScope here, deliberately: this IS the one
 * endpoint a "password_change"-scoped token is allowed to reach (task
 * requirement). Works for a normal "full"-scoped session too.
 */
usersRouter.post("/me/password", scopeResolverMiddleware, usersController.changePassword);
