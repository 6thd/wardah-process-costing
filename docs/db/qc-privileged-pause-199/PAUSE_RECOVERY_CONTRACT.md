# Proposed G05 pause, drain and recovery contract

2026-10-03 UTC. Proposal for isolated non-PROD acceptance preparation. No selected
target, implemented server fence, approved operational owner or passed pause
rehearsal is claimed. The current counterexample only proves that revoking
EXECUTE does not drain an already executing QC request.

## Candidate persistent server fence

Consider a per-org persistent pause state with epoch, actor and audit record.
Every affected writer must acquire a shared transaction-duration lock on its
pause row **before** any business row lock, verify admission/paused state, and
retain it through commit/rollback. A controller takes the exclusive lock on that
same row, waits for existing participating writers to finish, persists PAUSED
plus an incremented epoch, and commits. It claims quiescence only after that
commit and a verified complete writer inventory.

PostgreSQL's row-lock compatibility supports this candidate design; it does not
make today's unmodified functions participate in it. The common ordering would
be `pause row -> existing business-lock sequence`. Preserve and review the
accepted MO/policy/counter/product ordering inside each writer, including nested
calls and multi-org transactions. The controller must not hold MO or other
business locks while waiting for the pause lock. Deadlock/timeout is a failed
pause attempt, never a successful drain marker.

Reference: [PostgreSQL 17 row locks and deadlock avoidance](https://www.postgresql.org/docs/17/explicit-locking.html).

The pause row must exist before writers are admitted; a missing row must fail
closed. New participating writers wait during exclusive acquisition and then
read committed PAUSED state before obtaining business locks. Disconnect after
the controller's commit must leave PAUSED durable. No TTL, restart, UI reload or
loss of controller connectivity may silently resume writes. Resume requires an
authorized actor, epoch/build/ledger checks, reconciliation and an audit record.

An unrestricted owner or BYPASSRLS writer can bypass an application fence. Do
not claim those credentials are fenced by RLS. Direct writes need closure or a
separately reviewed participating path and credential/operator controls. A row
trigger added after an UPDATE has locked an MO is not a safe substitute for the
common prefix: it could invert business-row/pause-row ordering.
Reference: [Supabase RLS and privileged roles](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Required writer inventory before implementation acceptance

The following are starting points, not a complete deployed inventory or new
grants. Reconcile them with the 33 route IDs, G01 observations, effective grants,
dynamic callers, external integrations and scheduled jobs.

| Surface | Required treatment |
| --- | --- |
| `rpc_record_quality_inspection`, `rpc_set_mo_quality_hold`, `rpc_set_quality_policy` | Fence all reviewed QC writes, retries and policy changes |
| `rpc_consume_material_event` and callable reservation wrappers | Inventory current aliases/grants and fence consumption and replay entries |
| `rpc_manage_material_issue_setup`, `rpc_set_material_issue_wo_statuses` | Fence setup and status-policy mutations |
| `rpc_reconcile_material_issue_setup` | Treat as a writer: unknown-event recovery can insert a closed fence and audit |
| `rpc_close_stage_wip_194`, related cost/stock/MO writes | Resolve scope and accounting approvals before including or excluding |
| Direct table paths, service_role/owner jobs, dynamic RPCs and schedules | Close or explicitly participate; source absence does not prove non-use |
| Quarantined M195 legacy writers | Keep quarantine; do not restore them to make the pause test pass |

A proposed conservative pause policy refuses all writer entries, including
saved-event replay and unknown-event recovery. If operators need receipt lookup
while paused, use a reviewed genuinely read-only path with appropriate identity
checks. Do not assume a reconciliation RPC is read-only from its name. QC
business HOLD/replay semantics are distinct from this operational pause policy.
Any different replay policy requires explicit semantics and test evidence.

## Paired switch and preserved pending events

1. Before pausing, identify the exact DB/client pair and participating
   user/org/profile/device records. Inventory pending, applied, unknown and
   unresolved events. Record accountable grant, device, monitoring and resume
   owners; none are assigned here.
2. Acquire the server pause and prove drain or reviewed abort outcomes. Keep the
   pause durable throughout database verification and matching-client switch.
   UI flags and ACL revocation may reduce admission but do not establish drain.
3. Reconcile saved commands against authoritative receipts/fences. Keep the
   original event ID, payload hash, actor and parent version. Do not append a new
   version, rewrite a saved command or delete IndexedDB history to obtain success.
   Unknown-event fence creation is itself a write and requires its reviewed
   controlled recovery phase while ordinary admission remains closed.
4. Verify the target ledger and missing-only M190–M199 sequence only after
   separately authorized target access/application. Complete DB-first readback
   before the compatible UI-only projection is promoted.
5. Prove old clients cannot resume after the switch. A parent version is not a
   build/device lease. A client-supplied epoch/build string is not trustworthy
   authorization; design and review the server admission mechanism and revoked
   device/build behavior separately.
6. Re-authenticate/reload the authorized compatible operators, recheck grants,
   reconcile outcomes and obtain the named resume approval. On any uncertainty,
   retain PAUSED and the pending records. A one-sided downgrade is not recovery;
   require proven replay/data compatibility or reviewed fix-forward.

No target, owner, alternative MES/FG/accounting workflow or resume decision is
selected by these steps. The isolated acceptance planning choice does not
approve unavailable business routes.

## Required rehearsal oracles

All candidate-fence cases below are **PENDING**. Today's EXECUTE-revoke test is
supporting negative evidence, not a PASS for any implemented-fence case.

| ID | Required observation |
| --- | --- |
| P01 | Real admitted writer holds shared prefix lock; controller blocking is observed, not inferred from sleep |
| P02 | Successful pause commits only after all earlier writers commit/rollback; state and receipts identify each outcome |
| P03 | Every new writer/alias/retry is refused while paused with no business or financial effect |
| P04 | Direct privileged, scheduled, dynamic and external paths are closed or demonstrate the same admission contract |
| P05 | Lost-response replay and unknown-event recovery obey the selected pause policy without rewriting pending payloads |
| P06 | Missing pause row, timeout, deadlock and rollback cannot emit a quiescent marker |
| P07 | Controller loss after commit and service restart retain PAUSED; only reviewed resume changes it |
| P08 | Multi-org/nested calls and concurrent policy/QC/material writers preserve common lock ordering |
| P09 | Old build/device/session and revoked/expired grants cannot resume; metadata spoofing is refused |
| P10 | Paired DB/client switch, stale saved commands and failed switch preserve receipts, records and state invariants |
| P11 | Populated stock/cost/GL history is preserved where in scope; empty GL is insufficient for that preservation claim |
| P12 | All writer inventory entries, approvals, monitor ownership and post-resume reconciliation have auditable closure |

Implementation needs a separate additive correction and independent review. The
proof's canonical M199, frozen #308 client and #310 head stay unchanged. G05,
G01–G04/G06–G08, all route dispositions and NO-GO/M192 holds remain open.
