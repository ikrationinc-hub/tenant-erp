# Design: "+ Add New" quick-create for the Buyer field

Date: 2026-08-29
Status: Approved, pending implementation plan

## Context

The Purchase Order form's Buyer field renders as a plain AntD `Select`
(`DropdownField`) sourced from the tenant's own `companies` table. When a
company the user needs isn't already registered, there is no way to add it
without leaving the form, navigating to the admin Companies screen, filling
out the full company record, and coming back.

`LookupField.tsx` already implements a "+ Add" inline quick-create pattern,
but today only one field uses it (`purchase/header.containerId`), and the
flag that turns it on (`allowCreate`) is explicitly code-declared, never
company-overridable (`core/field-engine/types.ts` comment: "Code-declared
and never field_definitions-row-overridable, same as dataType"). The request
here is to extend "+ Add New" to the Buyer field, and to make that
capability a real field_definitions-backed configuration rather than a
hardcoded flag, so a tenant admin can enable/disable it without a code
deploy.

Investigation before this design surfaced two conflicts with a naive "just
flip the flag" approach, both resolved with the project owner during
brainstorming:

1. **Endpoint mismatch.** `LookupField`'s create handler always posts to
   `/masters/${masterKey}` with a `{code, name}` body — correct for a
   generic master (containers), wrong for `companies`, which is a
   first-class module with its own endpoint and validator, not a masters
   registry entry.
2. **Mandatory-fields mismatch.** `companies.validator.ts`'s
   `createCompanySchema` requires `countryId` and `currencyId` as mandatory
   UUIDs (mirrored in the Companies admin screen's own field definitions),
   which a single-text-box quick-add cannot supply. Resolved: quick-add
   creates a minimal company record with just a name; country/currency are
   left unset and completed later via the full Companies screen — the same
   as how `core/provisioning/provision-tenant.ts` already treats a brand
   new company's country/currency as backfilled-after-the-fact, not
   required at creation.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Where does `allowCreate` config live? | Real, per-company `field_definitions` DB column (not code-only) |
| How does Buyer get the "+ Add" UX? | Switch Buyer's `fieldType` from `Dropdown` to `Lookup`, reusing the existing component |
| What does "+ Add New Buyer" create? | A minimal company: name only. Country/currency/tax details are filled in later via the Companies screen |
| Scope | Buyer only. Supplier/Broker (richer entities, no minimal-payload path) are explicitly out of scope |

## Non-goals

- Generalizing quick-create to Supplier, Broker, or any other entity.
- A dedicated quick-create modal UI. The existing single-text-box "+ Add
  '<text>'" pattern is reused as-is.
- Any new RBAC permission. The existing `admin.company.create` permission
  (already gating `POST /companies`) is reused unchanged. No new
  client-side permission pre-check is added — consistent with how
  `containerId`'s existing quick-add behaves today (the POST is attempted;
  an unauthorized user gets a 403 from the existing route guard).
- Changing the Companies admin screen's own required-field UX. Its
  mandatory-field behavior comes from `field_definitions`
  (`countryId`/`currencyId`/`fiscalYearStartMonth`/`timezone` stay
  `isMandatory: true` there), untouched by this work.

## Data model

Add a new column to `field_definitions`
(`apps/api/src/database/tenant/schema.ts:764`):

```ts
allowCreate: boolean("allow_create").notNull().default(false),
```

Generated via `db:tenant:generate` (Drizzle migration, following existing
numbered-migration convention — do not hand-write the SQL file).

## Contracts (`packages/contracts/src/field-definitions.ts`)

- `fieldDefinitionSchema.allowCreate`: update its doc comment — no longer
  "Code-declared, never company-overridable"; it is now a genuine
  per-company override, same tier as `label`/`isVisible`/`isMandatory`.
- `updateFieldDefinitionRequestSchema`: add `allowCreate: z.boolean().optional()`.

## Backend (`apps/api`)

**`field-definitions.validator.ts`** — `updateFieldDefinitionSchema` gains
`allowCreate: z.boolean().optional()` (still `.strict()`; `fieldKey`,
`dataType`, `tier`, `isSystem` remain structurally absent).

**`core/field-engine/resolve.ts`** — `mergeRow` takes `allowCreate:
row.allowCreate` from the row unconditionally (same treatment as
`isVisible`/`isMandatory`/`isEditable`, not the "fall back to code default"
treatment `optionsSource` gets).

**`core/field-engine/mutations.ts`** — `UpdateFieldDefinitionInput` and
`updateFieldDefinition` gain `allowCreate?: boolean`, written through in the
same `.set({...})` call, included in the audit log's `before`/`after`
snapshots alongside the existing fields. No new guardrail needed — unlike
`isVisible`/`isMandatory`, `allowCreate` has no is-system tightening rule
(Buyer is not a system field).

**`field-definitions.service.ts`** — `updateFieldDefinition` passes
`input.allowCreate` through to the core mutation, same pattern as the three
existing fields.

**`core/provisioning/seed-field-definitions.ts`** — `seedDefaultFieldDefinitions`
adds `allowCreate: field.allowCreate ?? false` to both the insert `values`
and the `onConflictDoUpdate` `set` clause, in the same bucket as
`label`/`isVisible`/`isMandatory`/`isSystem` (company-overridable, reset to
code default on re-seed — matching existing behavior for those fields, not
`optionsSource`'s "never PATCH-able" treatment).

**`core/field-engine/defaults.ts`** — the `buyerId` `FieldDefault`
(currently at line ~731) gains:

```ts
fieldType: "Lookup",
allowCreate: true,
```

**`companies.validator.ts`** — `createCompanySchema`: `countryId` and
`currencyId` become `.optional()` (matching the DB columns, which are
already nullable per `schema.ts`'s own comment explaining why). No other
field changes. `updateCompanySchema` is already optional on both and needs
no change.

## Frontend (`apps/web`)

**`core/schema-form/use-field-options.ts`** — add a sibling map next to
`NON_MASTER_OPTIONS_ENDPOINTS` for create routing:

```ts
export const NON_MASTER_CREATE_ENDPOINTS: Record<
  string,
  { endpoint: string; buildPayload: (name: string) => Record<string, unknown> }
> = {
  companies: {
    endpoint: endpoints.companies,
    buildPayload: (name) => ({ name, fiscalYearStartMonth: 1, timezone: "UTC" }),
  },
};
```

**`core/schema-form/field-types/LookupField.tsx`** — `handleChange`'s create
branch looks up `masterKey` in `NON_MASTER_CREATE_ENDPOINTS` first; if
found, POSTs to that `endpoint` with `buildPayload(trimmedSearch)`;
otherwise falls back to today's `/masters/${masterKey}` + `{code, name}`
behavior unchanged. The created record's `.id` is used exactly as today
(`rhf.onChange(created.id)`), and the same
`queryClient.invalidateQueries({queryKey: ["field-options", masterKey]})`
call already covers `companies` since `use-field-options.ts` keys off the
same `masterKey`.

**Buyer field** requires no frontend registry change beyond this — once
`core/field-engine` returns `fieldType: "Lookup"` for `buyerId`, the
existing `field-types/registry.ts` already routes it to `LookupField`.

## Admin UI (`modules/admin/FieldDefinitionsScreen.tsx`)

- `FieldRow` gains `fieldType?: string` and `allowCreate: boolean`.
- `toRows` maps them from the response.
- A new "Allow Create" column, same shape as the existing Visible/Mandatory
  checkbox columns: enabled when `row.fieldType === "Lookup"`, otherwise
  rendered disabled (mirroring the existing `isSystem`-disabled treatment,
  but keyed on field type applicability here instead).
- `updateRow`'s patch type and `handleSave`'s changed-row diff and PATCH
  body both include `allowCreate`.

## Testing

- `apps/api/src/core/field-engine/__tests__/field-engine.test.ts`: resolve
  merges a row's `allowCreate`; re-seeding refreshes `buyerId`'s code
  default (`fieldType`/`allowCreate`) the same way the existing
  `optionsSource` refresh test does.
- `apps/api/src/modules/field-definitions/__tests__/field-definitions.test.ts`:
  PATCH accepts/persists `allowCreate`; audit log captures before/after.
- `apps/api/src/modules/companies/__tests__/companies.test.ts`: `POST
  /companies` succeeds with only `{name, fiscalYearStartMonth, timezone}`
  (no `countryId`/`currencyId`).
- `apps/web/src/modules/admin/FieldDefinitionsScreen.test.tsx`: the Allow
  Create checkbox renders, is disabled for non-Lookup fields, and PATCHes
  correctly.
- A `LookupField` test (new or extended) covering the `companies`
  create-endpoint routing: submitting a new value POSTs to `/companies`
  with the expected minimal payload, not `/masters/companies`.
- An end-to-end-ish Purchase form test: Buyer renders as a searchable
  Lookup with a working "+ Add" option.

## Rollout

Existing tenants pick up `buyerId`'s new `fieldType`/`allowCreate` via the
next `seedDefaultFieldDefinitions` re-run (same mechanism that already
carried the `optionsSource` "users" → "companies" migration), not via a
one-off backfill script.
