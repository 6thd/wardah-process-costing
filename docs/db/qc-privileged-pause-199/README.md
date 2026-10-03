# QC privileged writes and operational pause: bounded review

2026-10-03 UTC. Executor evidence for the first isolated-acceptance preparation
step in [#311](https://github.com/6thd/wardah-process-costing/pull/311).
Independent Round 1 review of `fcca92fe0eefa7638959667ae739614fef294e01`
returned PASS for the two counterexamples and suitability for further review,
with contract changes required before implementation. Round 2 hardens the
contract and harness; independent acceptance of this delta is pending.
This packet adds reproducible counterexamples, not a migration or a working pause.

## Frozen inputs and scope

Round 4 live-main readback: `1fe5eccc8e52874bc6038f26ffd4366628c46ca1`,
tree `b7dd9baa1d92b434118400c0e5ceaac30da45db8`, includes #312 docs and
#314/M200. This does not change the frozen proof inputs below. M200 is included
in the future pause inventory; the existing runner does not test it. No current
target ledger/application is inferred. See the contract's Round 4 section.

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

Proposed correction to review separately: REVOKE ALL direct privileges including
service_role, with effective table/column/inherited-grant readback and an
independent reviewed RPC-owner write guard. Preserve the reviewed authenticated
RPC path and require an attributable, audited path for any named server
integration. This packet does not allocate a migration number, modify
canonical M199, or implement that correction.

Non-vacuity: temporarily revoking service_role INSERT makes the reproduction
fail at `SERVICE_ROLE_INSERT`. In a separate rolled-back transaction, the same
candidate revoke leaves all 70 unchanged original QC assertions passing. That
supports a narrow candidate; it does not prove compatibility with unregistered
privileged integrations.

The supplied independent review also reproduced sequence shadowing: a forged
FINAL PASS at sequence 999 remains the selected final inspection after a later
genuine FINAL FAIL. It confirmed service_role cannot UPDATE manufacturing_orders.
These are reviewer observations, not additional executor or hosted proofs.
Existing immutability complicates remediation; target forensic readback is
heuristic because known issue #165 permits client-authored audit attribution.
Neither an audit row nor its absence alone establishes trusted provenance.

## Round 2 changes and evidence boundary

The pause harness replaces every bare Python `assert` with explicit conditions
raising named failures. Waiting and other required side effects execute under
normal Python, `-O` and `-OO`; no assertion-exclusion policy is needed for this
harness. The source verifier compares the complete top-level baseline candidate
set against the locked paths before any DB client invocation, rejects symlinked
locked sources, and retains the 44 original content hashes unchanged. A new
baseline candidate is refused even if its cutoff would otherwise be selected.

The contract now specifies advisory and row lock modes/order, locked state
reads/isolation refusals, provisioning and missing-row guards, expanded writer
inventory, F1 as a P04 prerequisite, server-identified recovery, stuck-holder
handling, epoch receipts and trusted audit independent of #165. All P01–P12
remain PENDING. These changes implement test/contract hardening only.

The results below describe the original executor run at the Round 1 head.
They must not be read as a complete PostgreSQL rerun of the Round 2 delta.

Round 2 executor checks: added baseline, removed baseline, symlinked locked
source, changed M199 content, wrong host/port and PGSERVICE all refused with
zero logged DB client calls. Unchanged sources passed and reached a deliberately
failing client shim. The actual wait-oracle branch raised
`PAUSE_WRITER_NOT_STARTED` and executed its wait exactly once under normal Python,
`-O` and `-OO`; ten converted assertion branches plus two existing explicit
failures give twelve `raise AssertionError` sites. This is a
non-DB optimization control, not a concurrency reproduction. Ruff check/format,
full Bandit without exclusions, Python compilation, Bash syntax and whitespace
checks passed. PostgreSQL was unavailable in this fresh environment, so a full
Round 2 PG17 runner and optimized concurrency reproduction remain required in
independent review. No target was accessed.

Round 2 independent review supplied by the owner at head `8c69605c` returned
scoped PASS: stock PG17.11 runner normal and PYTHONOPTIMIZE=2; 12 pre-client
refusals; 70/70 originals and candidate positives; named mutants; all five
Python modes and three optimized mutated oracles; quarantine 72 and frozen
mocked units 26/26. These are attributed reviewer results, not a new executor
run. It also found NULL inspection sequence shadowing and seven further
implementation-contract requirements. Round 3 incorporates those requirements
and refuses symlinked parent path components. Independent Round 3 review remains
pending. Raw temporary mutant/candidate outputs are deleted by the runner;
markers alone are not durable proof of their effects. A reviewer must capture
the actual outputs independently as in Round 2.

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

Round 3 executor check: parent-directory symlink refused before any client call;
unchanged-source control reached the client shim; all 44 hashes remain unchanged,
twelve explicit raise sites confirmed, Bash syntax and whitespace checks passed.
No additional PG17 run is claimed for Round 3.

The owner's supplied Round 3 review at `5f60aba3` returned the same bounded PASS,
with stock PG17 reproduction and optimized refusal. It noted live-main drift
through #312 at review time; the subsequent M200 merge is reconciled above.
It reproduced NULL shadowing in FINAL and identified NULLS FIRST in both gate
selectors. It also explains the TRUNCATE mutant helper's EXECUTE INTO diagnostic
(`42601`) on successful TRUNCATE: the named mutant still fails, while an
independent direct TRUNCATE proves the actual removal. No false claim of a
successful captured helper result is made. Frozen units were not rerun in Round 3.

Round 4 selects advisory keys/registry and controller hierarchy, server-code
RECOVERY constants, protected server marker provenance and uniform
revision/sequence ordering with append-only supersession. These are design
choices only. In particular, revoking parameter SET does not secure an ordinary
USERSET GUC; a private server-authored context is the selected authority, and
any restricted-parameter alternative needs separate feasibility/probes. The
harness's equivalent double negation is simplified for Ruff SIM208; SQL RED,
runner and SOURCE_LOCK are unchanged. Independent Round 4 acceptance is pending.

Round 4 executor verification: AST/compile retains zero assert nodes and twelve
raise sites; the condition is equivalent for both thread-alive states. Ruff
0.16.10 check, explicit SIM208 check and format, full Bandit 1.9.4, Bash syntax
and whitespace pass; all 44 hashes match. M200 source/runbook were read from
the live-main anchor, not executed. No new PG17 run or target access is claimed.
