# Native QC/material-issue M199 acceptance proposal

Status: local proof implemented; independent review and exact-head hosted acceptance pending.
This is an acceptance-only proposal based on `main@3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`
(tree `ad60355c42a0e725bbe431ff3032f95ac5f05d35`, merged #309).
It changes no migration, baseline, generated type, runtime client, existing assertion,
package dependency, RBAC inventory or deployment condition.

The browser mounts **frozen #308**, commit
`2ea72541fec4b52e7e0af2a3809ecb7be791bb47`, tree
`6ed7d21a7a6654382fc7cbff5265fd244b6012fb`, without editing that checkout.
Both its actual `QualityControlPage` and `MaterialIssuePage` use **one disposable
PG17 UTF8 database containing this proposal checkout's exact M190–M199 chain**.
Only the test entry point, identity adapter and transport adapter are new.
The browser uses native IndexedDB; no fake-indexeddb or RPC result mocks are used.
JWT identity is simulated with two fixed fixture actors; PostgreSQL executes each
call as `authenticated` and evaluates its real membership, grants and authorization.
This is not hosted Supabase/Auth/PostgREST identity acceptance.

## Run

From the proposal repository root, with a clean pinned #308 checkout whose dependencies
are available (a node_modules symlink is untracked and permitted):

```bash
export PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres
export WARDAH_QC_OUTPUT=/tmp/qc-material-199-evidence
mkdir -p "$WARDAH_QC_OUTPUT"
python3 tests/fixtures/qc-material-199/test_controls.py /path/to/pinned-308
bash tests/fixtures/qc-material-199/run_local.sh /path/to/pinned-308
```

Install psycopg 3.3.6, repository npm dependencies and Playwright Chromium first.
The local PG17 server must be UTF8, on a loopback port 55000–65535. URL/service/hostaddr
configuration is refused. The runner creates and drops its own database and race clones.
An optional `WARDAH_BROWSER_EXECUTABLE` selects an already-installed Chromium.
`WARDAH_QC_VISUAL_CHECK` can run a local visual-check script before acceptance.

`SOURCE_LOCK.json` pins 42 DB inputs from accepted main and four supporting #308 files,
including both readback SQL and comparators. Clean HEAD/tree identity is checked before
and after execution. Git uses a fixed executable, three read-only allowlisted queries,
no fsmonitor and no inherited `GIT_*` variables.

## Proof boundaries

| Proof | Expected evidence |
|---|---|
| Canonical install | cutoff 189; exactly 190→199, 10 files |
| Existing quarantine | 72 probes, 9 column-grant controls, no grant reopened |
| Installed function catalog | 22 functions before and after; M199 role-template overlay; 6 mutation controls each time |
| QC hold and consumption | fixed receipt replays during hold without effects; new event from an already-mounted stale form refused with exact P0001 diagnostic |
| Final inspection | actual form, server inspector/cycle, commit-then-lost-response retry with identical request and one row |
| QC return | reason required; version advances; new consumption succeeds afterwards |
| Next cycle and grant revocation | cycle 1 PASS cannot release cycle 2; revoked inspection grant returns 42501 with no effects; restored grant succeeds |
| Joint races | 17 observed lock waits with explicit first/second ordering; 7 oracle mutation refusals |
| Refusals | 9 connection cases, 4 actual input/ref revision refusals |

The 12 first race cases cover hold/return versus consumption, reserve and manual-work-order
setup, in both orders. Four more cover fixed receipt replay versus hold/return, in both
orders. The seventeenth blocks a same-event retry behind an **uncommitted** consumption,
then commits consumption plus QC hold before the retry returns the original receipt.
Each case uses a fresh clone of the same seeded M199 database, not shared accumulated state.
Waits are proved using `pg_blocking_pids`; sleeps only poll the observation.

Denied operations compare the complete business snapshot against the state after the
permitted predecessor. Successful operations check parent version/status, row counts,
reservation consumption, on-hand change and WIP cost. Financial snapshots include bins,
SLE, product stock, WIP, consumption, GL headers/lines and journals. GL fixtures start empty:
they prove no unexpected creation, not preservation of a populated real ledger.

The new workflow targets main PRs and supports manual dispatch, checks out the exact head,
uses `contents: read`, and tests stock `postgres:17` plus PG17 client. It requires all five
browser markers, exactly 17 race markers and two six-control catalog markers. It contains
no deployment, live connection, migration application to a target, or client-promotion step.

## Closure discipline

Local success is evidence proposed for review, not independent approval. Exact-head hosted
success and an independent repeat must be recorded before calling these two technical gaps
closed. Existing #308 remains frozen Draft/reference; this proposal does not merge its UI.

All remaining gates remain open: 33 owner dispositions; eight operational gates; service_role
inspection INSERT disposition; current #278 and target ledger/identity/grant readback;
server-side pause, in-flight/retry/pending-event recovery; hosted identities/operator acceptance;
device/monitoring decisions; separately authorized DB-first target application and UI-only
promotion. **NO-GO, M192, target-application and release holds remain in force.**

See [local evidence](LOCAL_EVIDENCE.md) and [independent review prompt](REVIEW_PROMPT.md).
