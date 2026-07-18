import { Router } from "express";
import { platformAdminAuthMiddleware } from "../../common/middleware/platform-admin-auth.js";
import * as platformController from "./platform.controller.js";

export const platformRouter: Router = Router();

platformRouter.post("/auth/login", platformController.login);
platformRouter.post("/tenants", platformAdminAuthMiddleware, platformController.createTenant);
