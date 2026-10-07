# Stage-WIP manufacturing-order lock under M195 containment

Migration: `sql/migrations/203_stage_wip_mo_lock_under_m195_containment.sql`.

Number 203 is the next free canonical number on `origin/main` at
`eb67705098c0bd14c22700296fffc8001011a435`. Migrations 194–202 are not edited.
The migration does not grant `UPDATE` on `manufacturing_orders`.

## What changed

`guard_stage_wip_write_194` stays `SECURITY INVOKER`. On `INSERT`:

- If `current_user` is the catalog owner of `stage_wip_log`, the original
  `SELECT ... FROM manufacturing_orders WHERE id = NEW.mo_id FOR UPDATE` runs.
  That is the path M192's `SECURITY DEFINER` writer already uses, because that
  function is owned by the same role.
- Otherwise the trigger calls `wardah_lock_mo_for_stage_wip_203(NEW.mo_id, NEW.org_id)`.

The stage lock is still `manufacturing_stages ... FOR SHARE` and still comes
second. `FOR SHARE` is not substituted for the manufacturing-order lock.
The `UPDATE` branch still does not take a manufacturing-order lock.
Posted-field, overlap, identity, and close rules are unchanged, and the
existing `wardah_assert_stage_wip_editor_194` call still runs for a non-owner
after those locks.

## Helper authorization

`public.wardah_lock_mo_for_stage_wip_203(uuid, uuid)` is `SECURITY DEFINER`,
owned by the migration role, which the preflight requires to own both
`stage_wip_log` and `manufacturing_orders`. `search_path` is `pg_catalog, pg_temp`.
`public` objects and `auth.uid()` are schema-qualified.

`EXECUTE` is revoked from `PUBLIC`, `anon`, and `service_role`, and granted
only to `authenticated`.

`p_org` is not identity. Before the lock, and again after it, the helper calls
`wardah_assert_org_member(p_org)` and `has_permission(auth.uid(), p_org,
'manufacturing.stage_costs.create')`. The locked statement is:

```sql
SELECT mo.org_id
FROM public.manufacturing_orders mo
WHERE mo.id = p_mo_id
  AND mo.org_id = p_org
FOR UPDATE;
```

A missing or foreign-org order raises `WIP_MO_NOT_IN_AUTHORIZED_ORG` and
returns no row contents. A membership or permission change that lands after
the first check is caught by the second check; the trigger still calls
`wardah_assert_stage_wip_editor_194` afterward, which is the M194 guarantee.
The lock is held only until the transaction ends, including when that later
check aborts it.

## M202

The helper is not owned by `wardah_qc_entry_202` and is not on that role's
ACL allowlist. The postflight repeats the M195 `manufacturing_orders` write
denial for `anon`, `authenticated`, and `service_role`. If
`qc_assert_closed_graph_202()` is already installed, the postflight runs it.

Reviewed restored-clone order: 195–201, the pre-M202 CRLF script, unmodified
202, then 203. 203 does not change a body that 202 pins, so it can also be
applied after 195 and before 202; the restored rehearsal keeps 202's own
acceptance on the pre-203 catalog and then re-checks the closed graph.

## M194 pre-image

Before creating the helper, 203 requires the live
`wardah_internal.guard_stage_wip_write_194()` to be the M194 body:
md5 `2068a97aea07127affa5dc6aef4d3394`, 3310 bytes. That is the body in
`194_stage_wip_posted_cost_boundary.sql` and the body on the Phase 1 restore.
The same check requires `SECURITY INVOKER`, language plpgsql, volatility
volatile, parallel unsafe, not strict, not leakproof, cost 100, rows 0,
`search_path=public, pg_temp`, owner equal to `current_user`, result
`trigger`, and ACL `postgres=EXECUTE/postgres` with no `PUBLIC` grant.

The trigger `zz_guard_stage_wip_write_194` must be the only trigger of that
name: non-internal, enabled in origin mode, `BEFORE INSERT OR UPDATE FOR EACH
ROW` (`tgtype` 23), on `stage_wip_log`, calling that function.

A body, attribute, owner, or binding mismatch raises
`STAGE_WIP_LOCK_203_PREIMAGE_REFUSED` or
`STAGE_WIP_LOCK_203_TRIGGER_BINDING_REFUSED` inside the preflight, before
`CREATE FUNCTION`. The migration transaction aborts. The drift test in
`scripts/ci/fresh-db/acceptance_203_preimage_drift.py` proves a one-character
body change, an owner change, and a dropped trigger each refuse without a
committed helper or a committed change to the guard.

## Reproducible local check

`scripts/ci/fresh-db/run_m203_local.sh` (workflow `.github/workflows/stage-wip-203-acceptance.yml`) runs on a
disposable PostgreSQL 17 only: it refuses URL/service/`PGHOSTADDR` settings, a non-loopback `PGHOST`, a non-17
server and an existing `wardah_qc_entry_202` role, and it uses no secret. It builds the cutoff-189 baseline pair
plus 190..201, then: the CRLF unit tests and the three 203 pre-image drift mutants on their own copies; the restored
order (CRLF script -> 202 -> 203) with the 203 acceptance, the concurrency check and the revised M202 acceptance
(including the membership contract and the `try_role` / `try_as` / `try_connected` harness controls) on the post-203
catalog; and the alternate order (203 -> 202) with the 203 acceptance. Each step requires psql exit 0, no ERROR line
and its marker (`PRE_M202_CRLF_CHECKS_PASS`, `STAGE_WIP_203_PREIMAGE_DRIFT_PASS`, `PRE_M202_CRLF_NOOP`,
`STAGE_WIP_203_ACCEPTANCE_PASS`, `STAGE_WIP_203_CONCURRENCY_PASS`, `M202_QC_PRIVILEGED_WRITE_CLOSURE_ACCEPTANCE_PASS`)
and ends with `M203_LOCAL_RUN_PASS`. Counts of `ok` notices and probe identities are printed for the record, not
asserted: the markers, not a fixed total, are the acceptance contract. The runner is not Production evidence.
