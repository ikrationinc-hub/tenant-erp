# 0023 - Contract document, assembly, and generation wiring

## Status

Accepted

## Context

C-3b (docs/CONTRACT-MODULE-BUILD.md, gated on C-2's GO) builds the full
contract document: templates, the header lifecycle, party resolution, the
clause-assembly snapshot, and end-to-end Word/PDF generation triggered from
a real contract. This required extending three already-built phases (C-1's
clause library, C-2's generation pipeline, C-3a's minimal header) rather
than building any of them from scratch, and surfaced several genuine design
gaps the prior phases had explicitly deferred.

## Decisions

- **`contract_templates` + `contract_template_clauses`, master-style CRUD,
  no new pattern.** A template names a division (nullable = all divisions,
  the same convention `clauses`/`contracts` already use) + a free-text
  `contractType` (no contract-type master exists or was asked for - same
  "don't invent a master beyond what's asked" discipline as
  `brokerCommissionType`). `isMandatory` lives on the join row
  (`contract_template_clauses`), not on `clauses` itself - the same clause
  can be optional in one template and mandatory in another.

- **`contract_parties` resolves directly to `suppliers`/`customers`, never
  a generic polymorphic party table.** `customers` already existed
  (Prompt 16's resolved decision, `defineMasterTable`) - the audit that
  flagged "no customers table" before this task started was simply wrong;
  no new master was needed. One row per `(contractId, partyRole)`, a CHECK
  constraint enforcing exactly one of `supplierId`/`customerId` per row -
  mirrors `purchases.supplierId`'s direct-FK convention exactly, and
  avoids inventing a cross-entity join pattern with no precedent anywhere
  in this schema.

- **`contracts` gained the real lifecycle**: gapless `contractNumber`
  (`core/numbering`, docType `"CONTRACT"`), `status`
  (`draft|approved|signed|closed`), `templateId`, `sourceType`/`sourceId`
  (LINK or STANDALONE), and `parentContractId`/`revisionNumber` as
  **columns only** - no amendment WORKFLOW (a "create new revision"
  endpoint) was built. Every contract this build creates has
  `parentContractId` null and `revisionNumber` 1; the columns exist,
  ready for whenever an amendment flow is actually requested, matching the
  user's own explicit scope decision rather than inventing an unconfirmed
  business rule (what happens to the superseded revision's own status is
  exactly the kind of thing CLAUDE.md's "when the spec is ambiguous, stop
  and ask" rule exists for).

- **LINK vs STANDALONE prefill is a ONE-TIME COPY, never a live
  reference.** `contract-source-link.ts` resolves a linked purchase's
  first item + its pricing + its shipment's incoterm into the SAME real
  columns (`materialType`/`weightKg`/`rateUsd`/`deliveryTerms`) a
  standalone contract fills in manually - both paths converge on identical
  storage, and the contract's own values are never re-read from the
  source afterward. The purchase's own later edits do not retroactively
  change an already-created contract. There is no Sales module yet, so
  `sourceType: "sale"` is accepted by the schema/validator (the enum
  value exists) but has no resolver - a contract linked to a sale 404s
  loudly at create time rather than silently prefilling nothing.

- **THE SNAPSHOT (`contract_clauses`) is written by ONE shared function**
  (`snapshotClause` in `contract-assembly.service.ts`), called from every
  path that can produce a snapshot row: template-driven assembly at create
  time, add-from-library, and re-snapshot. Each call resolves the clause's
  CURRENTLY ACTIVE version (`clauses.repository.ts`'s existing
  `findActiveVersion`, reused as-is - no new "find active version" logic
  needed) and writes `clauseVersionId`/`resolvedText` once; nothing ever
  re-reads the live clause to render a contract's own clauses afterward.
  The snapshot test (assemble, then edit the clause in the library, then
  re-fetch the contract) is exactly this invariant, and passes because the
  read path (`GET /contracts/:id`) only ever queries `contract_clauses`,
  never `clauses`/`clause_versions` directly.

- **"Update clauses to latest" re-snapshots in place** (overwrites
  `clauseVersionId`/`resolvedText` on the SAME `contract_clauses` rows,
  never delete-then-recreate) and returns a diff (`changed: boolean` per
  clause, old vs. new text) - Draft only, gated by the same `requireDraft`
  check every other assembly mutation uses. A hand-edited clause
  (`isEdited: true`) loses its edit on re-snapshot and its `isEdited` flag
  resets to `false` - this IS the point of "update to latest": discard
  drift from the library, edited or not, with the returned diff as the
  visible confirmation of what changed, never a silent overwrite.

- **Two real bugs caught by the test suite before they shipped**:
  (1) `reorderClauses`'s naive one-row-at-a-time `sortOrder` write
  collided with `contract_clauses`'s own partial unique index
  `(contractId, sortOrder)` mid-loop, since Postgres checks a unique index
  per-statement, not deferred - fixed with a two-phase write (bump every
  row to a negative, guaranteed-unique offset first, then assign final
  values), the same class of fix `clause-promotion.ts` already needed for
  the one-active-clause-version constraint. (2) A test that inserted a
  second "active" `clause_versions` row before superseding the first hit
  the same per-statement constraint-checking behavior - fixed by
  superseding first, matching the real `promoteVersion`'s own statement
  order.

- **Generation reuses C-2's `generateDocument` UNCHANGED** - it already
  took a `templateBuffer: Buffer` decoupled from where it came from, per
  its own doc comment predicting exactly this reuse. What changed:
  `ContractGenerationJobData.templateFilePath` (a local filesystem path,
  the spike's own placeholder) became `templateStorageKey` (an S3 key),
  and `contract-generation.worker.ts`'s processor now does a real S3
  `GetObjectCommand` instead of `readFile`. `generate-document.ts`'s
  `clauseVersionId` field was generalized to `storageScopeId` (a clause
  version for C-2's spike, a contract id for C-3b's whole-document run) -
  the only signature change either file needed.

- **A whole-contract generation concatenates every `contract_clauses.
  resolved_text` (already placeholder-substituted at snapshot time) into
  ONE context value, `contractBody`**, and calls `generateDocument` with
  the literal string `"{{contractBody}}"` as `clauseText` - NOT the
  assembled text itself. `resolvePlaceholders(clauseText, context, ...)`
  extracts tokens FROM `clauseText` and looks them up IN `context`, so the
  assembled content must be a context VALUE, not the string being
  scanned. This is the same one-placeholder pattern C-2's own spike used
  (a template with `{{token}}` placeholders resolved from context), just
  with the content template author's own `.docx` needing exactly one
  `{{contractBody}}` placeholder wherever the clause text should render.

- **A template's `.docx` file is uploaded via the EXISTING `attachments`
  mechanism** (`entity: "contract_template"`, `fieldKey: "templateFile"`)
  - no new upload endpoint, no new storage column on `contract_templates`.
  `.docx`'s content type was already in `core/storage/policy.ts`'s
  allowlist. Generation looks up the template's most recent attachment via
  the existing `listAttachmentsForEntity`. This was a genuine open
  question raised before building (how does a template's file get into
  the system at all) - the alternative (auto-generating a plain,
  unstyled `.docx` from clause text with no letterhead/formatting) was
  explicitly rejected in favor of the real, reusable upload path.

- **The API enqueues a BullMQ job for the first time** (`contract-
  generation.service.ts`'s own `Queue` instance, connected to the same
  Redis the worker's `Worker` already listens on) - previously only the
  worker ever produced/consumed its own jobs (C-1's clause-promotion
  scheduler). `bullmq` was added to `apps/api`'s own dependencies. Job
  polling (`GET /contracts/:id/generate/:jobId`) uses BullMQ's own
  `Job.fromId` + `.getState()` directly against the queue - no new
  `contract_generated_documents` table was needed; a completed job's own
  `returnvalue` (the two S3 storage keys) is presigned into download URLs
  on read, matching `core/storage/download.ts`'s existing
  `getPresignedDownloadUrl`.

- **Known drift risk, not eliminated**: the queue name (`"contract-
  generation"`) and the job-data field names are duplicated by hand across
  `apps/api/src/modules/contract/contract-generation.service.ts` and
  `apps/worker/src/workers/contract-generation.worker.ts` - the same
  "apps/api and apps/worker can't import each other's types" constraint
  every prior phase's worker-local mirrors (tenant schema, placeholder
  resolver) already accepted. Verified identical by hand for this build;
  a future field rename on either side needs the same manual verification,
  not a compiler check.

- **Permission naming**: the prompt's own literal wording
  ("contract.create/edit/assemble/generate") doesn't fit this codebase's
  `module.entity.action` permission-key convention (every other
  permission, including this module's own `contract.clause.*` set, is
  3 segments). Named `contract.document.{create,edit,assemble,generate}`
  instead - "document" is the contract header's own entity name, distinct
  from "clause" - satisfying the prompt's CONCEPT while keeping this the
  one and only 3-segment-consistent permission set in the whole catalogue.
  `assemble` deliberately covers every clause-assembly action (add/
  remove/reorder/edit-text/resnapshot) AND the three workflow transitions
  (approve/sign/close) - the prompt's own flat 4-permission list, not one
  permission per transition the way `purchase.po.issue`/`cancel` does it.

- **Menu placement**: "Contracts" (the actual create/assemble screens)
  lives in the main sidebar's operate section, alongside Purchase - a
  contract is a working document, not admin configuration, unlike Clause
  Library/Contract Field Setup/Templates, which stayed under the existing
  Settings-scoped `"contract"` node as legitimate admin/setup screens.
  This is a deliberate departure from that node's own prior doc comment
  ("every subsequent Contract-module screen... will likely join this
  node"), corrected once the actual operational nature of contract
  creation became concrete rather than speculative.

## Consequence

C-4 (rule engine, approval workflow refinement, e-signature stub, email)
is unblocked. The Clause Library screen, deferred from C-1 as backend-only,
was built here alongside C-3b's own screens since assembly (something to
link a clause TO) now exists - matching C-1's own stated reason for
deferring it in the first place.
