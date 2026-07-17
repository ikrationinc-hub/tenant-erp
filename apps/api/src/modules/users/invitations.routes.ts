import { Router } from "express";
import * as usersController from "./users.controller.js";

/**
 * Deliberately unauthenticated - the invitee has no session yet. Mounted at
 * /api/v1/invitations (not under /api/v1/users, which is admin-authenticated).
 */
export const invitationsRouter: Router = Router();

invitationsRouter.get("/:token", usersController.validateInvitation);
invitationsRouter.post("/:token/accept", usersController.acceptInvitation);
