# Migration 190 — Material Consumption Authorization Boundary

**Finding:** Astra Audit F1 / S0  
**Tracks:** #154 + material-consumption portion of #170  
**Predecessor evidence:** PR #232 (`acceptance_f1_material_consumption_auth_red.sql`)  
**Base for implementation:** `main@48c91a420a977215b0f377463882aa19390f3572`  
**Production state:** NOT APPLIED by this PR

## Purpose

Close the proven authorization gap around manufacturing material consumption without
changing inventory valuation, reservation arithmetic, WIP costing, or retry semantics.
Those other contracts remain separate findings/workstreams.

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

### RPC paths

The following client-facing paths remain executable by `authenticated`, but all legal
material-consumption mutation reaches an exact-permission guard before any inventory,
reservation, WIP-cost, or `material_consumption` write:

- `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` — guarded directly after org membership and before consumption business processing;
- `rpc_consume_reserved_materials(uuid,jsonb)` — delegate-only wrapper to v2;
- `consume_materials_for_mo(uuid,uuid,jsonb[])` — compatibility wrapper that reads the MO to validate the supplied organization and rejects an empty payload before delegating; it performs no mutation itself, and all mutation remains behind the v2 guard;
- `backflush_materials(uuid,numeric)` — guarded directly before its insert loop.

The compatibility wrapper intentionally preserves its pre-existing validation ordering.
Therefore an unauthorized caller that supplies an empty `p_consumptions` array may receive
`CONSUMPTIONS_REQUIRED` before reaching the canonical permission denial. This is not an
authorization bypass: the wrapper is `SECURITY INVOKER`, performs no DML, and delegates all
mutation to the guarded canonical path. The security contract is **no unauthorized side
effect / no alternate mutation path**, not identical error precedence for malformed input.

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

- active same-org member without permission → denied on all four entry points when supplied an input shape that reaches the authorization boundary;
- active same-org user with exact grant → passes authorization;
- revoked role permission → denied;
- expired assignment → denied;
- inactive role → denied;
- inactive membership → denied;
- cross-org caller → denied;
- active Org Admin → allowed under central ordinary-key semantics;
- direct INSERT without permission → denied by RLS;
- direct INSERT with permission → preserved compatibility path;
- direct UPDATE/DELETE → denied even for a permitted caller;
- compatibility wrappers remain delegate-only and contain no INSERT/UPDATE/DELETE/MERGE/TRUNCATE before the guarded canonical mutator.

For v2/legacy positive authorization, the fixture intentionally supplies an empty
consumption list. Success is proven by reaching the next legal validation error
`CONSUMPTIONS_REQUIRED`. For `consume_materials_for_mo`, the fixture supplies one
shape-valid row so execution passes its compatibility validation, delegates, and then
reaches the next post-authorization stage/WIP validation. `backflush_materials` uses an
empty-BOM work order and returns zero rows after passing the authorization gate.
Inventory/cost arithmetic remains covered by its existing contracts.

## Production rollout gate

A separate explicit Production authorization is mandatory.

Immediately before any apply, repeat read-only checks for:

1. current migration cutoff is still 189;
2. current definitions/ACLs/policies match Migration 190 preflight assumptions;
3. active ordinary users/roles that legitimately perform material consumption are
   identified and have an explicit rollout plan for the new key;
4. active Org Admin behavior still matches the central RBAC contract.

Read-only verification on 2026-09-06 found one active organization membership and it was
an Org Admin membership. That observation is **not** a future apply assumption; it must
be re-read immediately before Production rollout.

After an authorized Production apply, required readback:

- ledger cutoff advanced to 190;
- permission key exists exactly once with expected metadata;
- both guarded function bodies contain the exact key;
- compatibility wrappers remain delegate-only;
- authenticated keeps SELECT + INSERT on `material_consumption` but not UPDATE/DELETE;
- anon has no material-consumption mutation privilege;
- INSERT RLS is authenticated-only and exact-permission based;
- UPDATE/DELETE policies are absent;
- no Production data repair is performed.

## Explicit non-goals

Migration 190 does not:

- add retry/idempotency identity (F3);
- change inventory valuation algorithms;
- fix first-bin concurrency (F2);
- define manufacturing completion truth (F4);
- change tenant-selection identity (F5/FU-6);
- create reversal semantics for material consumption;
- auto-grant the permission to existing ordinary roles;
- normalize legacy validation-error precedence;
- touch historical `material_consumption` rows.
