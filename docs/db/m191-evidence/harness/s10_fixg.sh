source "$SCRATCH/s9_fixture.sh"
reset_fixture

GR_YX="jsonb_build_array(
  jsonb_build_object('product_id','$Y','qty_entered',4,'unit_cost',10),
  jsonb_build_object('product_id','$X','qty_entered',4,'unit_cost',10))"

# backend1 = reservation [X,Y] holds product prefix open; backend2 = crossed writer
control() { # $1 scenario $2 second-call
  local sc=$1 c2=$2
  local r="$tmp/$sc"; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
  PGAPPNAME="$sc-res" "${PSQL[@]}" >"$r-res.out" 2>"$r-res.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
$(mo_payload "S12-$sc" "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',3),jsonb_build_object('item_id','$I2','quantity',3))")
\! touch $r-res.ready
\! bash -c 'while [ ! -f "$r-res.release" ]; do sleep 0.05; done'
COMMIT;
SQL
  RPID=$!
  wait_for_file "$r-res.ready" || fail "$sc: reservation backend never completed: $(tr -d '\n' < "$r-res.err")"
  PGAPPNAME="$sc-w" "${PSQL[@]}" >"$r-w.out" 2>"$r-w.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
$c2
COMMIT;
SQL
  WPID=$!
  local w; w=$(wait_for_lock_waiters 1 "'$sc-w'") || fail "$sc: crossed writer never blocked (waiters=$w) - HARNESS_FAIL"
  echo "  EVIDENCE[$sc] $(blocking_evidence "$sc-w")"
  HELD=$(held_relations "$sc-w")
  echo "  HELD-BY-WRITER[$sc] $HELD"
  case "$HELD" in
    *bins:RowExclusiveLock*) fail "$sc: the crossed writer already owns a bins write lock while blocked - it was NOT serialized at the product prefix before touching bins" ;;
  esac
  touch "$r-res.release"
  SR=0; SW=0; wait "$RPID" || SR=$?; wait "$WPID" || SW=$?
  grep -qi 'deadlock detected\|40P01' "$r-res.err" "$r-w.err" && fail "$sc: 40P01 deadlock"
  echo "  STATUS[$sc] reservation=$SR writer=$SW"
  [[ $SR -eq 0 && $SW -eq 0 ]] || fail "$sc: both calls must complete; res=$SR writer=$SW err=$(tr -d '\n' < "$r-w.err")"
}

echo '=== 10.1 Control A: reservation [X,Y] vs Goods Receipt [Y,X] ==='
CURRENT_SCENARIO=10.1A
control ctlA "SELECT public.rpc_post_goods_receipt(jsonb_build_object('tenant_id','$org','vendor_id','$VEND','warehouse_id','$W','idempotency_key','s12-g-ctlA-$RUN_NONCE','lines',$GR_YX));"
echo "  10.1A PASS reservation and crossed GR both completed, writer serialized at prefix before any bin"
reconcile_product 10.1A-X "$org" "$X"; reconcile_product 10.1A-Y "$org" "$Y"

echo '=== 10.1 Control B: reservation [X,Y] vs outgoing [Y,X] ==='
CURRENT_SCENARIO=10.1B
control ctlB "SELECT public.wardah_apply_stock_outgoing('$org','$Y','$W',2,'Delivery Note',gen_random_uuid(),'S12-G-B-Y',CURRENT_DATE);
SELECT public.wardah_apply_stock_outgoing('$org','$X','$W',2,'Delivery Note',gen_random_uuid(),'S12-G-B-X',CURRENT_DATE);"
echo "  10.1B PASS reservation and crossed outgoing both completed"
reconcile_product 10.1B-X "$org" "$X"; reconcile_product 10.1B-Y "$org" "$Y"
echo "SLICE12_S10_1_PASS"
