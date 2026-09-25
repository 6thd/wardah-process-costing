# Manufacturing / inventory RED evidence — 2026-09-25

**Anchor:** `main@0761d567965e7977ea2702166143ea6c2f1dc1da` (the PR #241 / Migration 191 merge)
**Engine:** PostgreSQL 17.11, disposable local cluster
**Chain:** `000_schema_baseline_20260905_184634.sql` + `001_system_reference_data_20260905_184634.sql` (cutoff 189) → `190_material_consumption_authorization_boundary.sql` → `191_f2_stock_write_concurrency_closure.sql`
**Scope:** evidence only. No Production or Staging access. No migration. No data repair.

These probes are **non-executing in CI** on purpose. Each one *passes* only while its
defect still reproduces, which is the repository's existing `_red.sql` convention. The
focused implementation PR for each track must turn its probe into a GREEN acceptance.
It must not delete the probe or weaken the invariant it checks.

## Run

```bash
PGHOST=/var/run/postgresql PGPORT=5433 PGUSER=postgres \
  bash docs/db/manufacturing-inventory-red-20260925/run_red.sh
```

`run_red.sh` refuses a non-local `PGHOST`, and refuses to run while
`DATABASE_URL`, `PGSERVICE` or `SUPABASE_DB_URL` is set. It creates a new database
from the baseline pair and every migration after the cutoff, using the same helper
scripts as `ci-cd.yml`. It loads `00_fixture.sql`, runs each probe inside
`BEGIN … ROLLBACK`, then drops the database. Client calls run as the real
`authenticated` role with Supabase JWT claims, so RLS and EXECUTE grants apply
(`_helpers.sql: pg_temp.try_as`).

Fixture actors (all active members of one org):

| Actor | Grant |
|---|---|
| admin | org admin (`is_org_admin`) |
| consumer | only `manufacturing.material_consumption.consume` |
| reader | only `manufacturing.orders.read`, so no manufacturing or inventory mutation key |

## Results (captured 2026-09-25 at `62f9fb2d`, all probes REPRODUCED, runner exit 0)

Raw runner output: [`RED_RUN_20260925.log`](./RED_RUN_20260925.log). The MO and adjustment
UUIDs in it are generated per run.

| Probe | Track | Verdict | Exact observed result |
|---|---|---|---|
| `A_completion_fg_divergence` | #230 | **CONFIRMED** | Completion of 5 FG sets `products.stock_quantity=5` and `cost_price=20`, with **0 FG bins and 0 FG SLE**, and leaves `stock_value=0`. It writes two **draft** GL entries (`MATERIAL_ISSUE` Dr WIP/Cr RM 100; `FG_RECEIPT` Dr FG/Cr WIP 100). One canonical `rpc_manual_stock_movement_v2` +1 then re-derives the projection to **1**, so the 5 completed units vanish. |
| `B_completion_cost_contamination` | #230 / #229 | **CONFIRMED** | Canonical POSTED consumption = 10 (SLE value 10, stage WIP 10). A direct client INSERT (the `mesService.consumeMaterial` shape) of a **PENDING** row worth 40 is accepted for a member holding `consume`. Completion then books `total_cost=50`, `unit_cost=10`, and draft GL 50/50. The same direct surface also accepts a fabricated **`status='POSTED'`** row with no stock movement, so `WHERE status='POSTED'` alone is **not** a sufficient fix. The reader, who has no `consume` grant, is rejected by RLS (`42501`). |
| `C_consumption_retry_lifecycle` | #229 | **CONFIRMED** | Replaying the identical 10-unit request doubles **every** effect: SLE rows 1→2, bin 990→980 / 9,900→9,800, `material_consumption` 1→2, `reservation.quantity_consumed` 10→20, stage WIP 100→200. A client-sent `event_id` / `idempotency_key` is silently ignored and the replay still duplicates. New consumption is **accepted** on `cancelled`, `done`, `draft` and `on_hold` MOs. Auto-resolution rejects an MO whose only work order is `CANCELLED` (`WORK_ORDER_REQUIRED_FOR_CONSUMPTION`), but an **explicit** `work_order_id` for that same cancelled WO is accepted. |
| `D_completion_authorization` | #154 / #158 / #230 | **CONFIRMED** | The reader (`orders.read` only; `orders.update`, `orders.approve` and `consume` all false) reaches `done` three ways: a direct `UPDATE manufacturing_orders SET status='done'` (which also overwrote `completed_quantity`, `total_cost` and `unit_cost`); `rpc_transition_mo_status(…,'done')` (no FG, no cost, no GL); and `rpc_complete_manufacturing_order` (FG projection plus draft GL). `start_operation` / `complete_operation` are membership-only, and today both **abort for every caller** with `column reference "completed_quantity" is ambiguous` inside trigger `update_mo_status_from_work_orders`. They are therefore not a working completion bypass today, but they are broken. `search_path` is `{search_path=public}` (no `pg_temp`) on `rpc_complete_manufacturing_order`, `rpc_transition_mo_status`, `start_operation` and `complete_operation`. |
| `E_multiwarehouse_physical_count` | **#259** (new) | **CONTRACT GAP confirmed; reviewer's sourcing claim NOT REPRODUCED** | The `startPhysicalCount()` payload fails with `42703 column "counted_by" … does not exist`. Its `IN_PROGRESS` status violates `physical_count_sessions_status_check`. No repository or database object writes `system_qty`; the reader wrote `system_qty=100` freely. With aggregate `system_qty=100` and counted 60 for W1, the service arithmetic gives −40, and `rpc_create_stock_adjustment` + `rpc_submit_stock_adjustment` apply it without comparing it to the W1 bin: **W1 60→20, W2 40, aggregate 100→60**. |
| `F_stock_transfer_closed_path` | #160 | **CONFIRMED (closed path)** | No `%transfer%` RPC exists. The two browser-built SLE rows from `StockTransfer.tsx` are rejected for the org admin with `42501 permission denied for table stock_ledger_entries`, which is correct and must stay closed. The reader can still set `stock_transfers.status='SUBMITTED'` directly while bins stay unchanged. |
| `GH_direct_table_surfaces` | #157 / #170 | **CONFIRMED (already tracked)** | The reader rewrites `products.cost_price`, `valuation_method` and `stock_queue`. `validate_stock_queue()` then recomputes `stock_quantity` to 0 while bins sum to 100. The reader also rewrites `material_reservations.quantity_reserved` / `status`. |
| `I_process_costing_schema_rpc` | **#260** (new) / MFG-P1 | **CONFIRMED** | Service upsert: `42703 column "good_quantity" of relation "stage_costs" does not exist`. `labor_time_logs` / `moh_applied`: `42P01 relation … does not exist`. The real `upsert_stage_cost(p_tenant,p_mo,p_stage,p_wc,p_good_qty,p_dm,p_mode)` fails with `42702 column reference "costing_method" is ambiguous`. `rpc_cost_of_production_report` on a canonical-column row fails with `record "v_stage" has no field "costing_method"`. `events.ts` `stage-recalc` / `mo-finish` fail with `42883` (no such function signature). |

`R_projection_readback.sql` is a **read-only** rollout gate. It classifies
`products.stock_quantity ≠ SUM(bins.actual_qty)` rows and projection-without-bin rows.
Negative control on the fixture: a seeded `3500` projection with no bin is reported as
`no_bin_truth`, and a `90 vs 100` row as `projection_mismatch`. It was **not** run
against any live environment.

## What these probes do not claim

- Nothing here describes Production or Staging. The baseline is a schema-only dump of
  Production at cutoff 189, so the probes show what that schema plus the repository
  chain does. Only a separately authorized live readback can state live state.
- No concurrency race is claimed. The C1 duplicate is a sequential lost-response
  replay. Forced-overlap races stay in the #229 acceptance matrix.
- No lock-order defect is claimed for `rpc_complete_manufacturing_order`. It does not
  call `wardah_apply_stock_outgoing` at all (see the reconciliation document, §6).
