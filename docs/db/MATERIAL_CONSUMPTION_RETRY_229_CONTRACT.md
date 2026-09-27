# Proposal: retry-safe material consumption (#229)

**Status:** proposed contract, not an implementation, GREEN result or authorization to migrate. The owner approved `in_progress` as the only MO status for **new** consumption on 2026-09-27. The work-order status choice below still needs the owner's decision.
**Starting point:** `main@df02a4fddfca5c56a69e738e6707a55a78bd01ee`. M190 is reported live on Production; M191 is not. Verify the ledger again before implementation and application.
**Scope:** reserved-material consumption. FG receipt, completion, WIP close and GL (#230), and automatic backflush (#234), remain separate.

## Observed gap

The existing RED probe `docs/db/manufacturing-inventory-red-20260925/C_consumption_retry_lifecycle.sql` reproduces duplicate SLE, bin, reservation and stage-WIP effects on sequential replay; its supplied `event_id` / `idempotency_key` is ignored. Invalid MO states and an explicitly supplied cancelled work order admit new consumption. These are disposable-database observations, not Production assertions. M190 checks `manufacturing.material_consumption.consume` on the canonical RPC and direct INSERT policy; permitted direct INSERT still creates consumption without the linked stock/reservation/WIP effects. Do not expose this as an employee UI action yet.

## Lifecycle and replay

- **Approved MO rule:** only a stored MO status of exactly `in_progress` permits a new event. Reject `draft`, `pending`, `confirmed`, `quality_check`, `on_hold`, `completed`/`done`, `cancelled` and all other statuses. Lock the MO in the effects transaction; input status normalization cannot broaden this rule.
- **Proposed WO rule, pending owner decision:** permit a new event only for a stored `IN_PROGRESS` work order. Reject `PENDING`, `READY`, `IN_SETUP`, `ON_HOLD`, `COMPLETED`, `CANCELLED`. Explicit and automatic selection must enforce the same approved allowlist with a locked WO in the same MO and organization. The owner must decide whether `READY` and `IN_SETUP` should permit issuing materials; document any extra approved state explicitly and test it. A denylist of completed/cancelled is insufficient. The current MO status transition problem belongs to #230; test fixtures should seed WO status directly.
- **Replay order:** authenticate, check active same-org membership and exact permission even for a replay; lock MO; look up the receipt by `(org_id,event_id)` and compare the immutable fingerprint. Return the stored result for an identical completed event **before** new-event lifecycle, stage/WIP, reservation, stock or UoM checks. A changed request conflicts without effects. Replay must work after WIP close, reservation exhaustion or MO completion, while revoked permission must still deny it.

## Event identity and API

1. The client creates one stable opaque non-null event ID for the complete batch and retains it after response loss, retries and reloads. Each genuine second partial issue uses a new ID even on the same reservation. The server must not silently invent a fresh ID during retry.
2. Provide an explicit required event ID parameter on a new event-bearing RPC. The existing callable signatures `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)`, `rpc_consume_reserved_materials(uuid,jsonb)`, and `consume_materials_for_mo(uuid,uuid,jsonb[])` must reject **before writing** with a clear migration error, or be replaced so that no callable eventless write path remains. A four-argument overload alone leaves a bypass. Catalog-scan all granted wrappers and definer writers, including backflush; test each old signature with an authorized user. No silent client fallback to an old signature.
3. Require explicit item, reservation, warehouse, work-order, stage, quantity, UoM and consumption type for each line (or one explicitly bound batch stage). Reject missing and unknown keys, malformed or duplicate reservation IDs, and invalid quantity types, sign or precision. Do not resolve omitted identifiers from changing inventory state. Snapshot first-run resolved references and UoM factor; never recompute them on replay.
4. Fingerprint the validated normalized **raw request**, before any state-dependent lookup: organization, actor, MO, event ID, stage, consumption type, notes, and all ordered lines and their business fields. Normalize JSON object property order and numeric JSON values (e.g. `10` and `10.0` equivalent if both accepted); preserve line order. Changing a business field or the actor conflicts, while the same event ID in another organization remains independent. Never fingerprint values derived from current stock or reservation state on a retry.
5. Persist one immutable result and receipt with `UNIQUE (org_id,event_id)`, actor, fingerprint and links to all created consumption/stock effects **in the same transaction** as SLE/bin, reservation and stage-WIP effects. In an exposed schema, enable receipt-table RLS, grant no client write policy, and explicitly `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` from `PUBLIC`, `anon`, `authenticated`, including baseline default grants. Prefer a private schema; permit minimal read access only if required. A privileged RPC must fix its search path, check auth/org/permission explicitly and have restricted EXECUTE. Migration postflight must check effective grants, RLS, constraints and actual client write denial.
6. Serialize same-ID calls with the MO lock plus uniqueness. After waiting, reread the committed receipt: identical request returns the stored result, changed request conflicts; if the first transaction rolled back, the waiter applies once. Raw `23505` is not a successful replay result. A multi-line failure must roll back every earlier line and the receipt without swallowing per-line exceptions. Result counts must reflect committed, linked rows, not just input length.

## Migration dependency and access closure

M191 rewrites `rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)` with Fix E's reservation-lock superset, product-prefix lock and postflight invariants. #229 must follow **successful application of M191 exactly once on the target database** and preserve both M190's authorization and M191 Fix E in every replaced function. Repository ordering alone cannot establish live readiness. Fail closed on a missing ledger row or failed catalog/postflight check: never run #229 before M191 or reinstate a pre-M191 function. Choose the next migration number after checking `main`; Production needs separate authorization.

Revoke direct `material_consumption` INSERT from `authenticated` and `anon`, remove permissive INSERT policies and verify neither role can UPDATE, DELETE or TRUNCATE; audit all callable writers. Keep only necessary reads, maintain retired backflush and block commit if privileged write checks fail. RLS does not restrict a misconfigured SECURITY DEFINER function.

## Required RED/GREEN acceptance for the DB PR

| Case | Required assertion |
| --- | --- |
| Dependencies and catalog | M190 and M191 each present once at target; M190 guard and M191 Fix E retained; receipt UNIQUE, RLS, write revokes and callable writers verified. |
| First event | One legal stock/reservation/consumption/WIP set and linked receipt; returned counts match actual rows. |
| Replay | Identical ID and payload returns the stored result with no new effects, even after MO completion, closed WIP or exhausted reservation, subject to fresh permission. |
| Conflicts | Changed actor, MO, item, reservation, warehouse, stage, WO, UoM, type, notes, quantity or line order conflicts; JSON object-key order alone does not. |
| Two sessions | Hold session 1 while session 2 submits same ID. Commit 1: 2 returns stored result, not `23505`. Roll back 1: 2 applies once. Different payload conflicts. |
| Partial batches | Force second-line failure after first-line mutation; no receipt or stock/reservation/consumption/WIP effect remains. New event ID may consume remaining valid quantities. |
| Lifecycle | Every stored MO/WO status tested for both explicit and automatic WO choice against the approved allowlists; prior success replays without reapplying. |
| Authorization | Admin and granted same-org employee pass; ungranted, inactive, revoked and other-org callers fail, including on replay. |
| Bypass | Authenticated/anon direct receipt writes and consumption writes denied; all three eventless signatures, other definer writers and retired backflush cannot create effects. Different orgs may use the same ID independently. |

Run unchanged RED before migration and GREEN on PostgreSQL 17 with baseline cutoff 189 + M190 + M191 + the new migration. Keep exact-head SHA, server version, raw output and digests. Sequential replay does not establish two-session behavior. These disposable tests authorize no live write.

## Delivery sequence

1. Record the owner's WO-status decision, then independently review this completed contract; retain Draft status until then.
2. Implement #229 in a separate DB PR after M191 with event receipt, eventless closure, direct-write closure and the full acceptance matrix. Independently review the exact head; Production application needs fresh live readback and separate authorization.
3. Add an employee UI action using only the new RPC, showing the M190 permission, retaining event ID across retry/reload and testing granted/denied employee sessions. Do not mount the direct-insert `useConsumeMaterial` hook.
4. Resolve #230 before treating the complete manufacturing cycle as accepted.
