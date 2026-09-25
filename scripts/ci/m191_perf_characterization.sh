#!/usr/bin/env bash
# M191 pre-Production performance characterization.
# Disposable PostgreSQL only. Never connects to Production or Staging.
set -Eeuo pipefail

DB=${1:?database name required}
LABEL=${2:?label required}
OUT_ROOT=${3:?output directory required}

CONCURRENCY=${M191_PERF_CONCURRENCY:-4}
ITERATIONS=${M191_PERF_ITERATIONS:-30}
WARMUP=${M191_PERF_WARMUP:-5}
SAMPLE_INTERVAL=${M191_PERF_SAMPLE_INTERVAL:-0.02}

export PGDATABASE="$DB"
export SCRATCH="docs/db/m191-evidence/harness"
PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
OUT="$OUT_ROOT/$LABEL"
mkdir -p "$OUT"
CURRENT_SCENARIO="m191-perf-$LABEL"

fail() { echo "M191_PERF_FAIL[$LABEL]: $*" >&2; exit 1; }

CALLS_PER_WORKER=$((WARMUP + ITERATIONS))
TOTAL_CALLS=$((CONCURRENCY * CALLS_PER_WORKER))

declare -A SNAP_PRODUCT_QTY=()
declare -A SNAP_BIN_QTY=()
declare -A SNAP_BIN_VALUE=()
declare -A SNAP_QUEUE_QTY=()
declare -A SNAP_QUEUE_VALUE=()
declare -A SNAP_SLE_ROWS=()
declare -A SNAP_SLE_QTY=()
declare -A SNAP_SLE_VALUE=()

num_sub() {
  awk -v a="$1" -v b="$2" 'BEGIN { printf "%.12g", a-b }'
}

product_effect_state() {
  local org_id=$1 product_id=$2
  "${PSQL[@]}" -F '|' -c "
WITH
b AS (
  SELECT COALESCE(SUM(actual_qty),0)::numeric AS qty,
         COALESCE(SUM(stock_value),0)::numeric AS value,
         COUNT(*) FILTER (WHERE actual_qty < 0)::integer AS negatives
  FROM public.bins
  WHERE org_id='$org_id' AND product_id='$product_id'
),
q AS (
  SELECT COALESCE(SUM((layer->>'qty')::numeric),0)::numeric AS qty,
         COALESCE(SUM((layer->>'qty')::numeric * (layer->>'rate')::numeric),0)::numeric AS value
  FROM public.bins bin
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bin.stock_queue,'[]'::jsonb)) AS layer
  WHERE bin.org_id='$org_id' AND bin.product_id='$product_id'
),
s AS (
  SELECT COUNT(*)::integer AS rows,
         COALESCE(SUM(actual_qty),0)::numeric AS qty,
         COALESCE(SUM(stock_value_difference),0)::numeric AS value
  FROM public.stock_ledger_entries
  WHERE org_id='$org_id' AND product_id='$product_id'
)
SELECT
  COALESCE((SELECT stock_quantity FROM public.products WHERE id='$product_id' AND org_id='$org_id'),0),
  b.qty,b.value,q.qty,q.value,s.rows,s.qty,s.value,b.negatives
FROM b,q,s;"
}

capture_product_effect() {
  local key=$1 org_id=$2 product_id=$3
  local pq bq bv qq qv sr sq sv neg
  IFS='|' read -r pq bq bv qq qv sr sq sv neg <<<"$(product_effect_state "$org_id" "$product_id")"
  [[ "$neg" == "0" ]] || fail "$key: negative stock exists before workload"
  SNAP_PRODUCT_QTY["$key"]=$pq
  SNAP_BIN_QTY["$key"]=$bq
  SNAP_BIN_VALUE["$key"]=$bv
  SNAP_QUEUE_QTY["$key"]=$qq
  SNAP_QUEUE_VALUE["$key"]=$qv
  SNAP_SLE_ROWS["$key"]=$sr
  SNAP_SLE_QTY["$key"]=$sq
  SNAP_SLE_VALUE["$key"]=$sv
}

assert_product_effect() {
  local key=$1 scenario=$2 org_id=$3 product_id=$4 expected_qty=$5 expected_value=$6 expected_rows=$7 allow_projection_gap=${8:-0}
  local pq bq bv qq qv sr sq sv neg
  local d_product d_bq d_bv d_qq d_qv d_sr d_sq d_sv projection_gap

  IFS='|' read -r pq bq bv qq qv sr sq sv neg <<<"$(product_effect_state "$org_id" "$product_id")"
  [[ "$neg" == "0" ]] || fail "$scenario: negative stock exists after workload"

  d_product=$(num_sub "$pq" "${SNAP_PRODUCT_QTY[$key]}")
  d_bq=$(num_sub "$bq" "${SNAP_BIN_QTY[$key]}")
  d_bv=$(num_sub "$bv" "${SNAP_BIN_VALUE[$key]}")
  d_qq=$(num_sub "$qq" "${SNAP_QUEUE_QTY[$key]}")
  d_qv=$(num_sub "$qv" "${SNAP_QUEUE_VALUE[$key]}")
  d_sr=$(num_sub "$sr" "${SNAP_SLE_ROWS[$key]}")
  d_sq=$(num_sub "$sq" "${SNAP_SLE_QTY[$key]}")
  d_sv=$(num_sub "$sv" "${SNAP_SLE_VALUE[$key]}")

  num_eq "$d_bq" "$expected_qty" || fail "$scenario: bin qty delta=$d_bq expected=$expected_qty"
  num_eq "$d_bv" "$expected_value" || fail "$scenario: bin value delta=$d_bv expected=$expected_value"
  num_eq "$d_qq" "$expected_qty" || fail "$scenario: queue qty delta=$d_qq expected=$expected_qty"
  num_eq "$d_qv" "$expected_value" || fail "$scenario: queue value delta=$d_qv expected=$expected_value"
  num_eq "$d_sr" "$expected_rows" || fail "$scenario: SLE row delta=$d_sr expected=$expected_rows"
  num_eq "$d_sq" "$expected_qty" || fail "$scenario: SLE qty delta=$d_sq expected=$expected_qty"
  num_eq "$d_sv" "$expected_value" || fail "$scenario: SLE value delta=$d_sv expected=$expected_value"

  num_eq "$qq" "$bq" || fail "$scenario: queue qty=$qq <> bin qty=$bq"
  num_eq "$qv" "$bv" || fail "$scenario: queue value=$qv <> bin value=$bv"

  if [[ "$allow_projection_gap" == "1" ]]; then
    awk -v d="$d_product" -v e="$expected_qty" 'BEGIN { exit !(d >= 0 && d <= e) }' \
      || fail "$scenario: pre191 projection delta=$d_product outside [0,$expected_qty]"
    projection_gap=$(num_sub "$bq" "$pq")
    printf 'label=%s product_stock_quantity=%s sum_bins=%s projection_gap=%s\n' \
      "$LABEL" "$pq" "$bq" "$projection_gap" \
      | tee "$OUT/$scenario/pre191_known_red_projection_gap.txt"
  else
    num_eq "$d_product" "$expected_qty" || fail "$scenario: product qty delta=$d_product expected=$expected_qty"
    num_eq "$pq" "$bq" || fail "$scenario: product qty=$pq <> sum bins=$bq"
  fi

  echo "M191_PERF_EFFECT_OK scenario=$scenario qty=$d_bq value=$d_bv sle_rows=$d_sr sle_qty=$d_sq sle_value=$d_sv"
}

record_fixture_size() {
  local workload=$1 org_id=$2 product_csv=$3
  local dir="$OUT/$workload"
  mkdir -p "$dir"
  "${PSQL[@]}" -c "
SELECT 'org_products='||COUNT(*) FROM public.products WHERE org_id='$org_id';
SELECT 'org_bins='||COUNT(*) FROM public.bins WHERE org_id='$org_id';
SELECT 'target_products='||COUNT(*) FROM public.products
 WHERE org_id='$org_id' AND id = ANY(string_to_array('$product_csv',',')::uuid[]);
SELECT 'target_bins='||COUNT(*) FROM public.bins
 WHERE org_id='$org_id' AND product_id = ANY(string_to_array('$product_csv',',')::uuid[]);
SELECT 'org_reservations='||COUNT(*) FROM public.material_reservations WHERE org_id='$org_id';
SELECT 'target_reservations='||COUNT(*) FROM public.material_reservations
 WHERE org_id='$org_id' AND product_id = ANY(string_to_array('$product_csv',',')::uuid[]);
SELECT 'org_sle_rows='||COUNT(*) FROM public.stock_ledger_entries WHERE org_id='$org_id';
SELECT 'target_sle_rows='||COUNT(*) FROM public.stock_ledger_entries
 WHERE org_id='$org_id' AND product_id = ANY(string_to_array('$product_csv',',')::uuid[]);
" >"$dir/fixture_size.env"
  grep -q '^org_products=' "$dir/fixture_size.env" || fail "$workload: fixture size capture failed"
}


run_workload() {
  local name=$1 auth_user=$2 callback=$3 lock_scope=$4
  local dir="$OUT/$name"
  mkdir -p "$dir"
  local w q f pid failed sampler_pid start_ns end_ns wall_s ops
  local -a pids=()

  # Warm-up: same clients/query shape, excluded from metrics.
  for w in $(seq 1 "$CONCURRENCY"); do
    f="$dir/warmup.worker$w.sql"
    {
      echo '\set ON_ERROR_STOP on'
      echo '\pset tuples_only on'
      echo '\pset format unaligned'
      echo "SET statement_timeout='30s';"
      echo "SELECT set_config('request.jwt.claim.sub','$auth_user',false);"
      echo "SELECT set_config('request.jwt.claims','{\"sub\":\"$auth_user\",\"role\":\"authenticated\"}',false);"
      echo '\timing off'
      q="$($callback "$w")"
      for _ in $(seq 1 "$WARMUP"); do printf '%s\n' "$q"; done
    } > "$f"
    PGAPPNAME="m191perf-$LABEL-$name-w$w" "${PSQL[@]}" -f "$f" \
      >"$dir/warmup.worker$w.log" 2>&1 &
    pids+=("$!")
  done
  failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then failed=1; fi
  done
  if [[ "$failed" -ne 0 ]]; then
    tail -100 "$dir"/warmup.worker*.log >&2 || true
    fail "$name warm-up failed"
  fi

  for w in $(seq 1 "$CONCURRENCY"); do
    f="$dir/measured.worker$w.sql"
    {
      echo '\set ON_ERROR_STOP on'
      echo '\pset tuples_only on'
      echo '\pset format unaligned'
      echo "SET statement_timeout='30s';"
      echo "SELECT set_config('request.jwt.claim.sub','$auth_user',false);"
      echo "SELECT set_config('request.jwt.claims','{\"sub\":\"$auth_user\",\"role\":\"authenticated\"}',false);"
      echo '\timing on'
      q="$($callback "$w")"
      for _ in $(seq 1 "$ITERATIONS"); do printf '%s\n' "$q"; done
    } > "$f"
  done

  # Real Lock-wait samples from benchmark backends. For hot-multiwarehouse
  # workers share the product but not a bin, making it the product-row /
  # product-projection contention proxy.
  cat >"$dir/sampler.sql" <<SQL
\pset tuples_only on
\pset format unaligned
SELECT
  extract(epoch FROM clock_timestamp())::numeric(20,6) || E'\t' ||
  application_name || E'\t' || pid::text || E'\t' ||
  coalesce(wait_event,'') || E'\t' ||
  coalesce(array_to_string(pg_blocking_pids(pid),','),'')
FROM pg_stat_activity
WHERE application_name LIKE 'm191perf-$LABEL-$name-%'
  AND state='active'
  AND wait_event_type='Lock';
\watch $SAMPLE_INTERVAL
SQL
  PGAPPNAME="m191perf-$LABEL-$name-sampler" "${PSQL[@]}" \
    -f "$dir/sampler.sql" >"$dir/locks.tsv" 2>"$dir/locks.err" &
  sampler_pid=$!

  start_ns=$(date +%s%N)
  pids=()
  for w in $(seq 1 "$CONCURRENCY"); do
    PGAPPNAME="m191perf-$LABEL-$name-w$w" "${PSQL[@]}" \
      -f "$dir/measured.worker$w.sql" >"$dir/measured.worker$w.log" 2>&1 &
    pids+=("$!")
  done

  failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then failed=1; fi
  done
  end_ns=$(date +%s%N)
  kill "$sampler_pid" 2>/dev/null || true
  wait "$sampler_pid" 2>/dev/null || true

  if [[ "$failed" -ne 0 ]]; then
    tail -100 "$dir"/measured.worker*.log >&2 || true
    fail "$name measured workers failed"
  fi
  if grep -qiE '40P01|deadlock detected' "$dir"/measured.worker*.log; then
    fail "$name observed a deadlock"
  fi

  wall_s=$(awk -v a="$start_ns" -v b="$end_ns" 'BEGIN { printf "%.6f", (b-a)/1000000000 }')
  ops=$((CONCURRENCY * ITERATIONS))
  cat >"$dir/meta.env" <<META
workload=$name
label=$LABEL
database=$DB
concurrency=$CONCURRENCY
iterations_per_worker=$ITERATIONS
warmup_per_worker=$WARMUP
operations=$ops
wall_seconds=$wall_s
sample_interval_seconds=$SAMPLE_INTERVAL
lock_scope=$lock_scope
META
  echo "M191_PERF_WORKLOAD_COMPLETE label=$LABEL workload=$name ops=$ops wall_s=$wall_s"
}

# ---- core stock/manual fixture ------------------------------------------------
# shellcheck source=/dev/null
source "$SCRATCH/s7_fixture.sh"
S7_ORG=$org; S7_ADMIN=$admin; S7_P1=$P1; S7_P2=$P2; S7_W=$W
S7_MULTI_W=(
  "$S7_W"
  "00002294-0000-0000-0000-0000000000c2"
  "00002294-0000-0000-0000-0000000000c3"
  "00002294-0000-0000-0000-0000000000c4"
)
S7_DIST_P=(
  "00002294-0000-0000-0000-0000000000d1"
  "00002294-0000-0000-0000-0000000000d2"
  "00002294-0000-0000-0000-0000000000d3"
  "00002294-0000-0000-0000-0000000000d4"
)
S7_DIST_W=(
  "00002294-0000-0000-0000-0000000000e1"
  "00002294-0000-0000-0000-0000000000e2"
  "00002294-0000-0000-0000-0000000000e3"
  "00002294-0000-0000-0000-0000000000e4"
)

"${PSQL[@]}" <<SQL
UPDATE public.bins
SET actual_qty=100000,reserved_qty=0,valuation_rate=10,stock_value=1000000,
    stock_queue='[{"qty":100000,"rate":10}]'::jsonb
WHERE org_id='$S7_ORG';

INSERT INTO public.warehouses(id,org_id,code,name) VALUES
 ('${S7_MULTI_W[1]}','$S7_ORG','PERF-MW2','Perf Multi WH2'),
 ('${S7_MULTI_W[2]}','$S7_ORG','PERF-MW3','Perf Multi WH3'),
 ('${S7_MULTI_W[3]}','$S7_ORG','PERF-MW4','Perf Multi WH4');
INSERT INTO public.bins(id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue) VALUES
 ('00002294-0000-0000-0000-0000000001c2','$S7_ORG','$S7_P2','${S7_MULTI_W[1]}',100000,0,10,1000000,'[{"qty":100000,"rate":10}]'),
 ('00002294-0000-0000-0000-0000000001c3','$S7_ORG','$S7_P2','${S7_MULTI_W[2]}',100000,0,10,1000000,'[{"qty":100000,"rate":10}]'),
 ('00002294-0000-0000-0000-0000000001c4','$S7_ORG','$S7_P2','${S7_MULTI_W[3]}',100000,0,10,1000000,'[{"qty":100000,"rate":10}]');

INSERT INTO public.products(id,org_id,code,name,is_stockable,base_uom_id,cost_price)
SELECT p.id,'$S7_ORG',p.code,p.name,true,u.id,10
FROM (VALUES
 ('${S7_DIST_P[0]}'::uuid,'PERF-D1','Perf Distinct 1'),
 ('${S7_DIST_P[1]}'::uuid,'PERF-D2','Perf Distinct 2'),
 ('${S7_DIST_P[2]}'::uuid,'PERF-D3','Perf Distinct 3'),
 ('${S7_DIST_P[3]}'::uuid,'PERF-D4','Perf Distinct 4')
) p(id,code,name)
CROSS JOIN LATERAL (
 SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1
) u;
INSERT INTO public.warehouses(id,org_id,code,name) VALUES
 ('${S7_DIST_W[0]}','$S7_ORG','PERF-DW1','Perf Distinct WH1'),
 ('${S7_DIST_W[1]}','$S7_ORG','PERF-DW2','Perf Distinct WH2'),
 ('${S7_DIST_W[2]}','$S7_ORG','PERF-DW3','Perf Distinct WH3'),
 ('${S7_DIST_W[3]}','$S7_ORG','PERF-DW4','Perf Distinct WH4');
INSERT INTO public.bins(id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue)
SELECT gen_random_uuid(),'$S7_ORG',pp.p,ww.w,100000,0,10,1000000,'[{"qty":100000,"rate":10}]'::jsonb
FROM unnest(ARRAY[
 '${S7_DIST_P[0]}'::uuid,'${S7_DIST_P[1]}'::uuid,'${S7_DIST_P[2]}'::uuid,'${S7_DIST_P[3]}'::uuid
]) WITH ORDINALITY pp(p,n)
JOIN unnest(ARRAY[
 '${S7_DIST_W[0]}'::uuid,'${S7_DIST_W[1]}'::uuid,'${S7_DIST_W[2]}'::uuid,'${S7_DIST_W[3]}'::uuid
]) WITH ORDINALITY ww(w,n) USING(n);

UPDATE public.products p
SET stock_quantity=b.q,stock_value=b.v,cost_price=CASE WHEN b.q<>0 THEN b.v/b.q ELSE p.cost_price END
FROM (
 SELECT product_id,SUM(actual_qty) q,SUM(stock_value) v
 FROM public.bins WHERE org_id='$S7_ORG' GROUP BY product_id
) b
WHERE p.id=b.product_id;
SQL

q_core_hot_same() {
  printf "SELECT public.wardah_apply_stock_incoming('%s','%s','%s',1,10,'Goods Receipt',gen_random_uuid(),'PERF-'||gen_random_uuid()::text,CURRENT_DATE);" "$S7_ORG" "$S7_P1" "$S7_W"
}
q_core_hot_multi() {
  local idx=$(( $1 - 1 ))
  printf "SELECT public.wardah_apply_stock_incoming('%s','%s','%s',1,10,'Goods Receipt',gen_random_uuid(),'PERF-'||gen_random_uuid()::text,CURRENT_DATE);" "$S7_ORG" "$S7_P2" "${S7_MULTI_W[$idx]}"
}
q_core_distinct() {
  local idx=$(( $1 - 1 ))
  printf "SELECT public.wardah_apply_stock_incoming('%s','%s','%s',1,10,'Goods Receipt',gen_random_uuid(),'PERF-'||gen_random_uuid()::text,CURRENT_DATE);" "$S7_ORG" "${S7_DIST_P[$idx]}" "${S7_DIST_W[$idx]}"
}
q_outgoing() {
  printf "SELECT public.wardah_apply_stock_outgoing('%s','%s','%s',1,'Delivery Note',gen_random_uuid(),'PERF-'||gen_random_uuid()::text,CURRENT_DATE);" "$S7_ORG" "$S7_P1" "$S7_W"
}
q_manual() {
  printf "SELECT public.rpc_manual_stock_movement_v2(jsonb_build_object('product_id','%s','warehouse_id','%s','movement_type','in','quantity',1,'unit_cost_entered',10));" "$S7_P1" "$S7_W"
}

record_fixture_size core_hot_same_warehouse "$S7_ORG" "$S7_P1"
capture_product_effect s7-hot-same "$S7_ORG" "$S7_P1"
run_workload core_hot_same_warehouse "$S7_ADMIN" q_core_hot_same all_lock_waits
assert_product_effect s7-hot-same core_hot_same_warehouse "$S7_ORG" "$S7_P1" "$TOTAL_CALLS" "$((TOTAL_CALLS * 10))" "$TOTAL_CALLS"

record_fixture_size core_hot_multiwarehouse "$S7_ORG" "$S7_P2"
capture_product_effect s7-hot-multi "$S7_ORG" "$S7_P2"
run_workload core_hot_multiwarehouse "$S7_ADMIN" q_core_hot_multi product_row_proxy_no_shared_bin
if [[ "$LABEL" == "pre191" ]]; then allow_projection_gap=1; else allow_projection_gap=0; fi
assert_product_effect s7-hot-multi core_hot_multiwarehouse "$S7_ORG" "$S7_P2" "$TOTAL_CALLS" "$((TOTAL_CALLS * 10))" "$TOTAL_CALLS" "$allow_projection_gap"

dist_csv=$(IFS=,; echo "${S7_DIST_P[*]}")
record_fixture_size core_distinct_sku "$S7_ORG" "$dist_csv"
for idx in "${!S7_DIST_P[@]}"; do
  capture_product_effect "s7-dist-$idx" "$S7_ORG" "${S7_DIST_P[$idx]}"
done
run_workload core_distinct_sku "$S7_ADMIN" q_core_distinct parallelism_control
for idx in "${!S7_DIST_P[@]}"; do
  assert_product_effect "s7-dist-$idx" "core_distinct_sku_w$((idx + 1))" "$S7_ORG" "${S7_DIST_P[$idx]}" "$CALLS_PER_WORKER" "$((CALLS_PER_WORKER * 10))" "$CALLS_PER_WORKER"
done

record_fixture_size outgoing_hot_same_warehouse "$S7_ORG" "$S7_P1"
capture_product_effect s7-outgoing "$S7_ORG" "$S7_P1"
run_workload outgoing_hot_same_warehouse "$S7_ADMIN" q_outgoing all_lock_waits
assert_product_effect s7-outgoing outgoing_hot_same_warehouse "$S7_ORG" "$S7_P1" "$((-TOTAL_CALLS))" "$((-TOTAL_CALLS * 10))" "$TOTAL_CALLS"

record_fixture_size manual_movement_hot_same_warehouse "$S7_ORG" "$S7_P1"
capture_product_effect s7-manual "$S7_ORG" "$S7_P1"
run_workload manual_movement_hot_same_warehouse "$S7_ADMIN" q_manual all_lock_waits
assert_product_effect s7-manual manual_movement_hot_same_warehouse "$S7_ORG" "$S7_P1" "$TOTAL_CALLS" "$((TOTAL_CALLS * 10))" "$TOTAL_CALLS"

# ---- real Goods Receipt representative ---------------------------------------
# shellcheck source=/dev/null
source "$SCRATCH/s8_fixture.sh"
S8_ORG=$org; S8_USR=$usr; S8_A=$A; S8_W=$W; S8_VEND=$VEND
"${PSQL[@]}" <<SQL
UPDATE public.bins
SET actual_qty=100000,valuation_rate=10,stock_value=1000000,
    stock_queue='[{"qty":100000,"rate":10}]'::jsonb
WHERE org_id='$S8_ORG' AND product_id='$S8_A' AND warehouse_id='$S8_W';
UPDATE public.products SET stock_quantity=100000,stock_value=1000000,cost_price=10
WHERE id='$S8_A' AND org_id='$S8_ORG';
SQL
q_receipt() {
  printf "SELECT public.rpc_post_goods_receipt(jsonb_build_object('tenant_id','%s','vendor_id','%s','warehouse_id','%s','idempotency_key','m191-perf-gr-'||gen_random_uuid()::text,'lines',jsonb_build_array(jsonb_build_object('product_id','%s','qty_entered',1,'unit_cost',10))));" "$S8_ORG" "$S8_VEND" "$S8_W" "$S8_A"
}
record_fixture_size goods_receipt_hot_same_warehouse "$S8_ORG" "$S8_A"
capture_product_effect s8-gr "$S8_ORG" "$S8_A"
run_workload goods_receipt_hot_same_warehouse "$S8_USR" q_receipt all_lock_waits
assert_product_effect s8-gr goods_receipt_hot_same_warehouse "$S8_ORG" "$S8_A" "$TOTAL_CALLS" "$((TOTAL_CALLS * 10))" "$TOTAL_CALLS"

# ---- real manufacturing consumption representative ---------------------------
# shellcheck source=/dev/null
source "$SCRATCH/s9_fixture.sh"
reset_fixture
S9_ORG=$org; S9_ADM=$adm; S9_X=$X; S9_I1=$I1; S9_W=$W; S9_STAGE=$STAGE
"${PSQL[@]}" <<SQL
UPDATE public.bins
SET actual_qty=100000,reserved_qty=0,valuation_rate=10,stock_value=1000000,
    stock_queue='[{"qty":100000,"rate":10}]'::jsonb
WHERE org_id='$S9_ORG' AND product_id='$S9_X' AND warehouse_id='$S9_W';
UPDATE public.products SET stock_quantity=100000,stock_value=1000000,cost_price=10
WHERE id='$S9_X' AND org_id='$S9_ORG';
DROP TABLE IF EXISTS public.zz_m191_perf_mos;
CREATE TABLE public.zz_m191_perf_mos(worker_id integer PRIMARY KEY,mo_id uuid NOT NULL);
SQL

reserve_qty=$((WARMUP + ITERATIONS + 10))
for w in $(seq 1 "$CONCURRENCY"); do
  order_no="M191-PERF-$LABEL-MO-$w"
  as_user "$(mo_payload "$order_no" "jsonb_build_array(jsonb_build_object('item_id','$S9_I1','quantity',$reserve_qty))")" >/dev/null
  mo=$("${PSQL[@]}" -c "SELECT id FROM public.manufacturing_orders WHERE org_id='$S9_ORG' AND order_number='$order_no'")
  [[ -n "$mo" ]] || fail "failed to create consumption MO worker=$w"
  mk_wip "$mo"
  "${PSQL[@]}" -c "INSERT INTO public.zz_m191_perf_mos(worker_id,mo_id) VALUES ($w,'$mo');"
done

q_consumption() {
  local w=$1
  printf "SELECT public.rpc_consume_reserved_materials_v2((SELECT mo_id FROM public.zz_m191_perf_mos WHERE worker_id=%s),'%s',jsonb_build_array(jsonb_build_object('item_id','%s','quantity',1,'warehouse_id','%s')));" "$w" "$S9_STAGE" "$S9_I1" "$S9_W"
}
record_fixture_size manufacturing_consumption_hot_same_warehouse "$S9_ORG" "$S9_X"
capture_product_effect s9-consume "$S9_ORG" "$S9_X"
run_workload manufacturing_consumption_hot_same_warehouse "$S9_ADM" q_consumption all_lock_waits
assert_product_effect s9-consume manufacturing_consumption_hot_same_warehouse "$S9_ORG" "$S9_X" "$((-TOTAL_CALLS))" "$((-TOTAL_CALLS * 10))" "$TOTAL_CALLS"

read -r consumed released <<<"$("${PSQL[@]}" -c "
SELECT COALESCE(SUM(quantity_consumed),0)||' '||COALESCE(SUM(quantity_released),0)
FROM public.material_reservations
WHERE org_id='$S9_ORG'
  AND mo_id IN (SELECT mo_id FROM public.zz_m191_perf_mos);")"
num_eq "$consumed" "$TOTAL_CALLS" || fail "manufacturing consumption: reservation consumed=$consumed expected=$TOTAL_CALLS"
num_eq "$released" 0 || fail "manufacturing consumption: unexpected released qty=$released"
"${PSQL[@]}" -c "DROP TABLE public.zz_m191_perf_mos;"

echo "M191_PERF_CHARACTERIZATION_DB_COMPLETE label=$LABEL database=$DB"
