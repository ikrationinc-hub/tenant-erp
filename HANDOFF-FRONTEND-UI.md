# Frontend UI Handoff

For the developer (and their Claude) picking up UI/UX enhancement work on `apps/web`. Written 2026-08-21. This describes what exists and how it's wired — it is not a task list. Re-verify anything below against the actual code before relying on it; the codebase moves faster than this document will.

## What this app is

`apps/web` is the React frontend for a multi-tenant commodity trading ERP (metals: LME-priced, hedged, shipped in containers). **It is a rendering engine for backend metadata, not a set of hand-coded screens.** That single idea explains almost every architectural choice below, and it's the constraint you'll bump into first: you generally can't fix a UI problem by hardcoding a label, a column, or a route — there's a metadata source you're supposed to fix or extend instead. Read `/home/knackroot/Hyperion/hyperion-erp/CLAUDE.md` in full before making changes — it's the project's binding contract, not background reading, and it's checked into the repo root. The "7 frontend rules" section there is the short version of everything in this document.

## Stack

- React 19 + TypeScript `strict` + Vite
- **Ant Design v5** — the component library. Table/Tree/Transfer/Cascader/Drawer/Form ARE the product; don't reach for another component library or hand-roll what AntD already gives you.
- TanStack Query v5 — all server state
- Zustand — auth token + UI prefs ONLY, never API data
- React Hook Form + Zod resolver — forms, wrapping AntD inputs via `Controller`
- React Router v7
- MSW — mock backend for dev/test, handlers built from `packages/contracts` schemas
- Vitest + Testing Library — unit/component tests (Playwright is in the stack decision but not yet in heavy use — check `apps/web/package.json` before assuming e2e coverage exists)

Run `pnpm dev` from repo root (or `pnpm --filter @ikration/web dev`) to start Vite. `pnpm --filter @ikration/web test` runs Vitest. `pnpm --filter @ikration/web typecheck` / `lint`.

## The three non-negotiable rendering rules

These aren't style preferences — violating them is treated as a bug in this codebase, same severity as a backend money bug.

1. **No hardcoded field labels, types, or form layout.** Every form renders from `GET /field-definitions/:module/:entity` through `<SchemaForm/>`. If you're tempted to write `<Input label="Other Charges" />` anywhere under `modules/`, stop — that field's label, mandatory-ness, order, and visibility are supposed to come from the field-definitions response, because the client can rename/reorder/hide fields without a deploy (that's the whole point of the field engine — see "Tiers" below).
2. **No hardcoded navigation.** The menu tree renders from `GET /menus`. There is no route array anywhere describing "Purchase → Orders → ...". Routes are resolved dynamically at runtime (see Navigation section).
3. **The frontend never calculates money.** All money math (FR-105/106/203-type rules, LME rate formulas, variance, totals) is server-computed. The API returns `numeric` columns as **strings** — never `parseFloat` them for display. If you need a live client-side preview before the user saves, use `decimal.js`, never native `+`/`*`/`/` on parsed floats.

The other four rules (field permissions are UX not security, TanStack Query owns server state, one component per field type in a registry, types come from `packages/contracts`) matter just as much day-to-day; see CLAUDE.md.

## Directory map

```
apps/web/src/
├── app/
│   ├── router.ts, routes.tsx        route tree — see "Routing" below
│   ├── layout/AppShell.tsx          shell: sidebar nav + header + content outlet
│   ├── layout/HeaderBar.tsx         top bar: company/branch switcher, user menu
│   ├── layout/CompanyBranchSwitcher.tsx
│   ├── guards/RequireAuth.tsx       redirects to /login if no token
│   ├── guards/RequireFullScope.tsx  redirects if user hasn't picked company/branch yet
│   ├── dev/SchemaFormDevPage.tsx    /_dev/schema-form — dev-only fixture renderer
│   ├── dev/SchemaTableDevPage.tsx   /_dev/schema-table — dev-only fixture renderer
│   └── BootstrapStatus.tsx          "/" landing element inside the shell
│
├── core/                             ← THE reusable engine. Fix things here, not in modules/.
│   ├── schema-form/                  form renderer (see below)
│   │   ├── SchemaForm.tsx            orchestrator: fetches field-defs, builds Zod schema, RHF form
│   │   ├── FieldRenderer.tsx         maps one field-definition row to a field-type component
│   │   ├── field-types/              13 field components + registry.ts (the ONLY switch site)
│   │   ├── compile-validator.ts      field-definitions → Zod schema
│   │   ├── default-values.ts, visibility.ts, resolve-field-type.ts
│   │   └── use-field-options.ts      dropdown/lookup options (masters, static, etc.)
│   ├── schema-table/                  generic list/grid renderer
│   │   ├── SchemaTable.tsx           orchestrator: field-defs → columns, pagination, filters
│   │   ├── columns-from-fields.ts    field-definitions → AntD Table columns
│   │   ├── FilterBar.tsx
│   │   ├── use-entity-list.ts / use-entity-list-state.ts   TanStack Query + URL-synced filter/page state
│   │   └── types.ts                  SchemaTableProps, column overrides, extra columns, actions
│   ├── navigation/
│   │   ├── use-menu-tree.ts          GET /menus → tree, cached via TanStack Query
│   │   ├── NavigationMenu.tsx        renders the AntD Sider menu from that tree
│   │   ├── DynamicRoutes.tsx         matches current pathname against the menu tree at runtime
│   │   ├── menu-tree-utils.ts        flatten/lookup helpers
│   │   └── MenuBreadcrumbs.tsx
│   ├── permissions/
│   │   ├── use-permissions.ts        GET /users/me/permissions → Set<string>, usePermissions/useHasPermission
│   │   └── Can.tsx                   <Can permission="x.y.z"> declarative gate (UX only, rule 4)
│   ├── api/
│   │   ├── client.ts                 apiFetch() — fetch wrapper, Zod-validates every response
│   │   ├── endpoints.ts              SINGLE source of truth for API paths (real + MSW both use this)
│   │   ├── query-client.ts           TanStack QueryClient instance + defaults
│   │   ├── api-error.ts, error-toast.ts
│   ├── field-definitions/            client-side helpers around the field-definitions contract
│   ├── attachments/                  upload/download helpers (S3 presigned URLs via API)
│   ├── record-screen/                shared layout for a "detail" screen (header + tabs pattern)
│   └── store/                        Zustand store (auth token, selected company/branch)
│
├── modules/                          THIN. Screens compose core/, they don't reimplement it.
│   ├── auth/                         Login, accept-invitation, forced-password-change
│   ├── admin/                        Companies, Branches, Users, Roles, Field-Definitions admin,
│   │                                 Permission matrix/assignment — tenant-admin surface
│   ├── masters/                      MasterScreen.tsx + master-registry.tsx — generic CRUD over
│   │                                 every "reference master" (countries, cities, currencies, etc.)
│   ├── suppliers/                    SupplierScreen + contacts/banks sub-editors
│   ├── brokers/                      BrokerScreen + contacts/banks sub-editors (mirrors suppliers)
│   ├── purchase/                     the big one — PurchaseListScreen, PurchaseDetailScreen
│   │                                 (header/shipment/items/pricing/LME/allocations/costs/
│   │                                 invoices/attachments, all as sub-panels of one detail screen)
│   └── inventory/                    read-only stock ledger (balances + movements)
│
├── mocks/                            MSW handlers, one file per module, keyed off packages/contracts
│                                     schemas and core/api/endpoints.ts paths
├── theme/tokens.ts                    AntD theme tokens (colors, spacing) — the one place to touch
│                                      for a global look-and-feel change
└── test/                             test setup (jest-dom matchers, MSW server wiring for vitest)
```

Every `modules/*/*-registry.tsx` file (e.g. `purchase-registry.tsx`, `master-registry.tsx`) is the same pattern: it exports a `resolve<X>Screen(entry, pathname)` function that `routes.tsx` calls in sequence. That's the entire "routing table" — see Routing below.

## Routing — how a URL becomes a screen

There is **no** array of `{ path, element }` for business screens. `app/routes.tsx` only has structural routes (login, the authenticated shell, dev-only fixture pages). Everything else goes through `core/navigation/DynamicRoutes.tsx`:

1. `use-menu-tree.ts` fetches `GET /menus` — a tree the backend builds from the tenant's enabled modules + the user's role permissions.
2. `DynamicRoutes` flattens that tree and, for the current `pathname`, looks for a matching entry.
3. If found, it calls each module's `resolve<X>Screen(entry, pathname)` in turn (wired together in `routes.tsx`'s `resolveScreen` prop) until one returns a `ReactElement`.
4. If nothing matches, `NotFoundPage`.

This means: **to add a new screen, you add a menu row on the backend (or ask for one) and a resolver in the relevant module's registry** — you do not add a `<Route>`. `purchase-registry.tsx` (read above) is the best example of a module whose real paths (`/purchase/orders/new`, `/purchase/orders/:id`) go beyond its single seeded menu row — it pattern-matches sub-paths of the one row that IS in the menu tree.

## The field-definitions engine (drives both SchemaForm and SchemaTable)

Backend exposes `GET /field-definitions/:module/:entity` → an ordered list of field rows: `fieldKey, label, dataType/fieldType, isMandatory, isEditable, isSystem, sortOrder, optionsSource, visibility rules, ...` (see `packages/contracts/src/field-definitions.ts` for the exact shape — read it before touching anything in `schema-form/` or `schema-table/`).

**Three field tiers** (CLAUDE.md's model, mirrored 1:1 in the frontend):
- **Tier 1 Fixed** — real typed column, ~85% of fields (rate, quantity, exchange rate). Still driven by field-definitions for label/order/visibility, just not renamable at the DB level.
- **Tier 2 Configurable** — real column PLUS a field-definitions row that can override label/visibility/mandatory/order. This is the mechanism behind "the client renamed a field via admin UI and it changed everywhere, including validation" — it's not magic, it's literally re-fetching field-definitions and recompiling the Zod schema.
- **Tier 3 Custom** (JSONB custom fields) — **not built, not in scope.** If a UI task seems to need an arbitrary user-defined field with no backing column, stop and ask rather than improvising a JSONB blob.

**SchemaForm** (`core/schema-form/SchemaForm.tsx`) pipeline: fetch field-definitions for `(module, entity)` → `compile-validator.ts` builds a Zod schema from it → React Hook Form with that resolver → `FieldRenderer` walks the field list and, for each row, looks up `fieldTypeRegistry[field.fieldType]` (`field-types/registry.ts`) to pick the component. **That registry file is the only legal `switch`/lookup on field type in the whole app** — 13 types, each its own component under `field-types/`: AutoGenerated, Textbox, TextArea, Dropdown, Lookup, DatePicker, Decimal, Currency, Percentage, Toggle, Calculated, FileUpload, MultiUpload. If a UI task needs a new visual treatment for an existing type, edit that type's component — don't special-case a `fieldKey` inline somewhere else.

Full field-type definitions and the client's own vocabulary for them live in `docs/spec/Purchase-V2.md` §4 ("Reference" section) — read it if you're touching field rendering.

**SchemaTable** (`core/schema-table/SchemaTable.tsx`) does the mirror-image job for lists: same field-definitions fetch → `columns-from-fields.ts` turns rows into AntD `Table` columns. `SchemaTableProps` (`core/schema-table/types.ts`) lets a screen override/hide a column, splice in a column with no field-definitions backing (`extraColumns` — e.g. Purchase's system-controlled `status` badge), add filters, and add row actions gated by permission. This is the file to read first if a UI task is "add a column" or "change how a column renders" — there's almost always a `columns`/`extraColumns` override available before you'd need to touch the generic renderer itself.

## Permissions in the UI

`usePermissions()` / `useHasPermission(key)` (`core/permissions/use-permissions.ts`) fetch `GET /users/me/permissions` once (5 min stale time) and expose a `Set<string>`. `<Can permission="purchase.po.approve">...</Can>` is the declarative wrapper. **This is UX only** (frontend rule 4) — it hides/disables buttons so users don't hit a 403, but the backend is the real enforcement. Never invent client-side role logic (`if (user.role === 'admin')` — that pattern is explicitly banned, it's the RBAC middleware's job on the backend).

A related, newer pattern worth knowing: for actions that would be *rejected for business reasons* (not just permission reasons) — e.g. "this LME record is already used by a purchase item, so it can't be edited" — the **backend computes and returns a flag** (e.g. `isUsed`) alongside the row, and the UI greys out the action with an explanatory tooltip rather than showing a raw error after the fact. See `PurchaseDetailScreen.tsx`'s `PurchaseSubResourceList` component (used by both the LME Records and Customer Allocation tables) for the reference implementation — `rowLocked`, `editDeleteReadOnly` props derived from server-sent usage flags.

## Purchase module — the largest, most representative screen

`modules/purchase/PurchaseDetailScreen.tsx` is one big detail screen composed of many sub-panels (all still going through SchemaForm/SchemaTable underneath): header/shipment fields, supplier details, purchase items, purchase pricing, LME records, customer allocations, additional costs, hedges, invoices, attachments. If you're improving UI/UX broadly, this file is both the best example of the established patterns AND the screen most likely to benefit from layout/UX work (it's functionally complete but was built prompt-by-prompt, backend-first — there's real room for better information hierarchy, tab/section organization, etc.).

`docs/spec/Purchase-V2.md` is the authoritative field-by-field spec for this module (sub-tabs: Supplier Creation, Record Purchase, Platform Hedging/LME Records) — read §1-4 before restructuring anything here. §5 is an explicit list of open business-rule questions that are **not yet answered** — don't infer answers to those from the current UI.

## Mocking (MSW)

`VITE_USE_MOCKS=true` (see `.env.example` at repo root — Vite's `envDir` points there, not at `apps/web/`) runs the entire app against MSW with zero backend. `mocks/handlers.ts` aggregates per-module handler files (`masters-handlers.ts`, `purchase-handlers.ts`, etc.), each keyed off the same `endpoints.ts` paths and validated against the same `packages/contracts` Zod schemas the real API uses — so a UI change that breaks the contract breaks the mock too, not just prod. `masters-handlers.ts` is the clearest example of the "generate handlers from a registry" pattern (`MASTER_REGISTRY.flatMap(...)`) if you need to add mock coverage for a new entity.

This is genuinely useful for UI-only work: you can iterate on layout/interaction without the full docker-compose backend running. Toggle mocks in `.env` (or `.env.deploy.local`/`.env.test` for other targets — see the four env files at repo root).

## Types

**Never redeclare an API type inside `apps/web`.** Everything comes from `packages/contracts` (`@ikration/contracts` workspace package) — Zod schemas plus inferred TS types, imported by both `apps/api` and `apps/web` so they can't drift. If a UI task needs a field the current contract doesn't expose, the fix is adding it to `packages/contracts/src/*.ts`, not widening a local interface or using `as`.

## Testing conventions worth knowing before writing/editing tests

- Real Postgres/Redis for backend tests (not relevant to `apps/web`, but explains why the project takes "never mock the DB" seriously — the same "don't fake the boundary you're testing" instinct shows up here as "MSW handlers validate against real contracts," not ad hoc fixtures).
- AntD `Popconfirm`'s default confirm/cancel buttons are labeled **"OK"/"Cancel"**, not "Yes"/"No" — easy to get wrong in a new test.
- AntD `Drawer` with `destroyOnHidden` can still render a stale `role="dialog"` briefly during its closing animation even after a new drawer opens. If a test opens one drawer after closing another, grab the **last** dialog (`screen.getAllByRole("dialog").at(-1)`) or explicitly wait for the new drawer's own title text before interacting, or you'll get flaky "multiple elements" failures.
- Avoid annotating a test helper's return type as `ReturnType<typeof within>` in this repo — this codebase's ESLint config (not `tsc` itself) silently degrades all downstream member access on that return value to `any` for type-aware lint rules. Have helpers return the raw `HTMLElement` and call `within(...)` inline at each call site instead (see the existing pattern in `PurchaseFlow.test.tsx`).
- Component tests for the big flows (e.g. `PurchaseFlow.test.tsx`) run long — some are given explicit extended timeouts (up to 120s). Don't be surprised by that; it's deliberate, not a hang.

## Known rough edges / things NOT to assume are finished

- `docs/PROJECT-STATUS.md` at repo root is **stale** (it predates `apps/web` existing at all) — do not use it as a source of current state; it's kept only as a historical snapshot. Trust the code and `git log`, not that file.
- Playwright is a declared stack choice but e2e coverage may be thin or absent — check `apps/web/package.json` and search for `*.spec.ts` under a playwright config before assuming end-to-end tests exist for a flow you're touching.
- Tier 3 (custom JSONB fields) is explicitly out of scope — if a UI request implies it, stop and ask rather than build toward it.
- There is a known, **unresolved** data-integrity item on the backend side (a handful of `lme_records` rows computed under an old, incorrect formula, both locally and on the deploy) — not a frontend concern, but if you're building UI around LME records, know that a small number of legacy rows may show numbers computed under the old (now-fixed) formula until that's explicitly resolved.

## Deploy (context, not something UI work usually triggers)

There is no CI/CD pipeline. Production (droplet `159.89.167.57`) is updated by hand: rsync source → `docker compose build` the `api`/`worker` images → restart containers → run tenant migrations inside the container → separately, `vite build --mode deploy` the frontend and rsync `apps/web/dist/` into the `caddy` container's served directory. If UI work needs to go live, budget for this manual process (or ask whoever's been running it) — it's not a `git push` away.
