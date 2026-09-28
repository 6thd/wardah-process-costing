# M193 / #273 — posted material history deletion guard (Draft)

**Scope:** additive trigger guards, removal of direct client DELETE/TRUNCATE
privileges and per-action DELETE policies, and retirement of the mounted WIP
delete control. This PR changes neither M190–M192 nor posted business rows.
M193 is in the repository only; its merge would **not** apply it to Production.

## Current integrity risk and immediate hold

On disposable PG17 before M193, a same-org reader deleted a work order with a
POSTED M192 consumption line. The WO FK cascade erased that line while stock
ledger, bin, receipt, reservation consumption and WIP cost remained. A later
completion could book zero cost. A reader could also TRUNCATE WIP across orgs;
RLS does not constrain TRUNCATE. These are reproduced **local** observations,
not claims of a Production incident. The earlier read-only Production check
found zero material issue events and consumption rows at that time.

**Do not submit a new Production M192 issue event until the independently
reviewed protective migration is applied and verified live.** The same hold
applies to Org Admin and pilot activity. Neither the PR nor a green local/CI
run is an application authorization.

## What the migration does

- A BEFORE DELETE guard on `work_orders` reads POSTED consumption and M192
  event fingerprints. It raises `M193_POSTED_WORK_ORDER_DELETE_DENIED` / P0001
  before the FK cascade. It does not acquire the MO lock and cannot reverse
  M192's MO→WO lock order. All guards run as SECURITY INVOKER: an ordinary
  client is denied at the table grant, while the SQL owner reaches the named
  guards. A privileged role lacking private-schema read access fails closed.
- A BEFORE DELETE guard on `material_consumption` independently rejects
  posted/receipt-linked deletion, including an owner or indirect FK path.
- A BEFORE DELETE guard on `stage_wip_log` preserves nonzero material cost or
  a row in a MO/stage with an M192 issue event. This is the privileged-path
  backstop; client DELETE is blocked by a missing grant (42501).
- A BEFORE TRUNCATE guard refuses raw TRUNCATE even for a privileged caller
  on the eight production history tables. Client DELETE/TRUNCATE grants on
  seven tables are revoked; `material_consumption` was already closed in
  M192. Six action-specific DELETE policies are removed. The WIP `FOR ALL`
  policy stays for SELECT/INSERT/UPDATE; deleting it would break other flows.
- The old WIP delete button is removed, and its client service method now
  rejects. An old deployed client receives a database 42501 after M193.

This does **not** fix direct client UPDATE on WIP, MO status, reservations or
WO lifecycle, nor #230 terminal completion, #260 process costing or employee
material issue UI. Those remain separate gates under #170/#154/#230/#260.

## Local RED/GREEN and negative controls

`bash docs/db/posted-history-193/run_local.sh` refuses a nonlocal PG host and
requires a disposable local PostgreSQL 17 server. It builds baseline cutoff
189 + M190–M192, seeds the existing RED fixture, then runs:

1. `red.sql`: the active reader deletes the populated WO; consumption vanishes
   while receipt, SLE, bin and WIP remain. The same reader TRUNCATEs WIP.
   The script must print both `RED_273_*_REPRODUCED` markers before M193.
2. M193 as one BEGIN/COMMIT file. Its preflight rejects a missing M192 or a
   previously orphaned M192 receipt; its postflight checks guards, execution
   grants and direct DELETE/TRUNCATE grants.
3. `acceptance.sql`: the owner WO DELETE must fail for **the guard's own**
   P0001 reason, while the same-member client gets 42501. The two-step WO→MO
   route must not erase the fixture. A visible
   WIP row with posted material cost must reject client DELETE with 42501,
   while owner deletes hit the named WIP/consumption guards. Both client and
   owner TRUNCATE are denied. Receipt, SLE, bin, WIP, reservation, GL and
   completion cost stay correct. All fixture writes roll back.
4. Re-run M192's sequential, 288-cell lifecycle matrix and true two-session
   concurrency suite on the same disposable DB to catch regressions.

Mutation controls before accepting the PR: disable each named DELETE trigger
on a scratch M193 copy while preserving all grants, and demonstrate that a
privileged WO/consumption/WIP deletion changes the corresponding invariant.
Separately restore `authenticated` DELETE/TRUNCATE grants in a scratch copy
and verify behavioral tests and postflight turn red for the expected reason.
Do not call a grant-only `42501`, unrelated FK error or zero-row RLS denial
proof that the WO guard works.

## Production preflight and stop conditions (not authorization)

1. Owner approval, green exact-head PG17 acceptance, independent review and a
   new restorable post-M192 backup are required. Verify ledger M190/M191/M192
   once each and no M193, M192 function definitions, grant/policy/trigger
   catalog and project identity immediately before any application.
2. Read-only: ensure M192 receipts are not already orphaned; record counts of
   consumption, receipts, WOs, WIP, bins, SLE and GL. Stop on unexpected rows
   or drift; do not use this migration as cleanup of broken history.
3. Apply only the exact reviewed M193 SQL; any preflight, statement or commit
   failure stops the rollout for diagnosis. No ad-hoc rollback SQL on live DB.
4. Read back migration ledger exactly once, three DELETE triggers and eight
   TRUNCATE triggers enabled, function owner/security/search_path/EXECUTE,
   direct grants and policy scope. Read back unchanged business counts and
   product/bin and SLE reconciliation. Only then may the separate operational
   hold be reconsidered by the owner; #170/#154/#230/#260 remain open.
