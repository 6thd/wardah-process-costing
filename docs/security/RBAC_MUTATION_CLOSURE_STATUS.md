# RBAC Mutation Closure Status

Parent epic: #48  
Inventory issue: #148  
Inventory PR: #149

## Purpose

This document records the server-authorization audit of production mutation and RPC paths. PR #149 is inventory-only: verified authorization defects are split into focused child issues so unrelated financial, inventory, manufacturing, sales, HR, audit, and organization-admin changes are not bundled together.

## Final stable discovery baseline

The TypeScript AST inventory scans 486 production TS/TSX files and records 374 candidates across 343 stable signatures:

- 258 direct Supabase table mutations
- 115 RPC calls
- 1 Edge Function invocation

Baseline signature SHA-256:

`0cbeda396a8d927f3dcee92d713ef485b37424a61bc35a3456a79d9851db2b8d`

CI fails if a production mutation/RPC signature changes without review and still uploads the candidate and closure-matrix artifacts for inspection.

## Final closure matrix

Every candidate has a reviewed verdict: **`pending_review = 0`**.

| Verdict | Call-sites |
| --- | ---: |
| `verified_gap` | 157 |
| `follow_up_required` | 82 |
| `server_fail_closed_rls` | 80 |
| `stale_not_in_production` | 23 |
| `server_covered_admin_boundary` | 19 |
| `server_covered_exact_permission` | 5 |
| `server_covered_member_read` | 3 |
| `server_covered_rls_needs_acceptance` | 2 |
| `server_covered_token_boundary` | 1 |
| `server_invoker_no_privilege_escalation` | 1 |
| `scanner_false_positive` | 1 |
| **Total** | **374** |

These are call-site counts, not distinct vulnerabilities. Multiple callers of the same weak server boundary are grouped under the same focused follow-up issue.

## Focused closure issues

| Domain | Verified scope | Tracking |
| --- | --- | --- |
| Journal / GL mutation | Journal create/post helpers and related mutation boundary | #150 |
| Purchasing | Purchase-order, goods-receipt, supplier-payment actions and PO read helper | #151 |
| Manufacturing Routing | Membership-only routing CRUD and missing first-class routing permission contract | #152 |
| Inventory adjustments / bins | Adjustment mutations and storage-bin authorization | #153 |
| Manufacturing MES | Work-order execution, labor/material/downtime/quality operational mutations | #154 |
| Sales delivery | Delivery posting exact-permission gap and legacy caller reconciliation | #155 |
| HR / Payroll | Attendance, payroll, settlement and legacy role-string authorization | #156 |
| Inventory item/product master | `products` table authorization plus `items` vs `products` permission-family ambiguity | #157 |
| Manufacturing core | Orders, BOM, stages, capacity, stage costs, scheduling and costing | #158 |
| Customer receipts | Receipt create/update/post; cancel/unpost exact protections must be preserved | #159 |
| Stock transfers / manual moves | Transfer table writes and membership-only manual movement RPC | #160 |
| Chart of accounts | `gl_accounts` exact create/update/delete permissions | #161 |
| Fiscal periods | Period generation/status mutation plus accounting read alignment | #162 |
| UoM master data | Base UoM, conversions, physical weight and backfill actions | #163 |
| Invitation role/org integrity | Invitation role IDs can violate role-to-org invariant before acceptance | #167 |
| Legacy permission resolver | `get_user_permissions` caller binding and role/org alignment | #168 |
| Organization membership writes | Direct `user_organizations` DML bypasses audited RPC invariants | #169 |
| Reservations / physical counts | Material reservation/consumption and physical-count authorization | #170 |
| Audit integrity | Client-forged inserts can enter the trusted audit stream | #171 |
| Accounting read/report paths | Statements, trial balance, reconciliation and account lookup | #172 |
| Inventory read/valuation paths | Stock balance, aging, availability, batches, valuation and validation reads | #173 |
| Manufacturing read/report paths | Costing, BOM cost, OEE/efficiency and variance reporting | #174 |

## Important proven protections

The audit preserves protections already demonstrated by earlier migrations and acceptance:

- tenant/cross-org isolation from Migration 170;
- exact permission semantics and active-role checks from Migrations 172/173;
- sensitive-permission controls from Migration 174;
- audited atomic RBAC mutation RPCs, last-admin/self-removal protections and concurrency handling from Migration 175;
- authenticated direct-write closure on `roles`, `role_permissions`, and `user_roles` from Migration 176;
- `accounting.vouchers.cancel` and `accounting.vouchers.unpost` exact server-side checks and browser/server revocation behavior from #93 / PR #145;
- canonical `has_permission`, `wardah_has_exact_permission`, and `rpc_permission_snapshot` enforce caller/organization/active-role/expiry semantics;
- `reports-insights` authenticates the caller, resolves the caller organization with a user-scoped client, and checks exact `reports.ai_insights.use` before its service-role quota call.

## Fail-closed and stale-path findings

The inventory distinguishes a live authorization weakness from a dead/broken caller:

- many direct mutations are currently rejected because Production has SELECT-only RLS on the target table;
- several repository targets no longer exist in Production and are classified `stale_not_in_production` rather than as open bypasses;
- SECURITY INVOKER helpers that inherit caller RLS without elevating privilege are recorded separately;
- one Supabase Auth call was identified as a scanner false positive rather than a database RPC.

None of these classifications permits silently reopening a write path: a future change to grants, RLS, function security mode, or mutation signatures must be reviewed against the matrix.

## Classification semantics

- `verified_gap`: live server boundary is weaker than the intended exact RBAC contract;
- `follow_up_required`: reviewed path belongs to a focused remediation/reconciliation issue;
- `server_covered_exact_permission`: exact server-side business permission enforcement is confirmed;
- `server_covered_admin_boundary`: operation is intentionally bounded by an org-admin/super-admin server boundary;
- `server_covered_member_read`: reviewed read/calculation helper is intentionally membership-scoped and non-mutating;
- `server_covered_rls_needs_acceptance`: RLS provides the boundary, with dedicated acceptance still required by #48;
- `server_covered_token_boundary`: token possession plus server validation is the intended read boundary;
- `server_fail_closed_rls`: direct mutation is rejected by current RLS;
- `server_invoker_no_privilege_escalation`: SECURITY INVOKER helper inherits caller privileges/RLS;
- `stale_not_in_production`: repository target is absent from the live schema;
- `scanner_false_positive`: AST candidate is not a database mutation/RPC boundary.

## Safety

No Production mutation was performed as part of #148/#149. Production inspection was limited to read-only catalog/metadata/function-definition queries. Remediation issues must use isolated/fresh-database acceptance before any Production migration decision.

## Exit status for #148

The inventory exit criteria are satisfied:

- every pinned candidate has a non-pending verdict;
- high-risk gaps have focused child issues;
- the machine-readable matrix and signature drift gate are green;
- the results are linked back to parent #48.

The implementation issues intentionally remain open under #48 after #148 closes.
