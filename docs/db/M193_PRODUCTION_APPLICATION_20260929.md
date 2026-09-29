# M193 Production application — 2026-09-29

**Project:** `uutfztmqvajmsxnrqeiv` (Production)  
**Migration:** `193_posted_material_history_delete_guard`  
**Canonical source:** `sql/migrations/193_posted_material_history_delete_guard.sql` from `main@f5d6d8372cea1f02bde938441e2b1ff3a804181f`  
**Source SHA-256:** `ac7b824ed3eec183e6d7241964dc9cb5899ef2bba7c27ebaba5c0026dc267943`

## Evidence boundary and outcome

The owner explicitly authorized this Production application on 2026-09-29. The executor submitted the canonical file alone with Supabase `apply_migration` as `193_posted_material_history_delete_guard`; the tool returned `success=true`. The live migration ledger subsequently contained one M193 row, version `20260929070702` (10:07:02 Asia/Riyadh). Its single stored `statements` element is 8,172 characters and hashes to the source SHA-256 above. M192 was present exactly once before application. The SQL file contains its own `BEGIN … COMMIT`.

The catalog and aggregate data below were independently read from Production with SELECT-only queries after the application. No live DELETE, TRUNCATE, ordinary-user exercise, or concurrency test was performed against Production. The previous local RED/GREEN tests do not count as live behavioral tests.

## Recovery evidence reported by the owner/local agent

This private evidence was reported by the local agent; the executor did **not** inspect the archive, restore log, or local database:

- Archive: `wardah-production-uutfztmqvajmsxnrqeiv-after-m192-before-m193.dump`; 2,697,189 bytes; SHA-256 `bf59a9a1b5992141c3bd8b9cfb4617dd5fa446ad8d3e37157fcab8173618a8fa`.
- `pg_dump -Fc` with PostgreSQL 17.6 client against Production 17.6 exited 0 without warnings, 2026-09-29 06:52:03–06:54:39 UTC; `pg_restore --list` exited 0 with 3,599 entries. The ledger was unchanged before and after the dump: M190/M191/M192 each once, M193 absent.
- Full `pg_restore --exit-on-error` into a fresh `supabase/postgres:17.6.1.175` database exited 0 without errors or warnings. Extensions, ledger, object counts, product/bin readback, and stock validation matched Production. The local database owner was aligned to `postgres` without granting public CREATE.
- M193 was applied on a separate restored local copy by `postgres`: exit 0, visible COMMIT, empty stderr. The reference restore stayed pre-M193. Local postflight found three DELETE guards, eight TRUNCATE guards, closed client DELETE/TRUNCATE grants, unchanged stock and business counts.
- A separate empty PostgreSQL 17.6 fixture passed the #273 RED and GREEN acceptance and the M192 sequential and 288-cell matrix. `concurrency.py` was **not** run in this local report (Python unavailable in the isolated image). These tests were not a Production test.

The archive and logs remain private on the owner's machine and were not uploaded to this repository.

## Immediate live preflight

Directly before application: Production server 17.6; M192 once and M193 absent. `wardah_internal.material_issue_events`, `rpc_consume_material_event(uuid,uuid,uuid,jsonb)`, `material_consumption`, `work_orders`, and `stage_wip_log` existed. Event receipts, consumption rows, and orphaned receipt links were all zero. There were no other active or idle-in-transaction sessions at that read.

## Live postflight (executor SELECT-only readback)

| Check | Result |
| --- | --- |
| M193 ledger | Exactly one row; version `20260929070702`; stored SQL SHA-256 matches canonical file |
| DELETE guards | `guard_posted_wo_delete_193`, `guard_posted_consumption_delete_193`, and `guard_posted_wip_delete_193` enabled on their respective tables |
| TRUNCATE guards | `deny_history_truncate_193` enabled on all eight target tables; each is a statement-level BEFORE TRUNCATE trigger (`tgtype=34`) bound to the intended helper |
| Helper functions | All four `SECURITY INVOKER`, `search_path=public, pg_temp`; no EXECUTE for `PUBLIC`, `anon`, or `authenticated` |
| Client DELETE/TRUNCATE | Both privileges false for `anon` and `authenticated` on all eight target tables |
| WIP remaining grants | `authenticated` SELECT, INSERT, UPDATE remain true |
| Aggregate business rows | 3 manufacturing orders; 0 work orders; 2 WIP rows; 118 products; 2 bins; 5 SLE rows; 0 reservations, consumption rows, and event receipts; unchanged from preflight |
| Inventory invariant | Product/bin quantity and value mismatch count 0; `validate_stock_balance` mismatch count 0 |

The eight tables are `manufacturing_orders`, `work_orders`, `material_reservations`, `material_consumption`, `stage_wip_log`, `labor_time_tracking`, `operation_execution_logs`, and `quality_inspections`. A first attempt at the product/bin query used incorrect column names and failed as a read-only query; it was corrected to `org_id` and `actual_qty` and returned zero mismatches. The ledger query likewise first treated `statements` as text rather than `text[]`; the corrected hash used its single element. Neither failed SELECT changed data.

## Operational boundary

M193 prevents the documented deletion and truncation paths. It does not finish #229's employee UI, #230's manufacturing completion, #260's process costing, or the broader #170/#154 write boundary. Keep the operational hold on new material issue events, including Org Admin and pilot activity, until a separate owner decision accepts the remaining workflow and authorization gates. Do not interpret the M193 application as permission to expose the employee consumption UI or to close those issues.
