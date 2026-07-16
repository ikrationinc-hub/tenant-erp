# Hyperion ERP — 90-Day Prototype Plan

**Goal:** a demonstrable system proving (1) the full architecture end-to-end, (2) tenant/company onboarding, (3) the complete Purchase V2 module.
**Team:** 2 backend engineers. **Duration:** 12 weeks.
**Reference:** `Hyperion-ERP-Backend-Plan-v2.md` for the full architecture and decision register.

---

## 1. What "prototype" means here

This is **not** a throwaway. It is **Phases 1–6 of the real build, narrowed to one module.** Every line survives into production. The only things deferred are breadth (more modules, more verticals, more countries), never depth (no fake auth, no skipped audit, no float money).

**The prototype succeeds if it answers these five questions with running code:**

1. Can two tenants coexist in one database with **provably** zero data leakage under concurrent load?
2. Can we onboard a new company end-to-end in one click, with zero manual SQL?
3. Does a business module built *through* the module registry actually work — or is the registry theatre?
4. Does the money math survive a real trade (500 MT, LME + premium, USD→AED, costs allocated)?
5. Can the client rename a field and control who sees it, without a deploy?

If all five are yes at week 12, the remaining 9–12 months are execution risk, not architecture risk. That's the entire point.

---

## 2. Scope

### In

**Architecture**
- Schema-per-tenant, `getDb(ctx)`, `SET LOCAL search_path`, isolation test under concurrency
- Migration fan-out across N schemas, with partial-failure handling
- Auth: JWT + refresh rotation, invite flow, forced password set
- RBAC: `module.entity.action` + field-level mechanism
- Module registry + manifests, menu engine
- Numbering engine (gapless), audit engine (immutable), event bus
- Field engine — **Tier 2 only** (rename / hide / reorder / mandatory)
- Money: `numeric` + decimal.js, `Money` value object
- Storage: MinIO + ClamAV, attachments
- Pino + request context, AppError, Docker Compose, CI, Testcontainers

**Onboarding**
- Platform admin → create tenant → provision schema → migrate → seed → invite tenant admin
- Tenant admin → companies → branches → invite employees → user sets own password
- One-click provisioning (Excel instruction #5)

**Purchase V2 — complete**
- Sub Tab 1: Supplier Creation (FR-001…006)
- Sub Tab 2: Record Purchase — header, supplier details, shipment, items, pricing, customer allocation, additional costs, attachments (FR-101…108, FR-110)
- Sub Tab 3: LME + Hedging (FR-201…204)
- Draft → Approved → Posted workflow
- Stock ledger (FR-108)
- ~15 supporting masters

### Out — and why

| Deferred | Reason |
|---|---|
| Tier-3 custom fields | Tier 2 satisfies *"Other Charges — field should be named by user"*, which is what the spec asks. Tier 3 is ~4 weeks |
| Exhaustive field-RBAC | Mechanism built + demoed on Pricing. Full rollout needs every module to exist |
| FR-105 Profit/Loss, FR-206, FR-109 | Require the Sales module. Not buildable |
| SMS OTP | Needs a gateway contract. Email OTP proves the flow |
| Multi-country tax | Single country. `TaxEngine` interface exists with one stub implementation |
| Contracts, Sales, reporting, e-sign | Not prototype material |
| Vertical registry | `item_type` column present; plugin loading deferred |

---

## 3. Weekly plan

Two engineers — **A** (platform/infra) and **B** (domain). They converge from week 8.

| Wk | A — platform | B — domain | Demoable at end of week |
|---|---|---|---|
| **1** | Monorepo, TS strict, env config, Pino + AsyncLocalStorage, AppError, Express 5 skeleton, Docker Compose, health check | Drizzle setup, platform schema, first migration, Testcontainers harness | `docker compose up` → `/health` green, CI passing |
| **2** | **`getDb(ctx)` + `SET LOCAL search_path`**, tenant resolver middleware, **isolation test under concurrency** | **Migration fan-out** across N schemas + partial-failure handling | Two tenants, two schemas, isolation test proves no leak |
| **3** | Auth: JWT + refresh rotation, session denylist, login history | Users, roles, permissions, `user_roles`, RBAC middleware | Login → token → permission-gated endpoint |
| **4** | Invite flow, token issue/redeem, forced password set, email verify (Mailhog) | Platform admins + separate auth, break-glass skeleton | Admin invites user → user sets own password → logs in |
| **5** | **Numbering engine** + gapless concurrency test | **Audit engine** — immutable, in-transaction, JSONB diff | 100 parallel inserts → zero gaps. Every write audited |
| **6** | Module registry + manifests, menu engine + Redis cache | **Provisioning engine** — one-click tenant/company setup | **One click → new tenant, fully seeded, admin invited** |
| **7** | **Field engine Tier 2** — `field_definitions`, label/visibility/mandatory overrides, resolve API | Generic master pattern + ~15 masters (country, city, currency, payment terms, UOM, port, warehouse, incoterm, item, grade, vessel, LME exchange, hedge platform, branch, transport mode) | Rename a field via API → reflected in the form schema, no deploy |
| **8** | Storage: MinIO + ClamAV, streaming upload, presigned URLs | **Supplier master** (FR-001…006) — first module through the registry | Supplier CRUD, uploads scanned + stored |
| **9** | `Money` value object, decimal.js, FX rates, lint rule banning floats in money paths | **Purchase header + shipment + items** | Purchase draft created with lot/BL/container |
| **10** | **Workflow engine** — Draft→Approved→Posted, transitions, immutability | **Pricing + allocation + additional costs** (FR-105/106) | Qty × Rate → USD → AED. Costs allocated. Approve → locked |
| **11** | Field-level RBAC applied to Pricing (demo) + event bus | **LME + hedging** (FR-201…204), `market_prices`, `PriceSource` port, **stock ledger** (FR-108) | Final Rate = LME × (1+Premium%). Posted purchase moves stock |
| **12** | Hardening, seed data, load smoke test, runbooks | Attachments (FR-110), end-to-end trade scenario, demo script | **Full demo: onboard company → supplier → purchase → LME → approve → stock** |

**Week 6 is the checkpoint that matters.** If one-click provisioning isn't working by then, the architecture is wrong and everything downstream slips. Treat it as a go/no-go.

---

## 4. Definition of done

Non-negotiable at week 12:

- [ ] Two tenants, concurrent load, **isolation test proves no `search_path` leak**
- [ ] New tenant onboarded in one call — zero manual SQL
- [ ] Employee invite → self-set password → login → permission-gated access
- [ ] Purchase number gapless under 100 parallel inserts
- [ ] Every create/update/delete audited with before+after, immutable
- [ ] `Other Charges` renamed via API, no deploy, reflected in form schema
- [ ] 500 MT × $8,432.75 × (1 + 2.35%) × 3.6725 AED → **exact to the fils**, verified against a hand calculation
- [ ] Posted purchase cannot be edited; reversal path works
- [ ] Approved purchase moves stock in the ledger
- [ ] Test coverage: tenancy, numbering, money, permissions ≥ 90%
- [ ] `docker compose up` on a clean machine → working system
- [ ] Runbooks: restore, onboard, break-glass

**If it isn't demoable on a clean machine via `docker compose up`, it isn't done.**

---

## 5. Risks

| Risk | Signal | Response |
|---|---|---|
| Masters eat week 7 | Still writing masters in week 8 | They're the *same code* 15 times. If the generic pattern isn't working by day 3, stop and fix the pattern |
| Field engine over-scopes | Tier-3 talk appears | Tier 2 only. Write it on the wall |
| Purchase spec ambiguity | Blocked on "how does allocation work?" | Client questions doc, Q21–22. Ask **now**, not in week 10 |
| Express 5 middleware breaks | v4-era middleware misbehaves | **Verify in week 1**, not week 6 |
| Drizzle + search_path fights back | Type errors on dynamic schema | Fallback: raw SQL in the repository layer. The boundary is what matters, not the ORM |
| 2 engineers, 12 weeks | Week 6 checkpoint missed | Cut Tier 2 field engine (−1 wk), cut ClamAV (−0.5), cut break-glass (−0.5) |

---

## 6. What to tell stakeholders

> "In 90 days you'll see a real company onboarded and a real metals purchase recorded — supplier, shipment, LME pricing, hedging, approval, stock movement — on the production architecture. It won't have Sales, Contracts, or reporting; those are the next phases. What it proves is that the foundation is sound before we build 9 more months on top of it."

**Don't call it an MVP.** An MVP implies someone can run their business on it. This is an architecture proof with one real module — which is more valuable at this stage, and a much easier promise to keep.
