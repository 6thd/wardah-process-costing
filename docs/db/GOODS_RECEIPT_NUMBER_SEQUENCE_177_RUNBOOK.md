# Migration 177 — Goods Receipt Number Sequence Runbook

## Status

- Repository state: proposed by the Issue #45 Production UI Pilot.
- Production state: **not applied until this database PR is merged to `main`**.
- Dependency: Migration 148 contract and all migrations through 175.
- Migration 176 remains reserved for the RBAC direct-write closure documented in
  `CLAUDE.md`; 177 does not reuse that number.

## Incident

The Issue #45 UI Pilot successfully created the first partial goods receipt and
proved the UoM snapshot conversion, inventory posting, GRNI balance, purchase
order state, and idempotent replay.

The next distinct receipt attempt failed before the over-receipt business gate
with a unique violation on `goods_receipts.receipt_number`. Production contains
historical timestamp-shaped `GR-<digits>` values. Migration 148 selected the
maximum textual digit string, added one, then called `lpad(value, 6, '0')`.
PostgreSQL truncates inputs longer than the requested `lpad` width, so the
allocator repeatedly returned the same six-character prefix.

The failed statement rolled back atomically: no extra receipt header, line,
stock ledger entry, bin quantity, purchase-order quantity, or GRNI entry was
created.

## Fix contract

Migration 177 preserves the Migration 148 function body except for receipt
number allocation:

1. Create a global bigint sequence because the receipt-number unique constraint
   is global.
2. Seed it from existing canonical six-digit `GR-` numbers.
3. Ignore historical 13-digit timestamp-shaped values during seeding.
4. Keep six-digit zero padding below one million and never truncate larger
   sequence values.
5. Hold a receipt-table writer lock for the transactional seed-and-function
   swap, then retry receipt-number-only unique collisions to cover an old RPC
   invocation that began before the lock was acquired.
6. Keep sequence access unavailable to `PUBLIC`, `anon`, and
   `authenticated`; only the guarded `SECURITY DEFINER` receipt RPC consumes
   it.
7. Preserve membership, organization isolation, approval gates, immutable UoM
   snapshots, quality-aware quantities, atomic stock/GRNI, request hashing, and
   idempotent replay exactly as in Migration 148.

Sequence gaps after a rolled-back receipt are acceptable and expected. Legal
document identity must be unique and concurrency-safe; gaplessness is not part
of the contract.

## Repository-first deployment

Do not apply this SQL directly from the PR branch.

1. Review and merge the database-only PR to `main`.
2. Confirm all migration governance, Fresh DB, and UoM acceptance checks are
   green.
3. Apply `177_goods_receipt_number_sequence` to Production using the exact
   merged file and exact stem as the migration name.
4. Verify the migration ledger contains the legal name exactly once.
5. Run the postflight checks below.
6. Resume the remaining Issue #45 Pilot checks only after postflight is clean.

## Preflight (read-only)

```sql
select
  count(*) filter (where receipt_number ~ '^GR-[0-9]{6}$') as canonical_six_digit,
  count(*) filter (where receipt_number ~ '^GR-[0-9]{13}$') as legacy_timestamp_shape,
  count(*) - count(distinct receipt_number) as duplicate_numbers
from public.goods_receipts;

select
  to_regprocedure('public.rpc_post_goods_receipt(jsonb)') is not null as receipt_rpc_exists,
  has_function_privilege('anon', 'public.rpc_post_goods_receipt(jsonb)', 'EXECUTE') as anon_exec,
  has_function_privilege('authenticated', 'public.rpc_post_goods_receipt(jsonb)', 'EXECUTE') as auth_exec;
```

Expected:

- no existing duplicate receipt numbers;
- receipt RPC exists;
- `anon_exec = false`;
- `auth_exec = true`.

## Postflight (read-only)

```sql
select
  to_regclass('public.goods_receipt_number_seq') is not null as sequence_exists,
  has_sequence_privilege('anon', 'public.goods_receipt_number_seq', 'USAGE') as anon_usage,
  has_sequence_privilege('authenticated', 'public.goods_receipt_number_seq', 'USAGE') as auth_usage;

select
  version,
  name
from supabase_migrations.schema_migrations
where name = '177_goods_receipt_number_sequence';

select pg_get_functiondef('public.rpc_post_goods_receipt(jsonb)'::regprocedure);
```

Expected:

- sequence exists;
- `anon_usage = false` and `auth_usage = false`;
- exactly one legal ledger row;
- the function uses `nextval('public.goods_receipt_number_seq')`;
- all Migration 148 guards and replay-before-business-gates behavior remain.

## Acceptance continuation

After application:

1. Retry the deliberately excessive receipt payload with a fresh idempotency
   key. It must reach and return `OVER_RECEIPT`, not a unique violation.
2. Confirm counts and quantities remain unchanged after rejection.
3. Optionally post the exact remaining accepted quantity through the UI to prove
   the final transition to `fully_received`.
4. Confirm the new receipt number differs from every prior receipt number.
5. Confirm stock, bin, purchase-order accepted quantity, and GRNI each changed
   exactly once.
6. Replay the final payload with the same idempotency key and confirm no
   duplicates.

## Rollback policy

Do not delete or renumber historical goods receipts and do not lower the
sequence. If a regression is found, ship an additive corrective migration that
`CREATE OR REPLACE`s the RPC while retaining the sequence and all legal
history. Existing receipt numbers remain immutable.
