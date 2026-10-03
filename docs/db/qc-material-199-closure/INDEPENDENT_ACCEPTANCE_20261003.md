# Native QC/material M199: independent acceptance checkpoint

Recorded 2026-10-03 UTC from the independent follow-up report supplied by the
owner in the implementation conversation. **PASS for the two local technical
proofs at the exact reviewed head; no P1/P2, eight non-blocking P3 notes.** This
is an attributed record of that review, not a new executor reproduction or a
GitHub approval review. It authorizes no merge, target access, rollout or release.

## Immutable inputs

| Input | Commit | Tree |
| --- | --- | --- |
| Reviewed PR #310 | `0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86` | `6218cf7f984134f5db2c9fe6b295bc036bea22da` |
| Accepted main after #309 | `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe` | `ad60355c42a0e725bbe431ff3032f95ac5f05d35` |
| Frozen #308 client | `2ea72541fec4b52e7e0af2a3809ecb7be791bb47` | `6ed7d21a7a6654382fc7cbff5265fd244b6012fb` |
| Earlier #310 review | `3d5fca73e51ef4a00899e91db491ba5244517869` | `65434a337ee8bfe99f8b41b70840f0a3eac1c3c1` |

The reviewer re-resolved identities at both ends; they remained unchanged. The
reviewed delta was 22 added files, +1731/-0 against main, and 14 files,
+531/-55 against the earlier reviewed head. Canonical SQL, runtime src,
dependencies, generated types and deployment conditions were unchanged. The
frozen client remained clean and byte-and-mode identical throughout.

This checkpoint is published on a separate documentation branch from main.
It does not move #310 or #308. Any later executable change to #310 needs its own
exact-head verification and independent acceptance; this PASS is not transferable.

## What the supplied review independently verified

| Evidence | Reviewer result |
| --- | --- |
| Source lock | All 42 DB sources recomputed from accepted-main blobs and four client support hashes match; coverage includes 25 baseline files and M190-M199 |
| Refusal controls | 15 connection, four source/ref and four client-content controls pass; real entry-point refusals precede setup and installation |
| Three complete stock-image runs | Stock `postgres:17`, PostgreSQL 17.11 UTF8; all three exit 0, approximately 25-31 seconds |
| Installation/quarantine/catalog | Chain 10/10; quarantine 72 plus nine column controls before/after browser; two 22-function readbacks with six controls each |
| Races | 17 observed waits, exact outcomes and eight oracle mutants; actual hold/consume row-lock removal makes the tests fail |
| Server probes | Three return-reason refusals and old-cycle completion denial; repeated rollback snapshots match; three weakened real-DB implementations refused |
| Native browser/HTTP | Five proofs using frozen native pages/hooks/IndexedDB; HTTP 14 refusals and two positives; loopback binding independently checked |
| Catalog integrity | 620 catalog items compared; only owner fixture table `wardah_internal.issue_scope_test_ids` added by seed, with no canonical body/ACL replacement |
| Catalog mutation challenge | 109 body/hash/ACL/owner mutants across 22 functions refused; three historical role-template bodies refused |
| Markers and static checks | One positive/19 marker refusals; Ruff, Bandit zero issues, syntax/YAML and whitespace checks pass |

The reviewer independently derived the M199 role-template body hash from SQL and
matched it to the installed body, and matched PRIOR_MD5 to M196. These findings
were re-derived rather than inherited from the earlier PASS.

## Hosted artifact verification

The supplied reviewer downloaded the artifact, recomputed its digest, ran the
committed marker verifier on `acceptance.txt`, and visually inspected the actual
QC screenshot (QI-000001/cycle 1 and QI-000002/cycle 2).

| Hosted identity | Value |
| --- | --- |
| Native acceptance run | [37114669375](https://github.com/6thd/wardah-process-costing/actions/runs/37114669375) |
| Native job | `111179035528` |
| Artifact | `11270283314` |
| SHA-256 | `89be97547fd4b60befe6cfe15fe8d191210d6f7be2acef4473b2eefdc8012f35` |

The reviewer found the exact head/tree, 17 race lines and 23 refusal lines in the
hosted log, with pre-install controls before npm/Playwright. CodeFactor, Codacy,
Test & Build, SonarQube and SonarCloud succeeded; Production deployment was
skipped. Action SHAs were not checked against upstream tags by this reviewer;
the SonarCloud annotation count was not independently checked. Gate success
does not claim zero advisories. Artifact verification above is attributed to the
supplied review, not a new download by this documentation author.

## Eight retained P3 notes

These are non-blocking for the accepted local proofs according to the reviewer.
They remain open; this checkpoint implements none of them.

| ID | Finding and exact remaining boundary |
| --- | --- |
| P3-01 | Committed port control uses `5432`, rejected by the five-digit regex, so removal of the `<55000` lower bound survives the controls |
| P3-02 | Actual verifier refuses mode drift and symlink parents; committed controls do not kill removal of those two checks |
| P3-03 | Client-configured clean filter executes during redundant `git status`; the comment claiming no external filters execute is inaccurate |
| P3-04 | Untracked-source refusal scans `src/`; root files such as `.env.local` remain outside that scan |
| P3-05 | `Sec-Fetch-Site` uses first-wins `.get()` for duplicate headers; browser-controlled header limits exposure, while other guarded headers use `get_all()` |
| P3-06 | Successful-consumption oracle does not assert SLE stock-value difference, bin valuation, consumption cost and other WIP cost columns; those four reviewer mutants survived |
| P3-07 | Explicit parent lock still forces waiting without function-level lock; exact outcomes detect lock removal, while the barrier alone does not; unobserved-lock control only uses a fake holder PID |
| P3-08 | Marker controls do not pin initial quarantine notice, second input line, oracle-mutant lines or include missing browser-identity-line mutation; earlier execution failure/set-e carries part of the protection |

## Corrections and limits

The supplied report's statement that "GL and stock fixtures are empty" needs
qualification. The canonical inventory fixture seeds **populated bin balances**,
including 1000 units at valuation 10, and derives product projections. The race
oracle asserts consumption quantity changes and `cost_material` changes. GL
fixtures start empty: absence of GL creation is proven, preservation of populated
GL history is not. This correction does not close P3-06's valuation coverage gap.
See the pinned [fixture](https://github.com/6thd/wardah-process-costing/blob/0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86/docs/db/manufacturing-inventory-red-20260925/00_fixture.sql)
and [race oracle](https://github.com/6thd/wardah-process-costing/blob/0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86/tests/fixtures/qc-material-199/races.py).

Local output hashes in LOCAL_EVIDENCE.md fingerprint individual runs; PID-based
database names prevent reproducing those hashes across runs. The hosted artifact
digest is independently verified as recorded above.

Two actor identities are simulated, with real PostgreSQL authorization. Hosted
Auth/JWT/PostgREST, real operators/devices and current target state are not proven.
Material-page UI permissions are a fixed-key fixture. Server probes use an owner
connection and simulated QC claim to test logic, not employee role grants.
The frozen client SHA must remain fetchable; failure is closed. Reviewer used
stock Docker PG17.11, Python 3.11 and Chromium 141; hosted used Python 3.12 and
Chromium 143. Playwright was 1.57.0. The earlier executor used the disclosed PGDG
startup adapter; this review supplies a separate stock-image repeat.

## Closure and continuation

The exact-head hosted success plus fresh independent repeat satisfy the
reviewed closure discipline for **(1) native QC/material browser acceptance on
one disposable M199 DB and (2) deterministic joint QC/material races**.
Broader QC/security review, service_role direct-INSERT disposition, all 33 route
decisions, eight operational gates, current #278 target evidence, hosted identity,
pause/recovery, DB-first application and UI-only promotion remain open.

**NO-GO, M192 and target/release holds remain.** #310 stays Draft/unmerged;
#308 stays frozen Draft/reference. No target or business state is changed by this
record. Continue with [the owner/operational preparation packet](NEXT_PHASE_20261003.md).
