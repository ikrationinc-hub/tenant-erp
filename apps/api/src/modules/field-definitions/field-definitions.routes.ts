import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as fieldDefinitionsController from "./field-definitions.controller.js";

export const fieldDefinitionsRouter: Router = Router();

const requireFieldDefinitionsModule = requireModuleEnabled("field-definitions");

fieldDefinitionsRouter.get(
  "/:module/:entity",
  scopeResolverMiddleware,
  requireFieldDefinitionsModule,
  requirePermission("field_definitions.field.read"),
  fieldDefinitionsController.getFieldDefinitions,
);

fieldDefinitionsRouter.patch(
  "/:id",
  scopeResolverMiddleware,
  requireFieldDefinitionsModule,
  requirePermission("field_definitions.field.update"),
  fieldDefinitionsController.updateFieldDefinition,
);
