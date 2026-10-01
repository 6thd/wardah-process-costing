# Narrow #170/#154 material-issue maintenance review candidate

This is an **unallocated, unapplied review candidate**, stacked on #291 at
`75b4be4db2ef35dec625c37742812e58807a58d6`. Nothing here changes canonical
M190–M194, deploys SQL, restores a quarantined entry point, or removes the M192 hold.

The legal disposable chain is baseline cutoff 189, then **190 → 191 → 192 → 193 → 194**,
then #291's candidate, then `candidate.sql`. Never substitute M191 for M190 or
apply either candidate to a live environment using these test scripts.

## Authority and functional replacements

`rpc_manage_material_issue_setup(org,event,command,actor)` supports:

| Operation | Authority | Scope |
|---|---|---|
| create_order | explicit setup.prepare + orders.create; explicit reservation.reserve if materials supplied | Draft MO, manual backflush, atomic initial material array through restricted M191 internals |
| set_order_status | explicit setup.prepare + orders.update | confirmed/in_progress/on_hold only; existing state machine |
| create_work_order / set_work_order_status | explicit setup.prepare | Manual issue eligibility; READY/IN_SETUP/IN_PROGRESS/ON_HOLD, same-org work center/parent, no implicit MO transition |
| open_stage_wip | explicit setup.prepare + stage_costs.create | Pristine zero-cost current-period row; unchanged M194 guards |
| reserve / resize_reservation | explicit reservation.reserve | One base-unit line per event; current product/UOM, server availability, no resizing consumed/released history |
| release_reservation | explicit reservation.release | Unconsumed balance only, preserves consumption/release history |

The full new keys are `manufacturing.material_issue_setup.prepare`,
`manufacturing.material_reservation.reserve`, and
`manufacturing.material_reservation.release`. Even Org Admin/super-admin needs
an explicit active, unexpired role grant. No initial grants are created; all role
template expansion excludes these keys. Existing Admin semantics on the additional
legacy orders/stage-cost keys are retained. Grant policy still requires owner review.

`rpc_get_material_reservation_setup(org,item)` returns the scoped canonical
product/base UOM under the same explicit reserve grant. No EXECUTE grant is restored
on `wardah_resolve_product_id`. Both new public RPCs are authenticated-only;
private helper/event objects are not callable/readable by client roles.

Events save immutable commands and receipts per org/event/actor. Identical retries
return the saved receipt; changed payload/actor is refused. Permission is rechecked
after lock waits and before commit. Existing-object writers use event → MO → children
→ product → bins; creation retains the M191 new-parent exception. Versions advance
on every MO/WO/reservation UPDATE, including M192 consumption, rejecting stale edits.

The legacy WO status trigger is removed in this candidate: its ambiguous aggregate,
uppercase parent writes and WO→MO locking are replaced by explicit nonterminal MO
changes. It is **not** replaced with automatic completion. #230 owns financial
completion/cancellation; general routing generation, MES start/pause/labor/downtime/
quality and capacity/efficiency remain outside this candidate. Physical counts stay
with #259. No direct table/column mutation grants are restored.

## Disposable acceptance

With a local PostgreSQL 17 listener, psql/createdb/dropdb and psycopg installed:

```bash
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres \
  bash docs/db/material-issue-maintenance-170-154/run_local.sh
```

The runner rejects remote connection configuration, creates/drops its own DB, and
uses the legal baseline pair and all five canonical migrations once. It first runs
#291's existing acceptance, then scoped maintenance acceptance and two-backend races.
Denials compare MO/WO/reservations/WIP/consumption/bins/SLE/receipts/audit snapshots.
Races assert actual `pg_blocking_pids` relationships before releasing the blocker.
They cover M192 commit/stale release, rollback/release, both reserve/issue directions,
WO eligibility commit/rollback, same-event replay and cross-MO stock oversubscription.

Local implementation evidence passed using PostgreSQL 17.11 with **three startup
UID checks changed** for this workspace. That is not standard-PG17 proof. The prior
independent unmodified PGDG17.11 review covered #291, not this new candidate.
The dedicated CI workflow runs this candidate on the unmodified `postgres:17` image;
its final exact-head outcome must be verified separately. The baseline #278/M192
regression runner also passed locally; that run does not apply this candidate.

## Release prerequisites

NO-GO: independent final candidate review on standard PG17; canonical migration
allocation/sign-off; explicit grant/WO-trigger decision; compatibility/combined-tree
acceptance; #278 application/behavior record; real browser and identity acceptance
with SLE/bins/reservations/consumption/WIP/receipt reconciliation; owner's cross-device
decision; separate release approval. Local JWT identities and CI are not live identity
or native-browser evidence. Existing accepted policy-setter/sidebar P2s stay closed.
