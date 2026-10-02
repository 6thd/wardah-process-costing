# Canonical material-issue allocation: 195–198

**Draft allocation, final independent sign-off/application pending. NO-GO.**
This DB-only PR starts at `main@94400e1b78f7f5f1716568df96dba7cde2558d12`,
whose maximum canonical file is 194. It copies the accepted SQL bytes into the
canonical directory and adds pending MANIFEST rows. It changes no application
source, client contract, existing SQL/baseline, grants policy or Production hold.
Historical candidate comments inside the unchanged SQL remain provenance, not
evidence of target application. The numbers remain proposed until this PR is
accepted and merged; recheck allocation collisions before merge.

| Canonical file / application stem | Accepted source | SHA-256 prefix |
|---|---|---|
| `195_material_issue_scope` | #291 containment, frozen release package | `d906c72a` |
| `196_material_issue_maintenance` | #293 maintenance/reconciliation | `cf61b346` |
| `197_material_issue_stale_version` | accepted #294 compatibility correction | `e7eb6026` |
| `198_material_issue_parent_version` | accepted #295 parent-version candidate | `2cf867df` |

Full digests, source paths and application names are in `CANONICAL_PACKAGE.json`.
The verified order is cutoff-189 baseline/reference pair, then **190→191→192→193→194→195→196→197→198**.
M196, M197 and M198 replace the same setup RPC in order; only the final M198 body
is the post-chain contract. M197's P0001 correction remains in that final body.

## Acceptance and scanner disposition

The canonical workflow checks out the paired review harness at the immutable
commit `d71a1657739d1660740ac931ef5f48bffbd4476f` (tree
`ed2f78616e7b3582206bf39e47dcc94539c73c9f`). This is the #296 client plus accepted
#297 cleanup and the 13 frozen #293 DB files. A secondary checkout avoids copying
or editing the frozen profile and tests into this DB-only PR.

`verify_package.py` checks the four canonical files against fixed reviewed SHA-256
values, the manifest, and that exact clean harness checkout. `run_local.sh` applies
**this PR's actual canonical files**, without copying candidate SQL into the apply
directory. It refuses non-loopback/low-port/non-PG17 endpoints and connection
URL/service/PGHOSTADDR overrides, creates a uniquely named disposable database,
and drops it on exit. Before fixtures it verifies the final installed 22-function
body/owner/ACL/settings profile and the retryable-SQLSTATE gate. It then reuses the
unchanged containment, reconciliation and M198 behavior/race/guard-mutation probes,
and verifies the restored final catalog again.

The generic DEFINER scanner recognizes public membership/assertion helpers, but
does not infer the private `wardah_internal.assert_issue_maintenance_permission`
delegation. Five exact definitions across 196–198 therefore need an explicit
reviewed disposition. The addition credits only those full signatures when **all
four complete canonical files** match the accepted digests. It adds no generic
guard name or bare-name exemption, and leaves every other scanner rule intact.
Changing a body, ACL, identity, dependency or even an artifact comment removes
that credit; missing files, new filenames and overloads do not inherit it.
The independent review must assess this finite disposition plus its negative
controls and mandatory installed-catalog acceptance. This is a new promotion-gate
change, not a re-review of the accepted SQL/P2s or permission policy.

The #298 candidate workflow separately proves the matching M198 client with both
native browser modes. This DB-only workflow proves canonical installation and
server behavior, not browser/hosted identity or a target ledger record. CI results
must be tied to the final exact head/tree. No local PG run is claimed if unavailable.

```bash
python3 docs/db/material-issue-canonical-195-198/verify_package.py
python3 docs/db/material-issue-canonical-195-198/test_package.py
python3 scripts/ci/test_material_issue_canonical_delegations.py
# A clean checkout at the pinned harness commit is required for the server run:
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=postgres \
  bash docs/db/material-issue-canonical-195-198/run_local.sh /path/to/pinned-harness
```

## Cutover and release gates

M198/#294 and M197/#296 both reject new reserve/manual-WO commands without effects.
Separate DB-first review does not make either deployment order continuously
available. Follow the accepted [paired cutover plan](https://github.com/6thd/wardah-process-costing/blob/383c3537237de06e577231f35d74a4ccdb124031/docs/db/material-issue-parent-version-198/CUTOVER.md).
It requires separately approved isolated non-PROD work, verified server-side
quiescence including retries/in-flight requests, held access while switching both
artifacts, reloaded/re-authenticated verified client builds, intact saved events
and no unverified one-sided downgrade. Production rules in CLAUDE.md still apply;
this PR approves no migration application or Production deployment exception.

Remain open: final allocation/sign-off/application plan, owner explicit grants
and expiries/device/monitoring choices, current #278 application and behavior
record plus compatibility disposition of remaining quarantined callers, real
target identities/browser/operator/database reconciliation and separate release
approval. M192 and Production holds remain. Local/CI artifacts are not current
Production/Staging evidence; no such environment is accessed by these runners.
