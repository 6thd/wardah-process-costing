# Product Route × Navigation × Permission Gap Inventory

**Snapshot baseline:** `main@680754dbddbfc696ed0e9a7e96d667489ffc6fcd` (before `ALIGN-P1`)

**Reconciled through:** `main@6811ca196dfea8e460b2ac0104dbe8c917ca8e04` (PR #193 merged)

**Status:** historical `ALIGN-P0` acceptance input; it is not a current backlog.

**Purpose:** preserve the evidence that drove `ALIGN-P1` and record its outcome without rewriting the original audit.

**Sources at snapshot time:** `src/pages/routes.tsx`, `src/components/layout/sidebar.tsx`, `src/config/module-permissions.ts`, `src/config/route-permissions.ts`, and implementation/roadmap evidence.

## Post-`ALIGN-P1` reconciliation

PR #193 consumed this inventory and closed its navigation findings:

- `src/config/product-catalog.ts` now owns the navigation structure and derives visibility from exact route-permission contracts;
- the Sidebar-local module tree and duplicate `MODULE_CODES` were removed;
- decorative static readiness/count badges were removed;
- Categories, Routing, Quality, Bins and other non-GA surfaces are represented as `hidden`/`planned` instead of being advertised as GA;
- Accounting and General Ledger remain one visible product group; and
- `landingHref` prevents partial-permission users from being sent to a forbidden or inert group root.

Server-side `SEC-*`, financial-reporting, and manufacturing gaps listed below were not closed by this navigation PR and remain governed by `EXECUTION_LEDGER.md`.

## Classification

- `GA` — visible route has a real screen and a defensible permission contract for the supported behavior.
- `PARTIAL` — route/screen exists, but product depth, permission contract, or implementation truth has a known gap.
- `PLACEHOLDER` — route exists but currently represents an inert/under-development experience.
- `FAIL_CLOSED` — intentionally not reachable because no defensible catalog permission exists.
- `ADMIN` — platform/organization administration, not ordinary product navigation.

The classifications below describe the pre-`ALIGN-P1` UI/navigation snapshot. They do **not** certify the PostgreSQL authorization boundary; open `SEC-*` issues remain authoritative for server-side gaps.

## Cross-cutting findings at the snapshot

1. `routes.tsx` imported canonical `MODULE_CODES` while `sidebar.tsx` defined a second local copy. **Closed by PR #193.**
2. `route-permissions.ts` is materially more precise than `MODULE_PERMISSIONS`: it uses exact catalog keys and `anyOf`/`allOf`, while `MODULE_PERMISSIONS` still models coarse module-level `view/edit` actions and only a subset of subroutes.
3. Sidebar subitems were not filtered from the same exact route contract, allowing visible links to denial/placeholder behavior. **Closed by PR #193.**
4. Sidebar contained decorative static badges (`Manufacturing = "2"`, `Purchasing = "3"`) with no live data source. **Removed by PR #193.**
5. Accounting was already presented as one Sidebar group while spanning `/accounting/*` and `/general-ledger/*`. **Preserved explicitly in the Product Catalog by PR #193.**
6. Compatibility route `/gemini-dashboard/*` redirects to `/reports/insights`; legacy naming remains in routing despite the current product label being Reports & Insights.

## Pre-`ALIGN-P1` module inventory

| Product area | Top-level route | Sidebar at snapshot | Exact route contract | Readiness | Snapshot gap / reconciled outcome |
|---|---|---|---|---|---|
| Dashboard | `/dashboard/*` | Yes | Dashboard is intentionally available to authenticated users | `GA` | PR #193 preserved explicit public-within-authenticated status instead of inventing a permission. |
| Manufacturing | `/manufacturing/*` | Yes, deep tree | Exact per-route keys in `MANUFACTURING_ROUTES` | `PARTIAL` | PR #193 records readiness per child and keeps Routing hidden; Stage Costing remains incomplete under `MFG-P1`. |
| Inventory | `/inventory/*` | Yes, deep tree | Exact per-route keys in `INVENTORY_ROUTES` | `PARTIAL` | Categories had a visible-link/deny mismatch and Bins was a placeholder. PR #193 made both non-GA (`hidden`/`planned`) without weakening route guards. |
| Purchasing / AP | `/purchasing/*` | Yes | Exact supplier/PO/invoice/payment keys; receipts use PO-read parent contract | `GA` for supported first slice | Supplier invoice matched lifecycle was canonical; PR #193 removed the static Sidebar badge. Server-side exact-permission gaps remain separate. |
| Sales / AR | `/sales/*` | Yes | Exact customer/order/invoice/delivery/receipt read keys | `PARTIAL` | PR #193 records child readiness honestly; the later product decision remains trim-to-GA versus deeper implementation. |
| Accounting | `/accounting/*` | Yes, combined with GL | Exact journal/TB/statement/reconciliation requirements | `PARTIAL` | Existing Trial Balance, Account Statement and Reconciliation are real, but financial-report RPC authorization gap #172 blocks treating the reporting boundary as fully hardened. |
| General Ledger | `/general-ledger/*` | No separate group; linked under Accounting | `general_ledger.chart_of_accounts.view` / account-statement view | `PARTIAL` | PR #193 preserved one Accounting group with technical route ownership; duplicate/overlapping CoA permission families remain tracked by #161. |
| HR | `/hr/*` | Yes | Exact employees/attendance/payroll/leaves; settlements mapped to payroll read | `PARTIAL` | `/hr/settings` is intentionally fail-closed and absent from Sidebar until a real resource exists. Server mutation/RBAC debt remains #156. |
| Reports & Insights | `/reports/*` | Yes | Exact financial/inventory/manufacturing/sales/AI keys; purchasing uses operational read keys | `PARTIAL` | PR #193 exposes `/reports/insights` and keeps compatibility redirects non-navigational; financial report server-read gap #172 remains. |
| Settings | `/settings/*` | Yes | Exact organization/users/roles contracts | `PARTIAL` | Sidebar intentionally omits redirect-only users/permissions and integrations. System/backup currently inherit organization-read as parent contract; future dedicated resources may refine this. |
| Org Admin | `/org-admin/*` | Yes for Org Admin/Super Admin | Admin boundary handled outside ordinary module route table | `ADMIN` | Keep outside ordinary operational product catalog permission semantics; catalog may carry `requireOrgAdmin`. |
| Super Admin | `/super-admin/*` | Yes for Super Admin | Platform-admin boundary | `ADMIN` | Keep platform-only with `requireSuperAdmin`. |
| Design System | `/design-system` | No ordinary product nav | No ordinary module requirement | internal | Treat as internal/developer acceptance surface, not a normal ERP module. |

## Recorded mismatches and PR #193 outcomes

### 1. Inventory Categories

- Sidebar contains `/inventory/categories`.
- `route-permissions.ts` intentionally does **not** register the route because the live permission catalog has no `inventory.categories.*` resource and `items.read` was rejected as a nearest-resource guess.
- Result: the link can be visible at module level but route entry fails closed.

**Outcome:** PR #193 marks Categories `hidden`; the route guard remains fail-closed.

### 2. Inventory Bins

- Sidebar contains `/inventory/bins`.
- Route permission exists via `inventory.warehouses.read`.
- `route-permissions.ts` explicitly documents the mounted page as an under-development placeholder.

**Outcome:** PR #193 marks Bins `planned` rather than GA.

### 3. Manufacturing Routing

- Top-level manufacturing module still has routing implementation/routes internally, but the route-permission contract intentionally omits `/routing*` because there is no `manufacturing.routing.*` resource.
- Sidebar already removed Routing and explains why.
- Security issue #152 tracks the real backend/RBAC work.

**Outcome:** PR #193 keeps Routing `hidden`/blocked-by-contract; it is not navigational.

### 4. Manufacturing Stage Costing maturity

- Sidebar exposes Process Costing and related deep reporting screens.
- Current `process-costing-service.ts` still computes `unitCost = totalCost / goodQty` client-side and directly UPSERTs `stage_costs`.
- The advanced manufacturing roadmap defines the legal EUP/FIFO/Scrap engine connection as unfinished `MFG-P1`.

**Outcome:** PR #193 records per-child readiness instead of inferring GA from route existence. `MFG-P1` remains unfinished.

## Product-catalog constraints implemented by PR #193

`src/config/product-catalog.ts` now owns **navigation metadata**, not PostgreSQL authorization. Its contract includes:

- stable product key / module code;
- path and child paths;
- i18n key;
- icon metadata;
- `status: 'ga' | 'beta' | 'planned' | 'hidden'`;
- exact visible permission requirement compatible with `key` / `anyOf` / `allOf`;
- `requireOrgAdmin` / `requireSuperAdmin` where applicable;
- optional `compatibilityOnly` for redirects such as old Gemini URLs;
- optional `blockedByIssue` for known fail-closed product gaps.

PostgreSQL/RPC/RLS remains the final security boundary. The catalog must never be described as granting authority.

## `ALIGN-P0` evidence status after PR #193

- This pre-`ALIGN-P1` snapshot is retained as historical documentation evidence only.
- `ALIGN-P0` itself changes no route, permission, Sidebar item, database object, or Production contract.
- PR #193 consumed the acceptance matrix and its post-merge outcome is recorded at the top of this file and in `EXECUTION_LEDGER.md`.
