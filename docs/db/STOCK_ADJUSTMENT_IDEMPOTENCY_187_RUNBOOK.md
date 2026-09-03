# Migration 187 — Prospective Stock Adjustment Ledger Idempotency

## Status and authority boundary

Migration 187 is a repository proposal. It is not merged and has not been
applied to Production. This runbook does not authorize a merge, a Production
migration, or historical data repair. Each requires its own explicit decision.

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

## Pre-Production review

Before any separately authorized Production apply:

1. merge only the exact reviewed PR head;
2. require the full Fresh DB chain and the dedicated v187 acceptance workflow;
3. re-run the read-only duplicate and source-line audit;
4. confirm the migration ledger still ends at 186;
5. confirm no non-NULL-source duplicate would violate the partial index;
6. record row counts, stock quantity/value totals, and the known historical IDs;
7. confirm `rpc_submit_stock_adjustment` and both historical helpers still match
   their reviewed definitions; and
8. use the repository-first Production workflow, not an ad-hoc dashboard edit.

## Postflight after a separately authorized apply

Record raw query output proving:

- Migration 187 is present exactly once in the ledger;
- the partial unique index is valid and ready;
- the trigger is enabled for INSERT and identity/source-column UPDATE events;
- the source-aware overloads exist with the reviewed ACLs;
- the submission RPC contains `v_item.id` propagation;
- the five historical rows and the two known duplicate IDs are unchanged;
- stock row counts and quantity/value totals are unchanged by migration apply;
- no non-NULL-source Stock Adjustment duplicate exists; and
- no unexpected Supabase security or performance advisor regression appeared.

## Recovery

Do not edit Migration 187 after application and do not delete historical rows to
make the index appear clean. If a repository defect is found before Production,
fix the PR normally. If a defect is found after Production, use a new numbered,
forward-only migration. Historical duplicate remediation remains a separate
data decision requiring an authoritative source and explicit authorization.
