# Proposal: retry-safe material consumption (#229)

**Status:** proposed technical contract for review. The owner accepted the narrow MO lifecycle rule on 2026-09-27; event identity and DB delivery remain under review. This document is not an implementation, a GREEN result, or permission to apply a migration.  
**Repository starting point:** `main@df02a4fddfca5c56a69e738e6707a55a78bd01ee`; M190 is reported applied to Production, M191 is not. Recheck the live ledger before any future application.  
**Scope:** reserved-material consumption only. Finished-goods receipt, completion costing, WIP close and GL state belong to #230. Automatic backflush belongs to #234.

## Observed gap and boundary

The unchanged RED probe `docs/db/manufacturing-inventory-red-20260925/C_consumption_retry_lifecycle.sql` reproduces a sequential retry that duplicates SLE, bin, reservation and stage-WIP effects. Its supplied `event_id` / `idempotency_key` is ignored; new consumption succeeds on cancelled, done, draft and on-hold MOs, and an explicitly supplied cancelled work order bypasses the automatic branch's status filter. The probe proves these facts on a disposable database, not on Production.

M190 requires `manufacturing.material_consumption.consume` at the canonical RPC and the table INSERT policy. A permitted client's direct INSERT still creates a consumption row without the stock/reservation/WIP effects. A UI may not expose this path as a safe consumption action.

## Proposed contract (MO lifecycle choice accepted by owner)

1. **Eligible order:** a *new* material-consumption event requires an MO in `in_progress` and a work order belonging to the same organization and MO whose status is neither `COMPLETED` nor `CANCELLED`. Draft, pending, confirmed, quality_check, on_hold, completed/done and cancelled MOs reject new events. The MO and work order must be checked while locked in the same transaction as the effects. The owner accepted this narrow rule on 2026-09-27; late consumption during `quality_check` is not part of this contract.
2. **Event identity:** the caller supplies one stable, opaque event ID for the whole batch, created once when the operator submits it and retained across response loss, retries and page reload. A new legitimate partial issue gets a new ID even when it uses the same reservation. The server never silently invents a different ID for a retry.
3. **Same event and payload:** after authenticating and checking the exact permission and organization, a repeated event ID with the *same canonical payload* returns the stored success/result with no new stock, reservation, consumption or WIP effect. A reused ID with different payload fails with a distinct conflict error and no effect. A retry after the MO later changes state may return the prior successful result, but must never produce a new effect.
4. **Scope and payload:** the stored identity is unique per organization and event ID; bind it to MO, stage, actor and a canonical representation of every consumption line (item/reservation, quantity and UoM, warehouse, work order and meaningful options). Reject missing/invalid event IDs, duplicate or malformed lines and ambiguous item/warehouse/stage resolution. Define canonicalization before coding so JSON key order alone cannot change the hash, while changing a business field always does.
5. **Atomicity and concurrency:** persist an event receipt and its request fingerprint in the same transaction as SLE/bin, reservation, consumption and stage WIP changes. Serialize concurrent submissions of the same event ID at the database boundary. A failed event leaves no receipt or business effect; a committed event has one durable result. Different event IDs may both succeed subject to remaining reservation and stock checks.
6. **Entry points:** keep the legacy wrappers delegate-only, with the same event contract. Do not silently fall back to the old RPC signature if it cannot carry the event ID. Close direct client INSERT into `material_consumption` for `authenticated` and `anon` in the DB delivery after auditing every caller; permitted consumption must go through the atomic RPC. Do not depend on `status='POSTED'` as proof of a legitimate stock movement.
7. **Rollout:** migration is additive and follows M191 in repository order; use the next free migration number after checking `main` and the live ledger. A new parameter/signature or wrapper version must preserve a deliberate, fail-closed compatibility plan. No Production or Staging application is part of this proposal.

## Required RED/GREEN acceptance for the DB PR

| Case | Required assertion |
| --- | --- |
| First event | Exactly one legal set of SLE/bin, reservation, consumption and stage-WIP effects and one durable receipt/result. |
| Lost response, same ID and payload | Same result; no extra effect in any of the four ledgers/projections. |
| Same ID, changed quantity, warehouse, stage, MO or item | Explicit conflict; no extra effect. Test JSON property reordering separately as equivalent. |
| Two concurrent calls, same ID | Exactly one application; the other returns its stored result or a retryable conflict with no extra effect. |
| Distinct second partial event | Applies once if stock/reservation permit; reservation ID alone must not deduplicate it. |
| Failed mid-transaction | No event receipt and no partial inventory, reservation, consumption or WIP effect. |
| MO state matrix | Only the approved eligible status accepts *new* events; cancelled/done/draft/on_hold reject. Existing successful-event replay never reapplies. |
| Work order | Auto-selected and explicit IDs enforce the same org, MO and active-status rule. |
| Permission and tenant | Org Admin or explicitly granted same-org user can use the RPC; reader, inactive member and other-org user cannot, including on replay. |
| Bypass surfaces | Direct INSERT and retired backflush cannot create consumption effects; all wrappers either honor the event ID or reject without writing. |

The DB PR should run the original RED probe before its migration, then its own GREEN probes on PG17 with baseline cutoff 189 + M190 + M191 + the new migration. Retain the exact-head SHA, PostgreSQL version, raw outputs and digests. Test replay and forced overlap independently; a sequential replay alone does not prove concurrency safety.

## Delivery sequence

1. Independently review the accepted MO-status rule and the proposed event-identity/DB choices. Keep this contract PR Draft until the complete contract has been accepted.
2. DB PR for #229: additive migration, fail-closed compatibility and direct-write closure, with the acceptance matrix above; independent review at the exact head. Applying it to Production is a separate, explicitly authorized step after M191 readiness and a fresh ledger readback.
3. Consumer PR: give the employee a manufacturing action that invokes only the corrected RPC, display the exact permission from M190, persist the event ID across retry/reload, and test authorized/denied same-org employee sessions. Do not mount the legacy direct-insert `useConsumeMaterial` hook.
4. Continue #230 separately before treating MO completion and the full manufacturing cycle as accepted.
