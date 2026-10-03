# QC privileged writes and operational pause: bounded review

2026-10-03 UTC. Executor evidence for the first isolated-acceptance preparation
step in [#311](https://github.com/6thd/wardah-process-costing/pull/311).
Independent review of this new evidence and the proposed contract is pending.
This packet adds reproducible counterexamples, not a migration or a working pause.

## Frozen inputs and scope

| Input | Commit | Tree |
| --- | --- | --- |
| Accepted main / canonical M190–M199 | `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe` | `ad60355c42a0e725bbe431ff3032f95ac5f05d35` |
| Prior #310 local proof | `0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86` | `6218cf7f984134f5db2c9fe6b295bc036bea22da` |
| Frozen #308 client reference | `2ea72541fec4b52e7e0af2a3809ecb7be791bb47` | `6ed7d21a7a6654382fc7cbff5265fd244b6012fb` |
| #311 next-phase packet | `33b1806b9fd8cb6639a7a929c6c73b90c9c6d08a` | `5168f44118def6bc59fbf6d053500b9250fd0fe3` |

The supplied independent PASS at #310 remains limited to its two local technical
proofs. Neither finding below invalidates that scoped result or upgrades it to
whole-QC/security acceptance. This review inspected the six QC RPCs, policy and
gate helpers, immutable-history protections, privileged grants, and the frozen
QC service/hooks/pages. It tests two specific boundaries. It does not close the
full identity, device, business-workflow or operational acceptance scope.

`SOURCE_LOCK.json` pins the contents of 44 accepted-main files: the 42 database
sources from #310's lock plus the unchanged original QC acceptance suite and its
shared SQL helpers. The runner checks these hashes before connecting and again
after tests. This is a content lock, not #310's complete client mode/symlink
verifier, and it does not pin the installed server or Python/Node dependencies.

## F1: privileged direct INSERT can manufacture release evidence

The accepted baseline grants ALL on `public.quality_inspections` to
`service_role`. M199 revokes table privileges from PUBLIC, anon and authenticated,
but retains this privileged INSERT grant. Its QC RPC EXECUTE grants exclude
service_role. The local Supabase role shim models service_role as BYPASSRLS.

On a fresh canonical database, `privileged_red.sql` proves:

1. A new order in `quality_check`, with `release_gate_mode=all_orders`, initially
   has an evaluated release gate of `ready=false`.
2. With empty actor claims, service_role directly inserts a FINAL PASS. It chooses
   `inspector_id`, sequence 999 and an arbitrary non-RPC request hash.
3. The evaluator becomes `ready=true`, with no QC RPC audit entry added.
4. Identical direct INSERT attempts by anon/authenticated fail with `42501`.
5. All effects roll back.

This demonstrates a **trusted privileged-credential boundary**. It does not
demonstrate an ordinary-user bypass, a leaked service key, hosted JWT behavior,
or actual finished-goods receipt, completion or GL posting. The chosen inspector
is a valid fixture user, so this is not an FK-integrity finding.

Disposition: keep the previously pending service_role INSERT decision open. This
is a blocker to claiming RPC-only QC evidence integrity in a deployment that
permits that writer. Treat it as a candidate P2 for that acceptance scope, subject
to independent severity review and the owner's integration policy.

Proposed correction to review separately: revoke privileged direct INSERT with
effective table/column/inherited-grant readback, preserve the reviewed
authenticated RPC path, and require an attributable, audited path for any named
server integration. This packet does not allocate a migration number, modify
canonical M199, or implement that correction.

Non-vacuity: temporarily revoking service_role INSERT makes the reproduction
fail at `SERVICE_ROLE_INSERT`. In a separate rolled-back transaction, the same
candidate revoke leaves all 70 unchanged original QC assertions passing. That
supports a narrow candidate; it does not prove compatibility with unregistered
privileged integrations.

## Existing history protection: TRUNCATE is denied

The initial TRUNCATE hypothesis was disproved. M193 installs
`deny_history_truncate_193` on this history table. service_role TRUNCATE fails with
`P0001` / `M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED`; UPDATE/DELETE fail with
`42501` / `QUALITY_INSPECTION_IMMUTABLE`. The inserted row and evaluated gate stay
unchanged. anon/authenticated TRUNCATE lacks the table grant and fails with 42501.

Dropping only the M193 trigger inside a rolled-back mutant transaction makes the
test fail at `TRUNCATE_GUARD`. **Do not report TRUNCATE as an accepted-main
vulnerability or infer execution solely from the baseline ALL grant.**

## F2: revoking EXECUTE does not drain an in-flight request

`pause_revoke.py` uses a disposable clone and an actual authenticated QC actor.
An owner session locks the QC sequence-counter row. An inspection RPC begins and
is observed waiting on that session through `pg_blocking_pids`. A third session
commits an EXECUTE revoke. A new actor call fails with 42501, while the original
call is still blocked and no inspection is yet committed. Releasing the counter
lets that earlier call return a fresh receipt and commit one PASS inspection.

This is an operational G05 counterexample to **REVOKE alone as a pause/drain
mechanism**, not a PostgreSQL authorization defect. It exercises one QC writer;
it does not demonstrate a tested pause for all material, QC, recovery, legacy,
scheduled or privileged writers. The clone is dropped. Source inspection rows,
quality policies and this RPC's ACL compare equal before/after; that comparison
is limited to those items, not a full 620-item catalog readback.

The [pause/recovery contract](PAUSE_RECOVERY_CONTRACT.md) describes a candidate
server fence and the coverage/rehearsal needed before it could be accepted.
It is not implemented or approved here.

## Executor verification

| Check | Observed result |
| --- | --- |
| Canonical chain, cutoff 189 | Exactly M190–M199, 10 PASS |
| Existing QC acceptance | 70 original assertions PASS |
| Candidate INSERT revoke | Same 70 assertions PASS; revoke rolled back |
| Privileged and in-flight counterexamples | Both reproduced |
| INSERT-revoke / missing-TRUNCATE-trigger mutants | Both caught at named assertions |
| Legacy quarantine after tests | Existing M195–M198 suite, 72 probes PASS |
| Accepted-source content hashes | 44 match before/after; changed M199 source refused before connecting |
| Existing frozen-client QC unit suites | Five files, 26 tests PASS |
| Static checks | Ruff, Python compile, Bash syntax, Bandit excluding test assertions, whitespace |

Core counterexamples repeated across successful complete local runs. The final
runner version was rerun after source pinning, candidate-positive assertions and
Python formatting. Canonical SQL and frozen tracked client files were unchanged.
The unit tests use their existing mocks; they are not a new browser or hosted
identity proof. For these focused tests, Vitest coverage was disabled by command
line: the first subset run passed 26 tests but failed the repository-wide coverage
threshold. No coverage configuration or threshold was changed.

Local environment: PGDG PostgreSQL server/client 17.11, UTF8, Python 3.12.14,
`psycopg[binary]==3.3.6`, Node 24.19.0. Server startup used the managed sandbox's
UID/stat-owner adaptation for initdb/postgres only. This is not a stock Docker
run or a Supabase-hosted environment. Identities and JWT claims are fixtures;
PostgreSQL role checks and transaction/lock behavior are real. Canonical function
bodies were not replaced; the explicit mutation temporarily dropped one trigger. Independent
reproduction on stock `postgres:17` is requested.

## Reproduction

Use an owner-controlled, disposable PG17 UTF8 cluster on explicit
`127.0.0.1:55xxx` (range 55000–65535), `psql`, `rg`, Python and psycopg 3.3.6.
The accepted-main baseline and shim can create cluster roles, so a loopback
address is not evidence that an existing cluster is disposable. Do not use an
operational database. From this worktree:

```bash
PGHOST=127.0.0.1 PGPORT=55457 PGUSER=postgres \
  bash docs/db/qc-privileged-pause-199/run_local.sh
```

The runner rejects alternate connection variables, creates its own prefixed
database, rolls back SQL mutations, removes its pause clone, and drops its
database at exit. Source/drift refusals occur before database setup. Raw output
contains generated database IDs/PIDs; output-byte hashes are not deterministic.
The final marker means **existing gaps reproduced**, not security acceptance:

```text
QC_PRIVILEGED_REVIEW_REPRODUCED chain=10 original=70 red=2 controls=2 identity=simulated release_ready=false
```

## Holds

All 33 route dispositions and eight G gates remain pending in the owner register.
The service_role policy, whole-QC/security acceptance, current #278 target record,
real identity/grants, device/operator policy, implemented pause/drain/recovery,
target ledger/application and UI-only promotion still need their respective
evidence and approvals. NO-GO and M192 holds remain. #308/#310/#311 remain Draft
references. No merge, target access, deployment or live change is authorized by
this evidence packet. Use [REVIEW_PROMPT.md](REVIEW_PROMPT.md) for the next review.
