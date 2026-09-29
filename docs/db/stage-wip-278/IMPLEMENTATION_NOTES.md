# #278 M194 Draft implementation

This PR implements the independently reviewed WIP boundary contract. It does
not authorize a Production or Staging migration, new M192 consumption events,
or the employee issue UI. #229 and #230 remain separate.

## Database behavior

- The INSERT trigger takes the parent MO lock before checking every open
  interval for the same org/MO/stage. Inclusive boundary days and NULL-open
  rows count. Existing overlapping rows are untouched. An UPDATE of an
  existing row may edit labor and overhead, but cannot re-key or change dates;
  it takes no MO lock while holding the WIP row lock. The primary key `id` is
  part of the frozen identity: an M192 receipt links to its WIP row only by
  `id` (there is no foreign key), so a re-key would orphan the receipt.
- Ordinary client writes require active org membership and stage-costs
  create/update permission. A narrow public DEFINER helper performs that
  check because M190 correctly denies ordinary callers direct EXECUTE on
  `wardah_assert_org_member`. The trigger denies direct material-cost changes,
  identity/date changes and direct close/reopen. It runs after the existing
  equivalent-unit calculation trigger, so client-supplied derived columns do
  not persist. The M192 owner-run RPC sets a transaction-local marker around
  its cost-only WIP update; the trigger also requires its effective role to be
  the WIP table owner. A client-set marker alone cannot bypass the guard.
  Even the owner cannot insert a posted cost or directly alter it outside this
  reviewed path. `service_role` and `anon` cannot execute the editor helper,
  so their direct WIP writes fail closed.
- Every owner/marker/close-token comparison in the guard is NULL-safe. In a
  backend that never defined a marker setting, `current_setting(name, true)`
  is SQL NULL, and `NOT (TRUE AND NULL)` is NULL, so an unwrapped `IF` is not
  taken and the guard silently allows the write. The comparisons are wrapped
  in `COALESCE(..., false)`, so an unset, empty or foreign marker denies.
- The audited close RPC takes MO then WIP, checks membership and permission,
  and permits only false/NULL to true. It does not reopen.
- M192 checks the number of eligible WIP rows under its MO lock before stock
  or receipt writes. More than one gives `AMBIGUOUS_OPEN_STAGE_WIP_LOG`.
  Identical authorized event replays return the stored result before this
  check. The M192 body otherwise matches its canonical predecessor.
- The mounted form and generic service send only editable input fields. The
  material cost is display-only; a rejected stale write shows a prompt to
  reload. The service close operation calls the audited RPC.

## Changes after the independent review of head `4dfb141a`

The first independent review of this Draft returned FAIL with one P1 and four
P2 findings. This round is limited to those five. Its author does not grant the
final verdict: a fresh, independent closure review of the new head is required.

| Finding | Change |
|---|---|
| P1-1 owner branch of the guard was NULL-able | `194_...sql`: the close and material-cost owner/marker/token tests are wrapped in `COALESCE(..., false)`. New in-session and fresh-backend probes. |
| P2-A `id` not part of the frozen identity | `194_...sql`: `NEW.id`/`OLD.id` joins the identity tuple; probes for direct re-key, `ON CONFLICT (id)` re-key, and re-key with a cost change. |
| P2-B RBAC mutation baseline not updated | `scripts/ci/security/rbac-mutation-baseline.json`: 327 to 328 signatures (`stage_wip_log` direct update count 2 to 1, one new `rpc_call` signature for the close RPC), candidate total unchanged at 354. The reviewed classification rules are not touched: the new RPC stays `pending_review` in the closure matrix (as do two existing M181 RPCs) for the reviewer to classify. |
| P2-C the M193 runner refuses once M194 exists | `docs/db/posted-history-193/run_local.sh`: the apply order is cut right after 193, the same idiom `stage-wip-278/run_red.sh` uses. |
| P2-D five mutants survived the acceptance | New `acceptance_roles.sql`, `fresh_backend_probes.sh`, new legacy-shape fixtures and three new two-session scenarios (below). |

`194_...sql` is an unapplied Draft, so both guard fixes are in-place edits;
nothing else in it changed (INSERT branch, editor helper, close RPC, the M192
replacement body and the postflight are byte-identical to the reviewed head).

### New tests

- `acceptance_roles.sql`: every probe names a principal, an exact SQLSTATE and
  message, and asserts the whole `stage_wip_log` is unchanged after a denial
  (a zero-row UPDATE is not evidence of denial). Principals: Org Admin,
  non-admin editor with explicit create/update, reader, consumer, expired-role
  editor, inactive member, an editor whose membership has `is_active IS NULL`,
  foreign-org admin, foreign-org member with the same grants, `service_role`
  and `anon`. Areas: posted cost, `id`/period identity,
  close fields and derived columns, lawful edits, inserts (permission,
  posted fields, parent-org drift, every interval boundary, several rows in one
  statement, the historical overlap), the close RPC per principal, and the
  M192 ambiguity check including an `is_closed IS NULL` second row.
  It also covers what a client can forge: the cost marker and the close token
  set by the client in the same statement, before the row trigger runs. Each
  is paired with an owner-role control that proves the statement really
  delivers the setting (the owner is honoured only for the row the setting
  names), so the client denials cannot pass merely because no setting arrived.
  A function-shape block asserts owner, SECURITY DEFINER/INVOKER mode, pinned
  search_path and the exact EXECUTE grants of the three new functions, and the
  close RPC must clear its token again before it returns.
- `fresh_backend_probes.sh`: five owner denial probes and the two reviewed
  writers, each in a brand-new `psql` process. The in-session suites cannot see
  the NULL hazard: earlier M192 calls in the same session have already defined
  the marker setting.
- `historical_fixture.sql`: NULL-open and NULL-ambiguity legacy MOs and one MO
  per new race scenario. The shared RAW stock is 1000, so each MO reserves only
  what its scenario issues.
- `concurrency.py`: M192 frozen between its MO and WIP locks (a lawful labor
  edit completes, while an INSERT and the close queue behind the MO lock), and
  the close RPC against an issue in both orders (close first: the issue is
  refused; issue first: the close keeps the cost). The frozen scenario releases
  its locks on any failure and bounds the labor edit with a lock timeout, so a
  regression fails fast instead of hanging the run.

## Verification and limitations

`run_green.sh` refuses a remote target, builds a disposable PostgreSQL 17
database through M193, reproduces the M193 suite, seeds the legacy shapes
(two overlapping historical rows, two currently eligible rows, NULL-open and
NULL-ambiguous variants), applies M194, then runs the brand-new-backend probes,
the WIP boundary acceptance and the role suite, and re-runs the M192
sequential, matrix and two-session acceptance. Its own two-session harness
exercises overlapping INSERTs, both issue/INSERT lock orders, lawful labor
edits racing a material issue in both orders, and the close RPC races above.
The historical fixture is local only; Production rows are never rewritten. The
PR remains Draft for independent closure review.

To check that these tests can fail, the migration was mutated on disposable
copies (guards removed or weakened, lock order changed, grants widened, the
pre-fix guard shapes restored, the whole M194 of the reviewed head) and the
suite re-run against each; every mutant is refused. The membership assertion
inside the editor helper is visible only through a legacy shape: `is_active`
is nullable, tenant resolution counts NULL as active while the assertion and
`has_permission` need TRUE, so such a member sees the rows and must be refused
by name (`NOT_ORG_MEMBER`). Ordinary non-members never reach it, since
row-level security hides the row or the parent MO from them.

The prior M193 acceptance is run before M194 because it deliberately inserts
a nonzero material cost as its cross-org test fixture, which M194 correctly
denies for new rows. The M194 postflight and WIP acceptance verify the
retained M193 DELETE/TRUNCATE grants and triggers after application.

## Recorded, deliberately not implemented here (P3)

These came out of the independent review as non-blocking. They are recorded so
they are not lost; none is a regression against the contract, and none is
folded into #284 to keep it from growing.

1. Multi-MO bulk INSERT can deadlock (`40P01`): the per-row MO `FOR UPDATE` is
   unordered, so two multi-row statements over the same two MOs in opposite
   order collide. Fail-closed; the mounted UI inserts one row.
2. The overlap check is race-safe only at READ COMMITTED (PostgREST's level).
   Document it or reject other isolation levels in the trigger.
3. The trust anchor is `current_user = owner` plus a marker equal to the row
   id, not the calling function. A future owner-run function that updates
   `stage_wip_log` would become an overwrite primitive once a caller sets the
   marker. None exists at this head; consider a dedicated writer role.
4. The INSERT branch takes the MO `FOR UPDATE` and stage `FOR SHARE` locks
   before the permission check.
5. A natural-key `ON CONFLICT (org, mo, stage, start, end)` upsert and
   `ON CONFLICT DO NOTHING` are always refused with `WIP_OPEN_PERIOD_OVERLAP`,
   which would break a lawful idempotent creator.
6. `ON CONFLICT (id)` with a proposed row for MO B can update a WIP row of
   MO A while holding only MO B's lock (a lock-order footprint outside the
   MO to WIP rule; only multi-row statements can exploit it).
7. Closed rows remain editable (labor, overhead, transferred-in). Reopening is
   denied, and `is_closed` NULL to false counts as a close attempt.
8. `cost_transferred_in`, `cost_beginning_wip*` and the units stay freely
   editable by authorized editors: inputs, outside the contract's list.
9. `wardah_assert_stage_wip_editor_194` is callable by `authenticated` and
   appears in the generated client types; it reveals only the caller's own
   membership and permission.
10. `service_role` cannot write WIP (documented). A data-only restore or an
    `INSERT ... SELECT` of posted rows fails even for the owner
    (`WIP_CLIENT_POSTED_FIELDS_DENIED`): add it to the rollout runbook.
11. Production pre-flight: `M194_EXISTING_WIP_PARENT_ORG_DRIFT` fails closed;
    add a read-only Production pre-check to the runbook. The
    `stage-wip-278-acceptance.yml` path filter omits its dependencies
    (`docs/db/posted-history-193/**`, `docs/db/material-consumption-192/**`,
    `scripts/ci/fresh-db/**`).
12. Client: the toast maps every `WIP_*` error (overlap, permission,
    cross-tenant) to "cost or period changed, refresh"; the PR ships no client
    tests, and the SonarCloud/SonarQube checks report new-code coverage and
    floating-promise findings on lines this PR did not modify.
13. Hygiene found while regenerating this round: the M193 and M194 runners
    call `run_chain.sh` without exporting `REPORT`, so each local run leaves an
    untracked `chain_report.txt` in the repository root (the M192 runner
    passes it correctly).
14. `user_organizations.is_active` is nullable and is read two ways: tenant
    resolution (so row-level security on `stage_wip_log`) counts NULL as
    active, while `wardah_assert_org_member` and `has_permission` require TRUE,
    and the MO table's own policy hides the row from such a member. A member
    whose flag is NULL therefore sees WIP rows and is refused writes by name
    (`NOT_ORG_MEMBER`); the role suite pins that behavior. The inconsistency is
    shared code, not specific to M194.
