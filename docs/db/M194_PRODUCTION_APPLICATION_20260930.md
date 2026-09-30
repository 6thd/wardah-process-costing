# M194 Production application — 2026-09-30

**Project:** `uutfztmqvajmsxnrqeiv` (Production)
**Migration:** `194_stage_wip_posted_cost_boundary`
**Canonical source:** `sql/migrations/194_stage_wip_posted_cost_boundary.sql` in merge commit `145b536665484ce5539d0aec1d808cc9e4ba67dd` (PR #284 head `6902313fca442b560a8929358d6f4d8d6586ed6d`)
**Source SHA-256:** `c32918e3eed4edb1e71eef279a75ef859a9166352e3643e95f93f57ee6d7f1df`

## Outcome and evidence boundary

The owner authorized the coordinated release on 2026-09-30 after the local backup, full restore, and M194 rehearsal report. PR #284 was merged into `main` at 07:36:48 UTC as `145b5366` with the expected head SHA. The M194 blob at the merge commit matched the reviewed PR head byte for byte. The executor then submitted that SQL alone to Production using Supabase `apply_migration` under the name above; the tool returned `success=true`.

The live ledger now contains one M194 row, version `20260930073711` (10:37:11 Asia/Riyadh). Its one stored `statements` element hashes to the canonical SHA-256 above. M190–M193 remain present once each. The file includes its own `BEGIN … COMMIT`.

The postflight below consists of read-only catalog and aggregate queries on Production. It does **not** include a live ordinary-user close, material issue, browser session, or concurrency test. The M192 hold and employee-UI restriction remain in force.

## Recovery evidence reported by the owner/local agent

The executor did not inspect the private archive, restore log, or local database. The owner/local agent reported:

- Archive `wardah-production-uutfztmqvajmsxnrqeiv-after-m193-before-m194.dump`: 2,705,651 bytes; SHA-256 `cf9c7b5409911dd4c5c0004b90bead1b9a5ae0d6df21df3420bae1f4db1de558`. Older archives were unchanged.
- PostgreSQL 17.6 `pg_dump -Fc` against Production 17.6 exited 0 without warnings, 2026-09-30 06:58:45–07:03:07 UTC. `pg_restore --list` exited 0 with 3,612 entries. M190–M193 were each present once and M194 absent before and after the dump; the business counts and two WIP rows were stable.
- `pg_restore --exit-on-error` into a fresh `supabase/postgres:17.6.1.175` database exited 0 without errors or warnings. Extensions, ledger, objects, inventory invariants, and WIP-row fingerprint matched Production. The local database owner was aligned to `postgres`; `PUBLIC` and `authenticated` were not granted schema CREATE.
- M194 applied as `postgres` to a separate restored local copy: exit 0, visible COMMIT, empty stderr. The reference restore remained pre-M194. This direct `psql` rehearsal correctly did not insert a migration-ledger row. Postflight found the new trigger and RPCs, preserved M193 guards and client grants, and unchanged business rows and balances.
- On a separate empty PostgreSQL 17.6 database, the #278 RED/GREEN acceptance, M193 acceptance, and M192 sequential and 288-cell matrix passed. The two `concurrency.py` scripts were **not** run in this local image because it had no Python and no network. Earlier disposable PG17 CI race results are separate evidence, not live Production evidence.

The archive and logs remain private on the owner's machine and were not uploaded to the repository.

## Immediate live preflight

Inside a read-only transaction: Production was PostgreSQL 17.6 with M193 once and M194 absent; `postgres` owned both `stage_wip_log` and `rpc_consume_material_event` and could CREATE in `public`. M192's RPC and event table, M193's WIP delete guard, and `trigger_calculate_wip_eu` were present. WIP parent-organization drift, product/bin quantity and value differences, and `validate_stock_balance` findings were all zero. There were zero other active or idle-in-transaction client sessions at the read. The two WIP rows were historical, open, and outside the current date; material consumption and event receipts were empty.

Two initial read-only product/bin queries used nonexistent bin quantity column names. After checking the catalog, the corrected query used `bins.actual_qty` and returned zero differences. Neither failed SELECT changed data.

## Live postflight (executor read-only queries)

| Check | Result |
| --- | --- |
| Ledger | M194 exactly once, `20260930073711`; stored SQL SHA-256 matches the canonical file |
| New WIP guard | `zz_guard_stage_wip_write_194` enabled on `stage_wip_log`, bound to `wardah_internal.guard_stage_wip_write_194()`; existing EU and M193 WIP delete triggers remain enabled |
| M193 TRUNCATE guards | All eight remain enabled as statement-level BEFORE TRUNCATE triggers (`tgtype=34`) bound to the intended function |
| New function settings | `wardah_assert_stage_wip_editor_194` and `rpc_close_stage_wip_194` are `SECURITY DEFINER`; the private write guard is `SECURITY INVOKER`. All are owned by `postgres` with `search_path=public, pg_temp` |
| New function EXECUTE | Only `authenticated` among the tested client roles can call the editor helper and close RPC; `anon` cannot. `anon`, `authenticated`, and `service_role` cannot call the private guard |
| M192 issue RPC | Still `SECURITY DEFINER`, owned by `postgres`, pinned `search_path`, callable by `authenticated` and `service_role` but not `anon`; migration postflight preserved its exact preimage ACL, security mode, and settings |
| Client table privileges | `anon` and `authenticated` have no DELETE or TRUNCATE on the eight M193 tables. `authenticated` retains SELECT, INSERT, UPDATE on WIP; material consumption remains read-only to that role |
| Business rows | 3 MOs, 2 WIP, 118 products, 2 bins, 5 SLE, zero consumption and event receipts; unchanged from preflight and the reported backup snapshot |
| WIP historical rows | Both remain open with total material cost 2,000; periods span 2025-11-16 through 2025-11-24, no row covers the current date, and no close markers appeared |
| Stock and tenant invariants | Zero product/bin quantity or value differences; zero `validate_stock_balance` findings; zero WIP parent-organization drift |

The eight tables are `manufacturing_orders`, `work_orders`, `material_reservations`, `material_consumption`, `stage_wip_log`, `labor_time_tracking`, `operation_execution_logs`, and `quality_inspections`.

## Web deployment and remaining boundary

Vercel reported the production deployment for merge commit `145b5366` as `READY` after the database postflight. The deployment was created at 07:36:51 UTC; M194 was recorded at 07:37:11 UTC. This establishes the final deployed SHA and database state at readback, not the precise moment users could access the new UI. No live close button was pressed. The deployment is [recorded in Vercel](https://vercel.com/6thds-projects/wardah-process-costing/8j8XqUo8oM1rtcJ5JAH1V9syioDU).

The Supabase security advisor still lists existing repository-wide notices. Its authenticated `SECURITY DEFINER` count was 93 after application; a pre-M194 advisor count was not captured in this release, so no delta is claimed. [Supabase advisor remediation guidance](https://supabase.com/docs/guides/database/database-linter) remains available for those independent findings.

M194 protects posted WIP history and prevents ambiguous new issue routing. It does not complete #229's employee client and server-side intent boundary, #230's manufacturing completion, #260's costing engine, or #170/#154's wider write surface. Do not lift the operational hold on new M192 material issue events (including Org Admin or pilot use), expose the employee consumption UI, or close those issues on this readback alone. #278 needs independent review of this application record and any remaining live acceptance decision.
