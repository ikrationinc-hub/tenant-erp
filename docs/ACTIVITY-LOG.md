# Activity Log — Design & Prompts

Extends the BE-8 audit engine into a complete, viewable activity trail.
**Add these after BE-8 (backend) and after FE-4 (frontend).**

---

## 1. What already exists vs. what's missing

| | Status |
|---|---|
| `audit_logs` table — who, what, when, before/after JSONB | ✅ BE-8 |
| Written inside the business transaction | ✅ BE-8 |
| Immutable — app role cannot UPDATE/DELETE | ✅ BE-8 |
| Partitioned monthly | ✅ BE-8 |
| Auth events (login, failure, permission change) | ⚠️ BE-8 mentions it — verify it landed |
| **Export / download / report events** | ❌ |
| **A permission governing who can read the log** | ❌ |
| **Per-record history ("this purchase's changes")** | ❌ |
| **Per-user activity ("what did Ahmed do today")** | ❌ |
| **Field-permission filtering of diffs** | ❌ **← security bug if missed** |
| **Human-readable diffs (labels, not column names)** | ❌ |

---

## 2. The field-permission leak — read this before building the viewer

Field-level RBAC hides `purchase_rate_usd` from a Sales Officer. The audit log stores:

```json
{ "before": { "purchase_rate_usd": "8432.75" },
  "after":  { "purchase_rate_usd": "8510.00" } }
```

If the viewer returns that diff unfiltered, **the audit log defeats every field permission in the system.** The user reads the value in the history that they cannot read on the form.

**Rule: the audit viewer is an egress path.** It runs diffs through the same field-permission filter as any other response (frontend rule 4 / backend field-RBAC read boundary). A field the user cannot view is stripped from `before` and `after` — and the log shows `"— (restricted)"` rather than omitting the row entirely, so the *fact* of a change stays visible while the value does not.

Same logic for the entity itself: a user who cannot read purchases cannot read purchase audit rows.

---

## 3. What to log

### Always (write path — already in BE-8)
Create · Update · Delete (soft) · Approve · Post · Reverse · Status transitions

### Always (auth & access)
Login success · login failure (with reason) · logout · password change · password reset · invite sent/accepted/revoked · role assigned/removed · permission changed · field permission changed · user suspended/reactivated · break-glass session opened/closed

### Always (data egress)
Export to Excel/CSV · PDF download · report generation · attachment download · **bulk list fetches above a threshold** (e.g. `pageSize > 500`)

### Do NOT log
Ordinary list views · ordinary detail opens · navigation · search queries

> **Why:** traders open hundreds of records a day. Logging every read produces 10–100× the volume of your business data, and answers a question nobody asks. Logging *egress* answers the question that matters — "who took data out of the system" — at a fraction of the cost.
>
> If the client later insists on full read logging, it goes to a **separate table with a shorter retention**, never into `audit_logs` alongside the financial trail.

---

## 4. Schema additions

```sql
-- extend the existing audit_logs
ALTER TABLE audit_logs ADD COLUMN category text NOT NULL DEFAULT 'data';
  -- 'data' | 'auth' | 'access' | 'export' | 'admin'
ALTER TABLE audit_logs ADD COLUMN summary text;
  -- pre-rendered human line: "Approved purchase PO-DXB-2526-0042"
ALTER TABLE audit_logs ADD COLUMN session_id uuid;

-- indexes the viewer needs (audit_logs is partitioned — index each partition)
CREATE INDEX ON audit_logs (company_id, changed_at DESC);
CREATE INDEX ON audit_logs (entity, entity_id, changed_at DESC);   -- record history
CREATE INDEX ON audit_logs (changed_by, changed_at DESC);          -- user activity
CREATE INDEX ON audit_logs (company_id, category, changed_at DESC);
```

`summary` is written at log time, not rendered at read time — the viewer must stay fast over millions of partitioned rows.

---

## 5. Permissions

Three distinct permissions — do not collapse them into one:

| Key | Grants |
|---|---|
| `audit.record.view` | History of a record you can already read. Safe for most roles |
| `audit.user.view` | Another user's activity across the system. Supervisor / admin |
| `audit.export` | Export the audit trail itself. Restrict tightly |

**Viewing the audit log is itself audited** (`category='access'`). Who watched the watchers is a question every real audit asks.

The tenant admin gets `audit.user.view` by default. Nobody — including the tenant admin — can delete or edit an entry; that's enforced at the DB role (BE-8), not in application code.

---

## 6. Retention

`audit_logs` will become your largest table. Decide now, implement as a partition-drop job:

- **Financial records** (`category='data'` on purchases, invoices, payments): keep per the client's statutory requirement — commonly 5–10 years. **Ask; do not guess.**
- **Auth/access events:** 12–24 months typically satisfies a security review.
- **Export events:** match the financial retention — these are the ones an investigation needs.

Partition-drop, never `DELETE`. A `DELETE` against a multi-million-row audit table will lock your production database.

---

## 7. Prompts

### BE-8b — Activity log backend

```
Extends BE-8. Read section 2 of docs/ACTIVITY-LOG.md first — the field-permission leak is the critical part of this prompt.

1. Schema: add category, summary, session_id to audit_logs (see docs/ACTIVITY-LOG.md §4). Add the four indexes. Remember audit_logs is partitioned — indexes apply per partition.

2. Broaden capture beyond writes:
   - Auth events: login success/failure (+reason), logout, password change/reset, invite sent/accepted/revoked
   - Admin events: role assigned/removed, permission changed, field permission changed, user suspended/reactivated, module enabled/disabled
   - Export events: Excel/CSV export, PDF download, report generation, attachment download, and any list fetch with pageSize > 500
   - Do NOT log ordinary list views, detail opens, navigation, or searches — see §3 for why. If a requirement seems to need full read logging, stop and ask.

3. summary: a human-readable line written AT LOG TIME, not rendered at query time. "Approved purchase PO-DXB-2526-0042", "Failed login for a.hassan@... (wrong password)", "Exported 1,240 supplier rows to Excel".

4. Permissions: seed audit.record.view, audit.user.view, audit.export. Grant the first two to the default Admin role, audit.record.view to Manager.

5. Endpoints, all permission-gated:
   - GET /api/v1/audit/records/:entity/:id     — one record's history (needs audit.record.view AND read access to that entity)
   - GET /api/v1/audit/users/:userId           — one user's activity (needs audit.user.view)
   - GET /api/v1/audit                         — filtered feed: date range, category, entity, user, action (needs audit.user.view)
   All paginated server-side (backend rule 10), sorted changed_at DESC.

6. ⚠️ FIELD-PERMISSION FILTERING — the security-critical part:
   Before returning any before/after diff, filter it through the SAME field-permission resolver used by the response serializer (BE-6). A field the requesting user cannot view is replaced with a "restricted" marker in both before and after — NOT omitted, so the fact of a change stays visible while the value does not.
   Also: a user who cannot read the underlying entity cannot read its audit rows at all.
   Do not write a second, parallel permission check here — reuse the existing resolver, or the two will drift.

7. Viewing the audit log is itself logged, with category='access'.

8. Retention: a BullMQ scheduled job that DROPS old partitions per the retention policy in config. Never DELETE — a DELETE on a multi-million-row audit table locks production.

THE TESTS THAT MATTER:
- A user without can_view on purchase_rate_usd requests a purchase's history → the diff shows the change occurred but the VALUE is restricted in both before and after
- A user who cannot read purchases gets 403 on that purchase's audit endpoint
- Viewing the audit log writes an access-category entry
- Auth failures are logged with a reason
- An export writes an export-category entry with the row count
- Retention job drops the correct partition and no others
- The record-history query on a seeded 100k-row table returns in reasonable time (index check)

Acceptance:
- The field-permission leak test passes — this is the point of the prompt
- No parallel permission logic; the existing resolver is reused
```

### FE-8 — Activity log viewer

```
Read docs/ACTIVITY-LOG.md §2. Build after FE-4 (SchemaTable + navigation exist).

1. Record history — a drawer/tab on any detail screen: timeline of changes to THIS record. Each entry: who, when, action, and a field-by-field before→after diff.
   - Field LABELS come from field-definitions, never raw column names. If the client renamed "Other Charges" to "Clearing Charges", the audit log says Clearing Charges. Reuse the field-engine metadata the SchemaForm already fetches.
   - Restricted fields render as "— (restricted)" with a muted style. The row still shows that a change happened.
   - Money values display as returned by the API — strings, never parseFloat (frontend rule 3).

2. User activity page — pick a user, see their timeline. Filter by date range and category. AntD Timeline or a dense Table; dense is better for an audit context.

3. Global activity feed — a filterable table: date range, category (data/auth/access/export/admin), entity, user, action. Server-side pagination and filtering (backend rule 10) with URL-synced state so a filtered view is shareable.

4. Diff rendering: side-by-side or inline-highlighted. Show ONLY changed fields by default, with a toggle for the full record. A 50-field purchase where two fields changed should show two rows, not fifty.

5. Gate every entry point with <Can/> on the right permission. A user without audit.user.view never sees the user-activity nav item — the menu engine already handles this if the menu rows carry required_permission.

6. Export button gated on audit.export.

Tests: history drawer renders a diff from mocked data; restricted fields show the restricted marker and NOT the value; labels come from field-definitions (change the fixture label, assert the DOM changes); only-changed-fields default; filters hit the server; permission gating hides entry points.

Acceptance:
- `grep -rn 'label="' src/modules/audit/` returns nothing — labels come from metadata
- A restricted field's value never appears in the DOM, including in any data attribute or JSON payload rendered to the page
```

---

## 8. Add to the client questions

Slot these into section 4 (Security and audit) of `Client-Questions-Hyperion.md`:

- **Retention:** how long must financial audit records be kept? Auth/access events?
- **Read logging:** we propose logging changes, logins, and data exports — but not every screen view, as that grows 10–100× faster than your business data and rarely answers a real question. Does that meet your audit expectations?
- **Who may view whose activity?** Should a branch manager see only their branch's users, or all?
- **Employee monitoring notice:** activity logging of staff carries notification requirements in some jurisdictions, and you operate in several. Does your HR or legal team need to review what we capture?
