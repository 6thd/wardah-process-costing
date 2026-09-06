# Migration 190 — Material Consumption Authorization Boundary

**Finding:** Astra Audit F1 / S0  
**Tracks:** #154 + material-consumption portion of #170  
**Follow-up:** #234 (canonical backflush reimplementation)  
**Predecessor evidence:** PR #232 (`acceptance_f1_material_consumption_auth_red.sql`)  
**Base for implementation:** `main@48c91a420a977215b0f377463882aa19390f3572`  
**Production state:** NOT APPLIED by this PR

## Purpose

Close the proven authorization gap around manufacturing material consumption without
changing canonical inventory valuation, reservation arithmetic, WIP costing, or retry
semantics. Those other contracts remain separate findings/workstreams.

## Exact permission contract

New ordinary permission:

`manufacturing.material_consumption.consume`

Catalog metadata:

- module: `manufacturing`
- resource: `material_consumption`
- action: `consume`

This key is deliberately **ordinary**, not sensitive. Therefore the central RBAC contract
continues to give an active Org Admin the ordinary-key override. Ordinary users require
an explicit active, unexpired role grant in the same organization.

No existing role is auto-granted the new permission. Guessing from neighboring keys such
as `inventory.stock_moves.create` would silently widen authority and is rejected by this
design.

## Mutation boundary after 190

### Canonical RPC paths

The supported consumption path is permission-gated at the canonical boundary:

- `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` — guarded directly after org membership and before consumption business processing;
- `rpc_consume_reserved_materials(uuid,jsonb)` — delegate-only wrapper to v2;
- `consume_materials_for_mo(uuid,uuid,jsonb[])` — compatibility wrapper that reads the MO to validate the supplied organization and rejects an empty payload before delegating; it performs no mutation itself, and all mutation remains behind the v2 guard.

The compatibility wrapper intentionally preserves its pre-existing validation ordering.
Therefore an unauthorized caller that supplies an empty `p_consumptions` array may receive
`CONSUMPTIONS_REQUIRED` before reaching the canonical permission denial. This is not an
authorization bypass: the wrapper is `SECURITY INVOKER`, performs no DML, and delegates all
mutation to the guarded canonical path. The security contract is **no unauthorized side
effect / no alternate mutation path**, not identical error precedence for malformed input.

### Canonical UUID singleton-selection repair

Behavioral GREEN also exposed a pre-existing PostgreSQL defect inside the canonical
`rpc_consume_reserved_materials_v2` body itself. Three optional inference branches used
`min(uuid)`, but PostgreSQL has no built-in `min(uuid)` aggregate:

- `min(stage_id)` when stage is omitted;
- `min(warehouse_id)` when warehouse is omitted;
- `min(id)` for work-order inference when work order is omitted.

Because Migration 190 already replaces this canonical function to add the authorization
guard, leaving those expressions unchanged would knowingly preserve a broken supported
path. Migration 190 therefore repairs all three together using ordered UUID arrays:
`(array_agg(<uuid> ORDER BY <uuid>))[1]`, while retaining the existing `count(*)` gate.
The selected UUID is only consumed when the count is exactly one, so cardinality semantics
remain unchanged; the repair only replaces an invalid aggregate implementation.

Migration postflight explicitly rejects regression to the three `min(uuid)` patterns.

### Legacy backflush quarantine

The F1 GREEN work uncovered a pre-existing defect in the legacy backflush surface:
`backflush_materials` referenced the retired `manufacturing_orders.bom_id` column, and
`auto_backflush_materials` contained the same assumption. More importantly, both legacy
paths directly inserted `material_consumption` rows instead of using the canonical
reservation + valued ledger/bin + stage-WIP transaction.

This is not repaired by guessing a BOM selector inside the F1 security PR. Migration 190
therefore quarantines it fail-closed:

- `backflush_materials(uuid,numeric)` remains executable by `authenticated` so existing
  callers receive an explicit contract, but it first enforces organization membership and
  `manufacturing.material_consumption.consume`, then raises
  `BACKFLUSH_RETIRED_PENDING_CANONICAL_REIMPLEMENTATION` with SQLSTATE `0A000`;
- `trigger_auto_backflush` is removed from `work_orders`, preventing the broken automatic
  path from bypassing the exact permission boundary through direct table writes;
- functional BOM selection and canonical automatic/manual backflush are owned by #234.

This preserves F1 scope: unauthorized consumption cannot occur through the legacy
backflush surfaces, while this PR does not invent manufacturing/BOM behavior.

### Direct table path

`src/services/manufacturing/mesService.ts::consumeMaterial()` still performs a direct
INSERT into `material_consumption`. Migration 190 deliberately preserves only that
compatibility write and protects it with RLS using the same exact permission.

Direct UPDATE and DELETE have no repository consumer. Migration 190 removes both their
RLS policies and their authenticated table privileges. This also prevents direct
mutation of POSTED history without inventing a reversal contract in this authorization
PR.

SELECT behavior is unchanged.

## RED → GREEN evidence

Workflow:

`.github/workflows/material-consumption-auth-190-acceptance.yml`

Sequence:

1. rebuild cutoff-189 PostgreSQL 17 database from the published baseline;
2. run the already-merged F1 RED proof and require the membership-only gap to reproduce;
3. apply Migration 190;
4. build isolated RBAC/manufacturing fixtures;
5. run behavioral GREEN acceptance.

GREEN actors/contracts:

- active same-org member without permission → denied on all client-reachable mutation entry points, including legacy backflush;
- active same-org user with exact grant → passes authorization on canonical paths;
- permitted legacy backflush caller → receives the explicit `0A000` retired contract, never a direct legacy `material_consumption` write;
- revoked role permission → denied;
- expired assignment → denied;
- inactive role → denied;
- inactive membership → denied;
- cross-org caller → denied;
- active Org Admin → allowed under central ordinary-key semantics;
- direct INSERT without permission → denied by RLS;
- direct INSERT with permission → preserved compatibility path;
- direct UPDATE/DELETE → denied even for a permitted caller;
- `trigger_auto_backflush` is absent after 190;
- both compatibility wrappers remain delegate-only and contain no INSERT/UPDATE/DELETE/MERGE/TRUNCATE before the guarded canonical mutator;
- canonical v2 contains no `min(uuid)` singleton-selection regression for stage, warehouse, or work order.

For v2/legacy positive authorization, the fixture intentionally supplies an empty
consumption list. Success is proven by reaching the next legal validation error
`CONSUMPTIONS_REQUIRED`. For `consume_materials_for_mo`, the fixture supplies one
shape-valid row so execution passes its compatibility validation, delegates, and then
reaches the next post-authorization stage/WIP validation. Legacy backflush is tested as
an explicitly permission-gated retired surface rather than as supported manufacturing
behavior. The functional replacement is tracked in #234.

## Production rollout gate

A separate explicit Production authorization is mandatory.

Immediately before any apply, repeat read-only checks for:

1. current migration cutoff is still 189;
2. current definitions/ACLs/policies match Migration 190 preflight assumptions;
3. active ordinary users/roles that legitimately perform material consumption are
   identified and have an explicit rollout plan for the new key;
4. active Org Admin behavior still matches the central RBAC contract;
5. current `trigger_auto_backflush` / `backflush_materials` state is read back and compared with the quarantine assumptions;
6. current v2 body is read back for the three UUID singleton-selection patterns before apply.

A Production readback attempt on 2026-09-06 could not confirm the backflush defect live
because the connected `Wardah-Prod` project was reported INACTIVE and the read-only SQL
query timed out. Therefore #234 records the defect as **cutoff-189 baseline / Fresh DB
confirmed**, not as an independently live-read Production claim.

After an authorized Production apply, required readback:

- ledger cutoff advanced to 190;
- permission key exists exactly once with expected metadata;
- v2 and retired backflush bodies contain the exact permission key;
- v2 no longer contains the three invalid `min(uuid)` singleton selectors;
- retired backflush contains no direct `material_consumption` insert;
- `trigger_auto_backflush` is absent;
- compatibility wrappers remain delegate-only;
- authenticated keeps SELECT + INSERT on `material_consumption` but not UPDATE/DELETE;
- anon has no material-consumption mutation privilege;
- INSERT RLS is authenticated-only and exact-permission based;
- UPDATE/DELETE policies are absent;
- no Production data repair is performed.

## Explicit non-goals

Migration 190 does not:

- reimplement manual or automatic backflush (owned by #234);
- choose or infer a BOM for a manufacturing order;
- add retry/idempotency identity (F3);
- change inventory valuation algorithms;
- fix first-bin concurrency (F2);
- define manufacturing completion truth (F4);
- change tenant-selection identity (F5/FU-6);
- create reversal semantics for material consumption;
- auto-grant the permission to existing ordinary roles;
- normalize legacy validation-error precedence;
- touch historical `material_consumption` rows.
