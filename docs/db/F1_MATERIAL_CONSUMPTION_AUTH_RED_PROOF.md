# F1 — Material Consumption Authorization RED Proof

**Date:** 2026-09-06  
**Source:** Astra Architecture Red-Team Audit #1, F1 / S0  
**Tracking:** #154 + #170  
**Base:** `main@4c7db6e5243314b679dbd1e9b288304be913cbf9`  
**Production writes:** none

## Purpose

Freeze the current authorization gap as deterministic evidence before designing the fix.
This PR is intentionally RED-proof only: it does not add a permission key, change RLS,
replace RPC bodies, migrate consumers, or revoke table grants.

## Live read-only verification

A Production metadata/function-body read on 2026-09-06 confirmed:

1. `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` is `SECURITY DEFINER`,
   executable by `authenticated`, and checks `wardah_assert_org_member(v_org)` but
   no exact `has_permission(...)`/`wardah_has_exact_permission(...)` key.
2. `backflush_materials(uuid,numeric)` is also `SECURITY DEFINER`, executable by
   `authenticated`, and membership-only.
3. `rpc_consume_reserved_materials(uuid,jsonb)` and
   `consume_materials_for_mo(uuid,uuid,jsonb[])` remain authenticated-executable
   compatibility entry points into the same consumption boundary.
4. `material_consumption` exposes INSERT/UPDATE/DELETE through membership-only RLS.
5. `authenticated` has direct INSERT/UPDATE/DELETE table privileges on
   `material_consumption`; `anon` also retains table DML grants, although the current
   membership predicate blocks unauthenticated row access.
6. The live permission catalog contains `inventory.stock_moves.*` and broad
   manufacturing keys, but no exact material-consumption execution permission.
7. Repository consumer `src/services/manufacturing/mesService.ts` still has two
   relevant mutation paths:
   - `backflushMaterials()` → `backflush_materials` RPC;
   - `consumeMaterial()` → direct INSERT to `material_consumption`.

## Why an existing key is not selected yet

`inventory.stock_moves.create` describes a generic stock-movement authority, while
material consumption changes manufacturing reservation state, stock valuation, WIP
material cost, and manufacturing cost provenance. Reusing the nearest key without an
explicit contract would silently broaden or narrow authority.

The fix should introduce a first-class material-consumption permission contract rather
than guess from neighboring resources. Exact key naming and whether reversal is a
separate sensitive action belong in the FIX design, not this proof PR.

## Deterministic RED acceptance

`scripts/ci/fresh-db/acceptance_f1_material_consumption_auth_red.sql` asserts on a
cutoff-189 Fresh DB that:

- all four client-facing consumption functions exist and are executable by
  `authenticated`;
- the two privileged write bodies remain membership-only and have no exact permission
  guard;
- authenticated direct INSERT/UPDATE/DELETE on `material_consumption` is granted;
- all three write RLS policies lack exact permission enforcement;
- no semantically exact material-consumption permission key already exists.

The workflow stores the output as a 30-day artifact.

## What this RED proof does not claim

- It does not mutate Production.
- It does not execute a real manufacturing consumption transaction.
- It does not prove a cross-tenant disclosure.
- It does not decide whether org-admin override is allowed for the future permission.
- It does not close #154 or #170.

Behavioral direct-call fixtures belong in the FIX PR so the same actors can be tested
before and after the additive migration without duplicating a large manufacturing
fixture in two separate changes.

## FIX PR gate

Do not implement until this RED proof is green in CI. The following FIX acceptance is
mandatory:

1. ordinary active same-org member without the exact permission is denied on every
   supported consumption RPC;
2. explicitly granted role succeeds;
3. revoked, expired, inactive-role and inactive-membership actors fail closed;
4. cross-org actor fails closed;
5. org-admin behavior follows the central RBAC contract deliberately;
6. direct `material_consumption` mutation cannot bypass the supported guarded path;
7. all supported repository consumers have a replacement before direct DML is revoked;
8. inventory quantity/value, reservations and WIP cost remain atomic and unchanged by
   the authorization-only change;
9. migration is additive and Production apply requires separate explicit authorization.
