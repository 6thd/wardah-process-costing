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
