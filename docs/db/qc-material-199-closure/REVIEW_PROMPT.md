# Independent follow-up review: PR #310 P3-A–F repair

Please review this proposal read-only. The prior independent review accepted head
`3d5fca73e51ef4a00899e91db491ba5244517869` (tree
`65434a337ee8bfe99f8b41b70840f0a3eac1c3c1`) for the two local technical proofs,
with no P1/P2 and six P3 notes. This follow-up repairs those notes; do not inherit its
PASS for the changed head. Freeze the new GitHub head and tree. Compare against both
the parent head above and accepted main below. First challenge the changed source,
header, server, financial and marker assertions, then repeat the complete acceptance. Resolve its current PR head, tree and main base
from GitHub, freeze the full SHAs, and re-resolve them after review. Do not infer acceptance
from the executor's local results. Recover git status, HEAD, diff, reflog and uncommitted
work first; use separate clean scratch checkouts. Do not edit, push, merge, change PR state,
trigger workflows, access Production/Staging, apply to a target or lift any hold.

Scope is the two missing technical proofs: the native QC and material-issue UI on one
M199 database, and deterministic joint QC/material races. Do not restart the older feature
stack, add migrations, re-review #298 in full or expand owner-disposition decisions.

Frozen accepted inputs:
- main after #309: `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`, tree
  `ad60355c42a0e725bbe431ff3032f95ac5f05d35`;
- #308 client/reference: `2ea72541fec4b52e7e0af2a3809ecb7be791bb47`, tree
  `6ed7d21a7a6654382fc7cbff5265fd244b6012fb`.

1. Verify the proposal's exact diff and confirm it adds only the new workflow, fixture and
   three closure documents plus the four new fixture helpers (server_probes.py, test_http.py,
   check_markers.py, test_markers.py). No changes under sql/ (migrations/baselines), runtime src, generated type, dependencies,
   existing acceptance assertion, RBAC baseline or deployment condition may change.
   The frozen #308 checkout must stay byte-identical and clean throughout.
2. Inspect `SOURCE_LOCK.json` and independently recompute its 42 main DB-source hashes
   and four #308 support hashes. Verify clean HEAD/tree checking, fixed read-only git,
   fsmonitor disabled and GIT_* redirection stripped. Check tracked filesystem bytes/modes against immutable HEAD blobs, including index
   assume-unchanged and skip-worktree flags. Untracked and ignored .js source shadowing
   must be refused. Archived Windows-script CRLF normalization is the only content
   normalization and follows the pinned .gitattributes; runtime bytes stay exact. Try wrong HEAD, tracked client drift,
   a fake git on PATH, GIT_DIR/work-tree redirection and changed M199/readback SQL in scratch
   copies. Refusals must occur before any installation or browser/server startup.
3. Run `test_controls.py` yourself: 15 connection refusals, four input/ref refusals and four client-content refusals.
   Challenge nonnumeric/out-of-range ports, remote host, URL/service/hostaddr and wrong DB
   prefixes, plus whitespace/plus/underscore/Unicode-digit/leading-zero port forms.
   Each client-content control must first pass with the content verifier disabled,
   reproducing the former status-only false green, then fail with the real verifier. Inspect—not merely count—the controls and their non-vacuity.
4. Run the complete `run_local.sh` on disposable **PG17 UTF8**, preferably unmodified
   `postgres:17`. It must install this proposal's canonical 190–199 files from cutoff189,
   retain quarantine 72 + column controls9, and check 22 installed functions before/after.
   No fixture may replace a canonical function or restore quarantine grants.
5. Review the six catalog mutation controls: frozen overlay's four plus consumption-function
   body/ACL mutations. Derive M199 role-template MD5 from reviewed SQL independently; do not
   trust a constant alone. Test a different function and an old/foreign body hash yourself.
6. Inspect and execute all **17 joint races**. Every case must prove actual lock waiting with
   `pg_blocking_pids`, not merely start threads and sleep. Examine both orderings for hold
   and return versus consumption, reserve and create_work_order. Check exact rejection text,
   no effects after a denial, version fences and one permitted financial effect. Examine four
   receipt replay orderings and the uncommitted first-consume + concurrent same-event retry
   + QC-hold-before-commit case. Check that eight output/lock mutants, including product projection after a successful consumption cannot pass.
7. Inspect and execute the browser against that same M199 database. Confirm the actual
   frozen `QualityControlPage`, `MaterialIssuePage`, hooks/services and native IndexedDB run;
   no result mocks, fixture-only forms or test-auth claims may substitute for them. Verify:
   - fixed old receipt replay under hold equals the original request/receipt and changes no state;
   - already-mounted stale form's new event is refused with P0001 and exact diagnostic;
   - final inspection uses the server actor/cycle and an identical retry after response loss;
   - return requires a reason, advances version, and permits new consumption;
   - old cycle PASS cannot release the new cycle; revoked inspection grant returns42501
     with no effects; restoring the fixture grant permits one new inspection.
   Execute `server_probes.py` against the seeded disposable DB: NULL/empty/whitespace
   reasons refused, current-cycle PASS release positive, old-cycle completion-trigger
   rejection with exact P0001 and unchanged snapshot. All probes roll back; the owner
   UPDATE deliberately tests the trigger, not access to the quarantined completion RPC.
   Verify deep-equal material replay responses and exact inspection argument keys.
   Require post-browser quarantine72 acceptance as well as the initial quarantine.
   Repeat the full browser run and examine page/console errors. Earlier exploratory fixture
   runs had an initialization-time timeout; the fixture now awaits blank quantity and Final
   selection before typing, without changing client code or extending timeouts.
8. Inspect snapshots and limitations. GL fixtures are empty; they prove absence of creation,
   not preservation of populated financial history. Two fixed identities are simulated;
   PostgreSQL authorization is real. This does not prove hosted JWT/Auth/PostgREST or operator
   sign-off. Confirm test HTTP/grant endpoints are loopback-only and strictly allowlisted. Run test_http.py yourself; require14 real Host/Origin/Content-Type/
   fetch-site GET/POST refusals and2 positive controls with no state change. Inspect absent/
   duplicate headers and the bounded request body, including DNS-rebinding Host denial.
9. Verify workflow checkout head/tree, SHA-pinned actions and permissions; refusal controls
   must precede npm/Playwright installation (PG client/psycopg still precede them). Inspect
   the fail-closed frozen-client-SHA fetchability limitation; no new persistent ref is added.
   Run check_markers.py and test_markers.py on real output (one positive +19 refusals); markers must come from actual execution
   output, not echoed workflow source. Missing browser marker, wrong race count, one readback,
   or wrong identity marker must fail. Inspect hosted exact-head logs/artifacts if available;
   otherwise explicitly report them unverified. Deploy must remain skipped.
10. Report PASS/FAIL for **these proposed local technical proofs only**, precise P1/P2/P3 findings,
    exact files/delta, commands/results, repeated-run results, environment differences, hosted
    evidence and cleanup. Do not turn this into merge eligibility or live rollout approval.

All 33 owner dispositions, eight operational gates, service_role INSERT decision, current
#278, target ledger/identity/grants, hosted identities/operator/device/monitoring acceptance,
pause/in-flight/retry/pending recovery, DB-first application and UI-only promotion remain open.
NO-GO and M192 holds remain in force. #308 stays frozen Draft/reference.
