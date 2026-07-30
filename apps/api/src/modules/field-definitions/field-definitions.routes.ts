import { Router } from "express";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import * as fieldDefinitionsController from "./field-definitions.controller.js";

export const fieldDefinitionsRouter: Router = Router();

const requireFieldDefinitionsModule = requireModuleEnabled("field-definitions");

// Mounted before "/:module/:entity" - a literal "/modules" segment would
// otherwise be swallowed as module="modules" with no entity param.
fieldDefinitionsRouter.get(
  "/modules",
  scopeResolverMiddleware,
  requireFieldDefinitionsModule,
  requirePermission("admin.field.manage"),
  fieldDefinitionsController.listFieldDefinitionModules,
);

fieldDefinitionsRouter.get(
  "/:module/:entity",
  scopeResolverMiddleware,
  requireFieldDefinitionsModule,
  requirePermission("field_definitions.field.read"),
  fieldDefinitionsController.getFieldDefinitions,
);

// admin.field.manage, not field_definitions.field.update - this is an
// admin-configuration action (Admin-only by default, ROLE_PERMISSION_
// FILTERS), not the day-to-day data-entry read every role gets via
// field_definitions.field.read above.
fieldDefinitionsRouter.patch(
  "/:id",
  scopeResolverMiddleware,
  requireFieldDefinitionsModule,
  requirePermission("admin.field.manage"),
  fieldDefinitionsController.updateFieldDefinition,
);
