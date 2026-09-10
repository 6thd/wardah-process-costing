#!/usr/bin/env bash
source "$SCRATCH/lib.sh"
org='00002291-f2f2-0000-0000-000000000001'
actor='00002291-f2f2-0000-0000-000000000002'
ga_p='00002291-0000-0000-0000-0000000000a1'; ga_w='00002291-0000-0000-0000-0000000000a2'
gb_p='00002291-0000-0000-0000-0000000000b1'; gb_w1='00002291-0000-0000-0000-0000000000b2'; gb_w2='00002291-0000-0000-0000-0000000000b3'
gc1_p='00002291-0000-0000-0000-0000000000c1'; gc1_w='00002291-0000-0000-0000-0000000000c2'
gc2_p='00002291-0000-0000-0000-0000000000d1'; gc2_w='00002291-0000-0000-0000-0000000000d2'
gfb_p='00002291-0000-0000-0000-0000000000e1'; gfb_w='00002291-0000-0000-0000-0000000000e2'
v() { echo "00002291-0000-0000-0000-0000000000${1}"; }

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
INSERT INTO public.organizations (id,name,code) VALUES ('$org','M191 S12 Core','M191-S12-CORE');
INSERT INTO auth.users (id,email) VALUES ('$actor','m191-s12@wardah-e2e.invalid');
INSERT INTO public.user_organizations (user_id,org_id,is_active) VALUES ('$actor','$org',true);
INSERT INTO public.products (id,org_id,code,name,is_stockable,base_uom_id)
SELECT p.id,'$org',p.code,p.name,true,u.id FROM (VALUES
 ('$ga_p'::uuid,'S12-GA','G-A Product'),('$gb_p'::uuid,'S12-GB','G-B Product'),
 ('$gc1_p'::uuid,'S12-GC1','G-C1 Product'),('$gc2_p'::uuid,'S12-GC2','G-C2 Product'),
 ('$gfb_p'::uuid,'S12-GFB','G-FB Product')) AS p(id,code,name)
CROSS JOIN LATERAL (SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1) u;
INSERT INTO public.warehouses (id,org_id,code,name) VALUES
 ('$ga_w','$org','S12-WH-GA','GA WH'),('$gb_w1','$org','S12-WH-GB1','GB WH1'),
 ('$gb_w2','$org','S12-WH-GB2','GB WH2'),('$gc1_w','$org','S12-WH-GC1','GC1 WH'),
 ('$gc2_w','$org','S12-WH-GC2','GC2 WH'),('$gfb_w','$org','S12-WH-GFB','GFB WH');
INSERT INTO public.bins (id,org_id,product_id,warehouse_id,actual_qty,reserved_qty,valuation_rate,stock_value,stock_queue) VALUES
 ('00002291-0000-0000-0000-0000000000c3','$org','$gc1_p','$gc1_w',20,0,10,200,'[{"qty":20,"rate":10}]'::jsonb),
 ('00002291-0000-0000-0000-0000000000d3','$org','$gc2_p','$gc2_w',50,0,10,500,'[{"qty":50,"rate":10}]'::jsonb);
SQL

# ---- generic two-backend forced-overlap runner -------------------------------
# $1 scenario  $2 sql-call-1  $3 sql-call-2  $4 expected-waiters
run_pair() {
  local sc=$1 call1=$2 call2=$3 exp=${4:-1}
  local r="$tmp/$sc"; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
  PGAPPNAME="$sc-1" "${PSQL[@]}" >"$r-1.out" 2>"$r-1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$actor',true);
$call1
\! touch $r-1.ready
\! bash -c 'while [ ! -f "$r-1.release" ]; do sleep 0.05; done'
COMMIT;
SQL
  local p1=$!
  wait_for_file "$r-1.ready" || fail "$sc: backend 1 never completed its RPC body"
  PGAPPNAME="$sc-2" "${PSQL[@]}" >"$r-2.out" 2>"$r-2.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$actor',true);
$call2
COMMIT;
SQL
  local p2=$!
  local w; w=$(wait_for_lock_waiters "$exp" "'$sc-2'") || fail "$sc: backend 2 never blocked (waiters=$w) - overlap not established, this is HARNESS_FAIL not a pass"
  echo "  EVIDENCE[$sc] $(blocking_evidence "$sc-2")"
  touch "$r-1.release"
  st1=0; st2=0; wait "$p1" || st1=$?; wait "$p2" || st2=$?
  echo "  STATUS[$sc] backend1=$st1 backend2=$st2"
  grep -qi 'deadlock\|40P01' "$r-1.err" "$r-2.err" && fail "$sc: 40P01 deadlock detected"
  return 0
}

echo '=== G-A: first-bin incoming 5@10 + 7@10 ==='
CURRENT_SCENARIO=G-A
run_pair g-a \
"SELECT public.wardah_apply_stock_incoming('$org','$ga_p','$ga_w',5,10,'Goods Receipt','$(v a3)','S12-GA-1',CURRENT_DATE);" \
"SELECT public.wardah_apply_stock_incoming('$org','$ga_p','$ga_w',7,10,'Goods Receipt','$(v a4)','S12-GA-2',CURRENT_DATE);"
[[ $st1 -eq 0 && $st2 -eq 0 ]] || fail "G-A: both calls must succeed; statuses=$st1,$st2"
read -r bq bv bc sq sv pq pc <<<"$("${PSQL[@]}" -c "
SELECT (SELECT actual_qty FROM public.bins WHERE product_id='$ga_p' AND warehouse_id='$ga_w')||' '||
       (SELECT stock_value FROM public.bins WHERE product_id='$ga_p' AND warehouse_id='$ga_w')||' '||
       (SELECT count(*) FROM public.bins WHERE product_id='$ga_p' AND warehouse_id='$ga_w')||' '||
       (SELECT SUM(actual_qty) FROM public.stock_ledger_entries WHERE product_id='$ga_p')||' '||
       (SELECT SUM(stock_value_difference) FROM public.stock_ledger_entries WHERE product_id='$ga_p')||' '||
       (SELECT stock_quantity FROM public.products WHERE id='$ga_p')||' '||
       (SELECT cost_price FROM public.products WHERE id='$ga_p')")"
num_eq "$bc" 1   || fail "G-A: expected 1 bin, got $bc"
num_eq "$bq" 12  || fail "G-A: bin qty=$bq expected 12 (LOST UPDATE SURVIVED)"
num_eq "$bv" 120 || fail "G-A: bin value=$bv expected 120"
num_eq "$sq" 12  || fail "G-A: SLE qty sum=$sq expected 12"
num_eq "$sv" 120 || fail "G-A: SLE value sum=$sv expected 120"
num_eq "$pq" 12  || fail "G-A: product stock_quantity=$pq expected 12"
num_eq "$pc" 10  || fail "G-A: product cost_price=$pc expected 10"
reconcile_product G-A "$org" "$ga_p"
echo "  G-A PASS bin=$bq/$bv sle=$sq/$sv product=$pq/$pc"

echo '=== G-B: one product, two warehouses 6@10 + 9@20 ==='
CURRENT_SCENARIO=G-B
run_pair g-b \
"SELECT public.wardah_apply_stock_incoming('$org','$gb_p','$gb_w1',6,10,'Goods Receipt','$(v b4)','S12-GB-1',CURRENT_DATE);" \
"SELECT public.wardah_apply_stock_incoming('$org','$gb_p','$gb_w2',9,20,'Goods Receipt','$(v b5)','S12-GB-2',CURRENT_DATE);"
[[ $st1 -eq 0 && $st2 -eq 0 ]] || fail "G-B: both calls must succeed; statuses=$st1,$st2"
read -r b1q b1v b2q b2v sq sv pq pc <<<"$("${PSQL[@]}" -c "
SELECT (SELECT actual_qty FROM public.bins WHERE product_id='$gb_p' AND warehouse_id='$gb_w1')||' '||
       (SELECT stock_value FROM public.bins WHERE product_id='$gb_p' AND warehouse_id='$gb_w1')||' '||
       (SELECT actual_qty FROM public.bins WHERE product_id='$gb_p' AND warehouse_id='$gb_w2')||' '||
       (SELECT stock_value FROM public.bins WHERE product_id='$gb_p' AND warehouse_id='$gb_w2')||' '||
       (SELECT SUM(actual_qty) FROM public.stock_ledger_entries WHERE product_id='$gb_p')||' '||
       (SELECT SUM(stock_value_difference) FROM public.stock_ledger_entries WHERE product_id='$gb_p')||' '||
       (SELECT stock_quantity FROM public.products WHERE id='$gb_p')||' '||
       (SELECT cost_price FROM public.products WHERE id='$gb_p')")"
num_eq "$b1q" 6   || fail "G-B: wh1 qty=$b1q expected 6"
num_eq "$b1v" 60  || fail "G-B: wh1 value=$b1v expected 60"
num_eq "$b2q" 9   || fail "G-B: wh2 qty=$b2q expected 9"
num_eq "$b2v" 180 || fail "G-B: wh2 value=$b2v expected 180"
num_eq "$sq" 15   || fail "G-B: SLE qty=$sq expected 15"
num_eq "$sv" 240  || fail "G-B: SLE value=$sv expected 240"
num_eq "$pq" 15   || fail "G-B: product stock_quantity=$pq expected 15 (RED-B AGGREGATE RACE SURVIVED)"
num_eq "$pc" 16   || fail "G-B: product cost_price=$pc expected 16"
reconcile_product G-B "$org" "$gb_p"
echo "  G-B PASS bins=$b1q/$b1v + $b2q/$b2v product=$pq/$pc"

echo '=== G-C1: existing bin 20 + 3 + 4 ==='
CURRENT_SCENARIO=G-C1
run_pair g-c1 \
"SELECT public.wardah_apply_stock_incoming('$org','$gc1_p','$gc1_w',3,10,'Goods Receipt','$(v c4)','S12-GC1-1',CURRENT_DATE);" \
"SELECT public.wardah_apply_stock_incoming('$org','$gc1_p','$gc1_w',4,10,'Goods Receipt','$(v c5)','S12-GC1-2',CURRENT_DATE);"
[[ $st1 -eq 0 && $st2 -eq 0 ]] || fail "G-C1: both calls must succeed; statuses=$st1,$st2"
q=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$gc1_p'")
num_eq "$q" 27 || fail "G-C1: bin qty=$q expected 27"
reconcile_product G-C1 "$org" "$gc1_p"
echo "  G-C1 PASS bin=$q"

echo '=== G-C2: existing bin 50 + 8 - 10 ==='
CURRENT_SCENARIO=G-C2
run_pair g-c2 \
"SELECT public.wardah_apply_stock_incoming('$org','$gc2_p','$gc2_w',8,10,'Goods Receipt','$(v d4)','S12-GC2-IN',CURRENT_DATE);" \
"SELECT public.wardah_apply_stock_outgoing('$org','$gc2_p','$gc2_w',10,'Delivery Note','$(v d5)','S12-GC2-OUT',CURRENT_DATE);"
[[ $st1 -eq 0 && $st2 -eq 0 ]] || fail "G-C2: both calls must succeed; statuses=$st1,$st2"
read -r q val <<<"$("${PSQL[@]}" -c "SELECT actual_qty||' '||stock_value FROM public.bins WHERE product_id='$gc2_p'")"
num_eq "$q" 48 || fail "G-C2: bin qty=$q expected 48"
reconcile_product G-C2 "$org" "$gc2_p"
echo "  G-C2 PASS bin=$q/$val"

echo '=== G-FB: first-bin incoming vs outgoing ==='
CURRENT_SCENARIO=G-FB
r=$tmp/g-fb; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
PGAPPNAME='g-fb-1' "${PSQL[@]}" >"$r-1.out" 2>"$r-1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$actor',true);
SELECT public.wardah_apply_stock_incoming('$org','$gfb_p','$gfb_w',10,10,'Goods Receipt','$(v e3)','S12-GFB-IN',CURRENT_DATE);
\! touch $r-1.ready
\! bash -c 'while [ ! -f "$r-1.release" ]; do sleep 0.05; done'
COMMIT;
SQL
p1=$!
wait_for_file "$r-1.ready" || fail "G-FB: backend 1 never completed RPC"
PGAPPNAME='g-fb-2' "${PSQL[@]}" >"$r-2.out" 2>"$r-2.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$actor',true);
SELECT public.wardah_apply_stock_outgoing('$org','$gfb_p','$gfb_w',4,'Delivery Note','$(v e4)','S12-GFB-OUT',CURRENT_DATE);
COMMIT;
SQL
p2=$!
w=$(wait_for_lock_waiters 1 "'g-fb-2'") || fail "G-FB: outgoing never blocked (waiters=$w); without a real lock edge this proves nothing"
echo "  EVIDENCE[G-FB] $(blocking_evidence g-fb-2)"
touch "$r-1.release"
st1=0; st2=0; wait "$p1" || st1=$?; wait "$p2" || st2=$?
grep -qi 'deadlock\|40P01' "$r-1.err" "$r-2.err" && fail "G-FB: 40P01 deadlock"
[[ $st1 -eq 0 ]] || fail "G-FB: incoming must succeed; status=$st1"
read -r bq bc sc <<<"$("${PSQL[@]}" -c "
SELECT coalesce((SELECT actual_qty FROM public.bins WHERE product_id='$gfb_p'),-1)||' '||
       (SELECT count(*) FROM public.bins WHERE product_id='$gfb_p')||' '||
       (SELECT count(*) FROM public.stock_ledger_entries WHERE product_id='$gfb_p')")"
if [[ $st2 -eq 0 ]]; then
  num_eq "$bq" 6 || fail "G-FB: outgoing succeeded so bin must be 10-4=6; got $bq"
  num_eq "$sc" 2 || fail "G-FB: expected 2 SLE rows; got $sc"
  echo "  G-FB PASS (outgoing serialized after bin creation) bin=$bq sle=$sc"
else
  grep -q 'BIN_NOT_FOUND' "$r-2.err" || fail "G-FB: outgoing failed with an error other than BIN_NOT_FOUND: $(tr -d '\n' < "$r-2.err")"
  num_eq "$bq" 10 || fail "G-FB: outgoing failed atomically so bin must remain 10; got $bq (PARTIAL EFFECT)"
  num_eq "$sc" 1  || fail "G-FB: outgoing failed atomically so only 1 SLE row may exist; got $sc (PARTIAL EFFECT)"
  echo "  G-FB PASS (outgoing failed atomically with BIN_NOT_FOUND, zero partial effect) bin=$bq sle=$sc"
fi
reconcile_product G-FB "$org" "$gfb_p"
echo "SLICE12_S4_PASS"
