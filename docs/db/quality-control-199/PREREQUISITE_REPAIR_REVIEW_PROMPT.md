# Independent review prompt — narrow M199 prerequisite repair

Review the proposed `fix/m199-prerequisite-guard` branch stacked on #303's
`ccr-f47b6da1-i7t261` branch. Resolve the remote head and tree first, freeze them
in the verdict, and verify that the parent/base remains
`a312ab529919dc1815692dd7f06fab5f4270d804` / tree
`2a6024609a301c999cf4d50d0eed31b06dbc0287`. If either moves, report it and reassess
the actual delta rather than accepting this prompt's old identities.

Scope: prerequisite guard and executable controls only. No merge, push, PR edit,
workflow dispatch, target migration, Production/Staging access, release, owner
decision or hold removal. Use disposable local PG17 only. Preserve all other
agents' worktrees and frozen #301/#302/#303/#304 refs.

Expected delta is seven files:

- `sql/migrations/199_manufacturing_quality_control.sql`: preflight insertion only.
- `docs/db/quality-control-199/run_local.sh`: cutoff/order pin and real prefix controls.
- `docs/db/quality-control-199/test_prerequisites.py`: new executable controls.
- `.github/workflows/quality-control-199-acceptance.yml`: required marker, fixed grep.
- `docs/db/MANUFACTURING_QUALITY_CONTROL_199_RUNBOOK.md`: guard/errors and readback.
- `docs/db/quality-control-199/PREREQUISITE_REPAIR_EVIDENCE_20261002.md`.
- This review prompt.

Check all of the following independently:

1. Only M199 preflight changes in SQL. Removing its insertion must reproduce the
   original file exactly. No canonical 195–198, baseline, harness, application,
   generated types, QC assertion or concurrency test changes.
2. Reproduce complete original M199 acceptance on actual cutoff-189 chains
   ending at 196 and 197. Show the new oracle fails on the old file. Then prove
   the fixed file rejects both prefixes with the exact P0001 diagnostic, before
   any persistent QC schema, grant or reference-data change.
3. Compare the pinned result hash to canonical M198's postflight and the enabled
   trigger contract to M198's preflight. Verify null/missing objects fail closed,
   and ensure the existing duplicate-inspection-number check still executes.
4. Run all fourteen catalog mutations. Independently inspect snapshot coverage,
   exact error matching, transaction handling, rollback/restoration and local DB
   refusals. Prove that a false green cannot be reported as a successful control.
5. Run the complete QC runner, including all seventy unchanged assertions,
   existing RED, DEFINER contract mutants, reference RBAC and concurrency tests.
   Confirm exact prefix/mutation completion marker and workflow marker checks.
6. Verify canonical package bytes, seven package tests, six delegation tests and
   441 scanner tests from the repository root. Run post-199 quarantine and column
   controls; confirm no legacy privilege is reopened.
7. Inspect evidence limits: executor used a PGDG local server with a startup-only
   UID/file-owner adapter, not stock postgres:17. Distinguish local reproduction
   from any actual GitHub-hosted exact-head run. The stacked base does not match
   the workflow's main-only pull_request trigger.

Return PASS/FAIL for this narrow repair, exact head/tree/base and diff counts,
P1/P2/P3 findings with concrete evidence, commands/results you ran, and anything
not independently verified. A PASS closes only this repair review; it does not
close the whole QC feature review, shared QC/material-issue browser acceptance,
33 owner decisions, eight operational gates or any deployment/application hold.
