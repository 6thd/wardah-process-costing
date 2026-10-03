# Independent Round 2 review: privileged QC and pause contract hardening

Prior reviewed head: `fcca92fe0eefa7638959667ae739614fef294e01`.
Round 1 PASS covered counterexample accuracy and further review only; it required
contract changes before implementation. Re-derive the Round 2 delta independently.
Resolve the current #313 head/tree and freeze it before testing. If it differs
from the owner-supplied review SHA, stop and report drift.

Review the new Draft PR containing this directory. Resolve its exact head/tree
at the start and end; do not inherit the executor's conclusions. This is a
read-only evidence/contract review, not permission to merge, allocate/apply a
migration, trigger deployment or access Production/Staging.

## Anchors and scope

Accepted main is `3d01f99fae2fb294fa0586084c32f0cd6bdf21fe`, tree
`ad60355c42a0e725bbe431ff3032f95ac5f05d35`. #310 is frozen at
`0e91e3527e8201ffae6f051cd31f8e4e3e7d9c86`; #308 at
`2ea72541fec4b52e7e0af2a3809ecb7be791bb47`; #311 at
`33b1806b9fd8cb6639a7a929c6c73b90c9c6d08a`. Re-resolve and report drift. Verify
the delta contains only seven additions in `docs/db/qc-privileged-pause-199/`,
with no canonical SQL, application source, types, package, RBAC or deploy changes.

Read README, contract, runner, RED SQL, pause harness and source manifest. The
prior #310 two-proof PASS is context only; this packet does not ask you to close
its eight P3 notes or infer whole-QC/security acceptance.

## Independent reproduction

- Recompute all 44 hashes from accepted-main git blobs and verify coverage of
  the runner's consumed files, including transitive helpers. Change a source in
  a scratch copy and prove refusal before any database connection/setup.
  Also add a new later-timestamp cutoff-189 baseline, remove a locked candidate,
  and replace a locked file with a symlink. Require named pre-client refusal,
  zero logged psql/createdb calls and unchanged database inventory.
- Prefer stock `postgres:17`, UTF8, on a disposable explicit loopback port in
  55000–65535, with psycopg 3.3.6 and a PG17 client. Record exact image digest,
  server/client/Python versions and any differences. The executor used a managed
  PGDG 17.11 startup adapter; do not describe it as stock Docker or hosted Auth.
- Run the chain and unchanged 70 QC assertions. Check the RED assertions' actual
  effects/SQLSTATE/audit oracle, not merely the script's exit status or markers.
- Verify anon/authenticated direct INSERT is denied; service_role has BYPASSRLS
  and direct INSERT succeeds with empty actor claims. Confirm chosen inspector,
  non-RPC request hash, evaluated gate change and zero QC RPC audit delta. Do not
  infer finished-goods receipt, GL posting or a leaked service credential.
- Verify M193's TRUNCATE protection and M199 UPDATE/DELETE immutability with exact
  diagnostics and preserved rows. **TRUNCATE is not a claimed vulnerability.**
- Run both explicit mutants: revoke privileged INSERT and remove the M193
  TRUNCATE trigger in separate rollback transactions. Require named assertion
  failures, not syntax/setup errors. Independently check the candidate INSERT
  revoke leaves the unchanged 70 positive assertions passing and is rolled back.
- For pause, verify a real authenticated call is blocked by the actual holder
  PID before EXECUTE is revoked/committed. A new call must fail 42501 while the
  earlier call still waits. Release the holder and prove exactly one fresh
  inspection commits. Confirm source snapshot scope and clone/database cleanup.
- Confirm the 72-probe quarantine check still passes after these tests. Snapshot
  additional canonical catalog/state if needed to assess rollback claims.
- Optionally rerun the five existing frozen-client QC unit suites (26 tests) in
  a separate copy. The focused command uses `--coverage.enabled=false`; no full
  project coverage or new native-browser proof is claimed.
- Run syntax, Ruff, whitespace and full Bandit without excluding B101. Run the
  harness normally, under `-O`/`-OO` and PYTHONOPTIMIZE=1/2; explicit oracles and
  waits must remain active. Mutate a required observation in a scratch copy to
  prove the optimized run refuses instead of printing PASS.

## Judgment requested

Assess the privileged INSERT finding against the trusted integration boundary:
is the reproduction accurate, is candidate P2 justified for RPC-only acceptance,
and what explicit owner policy/additive correction would close it? Do not turn a
privileged-credential capability into an ordinary-user exploit claim.

Assess the operational counterexample: does it demonstrate why ACL revocation
alone cannot establish G05 drain, without alleging a PostgreSQL defect? Review
the proposed persistent fence's common lock prefix, missing-row behavior,
exclusive-controller ordering, complete writer coverage, direct privileged
paths, unknown-event reconciliation writes, fail-closed crashes/timeouts and
untrusted build/device metadata. All implementation/rehearsal claims remain
pending. Identify gaps before this contract could guide implementation.

Check all twelve Round 1 contract requests: anti-starvation advisory barrier and
load proof; explicit FOR SHARE/FOR UPDATE; state read under lock and 40001 retry;
missing row/provision/backfill/delete/truncate/cascade guards; deterministic
multi-org/global/new-org/nested ordering; complete effective-grant writer/call
inventory; precise BYPASSRLS/owner boundary and F1 prerequisite; server-identified
RECOVERY that only closes unknown events; stuck/prepared holders and reviewed
abort/timeout monitoring; signed identity plus current server admission state;
epoch-stamped receipts; and server-authored audit independent of #165.
Check that REVOKE ALL plus independent RPC-owner guard remains a separate
additive correction, and no target or pause acceptance is implied.

Return exact identities, commands/environment, independently observed outcomes,
findings/severity and one scoped verdict: PASS/FAIL for **accuracy of these two
counterexamples and suitability of the proposed contract for further review**.
List contract changes and remaining acceptance dependencies separately. Do not
approve merge, working pause, whole-QC/security, target application or rollout.
All 33 route dispositions, eight operational gates and NO-GO/M192 holds remain.
