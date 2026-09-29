# #278 M194 Draft implementation

This PR implements the independently reviewed WIP boundary contract. It does
not authorize a Production or Staging migration, new M192 consumption events,
or the employee issue UI. #229 and #230 remain separate.

## Database behavior

- The INSERT trigger takes the parent MO lock before checking every open
  interval for the same org/MO/stage. Inclusive boundary days and NULL-open
  rows count. Existing overlapping rows are untouched. An UPDATE of an
  existing row may edit labor and overhead, but cannot re-key or change dates;
  it takes no MO lock while holding the WIP row lock.
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
- The audited close RPC takes MO then WIP, checks membership and permission,
  and permits only false/NULL to true. It does not reopen.
- M192 checks the number of eligible WIP rows under its MO lock before stock
  or receipt writes. More than one gives `AMBIGUOUS_OPEN_STAGE_WIP_LOG`.
  Identical authorized event replays return the stored result before this
  check. The M192 body otherwise matches its canonical predecessor.
- The mounted form and generic service send only editable input fields. The
  material cost is display-only; a rejected stale write shows a prompt to
  reload. The service close operation calls the audited RPC.

## Verification and limitations

`run_green.sh` refuses a remote target, builds a disposable PostgreSQL 17
database through M193, reproduces the M193 suite, seeds two overlapping
historical rows and two currently eligible rows, applies M194, then checks
the WIP boundary and re-runs the M192 sequential, matrix and two-session
acceptance. Its own two-session harness exercises overlapping INSERTs,
both issue/INSERT lock orders and lawful labor edits racing a material issue
in both orders. The historical fixture is local only;
Production rows are never rewritten. The PR remains Draft for independent
review and further negative controls.

The prior M193 acceptance is run before M194 because it deliberately inserts
a nonzero material cost as its cross-org test fixture, which M194 correctly
denies for new rows. The M194 postflight and WIP acceptance verify the
retained M193 DELETE/TRUNCATE grants and triggers after application.
