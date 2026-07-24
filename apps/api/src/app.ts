import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { requestContextMiddleware } from "./common/middleware/request-context.middleware.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { attachmentsRouter } from "./modules/attachments/attachments.routes.js";
import { branchesRouter } from "./modules/branches/branches.routes.js";
import { companiesRouter } from "./modules/companies/companies.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { fieldDefinitionsRouter } from "./modules/field-definitions/field-definitions.routes.js";
import { permissionsRouter, rolesRouter } from "./modules/roles/roles.routes.js";
import { mastersRouter } from "./core/masters/registry.js";
// Side-effect only - registers the inventory subscriber (FR-108) against
// common/events/bus.ts. Module evaluation is cached per process, so this
// import (however many times createApp() itself runs) only ever runs the
// registration once - see inventory-subscriber.ts's doc comment.
import "./modules/inventory/inventory-subscriber.js";
import { menusRouter } from "./modules/menus/menus.routes.js";
import { platformRouter } from "./modules/platform/platform.routes.js";
import { purchaseRouter } from "./modules/purchase/purchase.routes.js";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes.js";
import { invitationsRouter } from "./modules/users/invitations.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(cors());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(express.json());

  app.use(healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/invitations", invitationsRouter);
  app.use("/api/v1/menus", menusRouter);
  app.use("/api/v1/field-definitions", fieldDefinitionsRouter);
  app.use("/api/v1/masters", mastersRouter);
  app.use("/api/v1/attachments", attachmentsRouter);
  app.use("/api/v1/suppliers", suppliersRouter);
  app.use("/api/v1/purchases", purchaseRouter);
  app.use("/api/v1/companies", companiesRouter);
  app.use("/api/v1/branches", branchesRouter);
  app.use("/api/v1/roles", rolesRouter);
  app.use("/api/v1/permissions", permissionsRouter);
  app.use("/api/v1/platform", platformRouter);

  app.use(errorHandler);

  return app;
}
