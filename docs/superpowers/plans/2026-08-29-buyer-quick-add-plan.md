# Buyer Quick-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add a new Buyer (tenant company) inline from the Purchase form's Buyer dropdown, via a "+ Add" option, instead of needing to leave the form and use the full Companies admin screen.

**Architecture:** Buyer switches from a plain `Dropdown` field to the existing `Lookup` field type (already used by `containerId`), and `allowCreate` — today a code-only flag — becomes a real, per-company `field_definitions` column so it flows through the same read/write/seed path as `label`/`isVisible`/`isMandatory`. `LookupField`'s inline-create handler, which today assumes every create target is a generic master (`POST /masters/:key` + `{code,name}`), gains a small routing table so `companies` (and only `companies`, for now) posts to its own endpoint with its own minimal payload. `POST /companies` is relaxed to accept a name-only company (country/currency added later via the full Companies screen).

**Tech Stack:** Express 5, Drizzle ORM (Postgres, tenant-schema migrations), Zod, React 19 + Ant Design v5 Select, TanStack Query v5, React Hook Form, Vitest + Testing Library + Supertest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-08-29-buyer-quick-add-design.md`

## Global Constraints

- Money/tenant/RBAC rules (CLAUDE.md rules 1-10) are unaffected by this work — no new money fields, no cross-tenant query, no new `SET search_path` call, no new SQL outside a repository/mutation module.
- Frontend rule 1: no hardcoded field label/type — Buyer's new `fieldType`/`allowCreate` values are set in `core/field-engine/defaults.ts` (the existing code-declared source of truth for Tier 2 fields), never inline in a component.
- Frontend rule 6: one component per field type, in `field-types/registry.ts` — no new field type is introduced; Buyer reuses the existing `Lookup` → `LookupField` mapping.
- Frontend rule 7: types come from `packages/contracts` — no type is redeclared in `apps/web`.
- `.strict()` Zod schemas stay `.strict()` — new optional fields are added explicitly, never loosened generically.
- No new dependency, no new RBAC permission. Reuse `admin.company.create` (already gates `POST /companies`) unchanged.

---

### Task 1: Add `allow_create` column to `field_definitions`

**Files:**
- Modify: `apps/api/src/database/tenant/schema.ts:764-795` (`fieldDefinitions` table)
- Create: a new Drizzle migration under `apps/api/src/database/tenant/migrations/` (generated, not hand-written)

**Interfaces:**
- Produces: `fieldDefinitions.allowCreate` (Drizzle column, `boolean`, `not null default false`) — consumed by Task 3 (read) and Task 4 (write).

- [ ] **Step 1: Add the column to the Drizzle table definition**

In `apps/api/src/database/tenant/schema.ts`, inside the `fieldDefinitions` table's column list (right after `isSystem`, before the audit columns spread):

```ts
    // System fields cannot be hidden or made optional (see isSystem's own
    // comment above). This one has no such is_system guard: any non-system
    // Lookup field can be toggled - see core/field-engine/mutations.ts.
    isSystem: boolean("is_system").notNull().default(false),
    /** Lookup only, ignored otherwise - lets this field's "+ Add" quick-create the referenced record inline (core/schema-form/field-types/LookupField.tsx). Company-overridable, same tier as label/isVisible/isMandatory - not structural like dataType. */
    allowCreate: boolean("allow_create").notNull().default(false),
    ...auditColumns(),
```

- [ ] **Step 2: Generate the migration**

Run: `cd apps/api && pnpm db:tenant:generate`

This produces a new numbered file in `apps/api/src/database/tenant/migrations/` (next after `0036_...sql`) containing `ALTER TABLE "field_definitions" ADD COLUMN "allow_create" boolean DEFAULT false NOT NULL;`. Open the generated file and confirm that's the only change.

- [ ] **Step 3: Verify the migration applies cleanly**

Run: `pnpm --filter api test -- field-engine.test.ts`

Expected: PASS (existing tests, unaffected by this column so far — this just proves the new migration applies against the Testcontainers Postgres without breaking tenant provisioning).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/tenant/schema.ts apps/api/src/database/tenant/migrations/
git commit -m "feat(api): add allow_create column to field_definitions"
```

---

### Task 2: Make `allowCreate` a company-overridable wire property (contracts + validator)

**Files:**
- Modify: `packages/contracts/src/field-definitions.ts:134-135` (`fieldDefinitionSchema.allowCreate` comment), `:197-204` (`updateFieldDefinitionRequestSchema`)
- Modify: `apps/api/src/modules/field-definitions/field-definitions.validator.ts` (`updateFieldDefinitionSchema`)

**Interfaces:**
- Produces: `UpdateFieldDefinitionRequest.allowCreate?: boolean` and `UpdateFieldDefinitionRequestBody.allowCreate?: boolean` — consumed by Task 4's `updateFieldDefinition` and Task 9's admin screen.

- [ ] **Step 1: Update the contracts doc comment and PATCH schema**

In `packages/contracts/src/field-definitions.ts`, replace the `allowCreate` line in `fieldDefinitionSchema`:

```ts
  /** Lookup only - lets the field's Select create a new row in the referenced master inline when nothing matches (core/schema-form/field-types/LookupField.tsx), instead of requiring pre-registration. Company-overridable via PATCH /field-definitions/:id, same as label/isVisible/isMandatory. */
  allowCreate: z.boolean().optional(),
```

And add `allowCreate` to `updateFieldDefinitionRequestSchema`:

```ts
export const updateFieldDefinitionRequestSchema = z
  .object({
    label: z.string().min(1).optional(),
    isVisible: z.boolean().optional(),
    isMandatory: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    allowCreate: z.boolean().optional(),
  })
  .strict();
```

- [ ] **Step 2: Mirror the change in the API's own validator**

In `apps/api/src/modules/field-definitions/field-definitions.validator.ts`:

```ts
export const updateFieldDefinitionSchema = z
  .object({
    label: z.string().min(1).optional(),
    isVisible: z.boolean().optional(),
    isMandatory: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    allowCreate: z.boolean().optional(),
  })
  .strict();
```

- [ ] **Step 3: Type-check both packages**

Run: `pnpm --filter @ikration/contracts build && pnpm --filter api exec tsc --noEmit`

Expected: no errors (nothing consumes `allowCreate` from the PATCH body yet — Task 4 wires that up).

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/field-definitions.ts apps/api/src/modules/field-definitions/field-definitions.validator.ts
git commit -m "feat(contracts,api): allow allowCreate in the field-definitions PATCH schema"
```

---

### Task 3: `resolve.ts` honors a row's `allowCreate` override

**Files:**
- Modify: `apps/api/src/core/field-engine/resolve.ts:14-46` (`mergeRow`)
- Test: `apps/api/src/core/field-engine/__tests__/field-engine.test.ts`

**Interfaces:**
- Consumes: `fieldDefinitions.allowCreate` (Task 1)
- Produces: `EffectiveField.allowCreate` now reflects the company's row, not just the code default — consumed by Task 6's Buyer default and by the frontend's `LookupField`/`FieldDefinitionsScreen`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/core/field-engine/__tests__/field-engine.test.ts` (near the other `mergeRow`-exercising tests):

```ts
  it(
    "a field_definitions row's allowCreate overrides the code default",
    async () => {
      const seed = await seedTenantWithUser("field-allow-create-override");

      await withTenantSchema(seed.tenant.schemaName, (tx) =>
        tx
          .update(fieldDefinitions)
          .set({ allowCreate: true })
          .where(
            and(
              eq(fieldDefinitions.companyId, seed.companyId),
              eq(fieldDefinitions.module, "purchase"),
              eq(fieldDefinitions.entity, "header"),
              eq(fieldDefinitions.fieldKey, "supplierId"),
            ),
          ),
      );

      const ctx = ctxFor(seed);
      const fields = await resolveFieldDefinitions(ctx, "purchase", "header");
      const supplierId = fields.find((f) => f.fieldKey === "supplierId");
      expect(supplierId?.allowCreate).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
```

(`supplierId`'s code default has no `allowCreate` set, i.e. `undefined`/falsy — this proves the row, not the code default, now wins.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test -- field-engine.test.ts -t "allowCreate overrides"`
Expected: FAIL — `supplierId?.allowCreate` is `undefined`, not `true` (mergeRow doesn't read the row's `allowCreate` yet).

- [ ] **Step 3: Fix `mergeRow`**

In `apps/api/src/core/field-engine/resolve.ts`, add one line to the object `mergeRow` returns:

```ts
  return {
    ...fallback,
    id: row.id,
    label: row.label,
    isVisible: row.isVisible,
    isMandatory: row.isMandatory,
    isEditable: row.isEditable,
    defaultValue: row.defaultValue ?? undefined,
    allowCreate: row.allowCreate,
    optionsSource: row.optionsSource ?? fallback.optionsSource,
    validationJson: row.validationJson ?? undefined,
    sortOrder: row.sortOrder,
    isSystem: row.isSystem,
  };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test -- field-engine.test.ts`
Expected: PASS (full file, to confirm no regression in the neighboring `optionsSource`/`isSystem` tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/field-engine/resolve.ts apps/api/src/core/field-engine/__tests__/field-engine.test.ts
git commit -m "feat(api): resolve field_definitions.allow_create as a per-company override"
```

---

### Task 4: PATCH `/field-definitions/:id` accepts and persists `allowCreate`

**Files:**
- Modify: `apps/api/src/core/field-engine/mutations.ts` (`UpdateFieldDefinitionInput`, `updateFieldDefinition`)
- Modify: `apps/api/src/modules/field-definitions/field-definitions.service.ts` (`updateFieldDefinition`)
- Test: `apps/api/src/modules/field-definitions/__tests__/field-definitions.test.ts`

**Interfaces:**
- Consumes: `UpdateFieldDefinitionRequestBody.allowCreate` (Task 2)
- Produces: `PATCH /field-definitions/:id` with `{allowCreate: boolean}` in the body persists it and returns it via the next `GET /field-definitions/:module/:entity` — consumed by Task 9's admin screen.

- [ ] **Step 1: Make the test file's response schema accept `allowCreate`**

`effectiveFieldSchema` near the top of `apps/api/src/modules/field-definitions/__tests__/field-definitions.test.ts` (the Zod shape `fetchFields`/`fetchOrderedFields` parse every response through) doesn't declare `allowCreate` yet, so it gets silently stripped from every parsed result. Add it:

```ts
const effectiveFieldSchema = z.object({
  id: z.string().nullable().optional(),
  fieldKey: z.string(),
  label: z.string(),
  dataType: z.string(),
  isVisible: z.boolean(),
  isMandatory: z.boolean(),
  isEditable: z.boolean(),
  isSystem: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  optionsSource: z.union([z.string(), staticOptionsSourceSchema]).optional(),
  fieldType: z.string().optional(),
  allowCreate: z.boolean().optional(),
});
```

- [ ] **Step 2: Write the failing test**

Add near the existing `"PATCH updates isVisible, isMandatory, and sortOrder together on a non-system field"` test, following that same test's exact `createApp()`/`authHeader`/`fetchFields` pattern (there is no `admin.app` — each test builds its own `app` from `createApp()`):

```ts
  it(
    "PATCH updates allowCreate on a field",
    async () => {
      const admin = await seedTenantWithAdmin("fd-allow-create", [
        "field_definitions.field.read",
        "admin.field.manage",
      ]);
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      const before = await fetchFields(admin, "purchase", "header");
      const containerId = before.find((f) => f.fieldKey === "containerId");
      if (!containerId?.id) {
        throw new Error("expected containerId to have a real provisioned id");
      }

      const patchRes = await request(app)
        .patch(`/api/v1/field-definitions/${containerId.id}`)
        .set("Authorization", authHeader)
        .send({ allowCreate: true });
      expect(patchRes.status).toBe(200);

      const after = await fetchFields(admin, "purchase", "header");
      expect(after.find((f) => f.fieldKey === "containerId")?.allowCreate).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
```

This PATCHes `allowCreate: true` regardless of whatever value provisioning happened to seed it with, so it stays valid however Task 5/6 land relative to this one.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter api test -- field-definitions.test.ts -t "allowCreate"`
Expected: FAIL — `after.find(...)?.allowCreate` is `undefined`/unchanged (the validator already accepts `allowCreate` from Task 2, but the service/mutation silently drops it before it reaches the database).

- [ ] **Step 4: Wire `allowCreate` through the mutation**

In `apps/api/src/core/field-engine/mutations.ts`:

```ts
export interface UpdateFieldDefinitionInput {
  id: string;
  companyId: string;
  schemaName: string;
  label?: string;
  isVisible?: boolean;
  isMandatory?: boolean;
  sortOrder?: number;
  allowCreate?: boolean;
  updatedBy: string;
}
```

In the `.set({...})` call:

```ts
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
        ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.allowCreate !== undefined ? { allowCreate: input.allowCreate } : {}),
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
        version: existing.version + 1,
      })
```

And in the audit log's `before`/`after`:

```ts
      before: {
        label: existing.label,
        isVisible: existing.isVisible,
        isMandatory: existing.isMandatory,
        sortOrder: existing.sortOrder,
        allowCreate: existing.allowCreate,
      },
      after: {
        label: row.label,
        isVisible: row.isVisible,
        isMandatory: row.isMandatory,
        sortOrder: row.sortOrder,
        allowCreate: row.allowCreate,
      },
```

- [ ] **Step 5: Pass it through the service**

In `apps/api/src/modules/field-definitions/field-definitions.service.ts`:

```ts
export async function updateFieldDefinition(
  ctx: RequestContext,
  id: string,
  input: UpdateFieldDefinitionRequestBody,
) {
  const scope = requireTenantScope(ctx);
  return coreUpdateFieldDefinition({
    id,
    companyId: scope.companyId,
    schemaName: scope.tenantSchema,
    updatedBy: scope.userId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
    ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.allowCreate !== undefined ? { allowCreate: input.allowCreate } : {}),
  });
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter api test -- field-definitions.test.ts`
Expected: PASS (full file).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core/field-engine/mutations.ts apps/api/src/modules/field-definitions/field-definitions.service.ts apps/api/src/modules/field-definitions/__tests__/field-definitions.test.ts
git commit -m "feat(api): persist allowCreate through PATCH /field-definitions/:id"
```

---

### Task 5: Provisioning seeds and re-seeds `allowCreate`

**Files:**
- Modify: `apps/api/src/core/provisioning/seed-field-definitions.ts`
- Test: `apps/api/src/core/field-engine/__tests__/field-engine.test.ts`

**Interfaces:**
- Consumes: `FieldDefault.allowCreate` (already exists in `core/field-engine/types.ts`)
- Produces: every company's `field_definitions` rows carry the code-declared `allowCreate` from day one, and a re-seed refreshes it when the code default changes — consumed by Task 6 (flipping Buyer's default) and by real tenant onboarding.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/core/field-engine/__tests__/field-engine.test.ts`, right after the existing `"re-seeding refreshes a field's optionsSource when its code default has changed"` test (same shape, but for `allowCreate` — pick a field whose code default doesn't have `allowCreate` set yet, e.g. `supplierId`, and simulate a stale `true` a previous seed left behind):

```ts
  it(
    "re-seeding refreshes a field's allowCreate when its code default has changed",
    async () => {
      const seed = await seedTenantWithUser("field-allow-create-refresh");

      await withTenantSchema(seed.tenant.schemaName, (tx) =>
        tx
          .update(fieldDefinitions)
          .set({ allowCreate: true })
          .where(
            and(
              eq(fieldDefinitions.companyId, seed.companyId),
              eq(fieldDefinitions.module, "purchase"),
              eq(fieldDefinitions.entity, "header"),
              eq(fieldDefinitions.fieldKey, "supplierId"),
            ),
          ),
      );

      await seedDefaultFieldDefinitions({ schemaName: seed.tenant.schemaName, companyId: seed.companyId, createdBy: seed.userId });

      const ctx = ctxFor(seed);
      const fields = await resolveFieldDefinitions(ctx, "purchase", "header");
      const supplierId = fields.find((f) => f.fieldKey === "supplierId");
      expect(supplierId?.allowCreate).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
```

(`supplierId`'s code default has no `allowCreate` — re-seeding should reset the stale `true` back to `false`, exactly like the existing `optionsSource` refresh test proves for that column.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test -- field-engine.test.ts -t "allowCreate when its code default"`
Expected: FAIL — `supplierId?.allowCreate` stays `true` (the re-seed's `onConflictDoUpdate` doesn't touch this column yet).

- [ ] **Step 3: Add `allowCreate` to both the insert and the re-seed `set`**

In `apps/api/src/core/provisioning/seed-field-definitions.ts`, add to the `.values({...})` call:

```ts
        .values({
          companyId: input.companyId,
          module: field.module,
          entity: field.entity,
          fieldKey: field.fieldKey,
          label: field.label,
          dataType: field.dataType,
          isVisible: field.isVisible,
          isMandatory: field.isMandatory,
          isEditable: field.isEditable,
          sortOrder: field.sortOrder,
          isSystem: field.isSystem,
          allowCreate: field.allowCreate ?? false,
          createdBy: input.createdBy,
          ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
          ...(typeof field.optionsSource === "string" ? { optionsSource: field.optionsSource } : {}),
          ...(field.validationJson !== undefined ? { validationJson: field.validationJson } : {}),
        })
```

And to the `onConflictDoUpdate`'s `set`:

```ts
          set: {
            label: field.label,
            isVisible: field.isVisible,
            isMandatory: field.isMandatory,
            isEditable: field.isEditable,
            sortOrder: field.sortOrder,
            isSystem: field.isSystem,
            allowCreate: field.allowCreate ?? false,
            optionsSource: typeof field.optionsSource === "string" ? field.optionsSource : null,
            defaultValue: field.defaultValue ?? null,
            updatedBy: input.createdBy,
            updatedAt: new Date(),
          },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test -- field-engine.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/provisioning/seed-field-definitions.ts apps/api/src/core/field-engine/__tests__/field-engine.test.ts
git commit -m "feat(api): seed and re-seed field_definitions.allow_create from the code default"
```

---

### Task 6: Buyer becomes a Lookup field with `allowCreate: true`

**Files:**
- Modify: `apps/api/src/core/field-engine/defaults.ts:728-741` (`buyerId` `FieldDefault`)
- Test: `apps/api/src/core/field-engine/__tests__/field-engine.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 5 (resolve + seed now honor `allowCreate`)
- Produces: `GET /field-definitions/purchase/header`'s `buyerId` entry now has `fieldType: "Lookup", allowCreate: true` — consumed by Task 8's frontend `LookupField`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/core/field-engine/__tests__/field-engine.test.ts`:

```ts
  it(
    "buyerId resolves as a Lookup field with allowCreate",
    async () => {
      const seed = await seedTenantWithUser("field-buyer-lookup");
      const ctx = ctxFor(seed);
      const fields = await resolveFieldDefinitions(ctx, "purchase", "header");
      const buyerId = fields.find((f) => f.fieldKey === "buyerId");
      expect(buyerId?.fieldType).toBe("Lookup");
      expect(buyerId?.allowCreate).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test -- field-engine.test.ts -t "buyerId resolves as a Lookup"`
Expected: FAIL — `buyerId?.fieldType` is `undefined`, `buyerId?.allowCreate` is `undefined`.

- [ ] **Step 3: Update the code default**

In `apps/api/src/core/field-engine/defaults.ts`:

```ts
  {
    module: "purchase",
    entity: "header",
    fieldKey: "buyerId",
    section: "purchaseInfo",
    label: "Buyer",
    fieldType: "Lookup",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    isSystem: false,
    sortOrder: 4,
    optionsSource: "companies",
    allowCreate: true,
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test -- field-engine.test.ts`
Expected: PASS. Also run the broader field-definitions suite since it asserts on `purchase/header`'s field list:

Run: `pnpm --filter api test -- field-definitions.test.ts`
Expected: PASS (the existing `{fieldKey, isMandatory}`-only assertions are unaffected by `fieldType`/`allowCreate`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/field-engine/defaults.ts apps/api/src/core/field-engine/__tests__/field-engine.test.ts
git commit -m "feat(api): make Buyer a Lookup field with inline quick-create"
```

---

### Task 7: `POST /companies` accepts a name-only company

**Files:**
- Modify: `apps/api/src/modules/companies/companies.validator.ts` (`createCompanySchema`)
- Test: `apps/api/src/modules/companies/__tests__/companies.test.ts`

**Interfaces:**
- Produces: `CreateCompanyInput` no longer requires `countryId`/`currencyId` — consumed by Task 8's frontend quick-create payload (`{name, fiscalYearStartMonth, timezone}`).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/modules/companies/__tests__/companies.test.ts`, near the existing `"creates a company"`-style test:

```ts
  it(
    "creates a minimal company with only name, fiscalYearStartMonth, and timezone (quick-add)",
    async () => {
      const tenant = await seedTenant("quick-add");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app)
        .post("/api/v1/companies")
        .set("Authorization", authHeader)
        .send({ name: "Acme Holdings Ltd", fiscalYearStartMonth: 1, timezone: "UTC" });

      expect(res.status).toBe(201);
      const created = asCompany(res);
      expect(created.name).toBe("Acme Holdings Ltd");
      expect(created.countryId).toBeNull();
      expect(created.currencyId).toBeNull();
      expect(created.status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api test -- companies.test.ts -t "quick-add"`
Expected: FAIL with a 422 (`createCompanySchema` currently requires `countryId`/`currencyId`).

- [ ] **Step 3: Relax the validator**

In `apps/api/src/modules/companies/companies.validator.ts`:

```ts
export const createCompanySchema = z
  .object({
    name: z.string().min(1).max(200),
    countryId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
    timezone: z.string().min(1),
    taxRegistrationNo: z.string().min(1).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter api test -- companies.test.ts`
Expected: PASS (full file — confirms the existing full-payload `"creates a company"` test still passes unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/companies/companies.validator.ts apps/api/src/modules/companies/__tests__/companies.test.ts
git commit -m "feat(api): allow creating a company without country/currency"
```

---

### Task 8: `LookupField` routes non-master creates to their own endpoint; Buyer gets "+ Add"

**Files:**
- Modify: `apps/web/src/core/schema-form/use-field-options.ts` (add `NON_MASTER_CREATE_ENDPOINTS`)
- Modify: `apps/web/src/core/schema-form/field-types/LookupField.tsx` (`handleChange`)
- Modify: `apps/web/src/mocks/purchase-handlers.ts:21` (`HEADER_FIELDS.buyerId` mock)
- Test: `apps/web/src/modules/purchase/PurchaseFlow.test.tsx`

**Interfaces:**
- Consumes: `endpoints.companies` (already exists in `apps/web/src/core/api/endpoints.ts`)
- Produces: `NON_MASTER_CREATE_ENDPOINTS: Record<string, { endpoint: string; buildPayload: (name: string) => Record<string, unknown> }>`, exported from `use-field-options.ts` for `LookupField.tsx` to consume.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/modules/purchase/PurchaseFlow.test.tsx`, near `createContainerInline`:

```ts
/** Buyer is a Lookup field with allowCreate whose target (companies) is NOT a generic master - this proves LookupField routes its create POST to /companies with a minimal payload instead of the generic /masters/companies + {code,name}. */
async function createBuyerInline(user: ReturnType<typeof userEvent.setup>, buyerName: string): Promise<void> {
  const combobox = await screen.findByRole("combobox", { name: "Buyer" }, ASYNC);
  await user.click(combobox);
  await user.type(combobox, buyerName);
  await user.click(await screen.findByText(`+ Add "${buyerName}"`, {}, ASYNC));
}
```

And a new test:

```ts
describe("Purchase - Buyer quick-add", () => {
  it(
    "creating a new Buyer inline adds a company and selects it without leaving the form",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: [`${PURCHASE_LIST_PATH}/new`] });

      await screen.findByLabelText("Purchase Date", {}, ASYNC);
      await createBuyerInline(user, "Acme Holdings Ltd");

      expect(await screen.findByText("Acme Holdings Ltd", {}, ASYNC)).toBeInTheDocument();
    },
    ASYNC.timeout,
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test -- PurchaseFlow.test.tsx -t "Buyer quick-add"`
Expected: FAIL — today Buyer is a plain `Dropdown` (no combobox typing/`+ Add` support), and even after Task 6 makes it a `Lookup` in the real backend, the web mock (`purchase-handlers.ts`) still serves the old shape, and `LookupField`'s create handler would wrongly POST to `/masters/companies` (which the mock doesn't register), so the option never appears.

- [ ] **Step 3: Update the mock to match the new backend default**

In `apps/web/src/mocks/purchase-handlers.ts`, change the `buyerId` entry:

```ts
    { fieldKey: "buyerId", label: "Buyer", fieldType: "Lookup", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4, optionsSource: "companies", allowCreate: true },
```

- [ ] **Step 4: Add the non-master create routing table**

In `apps/web/src/core/schema-form/use-field-options.ts`, right after `NON_MASTER_OPTIONS_ENDPOINTS`:

```ts
export interface NonMasterCreateConfig {
  endpoint: string;
  buildPayload: (name: string) => Record<string, unknown>;
}

/** Non-master options sources whose "+ Add" quick-create (LookupField.tsx) needs a different endpoint/payload than the generic POST /masters/<key> + {code,name} - currently just Buyer's companies. Anything absent from this map keeps using the generic masters create path. */
export const NON_MASTER_CREATE_ENDPOINTS: Record<string, NonMasterCreateConfig> = {
  companies: {
    endpoint: endpoints.companies,
    buildPayload: (name) => ({ name, fiscalYearStartMonth: 1, timezone: "UTC" }),
  },
};
```

- [ ] **Step 5: Use the routing table in `LookupField`'s create handler**

In `apps/web/src/core/schema-form/field-types/LookupField.tsx`, change the import:

```ts
import { NON_MASTER_CREATE_ENDPOINTS, useFieldOptions } from "../use-field-options";
```

Remove the now-unused import:

```ts
import type { MasterOption } from "@ikration/contracts";
```

And replace `handleChange`:

```ts
  async function handleChange(value: string): Promise<void> {
    if (value !== CREATE_OPTION_VALUE) {
      rhf.onChange(value);
      return;
    }
    setIsCreating(true);
    try {
      const createConfig = NON_MASTER_CREATE_ENDPOINTS[masterKey];
      const endpoint = createConfig ? createConfig.endpoint : `/masters/${masterKey}`;
      const body = createConfig ? createConfig.buildPayload(trimmedSearch) : { code: trimmedSearch, name: trimmedSearch };
      const created = await apiFetch<{ id: string }>(endpoint, { method: "POST", body });
      await queryClient.invalidateQueries({ queryKey: ["field-options", masterKey] });
      rhf.onChange(created.id);
      setSearchInput("");
    } finally {
      setIsCreating(false);
    }
  }
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter web test -- PurchaseFlow.test.tsx`
Expected: PASS (full file — confirms the existing `fillHeaderAndShipment`-based tests, which still `selectOption` an existing Buyer rather than creating one, keep working since `LookupField` still supports selecting a pre-existing option the same way `DropdownField` did).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/core/schema-form/use-field-options.ts apps/web/src/core/schema-form/field-types/LookupField.tsx apps/web/src/mocks/purchase-handlers.ts apps/web/src/modules/purchase/PurchaseFlow.test.tsx
git commit -m "feat(web): route Buyer's inline quick-create to POST /companies"
```

---

### Task 9: Admin Field Definitions screen gets an "Allow Create" toggle

**Files:**
- Modify: `apps/web/src/modules/admin/FieldDefinitionsScreen.tsx`
- Test: `apps/web/src/modules/admin/FieldDefinitionsScreen.test.tsx`

**Interfaces:**
- Consumes: `FieldDefinition.fieldType`/`allowCreate` (already in `packages/contracts`), `PATCH /field-definitions/:id` with `allowCreate` (Task 4)
- Produces: a company admin can toggle `allowCreate` for any Lookup field without a deploy — the end-to-end point of Task 1-5's DB/API work.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/modules/admin/FieldDefinitionsScreen.test.tsx`, near the existing `"is_system rows show disabled Visible/Mandatory toggles"` test:

```ts
  it(
    "Allow Create is enabled only for Lookup fields, and toggling it saves",
    async () => {
      signIn();
      const user = userEvent.setup();
      renderApp({ routes: testRoutes, initialEntries: ["/"] });

      await selectModuleEntity(user, "purchase / header");
      await screen.findByDisplayValue("Container Number", {}, ASYNC);

      // containerId (Lookup, allowCreate: true) - enabled and checked.
      expect(screen.getByLabelText("containerId - Allow Create")).not.toBeDisabled();
      expect(screen.getByLabelText("containerId - Allow Create")).toBeChecked();

      // branchId (Dropdown) - Allow Create isn't a meaningful toggle, so it's disabled.
      expect(screen.getByLabelText("branchId - Allow Create")).toBeDisabled();

      await user.click(screen.getByLabelText("containerId - Allow Create"));
      await user.click(screen.getByRole("button", { name: "Save field definitions" }));

      await screen.findByText("Field definitions saved", {}, ASYNC);
      expect(screen.getByLabelText("containerId - Allow Create")).not.toBeChecked();
    },
    30000,
  );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test -- FieldDefinitionsScreen.test.tsx -t "Allow Create"`
Expected: FAIL — `getByLabelText("containerId - Allow Create")` doesn't exist yet.

- [ ] **Step 3: Add the column to `FieldDefinitionsScreen.tsx`**

Extend `FieldRow`:

```ts
interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  tier: number;
  fieldType?: string;
  isVisible: boolean;
  isMandatory: boolean;
  isSystem: boolean;
  allowCreate: boolean;
  sortOrder: number;
}
```

Extend `toRows`:

```ts
function toRows(schema: FieldDefinitionsResponse): FieldRow[] {
  const fields = schema.sections ? schema.sections.flatMap((section) => section.fields) : (schema.fields ?? []);
  return fields
    .map((field) => ({
      id: field.id ?? "",
      fieldKey: field.fieldKey,
      label: field.label,
      tier: typeof field.tier === "number" ? field.tier : 2,
      fieldType: field.fieldType,
      isVisible: field.isVisible ?? true,
      isMandatory: field.isMandatory,
      isSystem: field.isSystem,
      allowCreate: field.allowCreate ?? false,
      sortOrder: field.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
```

Extend `updateRow`'s patch type:

```ts
  function updateRow(fieldKey: string, patch: Partial<Pick<FieldRow, "label" | "isVisible" | "isMandatory" | "allowCreate">>): void {
```

Extend `handleSave`'s changed-row diff and PATCH body:

```ts
    const changed = rows.filter((row) => {
      const original = originalByKey.get(row.fieldKey);
      return (
        !original ||
        original.label !== row.label ||
        original.isVisible !== row.isVisible ||
        original.isMandatory !== row.isMandatory ||
        original.sortOrder !== row.sortOrder ||
        original.allowCreate !== row.allowCreate
      );
    });
```

```ts
          apiFetch(endpoints.fieldDefinition(row.id), {
            method: "PATCH",
            body: {
              label: row.label,
              isVisible: row.isVisible,
              isMandatory: row.isMandatory,
              sortOrder: row.sortOrder,
              allowCreate: row.allowCreate,
            },
          }),
```

Add the column to the `Table`'s `columns` array, right after the `isMandatory` column:

```ts
              {
                key: "allowCreate",
                title: "Allow Create",
                render: (_value: unknown, row: FieldRow) =>
                  row.fieldType === "Lookup" ? (
                    <Checkbox
                      aria-label={`${row.fieldKey} - Allow Create`}
                      checked={row.allowCreate}
                      onChange={(event) => updateRow(row.fieldKey, { allowCreate: event.target.checked })}
                    />
                  ) : (
                    <Tooltip title="Only a Lookup field can offer inline create">
                      <Checkbox aria-label={`${row.fieldKey} - Allow Create`} checked={row.allowCreate} disabled />
                    </Tooltip>
                  ),
              },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web test -- FieldDefinitionsScreen.test.tsx`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/admin/FieldDefinitionsScreen.tsx apps/web/src/modules/admin/FieldDefinitionsScreen.test.tsx
git commit -m "feat(web): add an Allow Create toggle to the Field Definitions admin screen"
```

---

## Final verification

- [ ] Run the full backend suite: `pnpm --filter api test`
- [ ] Run the full frontend suite: `pnpm --filter web test`
- [ ] Manually smoke-test: start the app, open a new Purchase Order, type an unregistered company name into Buyer, click "+ Add", confirm it's selected; open Settings → Field Definitions → purchase/header, confirm "Allow Create" is checked and toggleable for `buyerId` and `containerId`, disabled for everything else on that entity.
