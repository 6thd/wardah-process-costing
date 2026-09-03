#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"

PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
# Keep worker evidence separate from the workflow-level tee target
# (/tmp/stock-186-concurrency.out). The cleanup below must never unlink the
# outer evidence file while tee still has it open.
tmp_prefix=/tmp/stock-186-race
org_id='51856186-2000-0000-0000-000000000001'
material_id='51856186-2000-0000-0000-000000000002'
finished_id='51856186-2000-0000-0000-000000000003'
warehouse_id='51856186-2000-0000-0000-000000000004'
bin_id='51856186-2000-0000-0000-000000000005'
user_id='51856186-2000-0000-0000-000000000006'

rm -f "${tmp_prefix}"-*.ready "${tmp_prefix}"-*.out "${tmp_prefix}"-*.err

"${PSQL[@]}" <<SQL
INSERT INTO public.organizations (id, name, code)
VALUES ('$org_id', 'Stock 186 Race', 'STK186-RACE');

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT '$material_id', '$org_id', 'STK186-RACE-MAT', 'Stock 186 Race Material', true, u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT '$finished_id', '$org_id', 'STK186-RACE-FG', 'Stock 186 Race Finished Good', true, u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES ('$warehouse_id', '$org_id', 'STK186-RACE-WH', 'Stock 186 Race Warehouse');

INSERT INTO public.bins (
  id, org_id, product_id, warehouse_id, actual_qty, reserved_qty,
  valuation_rate, stock_value, stock_queue
) VALUES (
  '$bin_id', '$org_id', '$material_id', '$warehouse_id', 10, 0,
  1, 10, '[{"qty":10,"rate":1}]'::jsonb
);

INSERT INTO auth.users (id, email)
VALUES ('$user_id', 'stock186-race@example.test');

INSERT INTO public.user_organizations (user_id, org_id, is_active)
VALUES ('$user_id', '$org_id', true);
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
  echo 'STOCK_186_CONCURRENCY_FAIL: blocker did not become ready' >&2
  exit 1
fi

run_reservation() {
  local suffix=$1
  local output=$2
  local error=$3
  PGAPPNAME="stock-186-$suffix" "${PSQL[@]}" >"$output" 2>"$error" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$user_id', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"$user_id","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT public.rpc_create_mo_with_reservation(
  jsonb_build_object(
    'org_id', '$org_id',
    'order_number', 'STK186-RACE-$suffix',
    'product_id', '$finished_id',
    'quantity', 1
  ),
  jsonb_build_array(jsonb_build_object(
    'item_id', '$material_id',
    'quantity', 6
  )),
  NULL
);
COMMIT;
SQL
}

run_reservation A "${tmp_prefix}-a.out" "${tmp_prefix}-a.err" &
pid_a=$!
run_reservation B "${tmp_prefix}-b.out" "${tmp_prefix}-b.err" &
pid_b=$!

for _ in $(seq 1 100); do
  waiting=$("${PSQL[@]}" <<SQL
SELECT COUNT(*)
FROM pg_stat_activity
WHERE application_name IN ('stock-186-A', 'stock-186-B')
  AND state = 'active'
  AND wait_event_type = 'Lock';
SQL
)
  [[ "$waiting" == '2' ]] && break
  sleep 0.05
done
if [[ "${waiting:-0}" != '2' ]]; then
  echo "STOCK_186_CONCURRENCY_FAIL: expected two callers waiting on the bin lock; got ${waiting:-0}" >&2
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

if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] || [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo "STOCK_186_CONCURRENCY_FAIL: expected exactly one success; statuses=$status_a,$status_b" >&2
  exit 1
fi

if ! grep -q 'INSUFFICIENT_STOCK' "${tmp_prefix}-a.err" "${tmp_prefix}-b.err"; then
  echo 'STOCK_186_CONCURRENCY_FAIL: losing caller did not fail with INSUFFICIENT_STOCK' >&2
  exit 1
fi

final_state=$("${PSQL[@]}" <<SQL
SELECT
  COALESCE(SUM(quantity_reserved), 0)::text || '|' ||
  (SELECT COUNT(*) FROM public.manufacturing_orders
   WHERE org_id = '$org_id' AND order_number IN ('STK186-RACE-A', 'STK186-RACE-B'))::text
FROM public.material_reservations
WHERE org_id = '$org_id' AND product_id = '$material_id' AND status = 'reserved';
SQL
)

if [[ "$final_state" != '6.000000|1' && "$final_state" != '6|1' ]]; then
  echo "STOCK_186_CONCURRENCY_FAIL: expected reserved|orders=6|1; got $final_state" >&2
  exit 1
fi

printf 'STOCK_186_RESERVATION_CONCURRENCY_PASS reserved|orders=%s statuses=%s,%s\n' \
  "$final_state" "$status_a" "$status_b"
