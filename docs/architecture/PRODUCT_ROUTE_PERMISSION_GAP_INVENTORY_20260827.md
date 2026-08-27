# Product Route × Navigation × Permission Gap Inventory

**Snapshot:** `main@680754dbddbfc696ed0e9a7e96d667489ffc6fcd`  
**Purpose:** `ALIGN-P0` evidence only — no runtime change.  
**Sources:** `src/pages/routes.tsx`, `src/components/layout/sidebar.tsx`, `src/config/module-permissions.ts`, `src/config/route-permissions.ts`, current implementation/roadmap evidence.

## Classification

- `GA` — visible route has a real screen and a defensible permission contract for the supported behavior.
- `PARTIAL` — route/screen exists, but product depth, permission contract, or implementation truth has a known gap.
- `PLACEHOLDER` — route exists but currently represents an inert/under-development experience.
- `FAIL_CLOSED` — intentionally not reachable because no defensible catalog permission exists.
- `ADMIN` — platform/organization administration, not ordinary product navigation.

This inventory describes UI/navigation truth. It does **not** certify the PostgreSQL authorization boundary; open `SEC-*` issues remain authoritative for server-side gaps.

## Cross-cutting findings

1. `routes.tsx` imports canonical `MODULE_CODES` from `src/config/module-permissions.ts`, while `sidebar.tsx` defines a second local copy. This is direct configuration duplication.
2. `route-permissions.ts` is materially more precise than `MODULE_PERMISSIONS`: it uses exact catalog keys and `anyOf`/`allOf`, while `MODULE_PERMISSIONS` still models coarse module-level `view/edit` actions and only a subset of subroutes.
3. Sidebar subitems are not permission-filtered individually from the same exact route contract. The parent item is filtered by `hasModuleAccess`; route entry then fails closed separately. This allows visible links that may lead to denial/placeholder behavior.
4. Sidebar still contains decorative static badges (`Manufacturing = "2"`, `Purchasing = "3"`) with no live data source.
5. Accounting is already presented as one Sidebar group while technically spanning `/accounting/*` and `/general-ledger/*`; this is a useful precedent for the future product catalog.
6. Compatibility route `/gemini-dashboard/*` redirects to `/reports/insights`; legacy naming remains in routing despite the current product label being Reports & Insights.

## Module inventory

| Product area | Top-level route | Sidebar | Exact route contract | Readiness | Current gap / ALIGN-P1 decision |
|---|---|---|---|---|---|
| Dashboard | `/dashboard/*` | Yes | Dashboard is intentionally available to authenticated users | `GA` | Catalog should preserve explicit public-within-authenticated status rather than invent a permission. |
| Manufacturing | `/manufacturing/*` | Yes, deep tree | Exact per-route keys in `MANUFACTURING_ROUTES` | `PARTIAL` | Routing is intentionally fail-closed/hidden; Stage Costing engine path remains incomplete (`MFG-P1`); some deep screens are not equal in maturity. Catalog needs readiness per child, not one module-wide GA flag. |
| Inventory | `/inventory/*` | Yes, deep tree | Exact per-route keys in `INVENTORY_ROUTES` | `PARTIAL` | `/inventory/categories` is in Sidebar but intentionally absent from route-permissions because no `inventory.categories.*` resource exists — visible-link/deny mismatch. `/inventory/bins` is explicitly an under-development placeholder. |
| Purchasing / AP | `/purchasing/*` | Yes | Exact supplier/PO/invoice/payment keys; receipts use PO-read parent contract | `GA` for supported first slice | Supplier invoice matched lifecycle is now canonical; static Sidebar badge must be removed/replaced. Server-side exact-permission gaps outside supplier invoice remain tracked separately (e.g. #151). |
| Sales / AR | `/sales/*` | Yes | Exact customer/order/invoice/delivery/receipt read keys | `PARTIAL` | Navigation depth is stronger than the product implementation maturity described by the alignment plan. ALIGN-P1 should mark child readiness honestly; later product decision is trim-to-GA vs deepen implementation. |
| Accounting | `/accounting/*` | Yes, combined with GL | Exact journal/TB/statement/reconciliation requirements | `PARTIAL` | Existing Trial Balance, Account Statement and Reconciliation are real, but financial-report RPC authorization gap #172 blocks treating the reporting boundary as fully hardened. |
| General Ledger | `/general-ledger/*` | No separate group; linked under Accounting | `general_ledger.chart_of_accounts.view` / account-statement view | `PARTIAL` | Good IA direction (one Accounting group), but duplicate/overlapping CoA permission families are tracked by #161. Catalog should model one visible Accounting group with technical route ownership metadata. |
| HR | `/hr/*` | Yes | Exact employees/attendance/payroll/leaves; settlements mapped to payroll read | `PARTIAL` | `/hr/settings` is intentionally fail-closed and absent from Sidebar until a real resource exists. Server mutation/RBAC debt remains #156. |
| Reports & Insights | `/reports/*` | Yes | Exact financial/inventory/manufacturing/sales/AI keys; purchasing uses operational read keys | `PARTIAL` | Financial report server-read gap #172; compatibility Gemini routes remain. Product catalog should expose `/reports/insights` and keep compatibility redirects non-navigational. |
| Settings | `/settings/*` | Yes | Exact organization/users/roles contracts | `PARTIAL` | Sidebar intentionally omits redirect-only users/permissions and integrations. System/backup currently inherit organization-read as parent contract; future dedicated resources may refine this. |
| Org Admin | `/org-admin/*` | Yes for Org Admin/Super Admin | Admin boundary handled outside ordinary module route table | `ADMIN` | Keep outside ordinary operational product catalog permission semantics; catalog may carry `requireOrgAdmin`. |
| Super Admin | `/super-admin/*` | Yes for Super Admin | Platform-admin boundary | `ADMIN` | Keep platform-only with `requireSuperAdmin`. |
| Design System | `/design-system` | No ordinary product nav | No ordinary module requirement | internal | Treat as internal/developer acceptance surface, not a normal ERP module. |

## Confirmed visible-link mismatches to fix in `ALIGN-P1`

### 1. Inventory Categories

- Sidebar contains `/inventory/categories`.
- `route-permissions.ts` intentionally does **not** register the route because the live permission catalog has no `inventory.categories.*` resource and `items.read` was rejected as a nearest-resource guess.
- Result: the link can be visible at module level but route entry fails closed.

**Decision for ALIGN-P1:** mark `categories` `hidden`/`planned` until a first-class permission contract exists; do not weaken the route guard to make the link work.

### 2. Inventory Bins

- Sidebar contains `/inventory/bins`.
- Route permission exists via `inventory.warehouses.read`.
- `route-permissions.ts` explicitly documents the mounted page as an under-development placeholder.

**Decision for ALIGN-P1:** do not advertise it as GA. Mark `planned`/`beta` according to the screen's actual capability.

### 3. Manufacturing Routing

- Top-level manufacturing module still has routing implementation/routes internally, but the route-permission contract intentionally omits `/routing*` because there is no `manufacturing.routing.*` resource.
- Sidebar already removed Routing and explains why.
- Security issue #152 tracks the real backend/RBAC work.

**Decision for ALIGN-P1:** encode Routing as `hidden`/blocked-by-contract in the catalog; do not re-add navigation until #152 or its accepted replacement closes the server boundary.

### 4. Manufacturing Stage Costing maturity

- Sidebar exposes Process Costing and related deep reporting screens.
- Current `process-costing-service.ts` still computes `unitCost = totalCost / goodQty` client-side and directly UPSERTs `stage_costs`.
- The advanced manufacturing roadmap defines the legal EUP/FIFO/Scrap engine connection as unfinished `MFG-P1`.

**Decision for ALIGN-P1:** navigation/catalog work must not label all manufacturing children GA merely because routes exist. Readiness is independent from route existence.

## Product-catalog constraints for `ALIGN-P1`

The future `src/config/product-catalog.ts` should own **navigation metadata**, not PostgreSQL authorization. Minimum fields:

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

## ALIGN-P0 close criteria from this inventory

- This snapshot is documentation evidence only.
- No route, permission, Sidebar item or Production contract changes in ALIGN-P0.
- `ALIGN-P1` must use this inventory as its starting acceptance matrix and update it when the code PR changes visible navigation behavior.
