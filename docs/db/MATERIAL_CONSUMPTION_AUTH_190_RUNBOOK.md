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
consumption reaches an exact-permission guard before business mutation:

- `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` — guarded directly
- `rpc_consume_reserved_materials(uuid,jsonb)` — delegates to v2
- `consume_materials_for_mo(uuid,uuid,jsonb[])` — validates MO/org then delegates to v2
- `backflush_materials(uuid,numeric)` — guarded directly

The guard is placed after the existing organization-membership check and before payload
processing or inserts.

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

- active same-org member without permission → denied on all four entry points;
- active same-org user with exact grant → passes authorization;
- revoked role permission → denied;
- expired assignment → denied;
- inactive role → denied;
- inactive membership → denied;
- cross-org caller → denied;
- active Org Admin → allowed under central ordinary-key semantics;
- direct INSERT without permission → denied by RLS;
- direct INSERT with permission → preserved compatibility path;
- direct UPDATE/DELETE → denied even for a permitted caller.

For v2/compatibility positive authorization, the fixture intentionally supplies an empty
consumption list. Success is proven by reaching the next legal validation error
`CONSUMPTIONS_REQUIRED`, rather than by building an unrelated inventory/WIP scenario.
`backflush_materials` uses an empty-BOM work order and returns zero rows after passing the
authorization gate. Inventory/cost arithmetic remains covered by its existing contracts.

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
- touch historical `material_consumption` rows.
