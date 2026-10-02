# Frozen material-issue and quality integration proposal

Status: **Draft, repository/local evidence only; not merge or deployment authorization.**
Date: 2026-10-02. The accepted narrow M199 repair does not approve the complete QC feature.

## Inputs and independent review checkpoint

| Input | Frozen commit | Tree |
| --- | --- | --- |
| main / canonical package | `3acea30d83e182a2651b60b8696a658137bc0c92` | `60f5aecb7275660ef8741c3fa18d9f2be48b6b1d` |
| #301 client | `0e462611e49f50d30f888323837d351b03f3acab` | `d73fc628ce9ac1addd3cb844bac51c4f4dd747c2` |
| #304 QC interface (includes #303) | `1781c981468b615777bf6672e80ce3498ca1ff1d` | `71b1c51567b3184e5a2e3aeba42091ef8eb48a1a` |
| #306 accepted narrow repair | `e29b4e5aa96556165f97b278f55591dc61c8044e` | `67f7ec6e3da1fba3f8aaef28641a23e408733335` |
| #307 independent review record | `1690d2e5a2f72df4cef96fd1a1825f781f3a329b` | `c25603634f451f36cdd1e9811d0b526e0e9d4c8f` |
| #298 pinned canonical harness | `d71a1657739d1660740ac931ef5f48bffbd4476f` | `ed2f78616e7b3582206bf39e47dcc94539c73c9f` |

[#307](https://github.com/6thd/wardah-process-costing/pull/307) records the independent
PASS for #306, attributed independent results, environment limits and open advisories.
It preserves #306's reviewed head. The remote main contains canonical 195–198;
the reviewer's local `origin/main` at `94400e1b` was older. The scanner's unsorted
baseline selector is separately tracked: explicitly selecting cutoff 121 gives
69 guarded migrations on #306. No scanner behavior was changed here.

## Integration boundary

This proposal combines the frozen #301 and #304 trees and incorporates #306 and
#307. It does not change their original branches. The four merge conflicts were
resolved as follows:

| Conflict | Resolution |
| --- | --- |
| Manufacturing route imports | Retain both material-issue imports and QualityControlPage; automatic merged routes retained |
| Arabic translation | Retain the #301 JSON and add the exact #304 `quality` subtree |
| English translation | Same deterministic union |
| RBAC mutation baseline | Recompute the actual union, rather than choose either parent's count |

The recomputed inventory contains **365 candidates / 339 signatures**, SHA-256
`865f9de40893072242b7deecea6104ff45794e18281b1200c47f7f8bae5efbdf`.
It retains #301's mounted material preparation, removes the retired direct
`quality_inspections` INSERT and adds the six literal QC RPCs. Passing this
baseline does not close any pending RBAC classification or operational decision.

`verify_sources.mjs` recomputes the four-conflict merge and checks all 889 `src/`
paths against that union, including the explicitly resolved imports and JSON.
All existing SQL/baseline bytes equal frozen main (except the manifest entry),
and M199 equals the accepted #306 bytes. The original QC RED, 70-assertion SQL
and concurrency files equal #304. No canonical 195–198 migration was rewritten.
The generated types are the automatic parent union; they have not been regenerated
against a live or hosted database. Production hard-disable of isolated material
issue is retained.

## New local shared acceptance

`run_local.sh` installs the PR's actual cutoff-189 chain **190–199**, checks the
22-function catalog before and after, and runs the 72 quarantine probes plus
nine column-grant controls. Owner-run fixtures do not replace canonical functions.
`acceptance.sql` then runs 11 sequential assertions in a rollback transaction:

- Initial consumption leaves the maintenance version unchanged.
- QC hold moves the parent to quality_check and increments its version.
- New material consumption and M198 reservation are refused during hold, without effects.
- An already-recorded material event replays its exact receipt during hold.
- QC return requires a reason and increments the version again.
- The pre-return M198 version is stale; refreshing it allows one reservation/version increment.
- Recorded material replay still has no effects after return/reservation, and a new material event posts.

M199 legitimately replaces `create_role_from_template`. The new readback overlay
requires its exact reviewed body MD5 `5cb026fc706caef1914dbf9a1aa5236b` first,
then maps only that proved hash to the prior M196 fingerprint for the unchanged
M198 owner/ACL/settings/other-function checks. No owner, ACL or configuration is
normalized. Four mutations of the real readback (body, ACL, owner, settings)
must be refused on each readback. Unknown bodies are never accepted.

## Local evidence and reproduction

Environment: Node 24.19.0, Python 3.12, psycopg 3.3.6, PGDG PostgreSQL/server/client
17.11. A startup-only UID/file-owner adapter was needed in the root-managed
sandbox. PostgreSQL executables, SQL, roles and function bodies were unmodified.
This is not stock `postgres:17` or GitHub-hosted evidence; CI uses Node 22.

| Control | Local result |
| --- | --- |
| TypeScript | Pass |
| Full Vitest | 4961/4961 tests, 337/337 files |
| Build/password gate | Pass, `DEMO_PASSWORD_BUILD_GATE_PASS files=79` |
| RBAC scan/classifier/baseline | Pass, 365 candidates / 339 signatures |
| Source union | Pass, 889 files, four conflicts; changed client gate and M198 file independently refused, then restored |
| Complete repaired QC runner | Pass: two prefix refusals, 14 mutation refusals, 70 assertions, four DEFINER mutants, reference RBAC and concurrency |
| Shared 190–199 runner | Pass: 11 assertions, quarantine 72 + column controls 9, two 22-function readbacks and four readback mutants per capture |
| Workflow scope | YAML parses; CI/CD and Sonar changes only add the proposal's target branch; deploy conditions unchanged |

Run from repository root with an independently provisioned disposable PG17 on
127.0.0.1 and a port >=55000, using no target connection URL:

```sh
node docs/db/material-issue-quality-integration/verify_sources.mjs
bash docs/db/quality-control-199/run_local.sh
bash docs/db/material-issue-quality-integration/run_local.sh
```

The combined workflow targets #301's branch so this stacked proposal can run the
full tests. It retains the canonical 190–198 and both original native material
browser modes, and adds complete M199 and shared SQL steps. Those existing browser
installers stop at **198**: they are not native QC-browser or combined-199 evidence.
No GitHub exact-head results are claimed until the resulting head actually runs.

## Open gates and next stage

- Independent review of this integration, the complete QC feature and its grants remains required.
- Native QC screen acceptance on the same 199 database as material issue is still missing.
- Joint QC-hold/return versus material consumption, reserve/setup and retry races remain missing; sequential acceptance does not prove them.
- Hosted identity, real operators, current #278 target record, grant/expiry/device/monitoring decisions, server-side pause, in-flight requests and pending-event recovery remain unverified.
- All **33 owner decisions and eight operational gates** remain pending. #302's disposition inventory is not operational sign-off.
- The pre-existing service_role direct-write boundary on quality_inspections remains a full-QC-review item, not closed by the narrow prerequisite repair.
- M191 s82b random fixture repair and deferred QC accounting, incoming inspection/quarantine, NCR/lot traceability are separate follow-ups.

NO-GO, M192, DB-first paired cutover, application and release holds remain in
force. No Production/Staging access, migration application, release, baseline
regeneration, merge or removal of any hold occurred. This proposal is not eligible
for client deployment merely because local controls pass.
