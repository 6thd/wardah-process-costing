#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"

PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
tmp_prefix=/tmp/stock-187-race
org_id='51856187-2000-0000-0000-000000000001'
product_id='51856187-2000-0000-0000-000000000002'
warehouse_id='51856187-2000-0000-0000-000000000003'
bin_id='51856187-2000-0000-0000-000000000004'
adjustment_id='51856187-2000-0000-0000-000000000005'
source_a='51856187-2000-0000-0000-000000000006'
source_b='51856187-2000-0000-0000-000000000007'
actor_id='51856187-2000-0000-0000-000000000008'

rm -f "${tmp_prefix}"-*.ready "${tmp_prefix}"-*.out "${tmp_prefix}"-*.err

"${PSQL[@]}" <<SQL
INSERT INTO public.organizations (id, name, code)
VALUES ('$org_id', 'Stock 187 Race', 'STK187-RACE');

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT '$product_id', '$org_id', 'STK187-RACE-P', 'Stock 187 Race Product', true, u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES ('$warehouse_id', '$org_id', 'STK187-RACE-WH', 'Stock 187 Race Warehouse');

INSERT INTO public.bins (
  id, org_id, product_id, warehouse_id, actual_qty, reserved_qty,
  valuation_rate, stock_value, stock_queue
) VALUES (
  '$bin_id', '$org_id', '$product_id', '$warehouse_id', 10, 0,
  1, 10, '[{"qty":10,"rate":1}]'::jsonb
);

INSERT INTO auth.users (id, email)
VALUES ('$actor_id', 'stock-187-race@wardah-e2e.invalid');

INSERT INTO public.stock_adjustments (
  id, organization_id, org_id, adjustment_number, adjustment_date,
  posting_date, adjustment_type, reason, warehouse_id, status, created_by
) VALUES (
  '$adjustment_id', '$org_id', '$org_id', 'STK187-RACE-ADJ', CURRENT_DATE,
  CURRENT_DATE, 'OTHER', 'Migration 187 race', '$warehouse_id', 'DRAFT', '$actor_id'
);

INSERT INTO public.stock_adjustment_items (
  id, adjustment_id, organization_id, product_id, warehouse_id,
  current_qty, new_qty, difference_qty, current_rate, new_rate, value_difference
) VALUES
  ('$source_a', '$adjustment_id', '$org_id', '$product_id', '$warehouse_id',
   10, 11, 1, 1, 1, 1),
  ('$source_b', '$adjustment_id', '$org_id', '$product_id', '$warehouse_id',
   10, 11, 1, 1, 1, 1);
SQL

blocker_ready="${tmp_prefix}-blocker.ready"
"${PSQL[@]}" >"${tmp_prefix}-blocker.out" 2>"${tmp_prefix}-blocker.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE id = '$bin_id' FOR UPDATE;
\! touch $blocker_ready
SELECT pg_sleep(3);
COMMIT;
SQL
blocker_pid=$!

for _ in $(seq 1 100); do
  [[ -f "$blocker_ready" ]] && break
  sleep 0.05
done
if [[ ! -f "$blocker_ready" ]]; then
  wait "$blocker_pid" || true
  echo 'STOCK_187_CONCURRENCY_FAIL: blocker did not become ready' >&2
  exit 1
fi

run_adjustment() {
  local suffix=$1
  local source_id=$2
  local output=$3
  local error=$4

  PGAPPNAME="stock-187-$suffix" "${PSQL[@]}" >"$output" 2>"$error" <<SQL
BEGIN;
SELECT public.wardah_apply_stock_incoming(
  '$org_id',
  '$product_id',
  '$warehouse_id',
  1,
  1,
  'Stock Adjustment',
  '$adjustment_id',
  'STK187-RACE-ADJ',
  CURRENT_DATE,
  '$source_id'
);
COMMIT;
SQL
}

run_adjustment A "$source_a" "${tmp_prefix}-a.out" "${tmp_prefix}-a.err" &
pid_a=$!
run_adjustment B "$source_b" "${tmp_prefix}-b.out" "${tmp_prefix}-b.err" &
pid_b=$!

waiting=0
for _ in $(seq 1 100); do
  waiting=$("${PSQL[@]}" <<SQL
SELECT count(*)
FROM pg_stat_activity
WHERE application_name IN ('stock-187-A', 'stock-187-B')
  AND state = 'active'
  AND wait_event_type = 'Lock';
SQL
)
  [[ "$waiting" == '2' ]] && break
  sleep 0.05
done
if [[ "$waiting" != '2' ]]; then
  echo "STOCK_187_CONCURRENCY_FAIL: expected two callers waiting on the bin lock; got $waiting" >&2
  wait "$pid_a" || true
  wait "$pid_b" || true
  wait "$blocker_pid" || true
  exit 1
fi

status_a=0
status_b=0
wait "$pid_a" || status_a=$?
wait "$pid_b" || status_b=$?
wait "$blocker_pid"

if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] \
   || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo "STOCK_187_CONCURRENCY_FAIL: expected exactly one success; statuses=$status_a,$status_b" >&2
  exit 1
fi

if ! grep -q 'uq_sle_stock_adjustment_voucher_product_warehouse_v187' \
  "${tmp_prefix}-a.err" "${tmp_prefix}-b.err"; then
  echo 'STOCK_187_CONCURRENCY_FAIL: loser did not hit the unique stock-adjustment boundary' >&2
  exit 1
fi

final_state=$("${PSQL[@]}" <<SQL
SELECT
  b.actual_qty::text || '|' ||
  count(sle.id)::text || '|' ||
  count(DISTINCT sle.source_line_id)::text
FROM public.bins b
LEFT JOIN public.stock_ledger_entries sle
  ON sle.org_id = b.org_id
 AND sle.product_id = b.product_id
 AND sle.warehouse_id = b.warehouse_id
 AND sle.voucher_type = 'Stock Adjustment'
 AND sle.voucher_id = '$adjustment_id'
WHERE b.id = '$bin_id'
GROUP BY b.actual_qty;
SQL
)

if [[ "$final_state" != '11.000000|1|1' && "$final_state" != '11|1|1' ]]; then
  echo "STOCK_187_CONCURRENCY_FAIL: expected bin|rows|sources=11|1|1; got $final_state" >&2
  exit 1
fi

printf 'STOCK_187_CONCURRENCY_PASS bin|rows|sources=%s statuses=%s,%s\n' \
  "$final_state" "$status_a" "$status_b"
