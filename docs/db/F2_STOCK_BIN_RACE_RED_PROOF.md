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
`(org, product, warehouse)` with no pre-existing bin, quantities 5 and 7 at the same
rate 10 (sum 12, value 120). Both calls report `applied: true` (this defect is silent —
no exception, no error path). Both stock-ledger effects survive with correct values:
`SUM(stock_ledger_entries.actual_qty) = 12` and
`SUM(stock_ledger_entries.stock_value_difference) = 120` across the two rows — the
ledger itself is never wrong. Exactly one bin row exists. Its `actual_qty` is
deterministically **7** and its `stock_value` **70** (the second/blocked caller's own
values) across every local run — never the correct sum (12 / 120), and never a value
outside the two individual inputs. `products.stock_quantity` (7) and `cost_price` (10)
mirror the same wrong single bin exactly, so the product aggregate is internally
consistent with its own (wrong) bin in this single-warehouse case — `cost_price` alone
does not reveal the defect here because both increments happened to share one rate;
RED-B below removes that coincidence.

**Overload coverage.** This is behaviorally reproduced only on the 9-argument
`wardah_apply_stock_incoming` overload (Migration 94/97 — the receipt/manual-movement
path). The 10-argument source-aware overload (Migration 187 — the stock-adjustment
path) is not called in this scenario. Instead, a Fresh-DB static contract assertion
(`pg_get_functiondef` on both overloads, matched with whitespace-tolerant regexes
since the live 9-arg body carries different column-aligned spacing than the 10-arg
body) proves both overloads carry the identical `FOR UPDATE` / `ON CONFLICT ... DO
UPDATE SET actual_qty = EXCLUDED.actual_qty` shape (RED-A) and the identical unlocked
`SUM(actual_qty)` → `UPDATE products` shape (RED-B). A fix that touches only one
overload cannot silently pass this proof, even though only the 9-arg path is
behaviorally exercised end-to-end.

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
across two distinct warehouses, quantities 6 and 9 — deliberately at *different* rates,
10 and 20, so the correct combined result (qty 15, value 240, weighted rate 16) cannot
be mistaken for either side's own number. Both calls report `applied: true`. Both
stock-ledger effects survive with correct values:
`SUM(stock_ledger_entries.actual_qty) = 15` and
`SUM(stock_ledger_entries.stock_value_difference) = 240`. Both bins are individually
and correctly `qty=6/value=60` and `qty=9/value=180` — the per-warehouse write path is
not at fault. `products.stock_quantity` is deterministically **9** and `cost_price`
**20** (the second/blocked caller's own partial qty and its own rate) across every
local run — never the correct combined result (15 / 240 / 16), and never a value this
scenario did not directly produce. The wrong `cost_price` (20, not 16) is the clearest
signal that this is a genuine aggregate corruption and not just a rounding artifact of
matching rates.

## Determinism, not probability

Both races are forced, not hoped for. The first backend of each race is driven to
complete its RPC call and then hold its transaction open via a file-based rendezvous
(`touch`/poll-for-file, not a fixed `sleep` used as the only synchronization signal);
the second backend is only started once the first has returned; the script then polls
`pg_stat_activity` for `wait_event_type = 'Lock'` on the second backend specifically,
proving genuine lock contention between two independent PostgreSQL backends before
releasing the first to commit. The two control scenarios' blocker transactions use the
same handshake (lock the row, signal ready, wait for an explicit release file) rather
than a fixed `pg_sleep` window, so a slow CI runner cannot cause either racer to be
released before it is actually observed waiting — the earlier draft of this proof used
`pg_sleep(2)` for the controls, which risked a false failure on a heavily loaded
runner; that gap is closed. Verified stable across 5 consecutive local runs against
PostgreSQL 17 with identical outcomes every time (RED-A → qty 7/value 70/cost 10;
RED-B → qty 9/value split 60+180/cost 20).

## Control scenarios (bound RED-A; do not by themselves imply RED-B is fixed)

1. **Existing bin, same race shape as RED-A.** A bin is pre-seeded (qty 20). An
   external blocker transaction holds `FOR UPDATE` on it, signals ready, and waits for
   an explicit release; two concurrent incoming calls (qty 3 and 4) both queue behind
   the real row lock, confirmed via `pg_stat_activity`, before the blocker is released.
   Result: bin correctly sums to 27 (20+3+4). This shows the `FOR UPDATE` lock is
   sufficient once the row exists — RED-A is precisely bounded to the bin-creation
   window, not a general failure of the locking strategy.
2. **Incoming vs outgoing lock ordering, existing bin.** A bin is pre-seeded (qty 50).
   The same lock/ready/release blocker handshake is used; one incoming (qty 8) and one
   outgoing (qty 10, requiring `wardah_assert_org_member` via an active
   `user_organizations` row) are forced to both queue on the same pre-existing bin
   lock, confirmed via `pg_stat_activity`, before the blocker is released. Result: no
   deadlock, both calls succeed, bin nets to 48 (50+8-10) correctly. This is a pre-fix
   baseline for lock ordering, not a defect — useful as a regression fence for
   whatever locking strategy the eventual fix chooses.

## Deterministic RED acceptance

`scripts/ci/fresh-db/acceptance_f2_stock_bin_race_red.sh` runs RED-A, the static
overload contract assertion, both controls, and RED-B (in that order) against a
cutoff-189 Fresh DB (the live functions already exist at this cutoff; no migration is
applied before or during this script) and fails loudly (`STOCK_F2_RED_FAIL: ...`, or a
`STOCK_F2_STATIC_CONTRACT_..._MISSING` exception for the contract step) if either race
fails to reproduce its documented quantity/value signature, if a control scenario
stops matching its expected correct result (which would mean a second, unrelated
defect), if the two racing backends are never observed genuinely blocked on each other
(which would mean the script degenerated into simulated sequential execution instead
of real concurrency), or if either overload stops carrying the vulnerable pattern the
contract assertion checks for. Numeric comparisons use a scale-tolerant `num_eq`
helper (`awk`-based) rather than exact-string matching, since quantity columns are
`numeric(18,6)` while value/price columns are `numeric(20,4)`/`numeric(12,2)`. A clean
run prints `STOCK_F2_RED_PROOF_PASS` with every scenario's final quantity/value
numbers.

## What this RED proof does not claim

- It does not mutate Production.
- It does not choose a lock/serialization strategy for either race.
- It does not fix RED-A or RED-B.
- It does not claim RED-A and RED-B share a fix, or that fixing one fixes the other —
  RED-A is a `bins` unique-key insert race; RED-B is a `products` row update race with
  no shared lock between them today.
- It does not extend to every stock-mutating RPC in the codebase — only
  `wardah_apply_stock_incoming` and its interaction with
  `wardah_apply_stock_outgoing` were exercised, and only the 9-arg
  `wardah_apply_stock_incoming` overload behaviorally; the 10-arg overload is
  covered by the static contract assertion only, not by a live race.
- It does not close #228.

## FIX PR gate

Do not implement a fix for either RED-A or RED-B in the same PR as this proof. Once
both are reviewed and accepted as confirmed, the remediation approach (one additive
migration covering both, or two scoped fix PRs under #228) is a separate decision, per
the review requirements already recorded on #228.
