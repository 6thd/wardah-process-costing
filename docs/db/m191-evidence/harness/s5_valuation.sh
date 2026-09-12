#!/usr/bin/env bash
source "$SCRATCH/lib.sh"
org='00002292-f2f2-0000-0000-000000000001'
actor='00002292-f2f2-0000-0000-000000000002'
fifo_p='00002292-0000-0000-0000-0000000000a1'; fifo_w='00002292-0000-0000-0000-0000000000a2'
lifo_p='00002292-0000-0000-0000-0000000000b1'; lifo_w='00002292-0000-0000-0000-0000000000b2'

"${PSQL[@]}" <<SQL
DELETE FROM public.stock_ledger_entries WHERE org_id='$org';
DELETE FROM public.bins WHERE org_id='$org';
DELETE FROM public.products WHERE org_id='$org';
DELETE FROM public.warehouses WHERE org_id='$org';
DELETE FROM public.user_organizations WHERE org_id='$org';
DELETE FROM public.organizations WHERE id='$org';
DELETE FROM auth.users WHERE id='$actor';
SQL
"${PSQL[@]}" <<SQL
INSERT INTO public.organizations (id,name,code) VALUES ('$org','M191 S12 Valuation','M191-S12-VAL');
INSERT INTO auth.users (id,email) VALUES ('$actor','m191-s12-val@wardah-e2e.invalid');
INSERT INTO public.user_organizations (user_id,org_id,is_active) VALUES ('$actor','$org',true);
INSERT INTO public.products (id,org_id,code,name,is_stockable,base_uom_id,valuation_method)
SELECT p.id,'$org',p.code,p.name,true,u.id,p.vm::public.valuation_method_enum FROM (VALUES
 ('$fifo_p'::uuid,'S12-FIFO','FIFO Product','FIFO'),
 ('$lifo_p'::uuid,'S12-LIFO','LIFO Product','LIFO')) AS p(id,code,name,vm)
CROSS JOIN LATERAL (SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1) u;
INSERT INTO public.warehouses (id,org_id,code,name) VALUES
 ('$fifo_w','$org','S12-WH-FIFO','FIFO WH'),('$lifo_w','$org','S12-WH-LIFO','LIFO WH');
INSERT INTO public.bins (id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue) VALUES
 ('00002292-0000-0000-0000-0000000000a3','$org','$fifo_p','$fifo_w',10,0,10,100,'[{"qty":10,"rate":10}]'::jsonb),
 ('00002292-0000-0000-0000-0000000000b3','$org','$lifo_p','$lifo_w',10,0,10,100,'[{"qty":10,"rate":10}]'::jsonb);
SQL

# forced-concurrency: incoming 5@20 holds; outgoing 12 must serialize after it.
run_val() {
  local sc=$1 p=$2 w=$3 vin=$4 vout=$5
  local r="$tmp/$sc"; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
  PGAPPNAME="$sc-1" "${PSQL[@]}" >"$r-1.out" 2>"$r-1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$actor',true);
SELECT public.wardah_apply_stock_incoming('$org','$p','$w',5,20,'Goods Receipt','$vin','$sc-IN',CURRENT_DATE);
\! touch $r-1.ready
\! bash -c 'while [ ! -f "$r-1.release" ]; do sleep 0.05; done'
COMMIT;
SQL
  local p1=$!
  wait_for_file "$r-1.ready" || fail "$sc: incoming backend never completed RPC"
  PGAPPNAME="$sc-2" "${PSQL[@]}" >"$r-2.out" 2>"$r-2.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$actor',true);
SELECT public.wardah_apply_stock_outgoing('$org','$p','$w',12,'Delivery Note','$vout','$sc-OUT',CURRENT_DATE);
COMMIT;
SQL
  local p2=$!
  local wt; wt=$(wait_for_lock_waiters 1 "'$sc-2'") || fail "$sc: outgoing never blocked (waiters=$wt) - forced concurrency not established (HARNESS_FAIL)"
  echo "  EVIDENCE[$sc] $(blocking_evidence "$sc-2")"
  touch "$r-1.release"
  st1=0; st2=0; wait "$p1" || st1=$?; wait "$p2" || st2=$?
  grep -qi 'deadlock\|40P01' "$r-1.err" "$r-2.err" && fail "$sc: 40P01 deadlock"
  echo "  STATUS[$sc] incoming=$st1 outgoing=$st2 result=$(cat "$r-2.out")"
  [[ $st1 -eq 0 && $st2 -eq 0 ]] || fail "$sc: both calls must succeed in this serialization; statuses=$st1,$st2"
}

echo '=== FIFO forced-concurrency: bin 10@10, +5@20, -12 ==='
CURRENT_SCENARIO=FIFO
run_val fifo "$fifo_p" "$fifo_w" '00002292-0000-0000-0000-0000000000a4' '00002292-0000-0000-0000-0000000000a5'
read -r q v rate qu <<<"$("${PSQL[@]}" -c "SELECT actual_qty||' '||stock_value||' '||valuation_rate||' '||stock_queue::text FROM public.bins WHERE product_id='$fifo_p'")"
num_eq "$q" 3   || fail "FIFO: bin qty=$q expected 3"
num_eq "$v" 60  || fail "FIFO: bin value=$v expected 60 (10@10 then 2@20 consumed => COGS 140)"
num_eq "$rate" 20 || fail "FIFO: valuation_rate=$rate expected 20 (oldest layer exhausted)"
qsum=$("${PSQL[@]}" -c "SELECT coalesce(SUM((e->>'qty')::numeric),0) FROM public.bins b, jsonb_array_elements(b.stock_queue) e WHERE b.product_id='$fifo_p'")
num_eq "$qsum" 3 || fail "FIFO: queue qty total=$qsum must equal bin qty 3"
layers=$("${PSQL[@]}" -c "SELECT jsonb_array_length(stock_queue) FROM public.bins WHERE product_id='$fifo_p'")
[[ "$layers" == "1" ]] || fail "FIFO: expected 1 surviving layer, got $layers"
lrate=$("${PSQL[@]}" -c "SELECT (stock_queue->0->>'rate')::numeric FROM public.bins WHERE product_id='$fifo_p'")
num_eq "$lrate" 20 || fail "FIFO: surviving layer rate=$lrate expected 20 (FIFO must consume the 10@10 layer first)"
read -r svd orate <<<"$("${PSQL[@]}" -c "SELECT stock_value_difference||' '||outgoing_rate FROM public.stock_ledger_entries WHERE voucher_id='00002292-0000-0000-0000-0000000000a5'")"
num_eq "$svd" -140 || fail "FIFO: SLE stock_value_difference=$svd expected -140"
echo "  FIFO PASS bin=$q/$v rate=$rate queue=$qu cogs=140 outgoing_rate=$orate"
reconcile_product FIFO "$org" "$fifo_p"

echo '=== LIFO forced-concurrency: bin 10@10, +5@20, -12 ==='
# shellcheck disable=SC2034 # read by lib.sh's fail() across sourced scripts
CURRENT_SCENARIO=LIFO
run_val lifo "$lifo_p" "$lifo_w" '00002292-0000-0000-0000-0000000000b4' '00002292-0000-0000-0000-0000000000b5'
read -r q v rate qu <<<"$("${PSQL[@]}" -c "SELECT actual_qty||' '||stock_value||' '||valuation_rate||' '||stock_queue::text FROM public.bins WHERE product_id='$lifo_p'")"
num_eq "$q" 3   || fail "LIFO: bin qty=$q expected 3"
num_eq "$v" 30  || fail "LIFO: bin value=$v expected 30 (5@20 then 7@10 consumed => COGS 170)"
num_eq "$rate" 10 || fail "LIFO: valuation_rate=$rate expected 10"
qsum=$("${PSQL[@]}" -c "SELECT coalesce(SUM((e->>'qty')::numeric),0) FROM public.bins b, jsonb_array_elements(b.stock_queue) e WHERE b.product_id='$lifo_p'")
num_eq "$qsum" 3 || fail "LIFO: queue qty total=$qsum must equal bin qty 3"
layers=$("${PSQL[@]}" -c "SELECT jsonb_array_length(stock_queue) FROM public.bins WHERE product_id='$lifo_p'")
[[ "$layers" == "1" ]] || fail "LIFO: expected 1 surviving layer, got $layers"
lrate=$("${PSQL[@]}" -c "SELECT (stock_queue->0->>'rate')::numeric FROM public.bins WHERE product_id='$lifo_p'")
num_eq "$lrate" 10 || fail "LIFO: surviving layer rate=$lrate expected 10 (LIFO must consume the newest 5@20 layer first)"
svd=$("${PSQL[@]}" -c "SELECT stock_value_difference FROM public.stock_ledger_entries WHERE voucher_id='00002292-0000-0000-0000-0000000000b5'")
num_eq "$svd" -170 || fail "LIFO: SLE stock_value_difference=$svd expected -170"
echo "  LIFO PASS bin=$q/$v rate=$rate queue=$qu cogs=170"
reconcile_product LIFO "$org" "$lifo_p"
echo "SLICE12_S5_PASS"
