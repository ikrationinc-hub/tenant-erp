# 0024 - Contract rule engine, approval revisions, e-signature stub, email

## Status

Accepted

## Context

C-4 (docs/CONTRACT-MODULE-BUILD.md, "the last phase") adds a data-driven
rule engine, routes contracts for approval with a real revision flow,
introduces an e-signature abstraction, and emails a generated contract PDF.
The prompt itself is explicit that the rule engine's RULES and the
e-signature PROVIDER are client-owned decisions, not ones this build may
invent - this ADR records where that line was drawn.

## Decisions

- **`clause_rules` + `json-rules-engine`, not a hand-rolled DSL.**
  `conditionJson` is stored and handed to `json-rules-engine`'s `Engine`
  VERBATIM as its own `TopLevelCondition` shape - no code in this module
  parses or interprets conditions itself. `targetClauseId`/
  `actionIsMandatory` are plain columns, not encoded into the rule's own
  `event.params` - the action a rule takes ("add clause X, optionally
  mandatory") is queryable/joinable without parsing event JSON, and is the
  literal "condition -> action" shape the prompt asked for.

- **`isExample` is structurally un-fakeable.** Every rule created through
  `clause-rules.service.ts`'s `create()` gets `isExample: true` hard-coded
  server-side; the field is absent from both the create and update Zod
  schemas (`clause-rules.validator.ts`), so no request body can ever flip
  it. This isn't a convention comment - it's enforced at the type/schema
  level, directly answering the prompt's repeated warning ("do NOT ship
  invented rules as if real").

- **Exactly one seeded example rule: CIF -> Insurance.** A one-off script
  (`scripts/backfill-c4-permissions-and-example-rules.ts`, idempotent,
  matched by clause title / rule name) seeds one example clause
  ("EXAMPLE - Insurance (CIF)", its text explicitly marked
  `[EXAMPLE CLAUSE - not client-confirmed legal text]`) and one example
  rule ("EXAMPLE: CIF shipments require an insurance clause") per company
  of every active tenant, matching `deliveryTerms == "Cost, Insurance and
  Freight"` (the same free-text incoterm NAME `contract-source-link.ts`
  already prefills - there is no dedicated incoterm CODE field on
  `contracts` yet, which is exactly the kind of structural gap the "open
  questions for the client" list below flags). The prompt asked for 2-3
  examples; one was judged sufficient to prove the engine end-to-end
  without manufacturing additional invented "legal" scenarios purely to
  hit a count.

- **Running rules is a contract-scoped action, not a rule-scoped one.**
  `POST /contracts/:id/run-rules` (permission `contract.document.
  run_rules`) evaluates every active rule for that contract's division
  against a small, real fact set (`ContractRuleFacts`, backed by actual
  `contracts` columns - `divisionId`, `materialType`, `weightKg`,
  `rateUsd`, `deliveryTerms`, `sourceType`), then calls the SAME
  `addClauseFromRule` path that the assembly service already exposes for
  a template's own defaults. A rule-matched clause already on the contract
  is reported back as `alreadyPresent`, never re-added or silently
  dropped. Draft-only, via the same `requireDraft` guard every assembly
  mutation already uses - zero new locking logic needed.

- **Rule-added clauses are non-removable for free.** `isMandatory` was
  already wired end-to-end from C-3b (`removeClause`'s existing guard:
  `if (contractClause.isMandatory) throw new ConflictError(...)`).
  `addClauseFromRule` sets `isMandatory: input.isMandatory` (the rule's own
  `actionIsMandatory`) and `isFromRule: true` - the "mandatory, cannot be
  removed" requirement needed no new removal logic, only a new insertion
  path that reuses the existing snapshot machinery
  (`snapshotClause`/`buildContractPlaceholderContext`).

- **Approval already locked the snapshot; the only new work was the
  revision-CREATION endpoint.** Every clause-assembly mutation
  (`contract-assembly.service.ts`) already calls `requireDraft` at its own
  top - a contract leaving Draft (Approved/Signed/Closed) was already
  immutable before this phase touched anything. `POST /contracts/:id/
  revise` (permission `contract.document.assemble`, same as every other
  assembly action) is genuinely new: it creates a fresh Draft contract row
  with a new gapless `contractNumber`, `parentContractId` set to the
  source contract, `revisionNumber` incremented, and every one of the
  source's own frozen `contract_clauses` rows copied as fresh,
  independently-editable rows (never a live reference back to the
  parent's snapshot). The parent's own status/fields are left completely
  untouched - no auto-supersede - because whether an old revision should
  be closed/archived automatically is still an unconfirmed business rule
  (spec Part 6's own open question); inventing that behavior now would be
  exactly the kind of unrequested business logic CLAUDE.md's "stop and
  ask" rule exists to prevent.

- **`sendForApproval` records and notifies; it does not grant authority.**
  `approvalRequestedFor/By/At` are stamped on the contract row and a
  best-effort email is sent to the named approver (skipped silently if
  that user has no email on file - `users.email` is nullable). The
  approver still calls the pre-existing `PATCH /:id/approve` themselves;
  this endpoint has no bearing on who is permitted to approve.

- **`ESignatureProvider` is one interface, one stub, deliberately no real
  integration.** `core/esignature/provider.ts` mirrors
  `core/notification/mailer.ts`'s own established shape exactly
  (interface + one implementation + `getX`/`setX`/`resetX` test seam) -
  no new abstraction pattern invented. The stub keeps an in-process
  `Map<requestId, status>`; `send` always returns "sent" and does no
  outbound network call at all. `parseWebhook` exists and is tested, but
  is deliberately **not mounted on any HTTP route** - a real provider's
  inbound callback cannot carry one of our own JWTs, and this codebase has
  no existing pattern for a differently-authenticated inbound endpoint
  (every mounted route resolves tenant scope from the JWT only,
  `scope-resolver.ts`'s own "Resolved from the JWT ONLY" rule). Designing
  that auth scheme depends entirely on which provider's actual callback
  shape is being matched - genuinely unknown until one is named - so it
  is left undesigned rather than guessed at.

- **Email and e-signature both read the durable `lastGeneratedDocxKey`/
  `lastGeneratedPdfKey` columns, not BullMQ job state.** Before this
  phase, a generation job's result (`{docxStorageKey, pdfStorageKey}`)
  lived ONLY in BullMQ's own job return value - fine for one-time
  presigned-URL polling (`GET /contracts/:id/generate/:jobId`), useless
  once that job ages out of Redis. `getGenerationJobStatus` now persists
  both keys onto the `contracts` row the first time it observes a job as
  completed (idempotent - a repeat poll just re-writes the same values).
  Email and e-signature both read `lastGeneratedPdfKey` directly off the
  contract, never re-deriving it from a job id the caller would otherwise
  have to remember and pass back in.

- **Email runs synchronously in the API process, not a worker job.**
  Emailing an already-generated PDF is fetch-and-forward of an existing
  file (read bytes from S3, attach, POST to Resend) - not document
  GENERATION, so CLAUDE.md's worker-only rule for generation doesn't
  apply. `core/storage/download.ts` gained `readObjectAsBuffer` (mirrors
  `apps/worker`'s own hand-written function of the same shape exactly -
  the same "apps/api and apps/worker can't share code, kept in sync by
  hand" drift risk ADR 0023 already accepted, now on one more function
  pair). `core/notification/mailer.ts`'s `SendMailInput` gained an
  optional `attachments` field (base64-encoded only inside
  `resendMailer.send` - every other caller keeps passing plain Buffers).

- **New permissions**: `contract.document.email`, `contract.document.
  esign`, `contract.document.run_rules` (document-scoped actions, same
  3-segment convention as `create/edit/assemble/generate`), and
  `contract.rule.{read,create,update}` (the rule engine's own CRUD
  surface, mounted on its own top-level router `clauseRulesRouter` at
  `/api/v1/clause-rules`, same "own top-level path" precedent as
  `contractTemplatesRouter`). Backfilled onto already-active tenants'
  existing roles via the same `backfill-c4-permissions-and-example-
  rules.ts` script that seeds the example rule, using the same
  `ROLE_ACTION_FILTERS` tiering (`backfill-contract-clause-
  permissions.ts`'s own precedent) - Officer gets email/run_rules,
  Manager additionally gets esign, Admin gets everything.

- **Fixed a pre-existing inconsistency while touching this file**:
  `CONTRACT_WORKFLOW`'s `approve`/`sign`/`close` transitions carried a
  stale, unregistered `permission: "contract.assemble"` string
  (documentation-only per `transitions.ts`'s own design - the route
  itself enforces the real permission). Corrected to the actually-enforced
  key, `contract.document.assemble` (`contract.routes.ts`'s own
  `requirePermission` call), rather than inventing three new unregistered
  per-transition permission keys that nothing would ever check.

## Open questions for the client (not answered here)

Consolidated from the build guide's own Part 6 list (docs/CONTRACT-MODULE-
BUILD.md) now that C-1 through C-4 are all built - every item below is
still genuinely open; none were answered or invented during the build.

- **The Scrap division field list.** C-3a seeded a clearly-flagged
  placeholder field set (materialType/weightKg/rateUsd/deliveryTerms) -
  never confirmed with the client. This is the field engine's own data
  (`field_definitions`, division-scoped), not code, so correcting it later
  is a data change, not a rebuild - but it must still be confirmed before
  the Scrap contract form is treated as real.
- **Real clause rules.** Every rule in this build is the one seeded
  CIF -> Insurance example. The client must provide the actual
  condition/action pairs their trading terms require before any rule is
  treated as governing real contracts.
- **E-signature provider.** No provider has been named. On-prem
  deployment may block outbound calls to a SaaS e-signature API entirely -
  this must be confirmed before integrating any real provider, and the
  provider's own webhook authentication shape must be known before this
  build's `parseWebhook` can be exposed over HTTP.
- **Placeholder namespace.** C-2/C-3b's `buildContractPlaceholderContext`
  exposes seller/buyer/commercial/shipment fields as `{{dotted.tokens}}` -
  a reasonable proposed set, but never explicitly confirmed as the
  complete/correct namespace clause authors should be allowed to
  reference.
- **Clause-edit approval.** Whether a new clause version requires legal
  sign-off before going Active is still unconfirmed. C-1's own
  `approved_by`/`approved_at` columns and `approveVersion` step exist
  either way (a version only reaches Active via explicit approval, never
  automatically), so this is a policy question, not a schema gap - but
  today nothing prevents the same Manager-tier user who authored a
  version from also approving it (no separate "legal" role or self-
  approval restriction exists), which a real legal sign-off requirement
  would need to change.
- **Incoterm as a proper field.** The CIF example rule matches on
  `deliveryTerms`'s free-text incoterm NAME because no incoterm CODE
  column exists on `contracts` yet. A real rule set will likely need a
  clean, enumerable incoterm field rather than string matching on a
  human-readable name.
- **Revision/amendment semantics.** `POST /contracts/:id/revise` creates
  a new Draft without touching the source contract's own status. Whether
  an old revision should be automatically closed, superseded, or flagged
  once a new revision exists is still open (spec Part 6).
- **Rich-text authoring.** Already tracked in ADR 0021: docxtemplater's
  paid Table/Image modules are only needed if clause authors require
  Word-level formatting (tables, numbered sub-clauses) - not yet
  confirmed either way.
- **Contract numbering per legal entity.** `contractNumber` is gapless
  per `companyId` today (the same convention every other document series
  in this codebase uses) - whether Contracts specifically need a
  per-legal-entity series distinct from company-wide numbering, the way
  invoices sometimes do, is unconfirmed.

## Consequence

The Contract module (C-1 through C-4) is now feature-complete for the
16-week prototype scope: versioned clause library, division-scoped
fields, full document assembly with an immutable snapshot, a data-driven
(but not yet client-populated) rule engine, and an approval/revision/
e-signature-stub/email lifecycle. Nothing in this phase treats invented
rules or a chosen e-signature provider as real - both remain explicit,
tracked client questions.
