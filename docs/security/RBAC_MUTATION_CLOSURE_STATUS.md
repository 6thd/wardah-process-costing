# RBAC Mutation Closure Status

Parent epic: #48  
Inventory issue: #148  
Inventory PR: #149

## Purpose

This document records the server-authorization audit of production mutation paths. It is intentionally separate from implementation fixes: PR #149 inventories and classifies the current surface; verified authorization defects are split into focused child issues so unrelated financial, inventory, manufacturing, sales, and HR changes are not bundled together.

## Stable discovery baseline

The TypeScript AST inventory currently scans 486 production TS/TSX files and records 374 mutation/RPC candidates across 343 stable signatures:

- 258 direct Supabase table mutations
- 115 RPC calls
- 1 Edge Function invocation

The baseline is pinned by count and SHA-256. CI fails if a production mutation/RPC signature changes without review and still uploads the generated artifact for inspection.

## Reviewed high-risk domains

| Domain | Current verdict | Tracking |
| --- | --- | --- |
| Super-admin organization mutations | Server-covered by Production RLS; dedicated positive/negative/cross-org acceptance still required | #148 / parent #48 |
| Journal / GL create-post-approve-reverse | Verified service-level gaps or overly coarse org-admin guards | #150 |
| Purchasing / goods receipt / supplier payments | Verified membership/admin-only guards where exact business permissions are required; cancel/unpost exact guards already proven | #151 |
| Manufacturing Routing | Verified gap: routing tables are writable through membership-only RLS and no first-class routing permission resource exists | #152 |
| Inventory stock adjustments / storage bins | Verified granular-permission gap; warehouses and storage locations remain RLS fail-closed for direct writes | #153 |
| Manufacturing MES / work-order execution | Verified gap: execution RPCs and operational tables are primarily membership-authorized | #154 |
| Sales delivery posting | Verified gap at `rpc_post_delivery_note`; legacy direct sales writes are currently RLS fail-closed and need reconciliation | #155 |
| HR attendance / payroll / settlements | Verified gap: attendance DEFINER RPC is membership-only; payroll/settlement uses org-admin checks; multiple HR tables still rely on legacy `admin/manager` membership roles | #156 |

## Important proven protections

The audit must preserve protections already demonstrated by earlier migrations and browser acceptance:

- tenant/cross-org isolation from Migration 170;
- exact permission semantics and active-role checks from Migrations 172/173;
- sensitive-permission controls from Migration 174;
- audited atomic RBAC mutation RPCs, last-admin/self-removal protections and concurrency handling from Migration 175;
- authenticated direct-write closure on `roles`, `role_permissions`, and `user_roles` from Migration 176;
- `accounting.vouchers.cancel` and `accounting.vouchers.unpost` exact server-side checks, browser visibility/revocation behavior, and direct-call denial from #93 / PR #145.

## Classification semantics

The generated matrix uses these verdicts:

- `verified_gap`: live server boundary is weaker than the intended exact RBAC contract;
- `follow_up_required`: reviewed path belongs to a focused child issue, but individual rows may include both protected and legacy/dead callers;
- `server_covered_exact_permission`: exact server-side business permission enforcement is confirmed;
- `server_covered_rls_needs_acceptance`: RLS provides the server boundary, but dedicated acceptance is still required by #48;
- `server_fail_closed_rls`: direct mutation is rejected by current RLS and must not be reopened accidentally;
- `pending_review`: candidate is pinned by CI but still awaits a server-authorization verdict.

## Safety rule

No Production mutation is performed as part of this inventory. Production inspection is limited to read-only metadata/catalog queries (`pg_proc`, grants, policies, triggers and permission catalog). Each implementation issue must use an isolated/fresh database acceptance path before any Production migration decision.

## Exit criteria for #148

#148 is not complete until every pinned candidate has a non-pending verdict, all high-risk verified gaps have focused child issues, and the generated matrix plus drift gate are green. Fixes themselves may remain open under the parent #48, but no sensitive production mutation path may disappear from the closure plan.
