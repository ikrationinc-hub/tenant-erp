# Prompt — Settings Page Restructure (frontend navigation only)

Split the app into "operate" (main sidebar) and "configure" (a Settings area),
Zoho-style. This is a NAVIGATION change only — no backend, no new endpoints, no
permission changes, no screen rewrites. The same screens are reached through a
different shell.

```
Reorganize the app's navigation into two areas — daily "operate" screens in the
main sidebar, and "configure" screens under a Settings section — following the
Zoho Inventory pattern. Read the 7 frontend rules in CLAUDE.md first.

THIS IS FRONTEND NAVIGATION ONLY. Do NOT touch the backend, endpoints,
permissions, or the screens themselves. You are moving how screens are REACHED,
not changing what they do. If you find yourself editing an API or a permission,
stop — that's out of scope.

AUDIT FIRST — report before changing:
- List every current main-sidebar entry and its route.
- Confirm which screens exist (some config screens may be built-but-unreachable,
  per the recurring menu-drift pattern — check DEFAULT_MENU_TREE and mockMenuTree).

THE SPLIT (the principle: does a normal user touch it weekly? yes=operate,
no=configure):

MAIN SIDEBAR (operate) — keep here:
- Dashboard
- Purchase (Orders, Receipts, Bills)
- Sales (later — leave a slot)
- Inventory (Stock Balances, Movements)
- Contracts (+ Clause Library — used often during contract creation, keep it
  reachable from the Contracts area, NOT buried in Settings)
- Reports

SETTINGS (configure) — move here:
- Masters — ALL of them (countries, cities, currencies, payment terms, UOM,
  ports, warehouses, incoterms, items, item grades, vessels, transport modes,
  LME exchanges, hedge platforms, supplier types, divisions, brokers, containers)
- Users & Roles (including the field-permission matrix)
- Field Definitions (the rename/hide/reorder screen — this is definitionally
  configuration)
- Number Series
- Companies & Branches
- Suppliers / Customers — JUDGEMENT CALL: these are master-like but used often.
  Zoho keeps Vendors in the main Purchases area. Recommend keeping Suppliers
  (and later Customers) in the MAIN sidebar, not Settings, since they're touched
  during daily transactions. Confirm with me if unsure.

BUILD:
1. A Settings shell — a two-column launcher page (like Zoho's All Settings): a
   left column grouping ("Organization Settings": Users & Roles, Companies &
   Branches, Number Series; "Module Settings": Masters, Field Definitions; etc.)
   AND its own sub-navigation sidebar for when you're inside Settings (Zoho's
   second screenshot — a left nav listing the settings groups). Use AntD layout;
   match the existing theme, don't invent a new visual language.
2. A Settings entry point in the main shell — a gear icon in the header (like
   Zoho's top-right), not a main-sidebar item. Clicking it enters the Settings
   area; a "Close Settings" / back control returns to the operate app.
3. MOVE the config screens' ROUTES under a /settings/* path prefix. The screens
   themselves are unchanged — same components, same data hooks, same permissions.
   Only their route location and how they're navigated to changes.
4. SLIM the main sidebar to the operate set above.
5. MENU TREES — the critical part (recurring drift bug): update BOTH
   DEFAULT_MENU_TREE (seed) and mockMenuTree so:
   - operate items appear in the main sidebar tree
   - config items appear under the settings tree
   - NOTHING becomes unreachable. Every screen that was reachable before is
     reachable after, just possibly via Settings now.
   Add a "section" or "area" attribute to menu nodes (operate | settings) if the
   tree doesn't already distinguish, so the frontend knows where to render each.
6. Permissions unchanged — a menu node's requiredPermission still gates it. A
   user without a config permission simply doesn't see that Settings item (and
   possibly not the Settings gear at all if they have no settings access). Do
   NOT change what the permissions ARE.

DON'T:
- Copy Zoho's settings CONTENTS (Taxes, MSME, Direct Taxes, Vendor Portal,
  Digital Signature) — those are Zoho/India-specific. Adopt only the LAYOUT and
  the operate-vs-configure split. Settings holds OUR config.
- Touch any backend route, service, or permission definition.
- Rewrite any screen. Masters, Users, Roles etc. render exactly as they do now.
- Break deep links — a bookmarked /masters/currencies should redirect to its new
  /settings/masters/currencies location, not 404.

TESTS:
- Every previously-reachable screen is still reachable (via main OR settings)
- Main sidebar shows only operate items; Settings shows only config items
- The Settings gear enters Settings; Close returns to the operate app
- A user lacking a config permission doesn't see that settings item
- Old routes redirect to new /settings/* locations (no 404s)
- Both menu trees updated and consistent; nothing orphaned
- No backend or permission files changed (report the diff — it should be
  frontend-only)

Acceptance:
- Audit reported first
- Main sidebar is slimmed to daily-operate screens; all config lives under a
  Settings area with a Zoho-style two-column launcher + settings sub-nav
- 100% of screens still reachable; old links redirect
- Zero backend/permission changes — this is navigation only
- Both menu trees consistent (the recurring drift bug does not recur)
```

---

## Notes

**Why this is safe to do now:** it's frontend-only and reversible. You're
re-presenting boundaries the backend already has (the module registry knows
business-vs-platform; RBAC already gates config behind admin permissions). Nothing
about how data flows changes.

**Why now rather than later:** Sales and Contracts will each add several sidebar
entries. Doing the split before they land means they slot into the right area
from the start, instead of being retro-fitted after the sidebar is even more
crowded.

**The one judgement call to make yourself:** Suppliers/Customers. They're
master-like (argues for Settings) but touched during daily transactions (argues
for main sidebar). Zoho keeps Vendors under Purchases in the main nav. My
recommendation is main sidebar, but it's genuinely a preference — decide based on
how your users actually work. Everything else has a clear home.

**What to watch Claude Code on:** the temptation to "tidy up" the backend while
it's in there, or to copy Zoho's actual settings items. Both are out of scope.
This is moving screens between two navigation shells — nothing more. The test
"no backend/permission files changed" is there to catch exactly that drift.
