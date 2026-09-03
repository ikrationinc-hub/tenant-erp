import { attachmentsRouter } from "../../modules/attachments/attachments.routes.js";
import { authRouter } from "../../modules/auth/auth.routes.js";
import { clausesRouter } from "../../modules/contract/contract.routes.js";
import { companiesRouter } from "../../modules/companies/companies.routes.js";
import { fieldDefinitionsRouter } from "../../modules/field-definitions/field-definitions.routes.js";
import { healthRouter } from "../../modules/health/health.routes.js";
import { inventoryRouter } from "../../modules/inventory/inventory.routes.js";
import { menusRouter } from "../../modules/menus/menus.routes.js";
import { purchaseRouter } from "../../modules/purchase/purchase.routes.js";
import { brokersRouter } from "../../modules/brokers/brokers.routes.js";
import { suppliersRouter } from "../../modules/suppliers/suppliers.routes.js";
import { usersRouter } from "../../modules/users/users.routes.js";
import { ALL_MASTER_PERMISSIONS, mastersRouter } from "../masters/registry.js";
import { permissionEntry } from "../rbac/types.js";
import type { ModuleManifest } from "./types.js";

/**
 * The concrete list of modules this build ships. Order here doesn't
 * matter - registry.ts's resolveLoadOrder topologically sorts by
 * dependsOn. `health` and `auth`'s pre-authentication routes (login,
 * refresh) are structurally exempt from module-enabled gating: gating
 * requires a resolved tenant scope (common/middleware/require-module-
 * enabled.ts), and neither the health check nor an as-yet-unauthenticated
 * login request has one yet - see that middleware's doc comment.
 */
export const MODULE_MANIFESTS: ModuleManifest[] = [
  {
    key: "health",
    name: "Health",
    version: "1.0.0",
    routes: healthRouter,
    permissions: [],
    dependsOn: [],
    migrations: [],
  },
  {
    key: "auth",
    name: "Authentication",
    version: "1.0.0",
    routes: authRouter,
    permissions: [],
    dependsOn: [],
    migrations: ["0000_mysterious_blindfold", "0001_high_outlaw_kid"],
  },
  {
    key: "users",
    name: "User Management",
    version: "1.0.0",
    routes: usersRouter,
    permissions: [
      permissionEntry("users", "user", "create", "Invite a new user"),
      permissionEntry("users", "user", "read", "View users"),
      permissionEntry("users", "user", "update", "Edit a user"),
      permissionEntry("users", "user", "delete", "Deactivate a user"),
      permissionEntry(
        "users",
        "user",
        "provision",
        "Provision a user with a temporary password, bypassing the email invite flow (no email address)",
      ),
    ],
    dependsOn: ["auth"],
    migrations: ["0006_sad_trish_tilby"],
  },
  {
    key: "roles",
    name: "Roles & Permissions",
    version: "1.0.0",
    // Real HTTP surface as of the tenant-admin API task: CRUD + permission
    // grant/revoke + field-permission get/save, all REST layers over
    // core/rbac/mutations.ts's existing engine (that file's own doc
    // comment: it's the ONLY way role/permission/field-permission data
    // changes - this router calls it, never reimplements it). `routes` is
    // deliberately omitted here (unlike most manifests) - modules/roles/
    // roles.controller.ts's permissions-catalogue handler imports this
    // very registry.js (getPermissionCatalogue), so importing rolesRouter
    // back into manifests.ts would close a real cycle: manifests.ts ->
    // roles.routes.ts -> roles.controller.ts -> registry.ts ->
    // manifests.ts. `routes` is purely informational (registry.ts's own
    // mountModules doesn't exist - every router is mounted directly in
    // app.ts, "users"+"invitationsRouter" is the existing precedent for a
    // module whose full surface isn't captured by this one field), so
    // dropping it costs nothing real. rolesRouter/permissionsRouter are
    // still mounted in app.ts exactly like every other router.
    // module="admin", not "roles" (this manifest's own key) - the task's
    // explicit convention: admin.company/admin.branch/admin.role all share
    // the "admin" permission namespace, matching apps/web's mock catalogue
    // (apps/web/src/mocks/admin-handlers.ts) exactly. "assign"/"delete"
    // (the old roles.role.* placeholders) are gone: assigning a role to a
    // user is users.user.update's job now (PUT /users/:id/roles), and no
    // FR in this spec ever asked for role deletion.
    permissions: [
      permissionEntry("admin", "role", "create", "Create a role"),
      permissionEntry("admin", "role", "read", "View roles"),
      permissionEntry("admin", "role", "update", "Rename a role, manage its permissions"),
    ],
    dependsOn: ["auth"],
    migrations: ["0002_silent_white_tiger"],
  },
  {
    key: "menus",
    name: "Navigation Menus",
    version: "1.0.0",
    routes: menusRouter,
    permissions: [],
    dependsOn: ["auth", "roles"],
    migrations: ["0007_menus"],
  },
  {
    key: "field-definitions",
    name: "Field Engine (Tier 2)",
    version: "1.0.0",
    routes: fieldDefinitionsRouter,
    permissions: [
      permissionEntry("field_definitions", "field", "read", "View a module/entity's resolved field definitions"),
      permissionEntry(
        "field_definitions",
        "field",
        "update",
        "Override a Tier 2 field's label, visibility, mandatory flag, or sort order",
      ),
    ],
    dependsOn: ["auth", "roles"],
    migrations: ["0010_modern_adam_warlock"],
  },
  {
    key: "masters",
    name: "Masters",
    version: "1.0.0",
    routes: mastersRouter,
    permissions: [
      // supplier used to be declared here too, but now has a real
      // implementation (see the "suppliers" manifest below) -
      // module="suppliers", not "masters", is its real permission
      // namespace. customer WAS a stub declared here ahead of its own
      // module (prompt 16 resolved this: it's now a real instantiated
      // master, so its create/read/update permissions come from
      // ALL_MASTER_PERMISSIONS below like every other master - declaring
      // it here too would be a duplicate permission key.
      //
      // The 16 generic masters (countries, cities, currencies, ...,
      // customers) - create/read/update per entity, generated from
      // core/masters/registry.ts so a 17th master needs no changes here.
      ...ALL_MASTER_PERMISSIONS,
    ],
    dependsOn: ["auth", "roles"],
    migrations: [
      "0011_chubby_blockbuster",
      "0012_dry_robbie_robertson",
      "0013_faulty_black_tarantula",
    ],
  },
  {
    key: "admin",
    name: "Tenant Admin (Companies & Branches)",
    version: "1.0.0",
    // Companies/branches REST layer under FE-5.5's tenant-admin screens.
    // routes only names one of the two routers this manifest owns
    // (companiesRouter) - branchesRouter is mounted separately in app.ts,
    // same precedent as "users" (routes: usersRouter, but app.ts also
    // mounts invitationsRouter on its own).
    routes: companiesRouter,
    permissions: [
      permissionEntry("admin", "company", "create", "Add a company"),
      permissionEntry("admin", "company", "read", "View companies"),
      permissionEntry("admin", "company", "update", "Edit a company"),
      permissionEntry("admin", "branch", "create", "Add a branch"),
      permissionEntry("admin", "branch", "read", "View branches"),
      permissionEntry("admin", "branch", "update", "Edit a branch"),
      // Deliberately its own action ("manage"), not "update" - the
      // ROLE_PERMISSION_FILTERS action-based tiers (Viewer/Officer/
      // Manager/Admin) only grant "update" up through Officer/Manager;
      // Tier 2 field configuration should be Admin-only by default, same
      // as company/branch structure itself is meant to be governed
      // carefully, not day-to-day data entry.
      permissionEntry(
        "admin",
        "field",
        "manage",
        "Edit a Tier 2 field's label, visibility, mandatory flag, or sort order",
      ),
    ],
    // "masters": companies.country_id/currency_id FK into core/masters'
    // countries/currencies tables (this task's own resolved decision).
    dependsOn: ["auth", "roles", "masters"],
    migrations: ["0020_companies_country_currency_fk", "0021_companies_drop_country_currency_code"],
  },
  {
    key: "storage",
    name: "Storage & Attachments",
    version: "1.0.0",
    routes: attachmentsRouter,
    permissions: [
      permissionEntry("storage", "attachment", "create", "Upload a file attachment"),
      permissionEntry("storage", "attachment", "read", "View/download a file attachment"),
    ],
    dependsOn: ["auth"],
    migrations: ["0014_shiny_lilandra"],
  },
  {
    key: "suppliers",
    name: "Supplier Master",
    version: "1.0.0",
    routes: suppliersRouter,
    permissions: [
      permissionEntry("suppliers", "supplier", "create", "Create a supplier"),
      permissionEntry("suppliers", "supplier", "read", "View suppliers"),
      permissionEntry("suppliers", "supplier", "update", "Edit a supplier, or activate/deactivate it"),
    ],
    // "masters": suppliers.supplier_type_id/country_id/city_id/payment_term_id/currency_id all FK into core/masters tables.
    dependsOn: ["auth", "roles", "masters"],
    migrations: ["0014_shiny_lilandra"],
  },
  {
    key: "brokers",
    name: "Broker Master",
    version: "1.0.0",
    // Prompt 21 item 4: full dedicated module mirroring suppliers' own
    // shape (own table + contacts/banks child tables, own permission
    // namespace) rather than a generic core/masters/factory.ts master -
    // same reasoning suppliers itself isn't one.
    routes: brokersRouter,
    permissions: [
      permissionEntry("brokers", "broker", "create", "Create a broker"),
      permissionEntry("brokers", "broker", "read", "View brokers"),
      permissionEntry("brokers", "broker", "update", "Edit a broker, or activate/deactivate it"),
    ],
    dependsOn: ["auth", "roles", "masters"],
    migrations: ["0023_prompt21_masters_and_purchase_columns"],
  },
  {
    key: "purchase",
    name: "Purchase",
    version: "1.0.0",
    // Built incrementally, session by session (docs/spec/Purchase-V2.md Sub
    // Tab 2 + 3 - "the big one", deliberately split rather than attempted in
    // one pass, now complete): (a) header+shipment, (b) items+pricing, (c)
    // allocation+costs (attachments needed no new code - core/storage's
    // existing entity-agnostic module already covers FR-110), (d) LME +
    // hedging, and (e) workflow + stock (this session) are all live.
    // "delete" stays declared but unexercised - no FR in this spec ever
    // asked for one, and it costs nothing to leave the permission stable
    // for whenever it's actually built.
    routes: purchaseRouter,
    permissions: [
      permissionEntry("purchase", "po", "create", "Create a purchase order"),
      permissionEntry("purchase", "po", "read", "View purchase orders"),
      permissionEntry("purchase", "po", "update", "Edit a draft purchase order"),
      // PL-3: "approve"/"post" are gone - issue commits the PO to the
      // supplier (Draft -> Issued); cancel kills an unfulfilled one
      // (Draft/Issued -> Cancelled). "Closed" has no permission of its
      // own - it's derived and automatic, never user-invoked.
      permissionEntry("purchase", "po", "issue", "Issue a purchase order to the supplier"),
      permissionEntry("purchase", "po", "cancel", "Cancel a purchase order before it's fulfilled"),
      permissionEntry("purchase", "po", "delete", "Delete a draft purchase order"),
      // Prompt 22, renamed PL-2 to the Bill (purchase_bills - CLAUDE.md's
      // Vocabulary section, superseded by PL-1/ADR 0016 for stock; the
      // financial lifecycle itself is unchanged). Not po.* - a separate
      // document, separate permission surface. Keys kept as
      // purchase.invoice.* deliberately - the REST surface (/invoices) is
      // unrenamed until PL-4's coordinated cutover.
      permissionEntry("purchase", "invoice", "create", "Create a bill against a purchase"),
      permissionEntry("purchase", "invoice", "update", "Edit a draft bill"),
      permissionEntry("purchase", "invoice", "approve", "Approve a bill"),
      // PL-1: the Purchase Receipt - its own lifecycle, own permission
      // surface. Confirm is what moves stock now, not bill approval.
      permissionEntry("purchase", "receipt", "create", "Create a purchase receipt against a purchase order"),
      permissionEntry("purchase", "receipt", "confirm", "Confirm a purchase receipt - this is what moves stock"),
      // PL-5: Payment, the 4th and final lifecycle document - its own
      // permission surface. Action is "record", not "create" - money
      // actually leaving the company deserves the same Manager-tier bar
      // as issue/approve/confirm (seed-roles.ts), not the Officer-tier
      // "create" bucket every other day-to-day data-entry permission
      // falls into; a distinct action name is what lets the role-tier
      // filter (keyed purely by action string) single this one out
      // without also promoting PO/bill creation to Manager. No
      // "approve"/"confirm" - a payment is a single atomic event recorded
      // once (no draft state); read reuses purchase.po.read (PL-4's own
      // precedent for the Receipts/Bills list screens).
      permissionEntry("purchase", "payment", "record", "Record a payment against one or more bills"),
    ],
    dependsOn: ["auth", "roles", "masters", "suppliers", "storage"],
    migrations: [
      "0015_lumpy_karnak",
      "0016_slim_hellion",
      "0017_serious_ricochet",
      "0018_loose_mastermind",
      "0019_lucky_sleeper",
      "0030_early_magik",
      "0031_pl2_bill_rename",
      "0032_pl3_po_lifecycle",
      "0033_nebulous_franklin_storm",
      "0034_nosy_earthquake",
    ],
  },
  {
    key: "contract",
    name: "Contract Management",
    version: "1.0.0",
    // C-1 (docs/CONTRACT-MODULE-BUILD.md): the versioned clause library -
    // the first slice of the Contract module. Templates/assembly/rules
    // engine land in C-3b/C-4; this manifest entry grows with them.
    routes: clausesRouter,
    permissions: [
      // "read" isn't in the C-1 prompt's own explicit permission list
      // (create/.version/.approve/.deactivate only), but GET /clauses and
      // GET /clauses/:id/versions need SOME permission gate (rule 2's
      // spirit: every endpoint is permission-checked, not just mutating
      // ones) - same reasoning purchase.po.read exists alongside po.create/
      // update/issue/cancel.
      permissionEntry("contract", "clause", "read", "View clauses and their version history"),
      permissionEntry("contract", "clause", "create", "Create a clause"),
      permissionEntry("contract", "clause", "version", "Add a new version to a clause"),
      permissionEntry("contract", "clause", "approve", "Approve a clause version"),
      permissionEntry("contract", "clause", "deactivate", "Deactivate a clause"),
      // C-3b item 6 - "document" is the contract header's own entity name
      // (distinct from "clause") so these fit the module.entity.action
      // shape every other permission in this catalogue already uses; the
      // prompt's own literal wording ("contract.create/edit/assemble/
      // generate") names the CONCEPT, satisfied by this shape. "assemble"
      // covers every assembly action (add/remove/reorder/edit-text/
      // resnapshot) AND every workflow transition (approve/sign/close) -
      // the prompt's own flat 4-permission list, not one permission per
      // transition the way purchase.po.issue/cancel does it.
      permissionEntry("contract", "document", "create", "Create a contract"),
      permissionEntry("contract", "document", "edit", "Edit a draft contract's header fields"),
      permissionEntry("contract", "document", "assemble", "Assemble a contract's clauses and transition its status"),
      permissionEntry("contract", "document", "generate", "Generate a contract's Word/PDF documents"),
    ],
    // "masters": clauses.division_id FK into core/masters' divisions table
    // (reused as-is from Purchase, per the build doc - not recreated) -
    // also contract_parties.customerId FK into core/masters' customers.
    // "field-definitions": C-3a's division-scoped contract fields extend
    // the field engine (field_definitions.division_id), which needs it
    // available before this module's own routes read from it.
    // "suppliers": contract_parties.supplierId FK, same reasoning.
    // "storage": a contract template's uploaded .docx file goes through
    // the existing attachments mechanism (contract-generation.service.ts).
    dependsOn: ["auth", "roles", "masters", "field-definitions", "suppliers", "storage"],
    migrations: ["0038_c1_clause_library", "0039_c3a_contract_fields", "0040_c3b_contract_document"],
  },
  {
    key: "inventory",
    name: "Inventory (Stock Ledger)",
    version: "1.0.0",
    // Read-only REST surface over stock_movements - the write side
    // (inventory-subscriber.ts, registered separately in app.ts as a
    // side effect against common/events/bus.ts, not through this
    // manifest's `routes`) already existed before this module had any
    // HTTP surface, permission, or menu entry at all.
    routes: inventoryRouter,
    permissions: [
      permissionEntry("inventory", "stock", "read", "View stock balances and movements"),
    ],
    dependsOn: ["auth", "roles", "masters", "purchase"],
    // stock_movements originates from the same migration purchase's own
    // Approve->stock workflow shipped in (0019) - not a new one.
    migrations: ["0019_lucky_sleeper"],
  },
];
