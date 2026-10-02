# M199 prerequisite repair — executor evidence

2026-10-02 UTC. Proposal based on #303 at
`a312ab529919dc1815692dd7f06fab5f4270d804`, tree
`2a6024609a301c999cf4d50d0eed31b06dbc0287`. Independent review is pending.
No merge, live application, Production/Staging access, release or hold removal.
The [coordination checkpoint in #305](https://github.com/6thd/wardah-process-costing/pull/305)
records the other work and its open gates.

## Reproduced defect

The old preflight tests objects already present by M196. Both real truncated
chains 190–196 and 190–197 accepted the complete original M199 transaction;
`wardah_internal.quality_policies` existed afterwards. These were disposable
databases with the cutoff-189 baseline and repository migrations in order.

The new control script, pointed at the original M199 file from frozen #303,
fails on its first actual prefix test:

```text
AssertionError: M199_PREREQUISITE_FALSE_GREEN: chain_196
M199_OLD_PREREQUISITE_ORACLE_RED_PASS
```

This proves the control distinguishes the original behavior from the repair.
The old result is a prerequisite failure, not evidence that quality functionality
is compatible with a missing M197/M198.

## Narrow repair

Only a preflight insertion changes the SQL. It requires the reviewed M198 setup
body MD5 `b2576a5e9cf4dbab07be959434add8ab`, its language/kind/return type,
SECURITY DEFINER and empty search path, plus the same enabled parent-version
trigger/body contract M198 requires. Body identity gates known reviewed bytes;
it is not a substitute for authorization review or proof of the live ledger.

The runner uses the cutoff-189 baseline and verifies exactly 190–198. It first
installs 190–196; the new script refuses M199, installs 197, refuses M199 again,
installs 198, and then exercises fourteen transactional catalog mutations.
Existing RED, positive M199 installation, seventy QC assertions, DEFINER controls
and concurrency tests still run afterwards. Workflow marker validation requires
the exact prefix/mutation count and uses fixed-string matching.

| Mutation | Expected refusal |
|---|---|
| Setup body, invoker mode, search path | `M199_REQUIRES_FROZEN_M198_SETUP` |
| Setup signature missing (transactional rename) | `M199_REQUIRES_M190_THROUGH_M198` |
| Trigger disabled, ALWAYS, REPLICA or missing | `M199_REQUIRES_FROZEN_PARENT_VERSION_TRIGGER` |
| Trigger event, column filter, condition, arguments or function changed | `M199_REQUIRES_FROZEN_PARENT_VERSION_TRIGGER` |
| Version helper body changed | `M199_REQUIRES_FROZEN_PARENT_VERSION_TRIGGER` |

Each refusal must be P0001 with the exact diagnostic. After rollback the script
compares affected-schema catalog rows, ACLs, permissions, role templates and
inspection rows to its before snapshot. Unexpected success or residue fails.

## Results run by the executor

| Control | Result |
|---|---|
| Original M199 on real 196 and 197 prefixes | Both falsely accepted, reproduced |
| New oracle against original M199 | Fails at `chain_196`, as required |
| Fixed M199 prefix / mutation controls | 2/2 prefix refusals, 14/14 mutations refused; restored snapshots |
| Complete QC runner | PASS; 70/70 assertions, existing RED, four DEFINER mutants and three two-session race scenarios |
| Canonical runner, pinned #298 harness | `CANONICAL_MATERIAL_ISSUE_PG17_PASS chain=9 readback=22 release_ready=false`; two 22-function readbacks |
| Quarantine after M199 on the full chain | 72 denied probes; nine column-grant mutations rejected and restored |
| Canonical package verification / tests | Byte verification PASS; 7/7 package tests |
| Canonical delegation / scanner tests | 6/6 and 441/441 PASS from repository root |
| DEFINER scanner | 42 migrations after its cutoff, no unguarded DEFINER |
| Python compile, shell syntax, diff check | PASS |
| Bandit 1.9.4, new Python script | Zero issues, no suppressions |
| Radon 6.0.1, new Python script | Maximum B; no D/E/F functions |
| Scope check | Original QC RED/acceptance/concurrency files unchanged; removing the preflight insertion reproduces original M199 exactly |
| Canonical preservation | 195–198 byte-identical to main; pinned harness unchanged |

The canonical runner stops at 198. Its result above does not claim combined
quality/client acceptance. The separate post-199 quarantine run proves the stated
quarantine boundary only, not QC/material-issue browser integration.

## Environment and limits

Local PGDG PostgreSQL server/client 17.11 on Ubuntu 24.04; Python 3.12,
psycopg 3.3.6. Official package downloads matched the SHA-256 values in the PGDG
package index. This was **not** a stock `postgres:17` container reproduction.

The managed scratch environment cannot switch Unix users and isolates each
execution's network. A local UID/file-owner startup adapter was used for initdb
and the server; client tests and server ran in one isolated invocation, on
127.0.0.1:55439 with Unix sockets disabled. It changes no SQL, PostgreSQL binary,
database role, function or assertion. Stock-image GitHub evidence is still needed
to close this environment limitation.

This proposal is stacked on #303's branch. The targeted workflow runs on PRs to
main or workflow_dispatch, so this stacked PR does not automatically provide its
GitHub-hosted PG17 acceptance evidence. No workflow was manually triggered here.
No full main-targeted CI, hosted identity, operator/device, live ledger or
combined #301/#304 acceptance is claimed.

## Reproduction and review

Run the normal `run_local.sh` only against a disposable local PG17 database
cluster. Its original local-connection refusal remains. To reproduce the old
oracle result, build a separate cutoff-189 database through 196, name it
`wardah_quality_199_*`, extract frozen #303's M199 file with `git show`, then run:

```sh
python3 docs/db/quality-control-199/test_prerequisites.py wardah_quality_199_review original199.sql
```

That invocation must fail with `M199_PREREQUISITE_FALSE_GREEN: chain_196`; discard
the database because unexpected success committed the old M199 transaction.
Read [PREREQUISITE_REPAIR_REVIEW_PROMPT.md](PREREQUISITE_REPAIR_REVIEW_PROMPT.md)
before independent review. All operational holds and owner decisions remain open.
