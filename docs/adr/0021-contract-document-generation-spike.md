# 0021 - Contract document generation: docxtemplater, LibreOffice, and the placeholder namespace

## Status

Accepted - **GO**

## Context

C-2 (docs/CONTRACT-MODULE-BUILD.md) is the module's highest-risk piece,
by its own explicit framing: prove that a clause's `{{placeholders}}`
resolve against live data and render to a Word document AND a PDF that
match, on one realistic clause, before any contract assembly UI is built.
If this didn't work cleanly, the build order calls for stopping and
reporting rather than proceeding to C-3a/C-3b. This ADR records the result
of that spike and the decisions it forced.

## Decisions

- **docxtemplater over carbone.io, for licensing reasons that dominate
  every other factor.** Carbone relicensed from Apache-2.0 to its own
  "Carbone Community License" at v3.0.0 (2023) - a non-OSI, non-standard
  license whose §2.2 restricts using the community edition "to provide
  document-generator-as-a-service... or any form of software-as-a-service
  in which the Carbone Community Edition Software is offered... to provide
  Document Generator functions... to third parties." A multi-tenant ERP
  where every tenant generates contracts through this exact mechanism sits
  close enough to that boundary that a client's legal review would
  reasonably flag it - "probably fine" is not the standard for a
  billion-dollar first client. docxtemplater is dual-licensed MIT-or-GPLv3;
  for a closed-source commercial SaaS, MIT is simply elected and the
  question is closed permanently. docxtemplater also ships its own
  TypeScript definitions; Carbone ships none (only a stale, unofficial
  `@types/carbone`), which is direct friction against this codebase's
  "no `any`, no `as` to silence a type error" rule.

- **Free-tier docxtemplater covers this module's actual needs.** Simple
  table row iteration (`{#items}...{/}` spanning one Word table row,
  duplicated per array element) is core, free functionality - confirmed
  against the current docs (docxtemplater.com/docs/tag-types,
  /modules/table). The paid modules (Table €500/yr, HTML €500/yr, etc.,
  up to Enterprise at €3,000/yr) are only needed for structural table
  manipulation (column loops, cell merging, building tables from scratch),
  HTML content, or images - none of which this module has been asked to
  build. If a future contract template genuinely needs merged cells or a
  dynamically-built table, that's the point to revisit this decision, not
  before.

- **`nullGetter` is explicitly overridden to THROW, not left at
  docxtemplater's own default.** Out of the box, a tag with no matching
  data renders the literal string `"undefined"` into the document - for a
  legal document, this is exactly the "blank where a price belongs" risk
  the spec calls out, just spelled differently. `apps/worker/src/
  contract-generation/docx-renderer.ts`'s `renderDocx` sets `nullGetter` to
  throw `UnresolvedTemplateTagError`. In practice this should never fire in
  normal operation, since `placeholder-resolver.ts`'s `resolvePlaceholders`
  already throws `MissingPlaceholderError` earlier in the pipeline, for
  every token the clause's own `clauseText` declares - the `nullGetter`
  override is the second, independent guard against the different failure
  mode where the .docx TEMPLATE file itself references a tag that
  `clauseText`'s own token scan never saw (e.g. a hand-edited template).

- **DOCX -> PDF via `libreoffice-convert` (MIT), wrapping
  `soffice --headless --convert-to pdf`, running only in `apps/worker`
  (`apps/worker/src/contract-generation/pdf-converter.ts`) - never in
  `apps/api`.** The worker's Dockerfile installs `libreoffice-writer-nogui`
  (the headless-server package, ~28MB, no GUI dependencies - not the full
  `libreoffice-writer`) plus `fonts-liberation` explicitly. The font
  package matters: Liberation is metric-compatible with Arial/Times New
  Roman, and without it, LibreOffice silently substitutes fonts on
  conversion, which breaks pagination and line-wrapping between the source
  DOCX and the converted PDF - precisely the "do these visually match" risk
  this spike exists to retire.

- **The spike is proven GO.** `apps/worker/src/contract-generation/
  __tests__/generate-document.test.ts` exercises the full pipeline (resolve
  -> render DOCX -> convert to real PDF, via a REAL LibreOffice 6.4
  invocation, not a mock) against a realistic 11-placeholder clause
  (`test/fixtures/build-clause-template.ts`'s `SPIKE_CLAUSE_TEXT`) spanning
  seller/buyer/commercial/shipment/payment. All 7 tests pass, including:
  every placeholder resolves; money renders as `8,432.75` (via decimal.js,
  never `parseFloat`, confirmed against a deliberately over-precise input
  string `"8432.7499999999999"`); a missing placeholder throws
  `MissingPlaceholderError` naming the exact token; a template tag with no
  resolved value throws `UnresolvedTemplateTagError` rather than rendering
  "undefined"; the generated PDF has real `%PDF-` magic bytes and
  non-trivial size. **A manual visual check was additionally run**
  (`apps/worker/test/fixtures/manual-check.ts`, a run-by-hand script, not
  part of the automated suite) - the generated PDF was read back and
  visually confirmed to show every substituted value correctly, in the
  same line-by-line layout as the source, with no stray `{{tokens}}` and
  no literal "undefined" anywhere.

- **The placeholder token namespace is a PROPOSAL, not a client-confirmed
  list** (docs/CONTRACT-MODULE-BUILD.md Part 6 explicitly flags this as an
  open question). `apps/worker/src/contract-generation/build-context.ts`
  proposes: `seller.{name,address}`, `buyer.{name,address}`,
  `commercial.{rate,currency,quantity}`, `shipment.{port,eta}`,
  `payment.{terms,dueDate}` - one section per contract concern, mirroring
  the spec's own "seller, buyer, commercial, shipment, payment" grouping.
  Money/quantity fields (`commercial.rate`) are decimal STRINGS end to end
  (CLAUDE.md rule 1) - `MONEY_TOKENS` names which dotted paths get
  thousands-separator + fixed-2dp formatting; everything else interpolates
  verbatim. **This list needs client confirmation before C-3a/C-3b treat it
  as final** - it will grow once C-3a's division-scoped fields and C-3b's
  actual contract header exist to source real values from.

- **Job payload carries a template FILE PATH, not template bytes.**
  `apps/worker/src/workers/contract-generation.worker.ts`'s
  `ContractGenerationJobData` passes `templateFilePath` through BullMQ's
  Redis-backed job data (JSON), reading the actual .docx bytes inside the
  processor via `readFile`. A multi-hundred-KB binary buffer has no
  business round-tripping through Redis as job data. This spike sources
  the path from the local filesystem (there is no `contract_templates`
  table yet - that's C-3b's job); once one exists, only the path's origin
  changes (an S3-backed template's key, fetched before enqueueing or
  inside the processor) - the resolve -> render -> convert -> store
  pipeline itself does not change.

- **Generated documents are stored via a worker-local S3 helper
  (`apps/worker/src/contract-generation/store-generated-document.ts`), not
  `apps/api`'s `attachments` table.** `attachments.scanned_at` is `NOT
  NULL`, encoding the invariant "this file passed the upload+ClamAV-scan
  path" (`core/storage/upload.ts`) - a system-generated DOCX/PDF, produced
  from this system's own data via docxtemplater/LibreOffice, never went
  through that path and was never a user-uploaded, potentially-malicious
  file to begin with. Forcing it into `attachments` would mean either
  stamping a fake `scannedAt` (a lie about what actually happened) or
  loosening the column's `NOT NULL` (weakening the guarantee for every
  genuinely-uploaded file). For this spike, the two S3 storage keys
  returned by `generateDocument` ARE the artifact references the spec asks
  for ("store both, return both references"); a proper
  contract-generated-documents table, if one is warranted once contracts
  themselves exist, is C-3b's decision to make with real requirements in
  hand, not this spike's to invent early.

## Consequence for the build order

**GO.** C-3a/C-3b can proceed. Two things carried forward as open items,
not blockers: the placeholder namespace above needs the client's
confirmation (Part 6), and rich template authoring (tables with merged
cells, images) would need the paid docxtemplater Table/Image modules if a
future template design calls for them - not needed for anything built or
scoped so far.
