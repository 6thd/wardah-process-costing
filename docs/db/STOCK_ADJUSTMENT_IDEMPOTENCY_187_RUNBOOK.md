# Migration 187 — Prospective Stock Adjustment Ledger Idempotency

## Status and authority boundary

Migration 187 was merged through PR #216 at `e2b6a075` and applied to
Production as `20260903202341 / 187_stock_adjustment_ledger_idempotency`.
Baseline cutoff 187 was then published through PR #217 at `3917231b`. This
runbook records those completed decisions; it does not authorize historical
data repair or any later Production change.

The migration is additive and transactional. It creates one partial unique
index, one source/identity guard, two source-aware helper overloads, and replaces the
existing stock-adjustment submission RPC so it passes the legal source line.
It does not delete, rewrite, or backfill any ledger row.

## Corrected invariant

The discovery record originally described INV-02 as a missing global unique
constraint on:

```text
(voucher_type, voucher_id, product_id, warehouse_id)
```

That is not a legal invariant for every voucher type:

- one Goods Receipt can have distinct source lines for the same product and
  warehouse;
- one Delivery Note can likewise carry distinct legal lines;
- manufacturing consumption may be posted in valid partial operations.

Stock Adjustments have a narrower contract. The live
`rpc_submit_stock_adjustment` already rejects duplicate
`(product_id,effective_warehouse_id)` items within one adjustment. Migration
187 therefore enforces one prospective Stock Adjustment movement per:

```text
(org_id, voucher_id, product_id, warehouse_id)
```

The index applies only when `source_line_id IS NOT NULL` and the normalized
voucher type is `stock adjustment`. The source-aware helper verifies that the
source is the matching `stock_adjustment_items.id`, belongs to the voucher and
organization, and resolves to the same product and warehouse.

## Production discovery snapshot

A read-only Production audit on 2026-09-03 established the pre-migration
state. It made no writes:

- the migration ledger ended at 186 (`20260903083010`);
- `stock_ledger_entries` contained five rows;
- all five rows had `source_line_id IS NULL`;
- one historical duplicate group existed for `ADJ-000001` / Stock Adjustment;
- the two entry IDs were
  `e9812b2e-6215-47c7-adab-8aa89c38945a` and
  `fc7257f0-a7ef-4f45-87fa-0f40f2ae7d91`;
- no unique voucher/product/warehouse index existed.

Those rows have unknown source provenance. Migration 187 deliberately leaves
them outside the partial index and keeps UPDATE possible so the legal
cancellation path is not disabled. It does not guess which row is canonical.

## Repository changes

`sql/migrations/187_stock_adjustment_ledger_idempotency.sql`:

1. refuses to run if the required tables, column, or live functions are absent;
2. refuses unexpected pre-existing v187 objects or duplicate source-aware rows;
3. creates
   `uq_sle_stock_adjustment_voucher_product_warehouse_v187`;
4. adds a trigger that rejects a new Stock Adjustment movement without a valid
   source relation and guards later identity/source changes, while allowing
   provenance-neutral updates to historical NULL-source rows;
5. adds source-aware incoming/outgoing overloads while preserving the complete
   live valuation, reservation-floor, bin, and product-projection behavior;
6. passes `stock_adjustment_items.id` from
   `rpc_submit_stock_adjustment(uuid)`;
7. pins `search_path` and keeps the new internal overloads executable only by
   `service_role`; and
8. verifies the index, trigger, overloads, ACLs, and RPC propagation before
   commit.

The historical helper signatures remain present because other legal voucher
families depend on them. The trigger makes the old incoming helper fail closed
if a future caller tries to write a Stock Adjustment without a source line.
The outgoing helper already fails before inserting when the same misuse occurs.

## Acceptance evidence

The dedicated PostgreSQL 17 workflow reconstructs cutoff 186, seeds the known
historical shape, and runs all directions below:

| Direction | Required proof |
|---|---|
| Red | v187 objects are absent and two identical pre-187 Stock Adjustment helper calls create two ledger rows |
| Upgrade | Migration 187 applies successfully while the historical NULL-source duplicate exists |
| History | the two historical rows remain present and updateable |
| Fail closed | a new Stock Adjustment through the old helper raises `STOCK_SOURCE_LINE_REQUIRED` |
| Source identity | a source line from the wrong voucher is rejected by both the helper and the table boundary with `STOCK_SOURCE_LINE_MISMATCH` before stock mutation |
| Compatibility | two Goods Receipt lines with the same voucher/product/warehouse remain legal |
| RPC replay | submit writes one source-aware movement; exact replay creates no second row |
| Unique boundary | a second matching source item reaches the named unique index and rolls back bin mutation |
| Race | two callers are observed waiting on the same bin lock; exactly one commits and the final state is `11|1|1` |

The race is deterministic rather than two merely backgrounded calls: a blocker
transaction holds the bin row, the script polls `pg_stat_activity` until both
callers are waiting on a lock, and only then releases contention.

## Executed pre-Production review

Before the separately authorized Production apply, the reviewed process:

1. merged only the exact reviewed PR head;
2. required the full Fresh DB chain and the dedicated v187 acceptance workflow;
3. re-ran the read-only duplicate and source-line audit;
4. confirmed the migration ledger still ended at 186;
5. confirmed no non-NULL-source duplicate would violate the partial index;
6. recorded row counts, stock quantity/value totals, and the known historical IDs;
7. confirmed `rpc_submit_stock_adjustment` and both historical helpers matched
   their reviewed definitions; and
8. used the repository-first Production workflow, not an ad-hoc dashboard edit.

## Production postflight evidence

The separately authorized apply and its read-only postflight proved:

- Migration 187 is present exactly once as `20260903202341`;
- `uq_sle_stock_adjustment_voucher_product_warehouse_v187` is valid and ready;
- `trg_sle_stock_adjustment_source_line_v187` is enabled for INSERT and updates
  to the identity/source columns;
- both source-aware overloads exist and are executable only by `service_role`
  (besides the owner);
- `rpc_submit_stock_adjustment(uuid)` contains `v_item.id` propagation and
  remains executable by `authenticated` and `service_role`, not `PUBLIC`/`anon`;
- all five historical SLE rows and the two known duplicate IDs are unchanged;
- the preserved totals are quantity `1400` and value difference `14250`;
- zero non-NULL-source Stock Adjustment duplicate groups exist;
- the one historical NULL-source duplicate group remains outside the prospective
  index by design; and
- no unexpected Supabase security or performance advisor regression appeared.

A read-only recheck on 2026-09-04 reconfirmed the ledger entry, index, trigger,
ACLs, RPC propagation, five-row history, both known IDs, zero source-aware rows,
zero source-aware duplicate groups, and the single historical NULL-source group.

## Recovery

Do not edit Migration 187 after application and do not delete historical rows to
make the index appear clean. If a repository defect is found before Production,
fix the PR normally. If a defect is found after Production, use a new numbered,
forward-only migration. Historical duplicate remediation remains a separate
data decision requiring an authoritative source and explicit authorization.
