# M192 — Production application and readback (2026-09-28)

**Target:** Production project `uutfztmqvajmsxnrqeiv`, PostgreSQL 17.6. Staging was not changed.  
**Exact source:** `main@76689dc076ca50f1765603bf7fb17439e4d0af39`, `sql/migrations/192_material_consumption_retry_and_policy.sql`, SHA-256 `d00685979cea79d634019c8c23a66a054f13b9c7e8a582e92885adde877b8653`, Git blob `8995cdbcaeeea874b1d37305a70f4e5110bb737b`.  
**Executor-run application:** `apply_migration` for `192_material_consumption_retry_and_policy` returned `success=true`. Live ledger version `20260928111141` (2026-09-28 11:11:41 UTC / 14:11:41 Asia/Riyadh). M190 and M191 each remain present once. The migration file was submitted unchanged.

## Recovery evidence and rehearsal

The owner/local agent reported a private post-M191/pre-M192 custom-format backup `wardah-production-uutfztmqvajmsxnrqeiv-after-m191-before-m192.dump`, 2,685,075 bytes, SHA-256 `07135e469e5097eab95d5dd51e6e8081374aea486376c267203150a29a4cb12f`. The reported complete local restore used `supabase/postgres:17.6.1.175` and `pg_restore --exit-on-error` with exit 0, M190/M191 once and M192 absent. A subsequent rehearsal on a second restored database applied the identical M192 bytes as role `postgres` and committed successfully after aligning that local database's ownership with Production. The earlier local failure (`permission denied for schema public`) arose because the first restored database was owned by `supabase_admin`, unlike Production; no Production privilege was changed to accommodate this.

**Evidence limit:** private archive, checksum, restore logs and role-alignment steps were reported by the owner/local agent, not inspected or uploaded here. The archive contains private database data and must remain private. Successful local restore and SQL rehearsal do not prove recovery of every Supabase service.

## Executor-run read-only Production preflight

Immediately before submission, the ledger showed M190 once (`20260927082227`), M191 once (`20260928074428`), M192 absent; database owner `postgres` could CREATE in `public`. The pre-M192 v2 body contained the M190 permission check and M191 stock-lock helper. The report view was owned by `postgres` with `security_invoker=on`. Active stock-ledger rows, nonzero product and bin balances, product/bin projection differences, and `validate_stock_balance` mismatches were all zero. Five historical stock rows were cancelled.

## Executor-run read-only Production postflight

| Check | Observed result |
| --- | --- |
| Ledger | M190, M191 and M192 each once; 85 total rows; M192 version `20260928111141`. |
| Report view | Owner still `postgres`; `security_invoker=on`; ACL unchanged. |
| Column precision | `planned_quantity`, `consumed_quantity`, `total_cost`: `numeric(18,6)`; `unit_cost`: `numeric(30,12)`. |
| Policy and receipts | `wardah_internal` exists; one seeded organization policy, default `{IN_PROGRESS}`, version 1; zero material-issue receipt rows. |
| Permission boundary | Direct `material_consumption` INSERT policy absent; `anon` and `authenticated` have no INSERT grant; `authenticated` cannot use the private schema or INSERT receipts. |
| RPCs | Event issue, policy setter and policy getter present as SECURITY DEFINER with pinned `search_path=public, pg_temp`; callable by `authenticated`, not `anon`. Old eventless signatures contain the retirement error `MATERIAL_CONSUMPTION_EVENT_ID_REQUIRED`. |
| Business data | Zero material-consumption rows, zero active SLE rows, five cancelled SLE rows, zero nonzero product/bin balances, zero projection differences and zero stock-balance mismatches. |

The security advisor count for executable SECURITY DEFINER functions available to `authenticated` moved from 88 to 91, consistent with the three new intended RPCs; other recorded security and performance advisory counts were unchanged. This advisor count is not a behavioral authorization test.

**Verification boundary:** Catalog, ledger, counts and query results above are executor-run read-only Production observations after `apply_migration`. No Production fixture, material issue, ordinary-user session, real retry, concurrency race or production-throughput test was run. The local PostgreSQL 17 acceptance and two-session tests described in PR #267 are independent repository evidence, not a live exercise.

## Still open after M192

- [#229](https://github.com/6thd/wardah-process-costing/issues/229): the database event boundary is live, but the employee client must persist and resend the *same* `event_id`, legacy callers must be audited, and user-session behavior tested. Keep the employee consumption UI unavailable until the surrounding write boundaries are safe.
- [#170](https://github.com/6thd/wardah-process-costing/issues/170) and [#154](https://github.com/6thd/wardah-process-costing/issues/154): `authenticated` still has direct INSERT/UPDATE grants on `material_reservations`, `work_orders` and `stage_wip_log`; existing RLS permits some organization-membership-only writes. M192 does not secure these surfaces.
- [#230](https://github.com/6thd/wardah-process-costing/issues/230): define and implement authoritative FG/bin/SLE/WIP/GL completion. Fix the potential MO→WO versus WO→MO lock inversion **before** making the WO status trigger operational.
- [#268](https://github.com/6thd/wardah-process-costing/issues/268): its M191→M192 scheduling gate is now satisfied on Production. Acceptance/ACL test additions can be a focused PR; lock and precision decisions belong with #230 and the costing contract.

No migration or runtime code was changed by this documentation. Do not infer that Production manufacturing completion, the employee consumption UI, Staging or full SaaS isolation are accepted by this M192 application.
