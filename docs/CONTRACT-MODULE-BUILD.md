# Contract Module — Complete Build Guide (start here)

Everything needed to build the Contract/Agreement Management module from zero.
Self-contained: the spec, the reconciled data model, and all prompts in order.
You don't need the other contract docs open — this file has it all.

Prerequisites already in the codebase: field engine, workflow engine, numbering
engine (gapless), audit engine, storage service, divisions master (from
Purchase), the module registry, and `<SchemaForm/>`. This module reuses all of
them.

---

## PART 1 — WHAT YOU'RE BUILDING

A contract system with four capabilities:

1. **Versioned clause library** — reusable legal clauses that change over time
   (market/law) WITHOUT ever altering already-signed contracts.
2. **Division-dynamic fields** — the contract form's fields differ per division
   (Scrap first, Metal/Textile later), driven by data not code.
3. **Assembly engine** — pick a template → default clauses load → a rule engine
   auto-adds required clauses → drag-drop reorder → placeholders fill with live
   data → generate matching Word + PDF → email → approve → e-sign.
4. **Snapshot integrity** — each contract freezes the exact clause versions it
   used; editing the library later never changes history.

v1 targets the **Scrap division**. Contracts can link to a purchase/sale OR stand
alone.

### The one rule that governs everything

**Editing a clause in the library must NEVER change what an already-signed
contract says.** Every clause edit creates a NEW version; contracts point to the
specific version active when they were created. This is the client's own stated
requirement, not our interpretation. Violating it falsifies a legal document.

### The one risk to retire early

Placeholder substitution → matching Word + PDF is the hard part. **Prove it on
ONE clause (C-2) before building the assembly UI.** If it doesn't work cleanly,
everything downstream is decoration on a broken foundation. C-2 is a small,
isolated spike that tells you whether this module is 8 weeks or 16.

---

## PART 2 — DATA MODEL (reconciled names — use these exactly)

```
divisions                 -- REUSE the existing one from Purchase. Do not recreate.

clauses                   -- stable clause identity (never changes after creation)
  clause_id, clause_code (gapless), clause_title,
  division_id (nullable: NULL = all divisions),
  category ('General T&C' | 'Division Specific'), is_active

clause_versions           -- append-only; the heart of the system
  version_id, clause_id (FK), version_number (auto per clause),
  clause_text (rich), status ('Draft'|'Approved'|'Active'|'Superseded'|'Expired'),
  effective_from, effective_to (nullable), change_reason (required),
  created_by, created_at, approved_by (nullable), approved_at (nullable)
  -- RULE: at most ONE version per clause_id is 'Active' at a time.

contract_templates        -- named default clause sets per division/contract type
contract_template_clauses -- which clauses a template loads by default, + order

clause_rules              -- data-driven rules (json-rules-engine), NOT hardcoded
  condition (on contract data) -> action (add clause as default/mandatory)

contracts                 -- the document header
  contract_id, division_id, contract_number (gapless), revision_number,
  contract_date, status ('Draft'|'Approved'|'Signed'|'Closed'),
  parent_contract_id (nullable), source_type (nullable: 'purchase'|'sale'),
  source_id (nullable FK)   -- link OR standalone
  + division-specific fields via the FIELD ENGINE (not columns — see C-3a)

contract_clauses          -- THE SNAPSHOT: frozen per-contract clause set
  contract_id, clause_id, clause_version_id (the legal anchor, frozen forever),
  resolved_text (placeholders substituted), sort_order, is_from_rule,
  is_edited (diverged from standard), snapshot_taken_at
  -- Never updated after write for Approved/Signed contracts.

contract_parties          -- seller/buyer resolved from Supplier/Customer masters
```

Every table: standard scope + audit columns, soft delete, `version` for
optimistic locking. Money numeric + decimal.js. Rich text: decide the storage
format in an ADR (HTML is the usual choice).

**Vocabulary:** Seller side resolves to **Supplier**, buyer side to **Customer**
(never "Vendor"). Keep trading terms as-is (LME, Incoterm, Laycan, LC).

---

## PART 3 — INFRASTRUCTURE THIS MODULE NEEDS

- **docxtemplater** (Word generation with placeholder substitution). Its
  HTML/image/table modules are **paid** (~€1–3k) — C-2 evaluates whether you need
  them, and compares against **carbone.io** as an alternative.
- **LibreOffice headless** in the WORKER container (DOCX→PDF preserving Word
  layout). Puppeteer/HTML→PDF will NOT match Word formatting.
- All document generation runs in the **worker**, never the API process.
- **json-rules-engine** for the rule engine (data-driven, not a hand-rolled DSL).

---

## PART 4 — BUILD ORDER

| Phase | What | Risk | Gate |
|---|---|---|---|
| **C-1** | Clause library + versioning + effective-dating + scheduler | Low | Versioned library works, history protected |
| **C-2** | Placeholder → Word/PDF spike (ONE clause) | **HIGH** | GO/NO-GO before proceeding |
| **C-3a** | Division-scoped contract fields via the field engine | Medium | Scrap form renders from data |
| **C-3b** | Contract doc + templates + assembly + drag-drop + snapshot | Medium | Build → assemble → generate |
| **C-4** | Rule engine + approval + e-sign (stub) + email | Med-High | Full lifecycle |

Every prompt is **audit-first**: report what exists before building (things may
be half-built or unreachable — a recurring lesson on this codebase). And every
new screen wires its menu node into BOTH `DEFAULT_MENU_TREE` and `mockMenuTree`
(the recurring drift bug).

---

## PART 5 — THE PROMPTS (copy-paste in order)

Put this file at `docs/CONTRACT-MODULE-BUILD.md` and reference it from each
prompt. One prompt per session; review, test, commit before the next.

---

### C-1 (BE) — Versioned clause library

```
Build the versioned clause library. Spec: docs/CONTRACT-MODULE-BUILD.md Parts 2-3.
Read CLAUDE.md (vocabulary, table conventions, rule 8 immutability) first.
Audit first — no clause tables should exist yet; report before building.

BUILD (use the exact reconciled names: clauses, clause_versions):
1. divisions: REUSE the existing divisions master from Purchase. Confirm it
   exists; do NOT create a second divisions table.
2. clauses (stable identity, never changes after creation): clause_code (gapless
   via numbering engine), clause_title, division_id (nullable = all divisions),
   category ('General T&C' | 'Division Specific'), is_active.
3. clause_versions (append-only):
   - version_number (auto-increment per clause_id), clause_text (rich text),
     status enum Draft/Approved/Active/Superseded/Expired,
     effective_from, effective_to (nullable), change_reason (REQUIRED),
     created_by/at, approved_by/at (nullable)
   - Editing text = INSERT a new version row. NEVER UPDATE or DELETE clause_text
     on an existing version.
4. ONE-ACTIVE RULE: at most one version per clause_id has status=Active.
   Promoting a version to Active flips the prior Active to Superseded and stamps
   its effective_to = the new version's effective_from — IN ONE TRANSACTION.
5. EFFECTIVE-DATING + SCHEDULER: effective_from may be in the FUTURE. Build a
   BullMQ scheduled job that promotes any Approved version whose
   effective_from <= now to Active (superseding the prior one, same transaction).
   Add an on-access fallback check. Validate a clause's version windows don't
   overlap and don't leave an uncovered date.
6. Placeholder extraction: clause_text may contain {{tokens}}. Store verbatim;
   add an endpoint listing the tokens a version references (substitution is C-2).
7. Permissions: contract.clause.create / .version / .approve / .deactivate.
8. Endpoints: GET /clauses?division_id=&category=, GET /clauses/{id}/versions,
   POST /clauses/{id}/versions (effective_from required). Paginated.

TESTS:
- Editing a clause inserts a new version; the prior version's text is
  byte-for-byte unchanged and still readable
- change_reason required — a version without it is rejected
- Only one Active version per clause ever; promoting flips the old to Superseded
  with effective_to stamped, atomically
- A future-dated version stays Approved until its date; a test that advances time
  proves the scheduler promotes it and supersedes the prior version
- Overlapping/gapping effective windows rejected
- Placeholder extraction lists a version's tokens; clause_code gapless

Acceptance:
- Audit reported first; reconciled table names used
- Future-dated promotion proven by a time-advancing test
- ADR: rich-text storage format; the one-Active-version state machine
```

---

### C-2 (BE) — Placeholder → Word/PDF spike ⚠️ PROVE THIS BEFORE PROCEEDING

```
THE critical spike. Prove a clause with {{placeholders}} resolves against live
data and renders to Word AND PDF that MATCH — on ONE clause, before any contract
UI exists. If this doesn't work cleanly, STOP and report; everything depends on
it. Spec: docs/CONTRACT-MODULE-BUILD.md Part 3.

BUILD:
1. Evaluate docxtemplater vs carbone.io for Word generation with placeholder
   substitution. Report which and why. Note docxtemplater's paid modules if
   HTML/tables are needed. Verify current library APIs against docs — do not rely
   on remembered syntax.
2. Add LibreOffice headless to the WORKER container. DOCX→PDF runs here, never in
   the API process.
3. Placeholder resolver: given a context object (seller, buyer, commercial,
   shipment, payment fields) and a template string with {{dotted.tokens}}, resolve
   every token. Money/quantity tokens are decimal strings, formatted for display —
   never parseFloat. A MISSING token is an explicit error, not a silent blank (a
   blank where a price belongs is a legal problem).
4. Generation job (BullMQ, worker): clause + context → substitute → render DOCX →
   convert to PDF → store both via the storage service → return both references.
5. Prove end-to-end with a realistic clause containing ~8 placeholders across
   seller/buyer/commercial/shipment and a realistic context.

TESTS:
- All placeholders resolve; DOCX and PDF contain the substituted values
- A missing placeholder raises a clear error (not a blank)
- Money renders formatted and correct (8,432.75, not 8432.749999)
- The PDF visually matches the DOCX (manual check noted in the result)
- Generation runs in the worker, not the API

Acceptance:
- ONE clause, real data, matching Word + PDF, via the worker
- A clear GO/NO-GO: does this approach work for full contracts?
- ADR: docxtemplater vs carbone; LibreOffice setup; the placeholder token
  namespace (what {{paths}} exist)
- If NO-GO: stop, report exactly what failed, we solve it before C-3
```

---

### C-3a (BE + FE) — Division-scoped contract fields (reuse the field engine)

```
Make the contract form's fields differ per division, driven by data not code —
using the EXISTING field engine, NOT a new field_master table. Spec:
docs/CONTRACT-MODULE-BUILD.md Part 2. Audit the field engine first and report how
it currently scopes fields.

BUILD:
1. Extend the field engine so contract-entity field definitions can be scoped to a
   division_id (or NULL = all divisions). Do NOT build a parallel field_master —
   the doc's field_master requirement IS the field engine with division scoping.
2. Field VALUES store through the existing field-value mechanism. Only add a new
   value table if the current mechanism genuinely can't represent per-contract
   values — verify and report before adding anything.
3. Seed the Scrap division's contract fields (material type, weight, rate,
   delivery terms, etc. — confirm the exact Scrap field list with me before
   seeding; do not invent the list).
4. FRONTEND: the contract form renders via the existing <SchemaForm/>, fed field
   definitions filtered by the selected division. Selecting Scrap shows Scrap's
   fields. Adding a division later (Metal) is a data task — prove this by
   confirming no code change is needed to render a second division's fields.
5. Menu node for Contract Field Setup (admin) if one doesn't exist — both trees.

TESTS:
- Field definitions scope by division; Scrap shows Scrap fields
- A second (test) division's fields render with zero code change — data only
- Values persist and reload through the existing field mechanism
- No parallel field_master table created

Acceptance:
- Audit reported; the field engine is reused, not duplicated
- Onboarding a division is demonstrably data-entry, not code
- Confirm the Scrap field list with me before seeding it
```

---

### C-3b (BE + FE) — Contract document, templates, assembly, drag-drop, snapshot

```
Only start after C-2 is GO. Build the contract document and assembly flow (rule
engine is C-4). Spec: docs/CONTRACT-MODULE-BUILD.md Part 2. Read the 7 frontend
rules in CLAUDE.md. Audit first.

BACKEND:
1. contract_templates + contract_template_clauses: a template names a division +
   contract type and a default ordered clause set. Template management is
   master-style CRUD.
2. contracts header + contract_parties per Part 2. contract_number + revision_number
   gapless. status Draft/Approved/Signed/Closed. parent_contract_id optional.
3. Link OR standalone: source_type + source_id optional FK to a purchase or sale.
   If linked, commercial/shipment fields PREFILL from that document but stay
   editable. If standalone, entered manually. Support BOTH.
4. contract_clauses (THE SNAPSHOT): selecting a template loads its default clauses;
   on assembly, resolve each clause's currently-Active version and write a frozen
   row (clause_id, clause_version_id, resolved_text via C-2's resolver,
   sort_order, is_from_rule, is_edited, snapshot_taken_at). Resolve display THROUGH
   this snapshot, never the live clause. Approved/Signed contracts: snapshot
   frozen. Draft: an explicit "update clauses to latest" re-snapshots with a diff.
5. Assembly endpoints: load template defaults, add/remove clause (block removing
   mandatory), reorder (persist sort_order), edit an editable clause's text on THIS
   contract (records is_edited, never touches the library), preview (resolve
   placeholders against this contract's data), generate Word/PDF (C-2's worker job).
6. Permissions: contract.create/edit/assemble/generate.

FRONTEND:
7. Contract form: division-scoped fields via C-3a's <SchemaForm/> + the header
   sections. Link-to-purchase/sale picker; prefill when linked.
8. Clause assembly UI: assembled clauses as a DRAG-AND-DROP reorderable list.
   Add-from-library (filtered by division + contract type), remove (disabled for
   mandatory), inline-edit editable clauses. Show which came from the template.
9. Preview pane: renders with placeholders resolved. Download Word / Download PDF
   (call the worker job, poll, present files).
10. Menu nodes (Contracts, Clause Library, Templates) in BOTH trees.

TESTS:
- Template loads default clauses in order
- Linked contract prefills from a purchase; standalone starts blank; both work
- Drag-drop reorder persists; mandatory clause cannot be removed
- THE SNAPSHOT TEST: assemble a contract, then edit that clause in the library →
  the contract's stored resolved_text and clause_version_id are UNCHANGED
- A Signed contract cannot be re-snapshotted; a Draft can, with a diff
- Preview resolves placeholders against real data; Word + PDF generate and match
- No hardcoded labels; screens reachable by clicking

Acceptance:
- End to end: create contract (linked or standalone) → pick template → clauses
  load → reorder → edit → preview → download matching Word + PDF
- The snapshot test passes — library edits never alter an assembled contract
```

---

### C-4 (BE + FE) — Rule engine, approval, e-signature, email

```
The last phase. Spec: docs/CONTRACT-MODULE-BUILD.md. ⚠️ The rule engine's RULES
come from the CLIENT, not from you — do not invent legal logic. Audit first.

RULE ENGINE:
1. clause_rules: data-driven (json-rules-engine, NOT hardcoded). Each rule: a
   condition on contract data (e.g. incoterm=='CIF', lc_required==true) → an action
   (add clause X as default/mandatory). Rules are DATA — editable without a deploy.
2. On assembly (or a "run rules" action), evaluate the contract's data against
   active rules and auto-add required clauses, flagged is_from_rule so the UI shows
   WHY. Rule-added mandatory clauses cannot be removed.
3. ⚠️ Real rules are UNKNOWN until the client provides them. Build the engine + a
   rules-management UI, seed 2-3 EXAMPLE rules clearly marked as examples (e.g.
   CIF→insurance). ADR lists the rules we need from the client. Do NOT ship
   invented rules as if real.

APPROVAL:
4. Contract workflow Draft→Approved→Signed→Closed via the workflow engine. Send
   for Approval routes to an approver; permission-gated, audited. Approval locks
   the clause snapshot (changes need a new revision — parent_contract_id).

E-SIGNATURE (⚠️ provider is an open client question; on-prem may block outbound):
5. Build an ESignatureProvider abstraction (send, status, webhook) with ONE
   stub/mock implementation. Do NOT integrate a real provider until the client
   names one and confirms network access. "Send for E-signature" calls the
   interface; the stub simulates it.
6. Email Contract: send the generated PDF via the notification service.

FRONTEND:
7. Rules-management UI (condition builder + target clause). Example rules labelled
   as examples.
8. On a contract: "Run rules" shows auto-added clauses with a "required by rule"
   badge. Send for Approval, Send for E-signature (stub), Email, Print.
9. Approval + signature status visible on the contract.

TESTS:
- A rule (CIF→insurance) auto-adds the clause, flagged is_from_rule, non-removable
- Rules are data — adding one needs no code change
- Approval locks the snapshot; editing after approval requires a new revision
- E-signature abstraction works with the stub; no real provider wired
- Email sends the PDF

Acceptance:
- Rule engine data-driven; example rules clearly marked as examples
- ADR lists the real rules needed + the e-sign provider question
- Approval + e-sign (stub) + email functional
- NOTHING invented as real client logic
```

---

## PART 6 — CLIENT QUESTIONS THIS MODULE NEEDS ANSWERED

Non-blocking for C-1/C-2, but needed by C-3a/C-4:

- **The Scrap division field list** — exact fields for the Scrap contract form
  (needed to seed C-3a). Don't invent it.
- **The actual clause rules** — the real if-then rules (Incoterm→clause,
  LC→clause, etc.). The biggest unknown; needed for C-4.
- **E-signature provider** + does on-prem allow the outbound call? Blocks C-4's
  real integration.
- **Placeholder namespace** — which fields can a clause reference? Propose a set
  from the contract sections + linked purchase/sale; client confirms.
- **Clause-edit approval** — should a new clause version require legal sign-off
  before going Active? (For a law-sensitive library, usually yes — C-1 has the
  approved_by field ready either way.)
- **Amendment vs revision** — when a SIGNED contract's terms change, is it a
  revision or a new linked contract (parent_contract_id)? Legal norm is a new
  amendment document; confirm.
- **Rich-text authoring** — do clause authors need Word-level formatting (tables,
  numbered sub-clauses)? Determines if docxtemplater's paid module is required.
- **Contract numbering per legal entity?** Like invoices, may need to be
  per-company. Confirm.

---

## PART 7 — THE SEQUENCE, IN ONE LINE

C-1 (build the versioned library — history protection is the foundation) → **C-2
(prove Word/PDF works — STOP if it doesn't)** → C-3a (division fields via the
field engine) → C-3b (assembly + snapshot) → C-4 (rules + approval + e-sign).
Confirm the Scrap field list and gather the clause rules from the client while
C-1/C-2 are in progress — they're needed by C-3a and C-4 respectively.
```
