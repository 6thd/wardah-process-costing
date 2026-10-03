# Native QC/material-issue M199 acceptance proposal

Status: prior head `3d5fca73` independently passed the two local technical proofs (no P1/P2).
This follow-up addresses its P3-A–F notes; new-head independent review and hosted verification
remain required. Historical results below do not approve this changed head.
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
and after execution. Tracked contents and modes are checked against immutable HEAD blobs,
including assume-unchanged/skip-worktree files; untracked and ignored source files are refused.
Only archived .bat/.cmd/.ps1 checkout CRLF is normalized per the frozen .gitattributes; runtime
source bytes are exact. Git uses a fixed executable, four read-only allowlisted queries,
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
| Joint races | 17 observed lock waits with explicit first/second ordering; 8 oracle mutation refusals |
| Refusals | 15 connection cases, 4 actual input/ref revision refusals, 4 client-content refusals |

The 12 first race cases cover hold/return versus consumption, reserve and manual-work-order
setup, in both orders. Four more cover fixed receipt replay versus hold/return, in both
orders. The seventeenth blocks a same-event retry behind an **uncommitted** consumption,
then commits consumption plus QC hold before the retry returns the original receipt.
Each case uses a fresh clone of the same seeded M199 database, not shared accumulated state.
Waits are proved using `pg_blocking_pids`; sleeps only poll the observation. The blocked
summary now independently increments on a successful blocking observation. Consumption
checks exact product quantity changes and final bin projections, including a dedicated
successful-consumption product mutant.

Denied operations compare the complete business snapshot against the state after the
permitted predecessor. Successful operations check parent version/status, row counts,
reservation consumption, on-hand change and WIP cost. Financial snapshots include bins,
SLE, product stock, WIP, consumption, GL headers/lines and journals. GL fixtures start empty:
they prove no unexpected creation, not preservation of a populated real ledger.

The new workflow targets main PRs and supports manual dispatch, checks out the exact head,
uses `contents: read`, and tests stock `postgres:17` plus PG17 client. It requires all five
browser markers, exactly 17 distinct race markers and two six-control catalog markers, plus
server/HTTP/post-browser quarantine markers. Its durable marker controls test one positive
and 19 refusals against the actual output. Input refusals precede npm/Playwright installation;
PG17 client and psycopg installation still precede the controls. Actions are SHA-pinned.
The frozen client SHA must remain fetchable; its branch is preserved and missing history
fails closed. No new persistent tag or branch rewrite is introduced. It contains
no deployment, live connection, migration application to a target, or client-promotion step.

## Follow-up coverage and bridge boundary

The browser deep-compares the fixed receipt replay response and checks inspection argument
keys. Additional PostgreSQL probes reject NULL/empty/whitespace return reasons and exercise
the actual completion trigger with only an old-cycle PASS. They run under a simulated QC
claim in an owner connection, roll back completely, and check full snapshots; they do not
claim the quarantined completion RPC is available to employees.

Quarantine acceptance runs again after the browser (72 probes, state unchanged). The source
control now mutates the installed cutoff-189 baseline rather than an older unused baseline.
The bridge remains loopback-only with its existing RPC/read/grant allowlists. It checks exact
Host, Origin, Content-Type and fetch-site headers before executing requests; 14 hostile
header/read cases are refused and two positive controls pass without state changes. POST
requires the frontend Origin and JSON; GET permits absent Origin for same-origin/direct
controls but rejects foreign Origin and Host. No hosted identity claim follows.

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
