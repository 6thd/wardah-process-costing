# Proposal — manufacturing write boundaries after M192 (#170, #154, #229)

**Status:** review contract only, not implemented and not an authorization to change Production or expose employee consumption. Anchor: `main@76689dc076ca50f1765603bf7fb17439e4d0af39`. Executor read-only Production catalog on 2026-09-28: M190, M191, M192 each once; `authenticated` has no INSERT on `material_consumption`, but has INSERT and UPDATE on `material_reservations`, `work_orders` and `stage_wip_log`. A table grant alone does not prove any particular RLS row is writable; the current membership-only policies and service paths make these surfaces material. Staging remains unverified.

## Boundary to approve

An active same-org Org Admin can assign explicit permissions to active roles through the existing RBAC UI. An employee receives only operations attached to those exact permissions. Every allowed write is checked at the database transaction boundary; the frontend's button visibility is informational. An inactive membership, expired role, foreign org, mismatched parent-child org, or ungranted key denies mutation. Org Admin bypass may pass the *authorization* check, never structural, amount, lifecycle or audit checks. `service_role` is trusted server-only and must not appear in a browser.

| Operation | Current surface to inspect | Proposed authority and server boundary |
| --- | --- | --- |
| Reserve materials for an MO; partial/all release | `inventory-transaction-service.ts` directly INSERTs/UPDATEs `material_reservations`, including read–calculate–update loops | Explicit `manufacturing.material_reservation.reserve` and `.release` permissions (new keys only after a separately reviewed migration); guarded, atomic RPCs using locked reservation/bin state. Creation must check stock/UoM and MO lifecycle; release cannot overwrite a concurrent consume. |
| Apply a material issue | M192 `rpc_consume_material_event`; retired eventless RPCs still callable but reject | Exact existing `manufacturing.material_consumption.consume`; event UUID must persist across retries. Only canonical M192 RPC can change consumed quantity, SLE/bin and WIP. The new reservation RPCs must not bypass or rewrite M192 receipts. |
| Generate, start, pause, resume, finish a WO | `generate_work_orders_from_mo`, `start_operation`, `complete_operation` plus direct `work_orders` UPDATE and separate log writes in `mesService.ts` | First-class `manufacturing.work_order.generate` and `.execute` keys, and a separate `.report` action if quantity/scrap reporting is delegated. Guard the existing RPCs or replace them with atomic status/event RPCs. Direct client WO status mutation cannot be a supported completion route. |
| Stage WIP labor/overhead, transfers and cost | `stage_wip_log` accepts direct client INSERT/UPDATE in the current catalog | A dedicated server cost/production boundary after #260 approves cost sources; no client amount is accounting authority. Do not map this to the material-consumption key. |
| Final MO completion | #230 `rpc_complete_manufacturing_order` and other terminal paths | Separate exact terminal permission and single guarded event from #230. Work-order completion may mark *ready*, never write terminal MO status independently. |

The key names above are **proposals**, not claims that they exist in the catalog. Reconcile with existing permission schema, Arabic role-editor labels and published API before implementation; avoid quietly granting new keys to every existing role. Physical count sessions are also tracked in #170, but deserve their own transaction and permission decision; this document does not silently close them.

## Non-bypass and migration sequence

1. Inventory *every* callable writer and every `authenticated`/anon table and column grant for reservations, WO, WIP, MO status and derived outputs, including inherited/default privileges. Account for `rpc_consume_material_event` as a trusted writer. Read actual policy `USING` and `WITH CHECK`; a query returning zero rows is not proof that a role lacks a grant.
2. Write failing disposable PG17 acceptance first: ordinary same-org read-only user attempts full valid INSERT/UPDATE/DELETE to each table, `UPDATE ... RETURNING`, inherited role and direct RPC calls. Independently exercise Admin, explicitly granted role, ungranted employee, foreign org, inactive/expired role, and revoked permission; assert SQLSTATE and that rows/balances/receipts remain unchanged.
3. Introduce any permission keys and guarded RPCs in additive migration(s) with pinned `search_path`, explicit `EXECUTE` revokes/grants, actor/org checks, ordered locks and audit entries. Preserve M191 product locks and M192 event lock → MO → policy → WO → WIP → reservation → product prefix; prove two-session overlap and rollback. No mutation of M190–M192 bytes.
4. Update client callers for reservation/WO/WIP operations and a stable event ID; add browser tests for Org Admin grants, role revocation and ordinary employee. Only after new client paths pass, revoke direct table mutation grants and policies in a separately sequenced reviewed migration where needed. If a staged rollout needs a compatibility interval, write the bounded state and rollback plan explicitly; never leave an unguarded fallback as the steady state.
5. Gate by exact-head PG17 Fresh DB, M190–M192 acceptance, cross-org isolation, tests for race/replay/revocation, and independent review. Production writes require their own backup, readback and approval. Keep the employee consumption UI unmounted until these gates and a real employee-session exercise pass.

## Explicit dependencies

- [#229](https://github.com/6thd/wardah-process-costing/issues/229) stays open until a caller retains/reuses `event_id` and retired clients are audited.
- [#230](https://github.com/6thd/wardah-process-costing/issues/230) owns the terminal completion and MO↔WO lock-order contract; simply repairing the broken WO trigger may expose a deadlock.
- [#260](https://github.com/6thd/wardah-process-costing/issues/260) owns authoritative process cost, labor, overhead and WIP source selection.
- [#170](https://github.com/6thd/wardah-process-costing/issues/170) also includes physical counts; its own boundary remains open.
