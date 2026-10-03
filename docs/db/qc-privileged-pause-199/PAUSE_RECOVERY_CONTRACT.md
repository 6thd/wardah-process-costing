# Proposed G05 pause, drain and recovery contract

2026-10-03 UTC. Proposal for isolated non-PROD acceptance preparation. No selected
target, implemented server fence, approved operational owner or passed pause
rehearsal is claimed. The current counterexample only proves that revoking
EXECUTE does not drain an already executing QC request.

## Candidate persistent server fence

Consider a per-org persistent pause state with epoch, actor and audit record.
Every affected writer must first acquire a shared transaction advisory barrier
for its org, then read the durable pause row with explicit `SELECT ... FOR SHARE`,
**before** any business row lock. The controller takes the exclusive transaction
advisory barrier, then explicitly reads the same row `FOR UPDATE`, waits for
participating writers, persists PAUSED plus an incremented epoch, and commits.
Locks last through commit/rollback. A row lock alone is insufficient: the
independent reviewer observed new FOR SHARE requests overtaking a queued FOR
UPDATE controller. The advisory barrier is a candidate mitigation, not a proven
production fairness guarantee; sustained-load drain must pass P02/P08.
It claims quiescence only after commit and a verified complete writer inventory.

PostgreSQL's row-lock compatibility supports this candidate design; it does not
make today's unmodified functions participate in it. The common ordering would
be `org advisory barrier -> pause row -> existing business-lock sequence`. Use
a reserved, documented advisory key namespace and deterministic org ordering.
Multi-org writers and global controllers enumerate every org before business
locks; dynamic discovery may not acquire an earlier org out of order. New-org
provisioning must participate in a reviewed global barrier so a global pause
cannot miss an org created during enumeration. Nested calls must safely re-take
their already-held locks without upgrading a shared barrier to exclusive.
Preserve and review the
accepted MO/policy/counter/product ordering inside each writer, including nested
calls and multi-org transactions. The controller must not hold MO or other
business locks while waiting for the pause lock. Deadlock/timeout is a failed
pause attempt, never a successful drain marker.

Reference: [PostgreSQL 17 row locks and deadlock avoidance](https://www.postgresql.org/docs/17/explicit-locking.html).

Read admission state and epoch from the locking statement itself, never from a
pre-lock snapshot. READ COMMITTED must observe PAUSED after waiting; higher
isolation may raise `40001`, which is refusal, with any retry restarting through
the fence. Plain UPDATE is not an exclusive-controller substitute, and
FOR KEY SHARE is not the writer mode. Missing-row SELECT returns no row, so the
helper must explicitly raise before business effects. Provision new-org rows,
backfill existing orgs with a postflight, guard DELETE/TRUNCATE, revoke ALL from
PUBLIC/anon/authenticated/service_role including column/inherited paths, and
prohibit silent cascade deletion of fence rows. Disconnect after
the controller's commit must leave PAUSED durable. No TTL, restart, UI reload or
loss of controller connectivity may silently resume writes. Resume requires an
authorized actor, epoch/build/ledger checks, reconciliation and an audit record.

BYPASSRLS bypasses RLS, not triggers or table privileges. A separately reviewed
RPC-owner trigger boundary can fence service_role; database owner/superuser
credentials cannot be contained by a database-only guarantee and require
external operational controls. Direct writes need closure or a
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

The inventory must also explicitly include service_role-executable aliases and
helpers: `upsert_stage_cost_core`, `update_mo_status_from_work_orders`,
`auto_backflush_materials`, `create_role_from_template` and other RBAC writers;
all MO status writers firing QC cycle/gate triggers; direct service_role DML on
`quality_inspections`, `material_consumption`, `stage_wip_log`; authenticated
`stage_wip_log` DML; and client-writable `audit_logs`. Invocation grants and
transitive effects matter even when a path is absent from application source.
Record signature, effective role/table/column grants, call graph, first lock,
route IDs, disposition and proof for each entry. A catalog-backed check must
account for every writer and establish that its fence precedes business locks;
text search alone is insufficient. Unresolved entries block P04/P12.

Closing F1 is a prerequisite of P04: a separate additive correction must revoke
ALL direct QC privileges (including service_role and effective inherited/column
paths) and independently guard writes through the reviewed RPC owner. Owner
policy must select no service_role QC writes or a named attributable RPC.
Fresh DB acceptance, effective-grant readback and independent review are needed.

A proposed conservative pause policy refuses all writer entries, including
saved-event replay and unknown-event recovery. If operators need receipt lookup
while paused, use a reviewed genuinely read-only path with appropriate identity
checks. Do not assume a reconciliation RPC is read-only from its name. QC
business HOLD/replay semantics are distinct from this operational pause policy.
Any different replay policy requires explicit semantics and test evidence.

Define explicit RUNNING, PAUSED and RECOVERY states. RECOVERY keeps ordinary
admission closed and admits only allowlisted server-identified recovery
functions/actors under the same barrier and epoch checks. A client flag or
settable session variable cannot identify a recovery function. M196
reconciliation closes/fences unknown events and audits; it never applies them.
Do not silently replay an unknown command as part of reconciliation. Entry to
RECOVERY and return to PAUSED require authorized audited transitions; resume to
RUNNING remains a separate approval.

Pause/resume/recovery records require a server-authored, RPC-only audit store:
existing `audit_logs` has the known #165 client-insert attribution gap and cannot
prove RPC provenance. Stamp server-derived epoch into receipts and trusted audit
records. Target searches for out-of-RPC QC rows are heuristic under #165 and
need an approved remediation policy for immutable forged history.

Idle-in-transaction holders and prepared transactions can prevent drain. Define
controller lock/statement timeouts, monitoring of blocking PIDs and prepared
transactions, and a reviewed abort policy recording actual commit/rollback or
termination outcomes. Timeout, unresolved prepared transaction or unknown
outcome leaves pause acceptance failed; never emit quiescence on cancellation.
Prepared transactions need their own reviewed resolution, not backend
termination alone. No abort authority is assigned by this document.

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
   Trust only Auth-signed identity claims and server-side admission records.
   Access tokens can outlive session revocation until expiry; each admission
   checks current server state rather than treating a valid JWT as a live lease.
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

P02/P08 must include sustained incoming writers, queued-controller progress,
multi-org/global provisioning and nested calls. P03/P06 include locking-statement
state reads at READ COMMITTED and higher isolation, `40001` retry, missing rows,
DELETE/TRUNCATE/cascade attempts, stuck sessions and prepared transactions.
P04 requires F1 closure and full effective-grant/call-graph reconciliation.
P05/P09/P12 require server-identified RECOVERY, current server admission state,
epoch-stamped receipts and the trusted audit store independent of #165.

Implementation needs a separate additive correction and independent review. The
proof's canonical M199, frozen #308 client and #310 head stay unchanged. G05,
G01–G04/G06–G08, all route dispositions and NO-GO/M192 holds remain open.
