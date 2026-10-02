# Independent review prompt: frozen material-issue/QC source integration

Review the Draft integration proposal against base #301, then against frozen main.
First resolve its exact remote head/tree and PR state. Do not trust PASS claims as
execution evidence. Record full SHAs and re-resolve them after the review.

Inputs are frozen in README.md: main 3acea30d, #301 0e462611, #304 1781c981,
#306 e29b4e5a, #307 1690d2e5, and harness #298 d71a1657. Resolve the full SHAs and
trees there. Keep original branches untouched. Do not merge, push, trigger workflows,
apply to a target, access Production/Staging, deploy or remove holds.

## Scope and required checks

1. Recover the existing workspace first: status, HEAD/tree, diff, reflog and local
   changes. Use isolated scratch checkouts for independent controls; do not recreate
   or overwrite other agents' work.
2. Verify that the proposal is a source union, with exactly the four documented
   parent conflicts. Run/review verify_sources.mjs and independently reproduce the
   merge. Check all material-issue and QC source, route imports, both complete
   translations and generated types. Recompute RBAC, including the removed direct
   INSERT and six added literal RPCs: 365 candidates, 339 signatures, the documented
   hash. Baseline acceptance does not approve pending security classifications.
3. Prove existing main SQL/baselines and canonical 195–198 are byte-preserved.
   M199 must equal #306 exactly. Original QC assertions, RED and concurrency must
   equal #304. Confirm the accepted repair/checkpoint identity and no live-ledger claim.
4. Inspect the new shared SQL fixture and all denials. Check exact diagnostic,
   parent-version behavior, exact receipt replay and unchanged financial/state
   snapshots. Verify fixtures never replace canonical functions. Distinguish
   existing-event replay from new consumption during hold.
5. Audit the M199 role-template readback overlay. Prove the new body MD5 from the
   reviewed SQL, not merely from a constant. Only that body fingerprint may be
   mapped to the old profile; owner, ACL, language, config and every other function
   must still pass the unchanged 22-function comparison. Independently mutate
   body, ACL, owner, settings and a different function: all must be refused.
6. Run TypeScript, full Vitest, build/password gate, security inventory/classifier,
   complete M199 runner and shared 190–199 runner on disposable PG17. Require all
   two prefix/14 mutation/70 assertion/concurrency markers, quarantine 72 plus nine
   column-grant controls, 11 shared assertions, and two readbacks with four mutants
   each. Run local-only refusal controls and detect wrong-chain/source drift.
7. Inspect workflow branch/path changes, deploy conditions, checkout identity,
   logging and artifacts. Full CI must run on the exact proposal head. The existing
   browser modes still install only 190–198; do not label them native QC/199 proof.
   If GitHub checks are pending or unavailable, say so. Check merge-tree equivalence
   for Test & Build and exact head checkout for the combined job.
8. Review production hard-disable, DB-first order and all NO-GO/M192 holds. The
   broad QC feature, service_role inspection-write boundary, 33 owner decisions,
   eight operational gates, hosted identity, current #278, pause, in-flight/retry
   recovery, device/monitoring and target application remain outside this PASS.

## Verdict boundaries

Return PASS/FAIL for this **repository integration and local sequential behavior**,
with P1/P2/P3 findings, exact deltas, controls and environment limits. Do not turn
this verdict into merge eligibility, rollout approval or full QC acceptance.
Explicitly list the missing native QC browser acceptance and joint QC/material
race evidence. Keep these gates open even if all existing browser jobs pass.

Do not expand this proposal to repair s82b randomness, accounting, incoming
inspection, NCR traceability or the original scanner's baseline selector.
Any needed change must identify which reviewed invariant is violated and remain
isolated from target actions.
