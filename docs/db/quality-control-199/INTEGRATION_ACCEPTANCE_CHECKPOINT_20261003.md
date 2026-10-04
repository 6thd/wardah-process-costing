# Material issue + QC: independent integration acceptance checkpoint

2026-10-03 UTC. The owner supplied an independent re-review **PASS for repository
integration and local sequential behavior only** at #308:

| Input | Commit | Tree |
| --- | --- | --- |
| Accepted #308 | `2ea72541fec4b52e7e0af2a3809ecb7be791bb47` | `6ed7d21a7a6654382fc7cbff5265fd244b6012fb` |
| main | `3acea30d83e182a2651b60b8696a658137bc0c92` | `60f5aecb7275660ef8741c3fa18d9f2be48b6b1d` |
| Client #301 | `0e462611e49f50d30f888323837d351b03f3acab` | `d73fc628ce9ac1addd3cb844bac51c4f4dd747c2` |
| QC UI #304 | `1781c981468b615777bf6672e80ce3498ca1ff1d` | `71b1c51567b3184e5a2e3aeba42091ef8eb48a1a` |
| M199 prerequisite repair #306 | `e29b4e5aa96556165f97b278f55591dc61c8044e` | `67f7ec6e3da1fba3f8aaef28641a23e408733335` |
| Earlier checkpoint #307 | `1690d2e5a2f72df4cef96fd1a1825f781f3a329b` | `c25603634f451f36cdd1e9811d0b526e0e9d4c8f` |
| Reference harness #298 | `d71a1657739d1660740ac931ef5f48bffbd4476f` | `ed2f78616e7b3582206bf39e47dcc94539c73c9f` |

The independent report re-resolved these before and after review. Its CI merge
`c51a4007` has the accepted head tree. #308 remains Draft; this checkpoint is
stored in a separate DB-only proposal so the accepted head stays unchanged.

## What this acceptance closes

These are attributed independent-review results, not new runs of the DB-only
projection:

- Source union verified independently, with the four documented merge conflicts;
  889 source paths verified and ten source-drift mutations refused. Original QC
  RED/acceptance/concurrency files and canonical 195–198 bytes are preserved.
- RBAC recomputed: 365 candidates / 339 signatures, SHA-256
  `865f9de40893072242b7deecea6104ff45794e18281b1200c47f7f8bae5efbdf`.
  Delta against #301: one direct quality-inspection INSERT removed, six literal
  QC RPC calls added. Twelve pending reviews and 145 verified gaps remain open.
- Full M199 runner: two prefix refusals, fourteen mutation refusals, seventy
  assertions, RED reproduction, four DEFINER mutants, concurrency and snapshot
  controls pass.
- Shared 190–199 runner: eleven assertions, 72 quarantine probes, nine column
  controls, sixty forced-order repetitions and two 22-function readbacks pass.
  Both old command-construction bugs were independently reproduced under the
  adverse UUID ordering; fixed commands pass both orderings.
- The M199 readback overlay derives from reviewed SQL and rejects field/body,
  cross-function hash, prior-body, missing-row and duplicate-row mutations.
- Snapshot repair tolerates maintenance changes to exactly five physical
  `pg_class` fields; fourteen catalog mutations are detected and rolled back.
- Default-timeout Vitest: 4961 tests / 337 files; TypeScript and build/password
  gate pass. Flagged and unflagged production bundles are byte-identical.
- Exact-head hosted checks have no failures; Deploy is skipped. The downloaded
  stock-PG17 artifact digest matches GitHub and contains the required markers.

Reviewer environment: PGDG PostgreSQL 17.11 UTF8, Node 22.22 and Python 3.11.
Stock-image evidence comes from the hosted artifact. The reviewer did not run
Playwright, vendor Auth, ESLint/i18n, Sonar or Codacy locally, regenerate types,
or inspect Sonar's sixty non-blocking new issues. Existing browser evidence is
190–198 only, never native QC/199 evidence.

## Remaining merge precondition and gates

There are no P1 findings. The review's P2 is a **merge-shape precondition**:
#308 combines M199 with its dependent QC UI. The QC route is mounted without a
production hard-disable. `CLAUDE.md` requires a separate DB PR, repository merge,
authorized target application and verification before the dependent UI merge.
This PASS does not make #308 merge eligible.

Still open, with no implied approval:

1. Full QC feature/security review, including `service_role` direct writes to
   `quality_inspections` and owner/ACL boundaries.
2. Native QC browser acceptance on the same 199 database as material issue.
3. Joint QC hold/return versus consumption, reserve/setup and retry races.
4. All 33 owner decisions and eight operational gates in the validated #302
   inventory: hosted identity, current #278 record, server pause, in-flight and
   pending-event recovery, devices, monitoring and paired cutover.
5. Separate repository-merge, target-application and client-release decisions.
   NO-GO, M192 and all existing holds remain. No baseline regeneration before
   the live ledger contains the applied canonical migrations.

## Optional advisories retained without expanding this repair

| Item | Limit / disposition |
| --- | --- |
| Empty GL fixture | Detects creation, not preservation of existing GL rows; GL lines not mutated separately |
| Runner byte binding | Source verifier pins M199 before shared runner; runners do not self-pin M199, and catalog_readback.sql is not byte-pinned |
| Built-in readback mutants | Cover role-template function; reviewer independently covered other functions |
| QC success timing | Returned invalidation promises delay toast/close until refetch; pending buttons remain disabled |
| Test timing | Pre-existing tests approach five-second defaults; repaired Settings tests have headroom |
| Encoding | UTF8 is required for the recorded runner evidence; SQL_ASCII produces an unclear TypeError |

No SQL, grant, application behavior or frozen input was changed to address these
optional items. New local/hosted evidence for the DB-only projection must be
recorded separately; the accepted #308 checks do not transfer to a new head.
