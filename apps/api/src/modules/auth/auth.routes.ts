import { Router } from "express";
import { loginIpRateLimiter } from "../../common/middleware/login-rate-limit.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as authController from "./auth.controller.js";

export const authRouter: Router = Router();

authRouter.post("/login", loginIpRateLimiter, authController.login);
authRouter.post("/refresh", authController.refresh);
authRouter.post("/logout", scopeResolverMiddleware, authController.logout);
authRouter.get("/me", scopeResolverMiddleware, authController.me);
