# F2 — Stock Bin Concurrency RED Proof (Issue #228)

**Date:** 2026-09-06
**Source:** Astra Architecture Red-Team Audit #1, F2 / S0 / Strong evidence
**Tracking:** #228
**Base:** `main@aa41b256dfd8ab45962a871e03e3bac02f5ebc49` (after PR #233)
**Production writes:** none
**Migration:** none — this PR is proof only

## Purpose

Freeze two independent, deterministic lost-update races in the live
`wardah_apply_stock_incoming` / `wardah_apply_stock_outgoing` pair before any fix is
designed. This PR is intentionally RED-proof only: it adds no migration, no locking
strategy, no schema change, and makes no Production read or write.

## RED-A — first-bin (product, warehouse) race

This is the original Astra hypothesis. Both live `wardah_apply_stock_incoming`
overloads (9-arg receipt/manual-movement path from Migration 94/97, and the 10-arg
stock-adjustment path from Migration 187) do:

```sql
SELECT actual_qty, stock_value, stock_queue
INTO v_prev_qty, v_prev_value, v_prev_queue
FROM bins
WHERE product_id = p_product AND warehouse_id = p_warehouse
FOR UPDATE;
-- ... derive v_new_qty/v_new_value from v_prev_* ...
INSERT INTO bins (...) VALUES (...)
ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
  actual_qty = EXCLUDED.actual_qty, ...;
```

A row that does not exist yet cannot be row-locked by `FOR UPDATE`. Two independent
transactions that both start from "no bin for this key" both derive their new balance
from the same empty state (`v_prev_qty = 0`). The second transaction's `INSERT` blocks
on the first transaction's *uncommitted* insert into the same unique
`(product_id, warehouse_id)` key (`idx_bins_product_warehouse`) — real lock contention,
not a coincidence of timing — and once the first commits, the second's
`ON CONFLICT DO UPDATE` blindly overwrites with its own precomputed `EXCLUDED` values
instead of the sum of both.

**Reproduced deterministically:** two Goods Receipt vouchers for the same
`(org, product, warehouse)` with no pre-existing bin, quantities 5 and 7 (sum 12).
Both calls report `applied: true` (this defect is silent — no exception, no error
path). Both stock-ledger effects survive (2 rows). Exactly one bin row exists. Its
`actual_qty` is deterministically **7** (the second/blocked caller's own value) across
every local run — never 12, and never a value outside `{5, 7}`. `products.stock_quantity`
mirrors the same wrong single bin, so the product aggregate is internally consistent
with its own (wrong) bin in this single-warehouse case.

## RED-B — product-aggregate race across two warehouses for one product

This is **not** part of the original Astra hypothesis. It surfaced while building
#228's own required regression check (acceptance item 6: "repeat ... with two
warehouses for one product"), which was meant to be a *control* proving the defect is
scoped to colliding `(product, warehouse)` keys. It is a distinct root cause: it
reproduces even when both underlying bin writes are individually correct and never
collide on a key.

The tail of `wardah_apply_stock_incoming` (both overloads) does:

```sql
SELECT COALESCE(SUM(actual_qty), 0), ...
INTO v_prod_qty, v_prod_rate
FROM bins
WHERE product_id = p_product AND org_id = p_org;

UPDATE products
SET stock_quantity = v_prod_qty, ...
WHERE id = p_product AND org_id = p_org;
```

Neither the `SUM` scan nor the `UPDATE` is preceded by any lock that spans both
warehouses' bins or the product row itself. Two concurrent incoming calls against
*different* warehouses for the *same* product each insert their own bin correctly (no
key collision at all — `idx_bins_product_warehouse` never fires), but each
transaction's `SUM` only sees its own uncommitted bin row under READ COMMITTED.
Both then attempt `UPDATE products ... WHERE id = p_product`, which **is** a real
single-row lock: the second `UPDATE` blocks on the first's uncommitted update to the
same product row. Once the first commits, the second's `UPDATE` proceeds with its own
precomputed (partial) sum, overwriting the first's contribution instead of the true
total surviving.

**Reproduced deterministically:** two Goods Receipt vouchers for the same product
across two distinct warehouses, quantities 6 and 9 (sum 15), starting with no bin in
either warehouse. Both calls report `applied: true`. Both stock-ledger effects survive
(2 rows). Both bins are individually and correctly 6 and 9 — the per-warehouse write
path is not at fault. `products.stock_quantity` is deterministically **9** (the
second/blocked caller's own partial sum) across every local run — never 15, and never
a value outside `{6, 9}`.

## Determinism, not probability

Both races are forced, not hoped for. The first backend of each race is driven to
complete its RPC call and then hold its transaction open via a file-based rendezvous
(`touch`/poll-for-file, not a fixed `sleep` used as the only synchronization signal);
the second backend is only started once the first has returned; the script then polls
`pg_stat_activity` for `wait_event_type = 'Lock'` on the second backend specifically,
proving genuine lock contention between two independent PostgreSQL backends before
releasing the first to commit. Verified stable across 5 consecutive local runs against
PostgreSQL 17 with identical outcomes every time (RED-A → 7; RED-B → 9).

## Control scenarios (bound RED-A; do not by themselves imply RED-B is fixed)

1. **Existing bin, same race shape as RED-A.** A bin is pre-seeded (qty 20). An
   external blocker transaction holds `FOR UPDATE` on it; two concurrent incoming
   calls (qty 3 and 4) both queue behind the real row lock, confirmed via
   `pg_stat_activity`. Result: bin correctly sums to 27 (20+3+4). This shows the
   `FOR UPDATE` lock is sufficient once the row exists — RED-A is precisely bounded to
   the bin-creation window, not a general failure of the locking strategy.
2. **Incoming vs outgoing lock ordering, existing bin.** A bin is pre-seeded (qty 50).
   One incoming (qty 8) and one outgoing (qty 10, requiring
   `wardah_assert_org_member` via an active `user_organizations` row) are forced to
   both queue on the same pre-existing bin lock. Result: no deadlock, both calls
   succeed, bin nets to 48 (50+8-10) correctly. This is a pre-fix baseline for lock
   ordering, not a defect — useful as a regression fence for whatever locking
   strategy the eventual fix chooses.

## Deterministic RED acceptance

`scripts/ci/fresh-db/acceptance_f2_stock_bin_race_red.sh` runs all four scenarios
above against a cutoff-189 Fresh DB (the live functions already exist at this cutoff;
no migration is applied before or during this script) and fails loudly
(`STOCK_F2_RED_FAIL: ...`) if either race fails to reproduce its documented signature,
if a control scenario stops matching its expected correct result (which would mean a
second, unrelated defect), or if the two racing backends are never observed genuinely
blocked on each other (which would mean the script degenerated into simulated
sequential execution instead of real concurrency). A clean run prints
`STOCK_F2_RED_PROOF_PASS` with every scenario's final numbers.

## What this RED proof does not claim

- It does not mutate Production.
- It does not choose a lock/serialization strategy for either race.
- It does not fix RED-A or RED-B.
- It does not claim RED-A and RED-B share a fix, or that fixing one fixes the other —
  RED-A is a `bins` unique-key insert race; RED-B is a `products` row update race with
  no shared lock between them today.
- It does not extend to every stock-mutating RPC in the codebase — only the two
  `wardah_apply_stock_incoming` overloads and their interaction with
  `wardah_apply_stock_outgoing` were exercised.
- It does not close #228.

## FIX PR gate

Do not implement a fix for either RED-A or RED-B in the same PR as this proof. Once
both are reviewed and accepted as confirmed, the remediation approach (one additive
migration covering both, or two scoped fix PRs under #228) is a separate decision, per
the review requirements already recorded on #228.
