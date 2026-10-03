# Executor evidence — 2026-10-03

This records local execution, not independent sign-off or target state. The accepted base
is main `3d01f99f`, tree `ad60355c`; the frozen client is #308 `2ea72541`, tree `6ed7d21a`.
Remote main and the client ref were re-resolved during preparation and had not moved.

## Final implementation results

| Command / proof | Observed result |
|---|---|
| `run_local.sh <clean frozen #308>` | Exit0; `QC_MATERIAL_NATIVE_199_PASS chain=10 readback=22 identity=simulated release_ready=false` |
| Installed files | This proposal's canonical190–199, exactly10; cutoff189 |
| Input verifier | 42 accepted main sources + 4 frozen client support hashes; clean client HEAD/tree before/after |
| Quarantine | 72 actual attempts; role authenticated/anon/service_role; unchanged state |
| Column-grant controls | 9 refused mutants, restored positive control |
| Readback | Twice22 functions; M199 role-template body checked before normalization; six refused mutants each time |
| Joint races | 17/17 explicit orderings passed; all17 observed blocking; seven oracle mutants refused |
| Native browser | Five proof markers, four separate browser profiles, one199 database, no page/console errors |
| Refusal controls | Nine connection cases + four actual source/ref refusals |
| Workflow marker controls | One positive + four refusals: missing browser marker, wrong race count, only one readback, wrong identity marker |
| Canonical package verifier | files4, release_ready=false |
| Package/delegation controls | 7/7 + 6/6 |
| DEFINER source scan | Actual invocation: 38 migrations above152, no unguarded DEFINER; not a rerun of the441 self-tests |
| Syntax | Python compilation, node `--check`, bash `-n`, YAML parse and `git diff --check` pass |
| Bandit1.9.4 | Zero issues with B101 omitted for executable test assertions; two line-specific fixed-git B404/B603 exceptions; no analyzer config changed |
| Radon6.0.1 | All helpers A/B; maximum catalogB(10), race effectsB(6) |

Final full-run output SHA256 (run ending in final PASS):
`878ec5530cae289742af43c515aeca3af94c4b3b35a9b08741429c5db4d74a00`.
The same final implementation completed a second full run with exit0; its output SHA256 is
`168f173baadeeb60479b9aa9b9982af6e6b63cd10a193b83b2b20942adccdcd5`. Logs/screenshots are local
scratch evidence; the new hosted workflow uploads reproducible evidence as an artifact.

## Environment and exploratory failures

- PostgreSQL17.11 official Ubuntu PGDG extracted binaries, client17.11, UTF8, Python3.12,
  psycopg3.3.6, Node24.19.0, Playwright package from the installed accepted client dependencies.
- Browser: unmodified Chrome headless shell143.0.7499.4, downloaded from official Chrome
  for Testing storage. The regular154 browser crashed in this sandbox. Standard Playwright
  download mirrors failed, so the explicit `WARDAH_BROWSER_EXECUTABLE` path was used.
- Managed root startup uses a UID/stat-owner preload adapter for initdb/postgres only;
  PostgreSQL binaries, SQL, authorization and database functions are unchanged. This is
  not a stock Docker reproduction. The new hosted workflow uses stock `postgres:17`.
- agent-browser's local daemon could not start under this sandbox's socket restrictions.
  Native Playwright ran the forms, checked meaningful page content/console errors, and took
  the screenshot, which was visually inspected.
- An exploratory browser run timed out waiting for a dialog after grant restoration.
  The fixture now awaits form reset/Final selection before typing; no runtime client edit
  or timeout increase was made. Browser sequences passed repeatedly afterwards. One
  development repeat passed browser/races but failed at shell EOF because its runner file
  was edited while that process was reading it; this is not counted as a complete pass.
- A later helper refactor exposed a test-variable/helper-name collision; it was corrected
  and the complete final implementation passed. These exploratory outputs are not CI proof.

## Limits retained

No hosted run is claimed by this local document. Await exact-head GitHub evidence and
independent review/repeat. The workflow and screenshots do not prove hosted Auth, PostgREST,
real devices, an operator, current target ledger/identities/grants, or populated real GL.
The fixture's grant endpoint and request-loss switches are test-only loopback adapters.
Quality settings UI, conditional/stage inspection UI, completion orchestration and broad
QC feature review are not claimed. The material/QC hold-return-consumption interaction
and fixed inspection replay are the scope here.

No full Vitest/build or types regeneration was rerun: runtime src, generated types and
package dependencies are byte-unchanged from main; the actual frozen client mounts and
executes in the browser. Existing accepted assertions and #308 reference are unchanged.

NO-GO/M192, owner33/operations8, service_role INSERT decision, #278, target application,
hosted identity/operator/device/monitoring, pause/in-flight/retry/pending recovery and
DB-first UI promotion all remain open. No Production/Staging access, live migration,
deployment, merge or hold change occurred.

## Analyzer follow-up on the initial published head

The first hosted native run37107404098 at `b65b13be` succeeded on stock postgres:17
(all installation, refusal, native/race and artifact steps passed). This is evidence for
that earlier head, not a claim for the follow-up head.
CodeFactor reported Python E702 statement layout and the test transport's explicit thenable.
Codacy flagged two safely quoted CREATE DATABASE format calls and the seed's psql meta-command.
The follow-up splits Python statements, ends the known read chains with real Promises,
uses psycopg `sql.Composed` plus `sql.Identifier` for database names, and removes the
redundant meta-command (the caller already sets ON_ERROR_STOP). No suppression/config was
added for those reports, and no runtime, canonical source, assertion or timeout changed.
The complete native/race runner passed again after this repair. The new exact-head hosted
result remains pending until verified separately.

Codacy subsequently classified the PostgreSQL-only seed file as T-SQL and required
SET QUOTED_IDENTIFIER. The seed is now a local guarded Python script executing the same
fixed grant/policy SQL with bound parameters. No analyzer setting or DB semantics changed.
The complete runner passed with this parameterized seed as well (17 races, five browser
proofs, quarantine72/controls9 and two22-function readbacks).


## P3 follow-up — 2026-10-03 (supersedes initial local pending status)

The owner supplied an independent review of parent head
`3d5fca73e51ef4a00899e91db491ba5244517869`, tree
`65434a337ee8bfe99f8b41b70840f0a3eac1c3c1`: PASS for the two local technical
proofs only, no P1/P2, with six P3 notes. That reviewer reported seven full runs
including a loaded run, function-level mutants and catalog/header probes. Those are
reviewer observations, not reruns by this follow-up executor.

This delta stays within the fixture/workflow/three closure docs. SQL, runtime src,
SOURCE_LOCK, #308, dependencies, generated types, existing accepted assertions and
all target/owner/operational/release holds are unchanged.

| Note | Follow-up disposition |
|---|---|
| P3-A | Immutable HEAD blob/mode verification over tracked client files, plus filesystem enumeration of untracked/ignored src files. Four real scratch-copy refusals; the status-only mutant accepts each same alteration before the fixed verifier refuses it. Windows-script CRLF normalization follows the frozen attributes; runtime bytes are exact. |
| P3-B | Python and shell require five ASCII port digits in the allowed range. Fifteen connection refusals include spaces, plus sign, underscores, Arabic-Indic digits and a leading zero. |
| P3-C | Three server reason refusals, successful current-cycle release positive control, actual old-cycle completion-trigger rejection and whole-transaction rollback snapshot; deep-equal material replay; exact inspection args; mutation of installed 20260905_184634 baseline; quarantine re-run after browser. |
| P3-D | npm/Playwright install follows refusals; four actions pinned to the previously observed exact action commits. Marker verifier and one-positive/19-refusal controls are committed and run against actual output. Client-SHA availability remains an explicit fail-closed limitation; no persistent ref was created. PG client/psycopg still precede refusal controls. |
| P3-E | Exact Host/Origin/Content-Type/fetch-site checks before request execution, bounded body read. Fourteen real HTTP refusals and two positives; business state unchanged. Loopback binding and original SQL/RPC/grant allowlists preserved. |
| P3-F | Summary counts actual successful blocking observations independently; exact product delta and final bin projection asserted on consumption, with an additional successful-consumption product mutant. Eight race-oracle refusals in total. |

Local complete run 1: exit 0, output SHA256
`64fdb0aae7e5960cfe6aa635f51cb9f5bb7c81fbfeebb4aa0b5aa8f8c4106419`.
Local complete run 2 after the helper refactor: exit 0, output SHA256
`2445821fe3ae765a2bed7eaea8decf92b5e9408658efd0330f4d9b1ccabed1db`.
Both ran canonical 190–199 from cutoff189, 17 observed lock orderings, five browser
proofs, the new server/HTTP probes, quarantine before/after and two22-function readbacks.
The actual-output marker positive and19 refusals passed for both logs.
The final test-controls non-vacuity addition was rerun separately and passed all
15 connection +4 source/ref +4 content controls.

Environment: PGDG PostgreSQL17.11 UTF8, psql17.11, Python3.12.14/psycopg3.3.6,
Node24.19.0/Playwright1.57.0, unmodified Chrome headless shell143.0.7499.4.
The existing disclosed UID/stat-owner preload adapter was reused for PostgreSQL startup
only, on a new local cluster/port55447. No SQL/database function was replaced and no
hosted target was contacted. This remains a managed local reproduction, not Docker.
Bandit1.9.4: zero reported issues with B101 omitted for test assertions and narrow
fixed-git subprocess annotations. Ruff E702/F checks, Python/node/bash syntax and diff
checks pass. Radon6.0.1 helpers are A/B, maximum10. Frozen client verification passes
before/after and its git status remains clean except the permitted ignored dependency link.

Parent-head hosted evidence: native run37108076924/job111160410558 succeeded;
Test & Build, CodeFactor, Codacy and SonarQube checks succeeded; Production deploy skipped.
Those old results do not certify this follow-up. New-head CI must be resolved separately
and recorded in the PR body; independent review is still pending. No merge or target
migration application was performed. All NO-GO/M192/owner33/ops8 and DB-first gates remain.


### Analyzer-driven byte comparison follow-up

At intermediate head `d8db7da2`, the hosted native M199 run37114130320 succeeded,
as did CodeFactor. Codacy objected to the explicit SHA1 algorithm used to reproduce
Git blob identities (`verify_inputs.py` line59); its exact annotation was read via
the public GitHub API. The verifier now reads the pinned immutable blobs with fixed,
read-only `git cat-file --batch` and compares actual bytes directly, without any
weak-hash algorithm or suppression. The existing Windows-script checkout normalization
and all mode/source-shadow checks remain. Git now has five read-only query kinds.

The content/refusal controls passed again, including the former-status-only positive
mutants, and a third complete native/race/server/HTTP run exited0 with all markers.
Third-run output SHA256:
`201bac0db0ea1c0a3dd363f0920fef1d7cef3fcec661be556a04c6f46583de10`.
Bandit/Ruff, syntax and marker controls passed after the byte-comparison change.
The intermediate hosted success does not certify the resulting changed head; resolve
new-head CI and fresh independent review separately. No source lock, frozen client,
canonical SQL, runtime source, dependency or rollout hold changed.
