#!/usr/bin/env bash
source "$SCRATCH/s7_fixture.sh"

# backend1 holds open after its call; backend2 must block, then run after release.
# $1 scenario $2 sql1 $3 sql2
pair() {
  local sc=$1 c1=$2 c2=$3
  local r="$tmp/$sc"; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
  PGAPPNAME="$sc-1" "${PSQL[@]}" >"$r-1.out" 2>"$r-1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$admin',true);
$c1
\! touch $r-1.ready
\! bash -c 'while [ ! -f "$r-1.release" ]; do sleep 0.05; done'
COMMIT;
SQL
  P1PID=$!
  wait_for_file "$r-1.ready" || fail "$sc: backend 1 never completed its call: $(tr -d '\n' < "$r-1.err")"
  PGAPPNAME="$sc-2" "${PSQL[@]}" >"$r-2.out" 2>"$r-2.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$admin',true);
$c2
COMMIT;
SQL
  P2PID=$!
  local w; w=$(wait_for_lock_waiters 1 "'$sc-2'") || fail "$sc: backend 2 never blocked (waiters=$w) - HARNESS_FAIL, overlap not established"
  echo "  EVIDENCE[$sc] $(blocking_evidence "$sc-2")"
  touch "$r-1.release"
  ST1=0; ST2=0; wait "$P1PID" || ST1=$?; wait "$P2PID" || ST2=$?
  grep -qi 'deadlock detected\|40P01' "$r-1.err" "$r-2.err" && fail "$sc: 40P01 deadlock"
  ERR2=$(tr -d '\n' < "$r-2.err")
  echo "  STATUS[$sc] b1=$ST1 b2=$ST2 ${ERR2:+err2=$ERR2}"
}
bins_now() { "${PSQL[@]}" -c "SELECT string_agg(actual_qty::text,',' ORDER BY product_id) FROM public.bins WHERE org_id='$org'"; }
adj_status() { "${PSQL[@]}" -c "SELECT status FROM public.stock_adjustments WHERE id='$1'"; }
rev_count() { "${PSQL[@]}" -c "SELECT count(*) FROM public.stock_ledger_entries WHERE org_id='$org' AND voucher_type='Stock Adjustment Reversal' AND voucher_id='$1'"; }
active_sle() { "${PSQL[@]}" -c "SELECT count(*) FROM public.stock_ledger_entries WHERE org_id='$org' AND voucher_id='$1' AND voucher_type='Stock Adjustment' AND COALESCE(is_cancelled,false)=false"; }

# Generated per run: rpc_submit_stock_adjustment derives its GL idempotency key
# as 'stock-adjustment:'||adjustment_id, and the resulting posted gl_entries are
# immutable, so reusing fixed ids makes a second run fail IDEMPOTENCY_KEY_CONFLICT.
ADJ1=$(new_uuid); ADJ2=$(new_uuid); ADJ3=$(new_uuid)
ADJ4=$(new_uuid); ADJ5=$(new_uuid)

echo '=== 7.1 cancellation vs cancellation, two overlapping multi-product adjustments ==='
CURRENT_SCENARIO=7.1
make_adj "$ADJ1" 'S12-CD-ADJ-1' "$P1" "$P2"
as_admin "SELECT public.rpc_submit_stock_adjustment('$ADJ1');" >/dev/null
make_adj "$ADJ2" 'S12-CD-ADJ-2' "$P2" "$P1"
as_admin "SELECT public.rpc_submit_stock_adjustment('$ADJ2');" >/dev/null
echo "  after two submits bins=$(bins_now) (expect 110,110)"
# cancel the LATER adjustment first (legal), the EARLIER one second.
pair c-vs-c "SELECT public.rpc_cancel_stock_adjustment('$ADJ2','s12 later first');" \
            "SELECT public.rpc_cancel_stock_adjustment('$ADJ1','s12 earlier second');"
[[ $ST1 -eq 0 ]] || fail "7.1: cancelling the later adjustment must succeed"
if [[ $ST2 -eq 0 ]]; then
  [[ "$(adj_status "$ADJ1")" == "CANCELLED" && "$(adj_status "$ADJ2")" == "CANCELLED" ]] || fail "7.1: both cancels reported success but status is not CANCELLED"
  b=$(bins_now); [[ "$b" == "100.000000,100.000000" ]] || fail "7.1: both cancels succeeded so bins must return to 100,100; got $b"
  echo "  7.1 PASS both cancels serialized cleanly, bins=$b, no 40P01"
else
  echo "$ERR2" | grep -q 'LATER_STOCK_MOVEMENT_EXISTS' || fail "7.1: second cancel failed with an unexpected error: $ERR2"
  [[ "$(adj_status "$ADJ1")" == "SUBMITTED" ]] || fail "7.1: failed cancel must leave ADJ1 SUBMITTED (no partial reversal)"
  [[ "$(rev_count "$ADJ1")" == "0" ]] || fail "7.1: failed cancel left reversal SLE rows (PARTIAL EFFECT)"
  echo "  7.1 PASS EXPECTED_BUSINESS_FAIL LATER_STOCK_MOVEMENT_EXISTS, zero partial reversal, bins=$(bins_now)"
fi
reconcile_product 7.1-P1 "$org" "$P1"; reconcile_product 7.1-P2 "$org" "$P2"

echo '=== 7.2 incoming vs cancellation, existing bin ==='
CURRENT_SCENARIO=7.2
make_adj "$ADJ3" 'S12-CD-ADJ-3' "$P1"
as_admin "SELECT public.rpc_submit_stock_adjustment('$ADJ3');" >/dev/null
pair in-vs-c "SELECT public.wardah_apply_stock_incoming('$org','$P1','$W',5,10,'Goods Receipt',gen_random_uuid(),'S12-72-IN',CURRENT_DATE);" \
             "SELECT public.rpc_cancel_stock_adjustment('$ADJ3','s12 after later incoming');"
[[ $ST1 -eq 0 ]] || fail "7.2: incoming must succeed"
[[ $ST2 -ne 0 ]] || fail "7.2: cancellation serialized AFTER a later committed incoming must fail with LATER_STOCK_MOVEMENT_EXISTS, but it succeeded"
echo "$ERR2" | grep -q 'LATER_STOCK_MOVEMENT_EXISTS' || fail "7.2: wrong error: $ERR2"
[[ "$(adj_status "$ADJ3")" == "SUBMITTED" ]] || fail "7.2: partial state - adjustment must stay SUBMITTED"
[[ "$(rev_count "$ADJ3")" == "0" ]] || fail "7.2: partial reversal survived a business failure"
[[ "$(active_sle "$ADJ3")" == "1" ]] || fail "7.2: original adjustment SLE must remain active"
echo "  7.2 PASS EXPECTED_BUSINESS_FAIL LATER_STOCK_MOVEMENT_EXISTS, zero partial reversal"
reconcile_product 7.2 "$org" "$P1"

echo '=== 7.3 outgoing vs cancellation, existing bin ==='
CURRENT_SCENARIO=7.3
make_adj "$ADJ4" 'S12-CD-ADJ-4' "$P2"
as_admin "SELECT public.rpc_submit_stock_adjustment('$ADJ4');" >/dev/null
pair out-vs-c "SELECT public.wardah_apply_stock_outgoing('$org','$P2','$W',3,'Delivery Note',gen_random_uuid(),'S12-73-OUT',CURRENT_DATE);" \
              "SELECT public.rpc_cancel_stock_adjustment('$ADJ4','s12 after later outgoing');"
[[ $ST1 -eq 0 ]] || fail "7.3: outgoing must succeed"
[[ $ST2 -ne 0 ]] || fail "7.3: cancellation after a later committed outgoing must fail LATER_STOCK_MOVEMENT_EXISTS, but succeeded"
echo "$ERR2" | grep -q 'LATER_STOCK_MOVEMENT_EXISTS' || fail "7.3: wrong error: $ERR2"
[[ "$(rev_count "$ADJ4")" == "0" ]] || fail "7.3: partial reversal survived"
echo "  7.3 PASS EXPECTED_BUSINESS_FAIL LATER_STOCK_MOVEMENT_EXISTS, zero partial reversal"
reconcile_product 7.3 "$org" "$P2"

echo '=== 7.4 manual movement vs incoming ==='
CURRENT_SCENARIO=7.4
b0=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$P1'")
pair man-vs-in "SELECT public.rpc_manual_stock_movement_v2(jsonb_build_object('product_id','$P1','warehouse_id','$W','movement_type','in','quantity',4,'unit_cost_entered',10));" \
               "SELECT public.wardah_apply_stock_incoming('$org','$P1','$W',6,10,'Goods Receipt',gen_random_uuid(),'S12-74-IN',CURRENT_DATE);"
[[ $ST1 -eq 0 && $ST2 -eq 0 ]] || fail "7.4: both must succeed; b1=$ST1 b2=$ST2 err2=$ERR2"
b1=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$P1'")
num_eq "$b1" "$(awk -v a="$b0" 'BEGIN{print a+10}')" || fail "7.4: bin=$b1 expected $b0+10"
echo "  7.4 PASS bin $b0 -> $b1 (+4 manual, +6 incoming)"
reconcile_product 7.4 "$org" "$P1"

echo '=== 7.5 manual movement vs outgoing ==='
CURRENT_SCENARIO=7.5
b0=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$P2'")
pair man-vs-out "SELECT public.rpc_manual_stock_movement_v2(jsonb_build_object('product_id','$P2','warehouse_id','$W','movement_type','in','quantity',7,'unit_cost_entered',10));" \
                "SELECT public.wardah_apply_stock_outgoing('$org','$P2','$W',2,'Delivery Note',gen_random_uuid(),'S12-75-OUT',CURRENT_DATE);"
[[ $ST1 -eq 0 && $ST2 -eq 0 ]] || fail "7.5: both must succeed; b1=$ST1 b2=$ST2 err2=$ERR2"
b1=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$P2'")
num_eq "$b1" "$(awk -v a="$b0" 'BEGIN{print a+5}')" || fail "7.5: bin=$b1 expected $b0+5"
echo "  7.5 PASS bin $b0 -> $b1 (+7 manual, -2 outgoing)"
reconcile_product 7.5 "$org" "$P2"

echo '=== 7.6 manual movement vs cancellation ==='
CURRENT_SCENARIO=7.6
make_adj "$ADJ5" 'S12-CD-ADJ-5' "$P1"
as_admin "SELECT public.rpc_submit_stock_adjustment('$ADJ5');" >/dev/null
pair man-vs-c "SELECT public.rpc_manual_stock_movement_v2(jsonb_build_object('product_id','$P1','warehouse_id','$W','movement_type','in','quantity',2,'unit_cost_entered',10));" \
              "SELECT public.rpc_cancel_stock_adjustment('$ADJ5','s12 after later manual movement');"
[[ $ST1 -eq 0 ]] || fail "7.6: manual movement must succeed"
[[ $ST2 -ne 0 ]] || fail "7.6: cancellation after a later committed manual movement must fail LATER_STOCK_MOVEMENT_EXISTS, but succeeded"
echo "$ERR2" | grep -q 'LATER_STOCK_MOVEMENT_EXISTS' || fail "7.6: wrong error: $ERR2"
[[ "$(rev_count "$ADJ5")" == "0" ]] || fail "7.6: partial reversal survived"
echo "  7.6 PASS EXPECTED_BUSINESS_FAIL LATER_STOCK_MOVEMENT_EXISTS, zero partial reversal"
reconcile_product 7.6 "$org" "$P1"
echo "SLICE12_S7_PASS"
