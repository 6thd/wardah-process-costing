# Independent review: material-issue client promotion to main

Repository: `6thd/wardah-process-costing`.
PR: the Draft from `feat/material-issue-client-promotion-main` to `main`.
Freeze the full head SHA/tree from the PR description and verify them remotely
before doing any work. If those identities differ, report the mismatch rather
than reviewing a substituted revision. This is READ ONLY: no edits, commits,
pushes, metadata changes, workflow triggers, merges, live migration application,
Production/Staging access, or release/hold removal.

Frozen inputs:

- main after #299: `3acea30d83e182a2651b60b8696a658137bc0c92`, tree
  `60f5aecb7275660ef8741c3fa18d9f2be48b6b1d`.
- Accepted combined #298: `d71a1657739d1660740ac931ef5f48bffbd4476f`, tree
  `ed2f78616e7b3582206bf39e47dcc94539c73c9f`.
- The unmodified merge-tree of those inputs: `eb5c585a73b8c6fe397e58a73bd0cb4f2ac8c287`.

Do not rely on implementation-session conclusions or supplied PASS reports as
proof. Re-derive the integration evidence from exact bytes, real local controls
and GitHub logs. Do not restart the frozen #298 design or recreate M195–M198.

Required review:

1. Verify Draft/Open/unmerged state, base identity, head/tree, parents and exact
   deltas. Distinguish the entire stacked-client delta against main from #298's
   small delta against #296. Verify no `sql/` change against frozen main and no
   runtime `src/` change against #298 except the generated-type resolution.
2. Verify generated types are byte-identical to main, removing duplicate manual
   declarations without losing any canonical fields/functions. Run type-check,
   build/password gate and the full Vitest suite (implementation result: 4930
   tests across 332 files). Keep every existing assertion and permission/recovery
   rejection intact; a green mock suite does not prove native persistence or REST.
3. Review the installer and both browser runners. Actual SQL must come only from
   this PR's `sql/migrations`, baseline cutoff must be 189, exact order 190–198,
   all SQL must install before business fixtures, and no candidate file may
   replace a canonical function. Prove the 72 quarantine probes, nine grant
   controls and 22-function catalog before the browser, plus catalog after it.
   Exercise connection/name/M198 refusals and source/order drift if needed.
4. Review the workflow boundary: main trigger, read-only permissions, PG17 client,
   frozen clean harness, strict client/SQL/type identity checks, preserved three
   historical SQL controls, actual canonical runner, both browser modes and
   artifacts. Historical harness tests are not evidence that this head's SQL
   installed; require the actual canonical/browser logs separately.
5. Independently run native adapter and local vendor Auth/PostgREST modes on a
   disposable standard PG17 where available. Confirm both reserve and manual-WO
   two-profile displayed-version/stale/replay/fence/refresh checks remain, without
   altering saved payloads or versions. Real local JWT/REST still does not prove
   hosted Supabase identity, physical device policy or operator sign-off.
6. Recompute the M195 twelve-name literal-caller inventory. Distinguish the ten
   retained source calls from names with no literal caller; do not infer absence
   of external/dynamic/scheduled clients. Verify narrow maintenance replacements
   are not falsely presented as complete MES/routing/scheduling/FG completion.
   Include legacy direct writers/fallbacks in the application gate. Do not reopen
   quarantined grants or choose product retirements during this review.
7. Verify the production hard-disable and existing M192/NO-GO holds survive. The
   new record must supersede historical allocation wording only for repository
   state. Review acceptance does not authorize a client merge/deploy before the
   deployment/application rules and paired-cutover decisions are satisfied.
8. Read exact-head GitHub checks and both browser logs, confirm checkout SHA/tree,
   standard server/client version, canonical markers, readbacks and artifact
   availability. Verify Deploy to Production stays skipped on this PR. Report
   pending or failed checks accurately; do not reuse older branch evidence.

Report PASS/FAIL for the repository integration review only, with exact
head/tree/base, files/diff summary, controls/results and evidence limits. Report
concrete P1/P2 defects with reproduction; list P3 advisories separately. Keep
compatibility dispositions, #278 target record, owner grants/expiry/devices/
monitoring, server-side pause/recovery, real identity/operator reconciliation,
application/release approval and baseline regeneration as separate open gates.
