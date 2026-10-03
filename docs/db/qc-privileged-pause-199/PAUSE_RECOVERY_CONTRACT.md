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

## Round 3 implementation requirements

The supplied Round 2 reviewer independently observed these additional surfaces.
They are requirements for future implementation, not implemented protections.

1. Owner identity alone is insufficient: the reviewer counted 110 postgres-owned
   DEFINER functions executable by service_role, eight with dynamic SQL. Require
   both the intended RPC owner and an RPC-specific transaction-local marker
   (do not copy M169's owner-session bypass) for QC, fence and trusted audit writes. A caller-settable
   marker alone is not authority. Inventory dynamic SQL, helper EXECUTE grants,
   marker spoofing, nested entry and marker lifetime/reset on every exit.
2. Reserve a class ID in the two-int4 advisory namespace, separate from existing
   single-bigint locks in M191/M192/M194/M196–M198. Document collision-free org
   mapping and global key allocation; hash collisions must be explicitly handled.
   All fence advisory locks precede existing business advisory and row locks.
   Inventory each writer's first advisory lock as well as first row lock.
3. Use a reviewed hierarchy: global shared barrier -> org shared barriers in
   ascending order -> pause rows -> business locks. A global controller takes
   the global exclusive barrier before org enumeration/state transitions, so it
   need not hold N org exclusive advisory locks. Every writer, org controller and new-org
   provisioning must take the global shared prefix before any org lock. A writer without a server-resolved
   org refuses before org/business locks; no caller-supplied org is trusted.
   Review global controller overlap with org controllers and provisioning.
   Read back max_locks_per_transaction and budget the remaining locks under
   realistic transactions; it sizes shared capacity, not a hard per-tx cap.
4. A queued exclusive controller convoys new writers. Define bounded controller
   and writer lock_timeout/statement_timeout, monitor queue age and blocking
   PIDs, and refuse on timeout without a quiescence marker. Load rehearsal must
   cover arrivals during controller wait and recovery after failed pause.
5. Read back pg_parameter_acl and effective has_parameter_privilege for SET of
   session_replication_role, including inherited roles. Replica mode can disable
   ordinary triggers including M193/M199 and the proposed F1 guard. No target
   guarantee is accepted until bypass-capable credentials are closed or covered
   by reviewed external controls; owner/superuser limitations remain explicit.
6. RECOVERY identity requires a helper clients cannot execute directly, invoked
   with a literal function identity only by allowlisted DEFINER entrypoints.
   Protect helper owner/search_path/grants and validate caller/marker provenance.
   A literal argument or session marker alone proves nothing. Reconciliation
   only closes unknown events; ordinary writer admission stays closed.
7. Read back max_prepared_transactions. If zero, P06's prepared case is the
   verified disabled configuration; if nonzero, inventory prepared holders and
   rehearse reviewed resolution and durable outcome recording before acceptance.

F1 defence in depth must cover NULL sequence ordering (the reviewer reproduced
a NULL FINAL PASS shadowing a genuine FAIL): review NOT NULL for M199-era rows
or explicit NULLS LAST, with legacy compatibility and Fresh DB probes. Forged
history remediation requires an approved append-only superseding mechanism
that actually overrides arbitrary high/NULL sequence evidence; merely appending
a normal lower-sequence row is insufficient. No such remediation is implemented
or authorized by this contract.


## Round 4 selected design and live-main reconciliation

These choices refine the proposal; they are not implemented admission, grants,
remediation or target acceptance. P02/P08 sustained-load and queue/timeout proofs
remain mandatory. Earlier generic requirements must be read with these choices.

### Frozen proof versus current source scope

The counterexample runner still consumes only the locked M190–M199 chain at
`3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`. Live main was independently read at
`1fe5eccc8e52874bc6038f26ffd4366628c46ca1`, tree
`b7dd9baa1d92b434118400c0e5ceaac30da45db8`, after #312 and merged #314/M200.
The Round 3 review's docs-only drift statement is historical. Do not rebase,
relock or claim that the frozen runner tests M200 or current-main acceptance.
No target ledger was read; repository presence is not target application.

M200 is INCLUDED in the future pause and paired DB/client inventory because GL
mapping mutations affect account selection for manufacturing posting. It is not
implicitly accepted by the ten-step reproduction. Scope ledger/application
verification against the selected target's actual chain, including M200 when
applicable, with separately authorized missing-only ordered application. Any
later migration requires a new source/inventory reconciliation before P04/P12.

| Surface at live main | Required future treatment |
| --- | --- |
| `rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)` | Include authenticated admin writes; fence before its single-bigint mapping advisory lock and before INSERT/conflict wait/FOR UPDATE; retain M200 validation and exact audit before-image contract |
| `rpc_upsert_event_mapping(text,text,text,text,text,uuid)` | Include service_role writer and seed/jobs; it does not take the new setter's mapping lock; resolve server org before common prefix or refuse |
| service_role direct `gl_event_mappings` writes, inherited/column grants and trigger paths | Close or independently prove participating admission; M200 deliberately preserves them |
| M200 `audit_logs` insert and posting consumers | Include audit mutation and transitive effects; #165 means this audit is not trusted RPC provenance; mapping pause does not prove all posting consumers are fenced |

Read M200 runbook §§8–9 before future function replacement. The setter validates
org admin/accounts, has a single-bigint business advisory lock, then inserts or
locks/updates, and audits. The runbook records that the legacy setter is a
separate service_role seed path with weaker validation and no audit. Future
fencing must not silently replace those contracts or authorize their use.

### Provenance, marker and recovery identity

Do not copy the M169 `session_user = current_user` disjunct. Direct owner-session
DML without a valid entry context is refused by the proposed guard, even though
an owner/superuser can ultimately alter the mechanism outside its guarantee.

Selected SQL-only marker design: a protected server-authored transaction context
in a private schema, not a caller-settable custom GUC. Bind it to backend identity,
full transaction ID, org, epoch, literal entrypoint identity and nesting depth.
Only narrow, reviewed DEFINER entrypoints with dedicated NOLOGIN owners may
establish/push/pop context. No client EXECUTE on the context mutator, no direct
DML/DDL or owner membership for client/service roles; pinned search_path and
fully qualified references are required. Context rows must be removed on normal
exit, scoped/restored on nested exit and rolled back on errors; committed orphan
context is a failed invariant. Guards check both intended execution owner and
matching context. Current_user, literal arguments or context existence alone
are insufficient. Inventory all owner-executed dynamic SQL and callable helpers
that could forge context or reach protected QC/fence/audit stores. No acceptance
until spoof/direct-helper/nested/error/pool-reuse probes pass.

RECOVERY allowlist is a fixed server-code constant containing only reviewed
recovery entrypoint identities (initially only
`public.rpc_reconcile_material_issue_setup(uuid,uuid,jsonb,uuid)` for unknown
material issue events), with literal identity in the allowlisted entrypoint body. No
client-writable allowlist table, payload-based identity or arbitrary name passed
to a helper. The helper is reachable only through restricted entrypoints and
uses the protected context above; reconciliation may close, never apply events.
Exact deployed function signatures/owners are frozen by implementation review.

If a parameter marker is retained in a later implementation, reserve
`wardah.qc_entry_context`, revoke SET/ALTER SYSTEM grants via pg_parameter_acl
from PUBLIC, anon, authenticated, service_role and inherited/settable roles,
and read back effective has_parameter_privilege plus actual SET/set_config
attempts in new sessions. This is NOT protection for an ordinary USERSET custom
GUC: PostgreSQL parameter SET ACL matters for otherwise restricted parameters.
Such an alternative needs a registered protected parameter in every backend and
independent hosted feasibility/negative probes; absent that, it is refused and
the selected protected context remains authoritative. Apply the separate
session_replication_role ACL/readback requirement as well.

References: [PostgreSQL 17 parameter SET privilege](https://www.postgresql.org/docs/17/ddl-priv.html)
and [custom option placeholders](https://www.postgresql.org/docs/17/runtime-config-custom.html).

### Selected advisory keys and controller order

Reserve two-int4 class ID `1463898704` for this proposed fence only. Global key
is `(1463898704, 0)`. Org keys are `(1463898704, org_lock_id)`, where an immutable,
server-owned registry assigns UNIQUE positive int4 IDs monotonically, never
reuses deleted-org IDs and refuses on exhaustion. No UUID hash or modulo mapping:
distinct orgs cannot collide. Registry protection/provisioning is part of the
writer inventory. Read-only lookup of an existing immutable mapping happens
under the global shared barrier before org locks; missing mapping refuses.
Namespace/key ownership must be checked against all source/catalog/external
advisory users before allocation, not just this repository's numeric literals.

| Participant | Transaction-duration lock prefix |
| --- | --- |
| Ordinary or recovery writer | global shared -> org shared in ascending org_lock_id -> pause rows FOR SHARE -> existing business advisory/row order |
| Org pause/resume/recovery controller | global shared -> org exclusive in ascending org_lock_id -> pause rows FOR UPDATE; no business locks while waiting |
| Global controller | global exclusive -> pause rows FOR UPDATE in ascending org_lock_id; no per-org advisory locks are required because every org controller/writer takes the global shared prefix |
| New-org provisioning | global shared -> protected registry allocation -> new org exclusive -> provision pause row; reject if durable global state is PAUSED except separately authorized recovery provisioning |

Global state must be read under the acquired global barrier by every participant;
per-org state is read in its locking statement. Multi-org writers determine all
server-authorized orgs before the org-lock phase; late discovery of a lower key
requires rollback/restart. A writer unable to resolve its org refuses before
business locks. Never upgrade a held shared barrier to exclusive in a nested
call. Registry allocation and global pause-row ordering need a reviewed
non-inverting lock path. Bound both controller and writer waits, monitor convoy
age, and budget max_locks_per_transaction for real row/business workloads.
A single advisory queue sample is not proof of sustained-load drain.

### Uniform QC ordering and supersession

Select one policy for FINAL, IN_PROCESS and list projections within each
(org, MO, QC cycle, inspection type): trusted authority revision DESC, then
inspection_seq DESC NULLS LAST, then stable ID DESC. Legacy evidence has authority
revision 0; new RPC inspections use server-generated non-NULL sequences. Require
NOT NULL for new-era sequence data and compatibility probes for existing NULLs.
Apply the same ordering to both evaluator selectors and the list RPC; list
ordering alone does not fix the gate.

Append-only remediation creates a trusted positive authority revision under the
common fence and per-cycle/type serialization, greater than the trusted revision
counter, not greater than an untrusted inspection sequence. A supersession record
identifies affected history, rationale, approver and replacement decision; the
original rows remain immutable. Protected revision metadata is separate from
client/direct-writer fields: no legacy NULL or arbitrary high sequence can raise
its revision above 0. The gate selects only evidence linked to the latest trusted
revision; a remediation revision with no validated replacement keeps release
blocked. Future genuine inspections in that revision then use their normal
server sequence. This requires a separate additive correction and owner-approved
forensics/remediation policy. Probe forged NULL and arbitrarily high sequences,
FINAL and IN_PROCESS independently, revisions/retries/concurrency and no-valid-
replacement denial. No revision/schema/selector change is made in this packet.
