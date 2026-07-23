import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as attachmentsController from "./attachments.controller.js";

export const attachmentsRouter: Router = Router();

const requireStorageModule = requireModuleEnabled("storage");

attachmentsRouter.post(
  "/:entity/:entityId/:fieldKey",
  scopeResolverMiddleware,
  requireStorageModule,
  requirePermission("storage.attachment.create"),
  attachmentsController.upload,
);

attachmentsRouter.get(
  "/:id/download-url",
  scopeResolverMiddleware,
  requireStorageModule,
  requirePermission("storage.attachment.read"),
  attachmentsController.getDownloadUrl,
);

attachmentsRouter.get(
  "/",
  scopeResolverMiddleware,
  requireStorageModule,
  requirePermission("storage.attachment.read"),
  attachmentsController.list,
);
