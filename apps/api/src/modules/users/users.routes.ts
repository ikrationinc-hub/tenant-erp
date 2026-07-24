import { Router } from "express";
import { enforcePasswordChangeScope } from "../../common/middleware/password-change-scope.js";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as usersController from "./users.controller.js";

export const usersRouter: Router = Router();

const requireUsersModule = requireModuleEnabled("users");

usersRouter.post(
  "/invite",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.create"),
  usersController.invite,
);

usersRouter.post(
  "/provision",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.provision"),
  usersController.provision,
);

usersRouter.post(
  "/invitations/:id/resend",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.create"),
  usersController.resendInvitation,
);

usersRouter.post(
  "/invitations/:id/revoke",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.create"),
  usersController.revokeInvitation,
);

usersRouter.get(
  "/",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.read"),
  usersController.list,
);

usersRouter.patch(
  "/:id/suspend",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.update"),
  usersController.suspend,
);

usersRouter.patch(
  "/:id/reactivate",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.update"),
  usersController.reactivate,
);

usersRouter.put(
  "/:id/roles",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  requirePermission("users.user.update"),
  usersController.setRoles,
);

/**
 * No enforcePasswordChangeScope OR requireModuleEnabled here, deliberately:
 * this IS the one endpoint a "password_change"-scoped token is allowed to
 * reach (task requirement), and self-service password changes are
 * foundational account management, not a "users" administration feature a
 * tenant would toggle off. Works for a normal "full"-scoped session too.
 */
usersRouter.post("/me/password", scopeResolverMiddleware, usersController.changePassword);

/**
 * FE-4's row-action gating: the requesting user's own resolved permission
 * set, for UX only (frontend rule 4 - the backend remains the actual gate
 * on every write, same as every requirePermission call elsewhere). Gated
 * like GET /auth/me (enforcePasswordChangeScope, not exempt) - unlike
 * /me/password this isn't the one endpoint a password-change-scoped token
 * needs to reach.
 */
usersRouter.get(
  "/me/permissions",
  scopeResolverMiddleware,
  requireUsersModule,
  enforcePasswordChangeScope,
  usersController.myPermissions,
);
