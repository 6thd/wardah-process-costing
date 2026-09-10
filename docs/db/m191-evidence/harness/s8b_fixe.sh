source "$SCRATCH/s9_fixture.sh"
reset_fixture
r=$tmp/s8b; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
ADJ=$(new_uuid)   # per-run: see s7_fixcd.sh note on derived GL idempotency keys
mk_adj() { # $1 adj_id $2 number $3.. products in payload order
  local adj=$1 num=$2; shift 2
  "${PSQL[@]}" <<SQL
DELETE FROM public.stock_adjustment_items WHERE adjustment_id='$adj';
DELETE FROM public.stock_adjustments WHERE id='$adj';
INSERT INTO public.stock_adjustments
 (id,organization_id,org_id,adjustment_number,adjustment_date,posting_date,adjustment_type,reason,warehouse_id,status,total_items,created_by,
  inventory_account_id,increase_account_id,decrease_account_id)
VALUES ('$adj','$org','$org','$num',CURRENT_DATE,CURRENT_DATE,'PHYSICAL_COUNT','S12 8.1b','$W','DRAFT',0,'$adm',
  '00002296-0000-0000-0000-000000000091','00002296-0000-0000-0000-000000000092','00002296-0000-0000-0000-000000000093');
SQL
  for p in "$@"; do
    "${PSQL[@]}" -c "INSERT INTO public.stock_adjustment_items (adjustment_id,organization_id,product_id,warehouse_id,current_qty,new_qty,difference_qty,current_rate,new_rate,value_difference) VALUES ('$adj','$org','$p','$W',100,103,3,10,10,30);" >/dev/null
  done
  "${PSQL[@]}" -c "UPDATE public.stock_adjustments SET total_items=(SELECT count(*) FROM public.stock_adjustment_items WHERE adjustment_id='$adj') WHERE id='$adj';" >/dev/null
}

echo '=== 8.1b Stock Adjustment [Y,X] vs Consumption {X,Y} ==='
CURRENT_SCENARIO=8.1b
MO=$( as_user "$(mo_payload 'S12-8B-MO' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',4),jsonb_build_object('item_id','$I2','quantity',4))")" >/dev/null; "${PSQL[@]}" -c "SELECT id FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='S12-8B-MO'" )
mk_wip "$MO"
mk_adj "$ADJ" 'S12-8B-ADJ' "$Y" "$X"
PGAPPNAME='s8b-adj' "${PSQL[@]}" >"$r-adj.out" 2>"$r-adj.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
SELECT public.rpc_submit_stock_adjustment('$ADJ');
\! touch $r-adj.ready
\! bash -c 'while [ ! -f "$r-adj.release" ]; do sleep 0.05; done'
COMMIT;
SQL
apid=$!
wait_for_file "$r-adj.ready" || fail "8.1b: adjustment submit never completed: $(tr -d '\n' < "$r-adj.err")"
PGAPPNAME='s8b-con' "${PSQL[@]}" >"$r-con.out" 2>"$r-con.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
SELECT public.rpc_consume_reserved_materials_v2('$MO','$STAGE',
  jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2),jsonb_build_object('item_id','$I2','quantity',2)));
COMMIT;
SQL
cpid=$!
w=$(wait_for_lock_waiters 1 "'s8b-con'") || fail "8.1b: consumption never blocked (waiters=$w) - HARNESS_FAIL"
echo "  EVIDENCE[8.1b] $(blocking_evidence s8b-con)"
echo "  HELD-BY-CONSUMER $(held_relations s8b-con)"
touch "$r-adj.release"
sa=0; sc=0; wait "$apid" || sa=$?; wait "$cpid" || sc=$?
grep -qi 'deadlock detected\|40P01' "$r-adj.err" "$r-con.err" && fail "8.1b: 40P01 deadlock"
echo "  STATUS[8.1b] adjustment=$sa consumption=$sc"
[[ $sa -eq 0 ]] || fail "8.1b: adjustment must succeed: $(tr -d '\n' < "$r-adj.err")"
[[ $sc -eq 0 ]] || fail "8.1b: consumption must succeed: $(tr -d '\n' < "$r-con.err")"
read -r qx qy <<<"$("${PSQL[@]}" -c "SELECT (SELECT actual_qty FROM public.bins WHERE product_id='$X')||' '||(SELECT actual_qty FROM public.bins WHERE product_id='$Y')")"
num_eq "$qx" 101 || fail "8.1b: X bin=$qx expected 101 (100 +3 adj -2 consumed)"
num_eq "$qy" 101 || fail "8.1b: Y bin=$qy expected 101"
mc=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_consumption WHERE mo_id='$MO'")
[[ "$mc" == "2" ]] || fail "8.1b: expected 2 material_consumption rows, got $mc"
echo "  8.1b PASS bins X=$qx Y=$qy consumption_rows=$mc, no 40P01"
reconcile_product 8.1b-X "$org" "$X"; reconcile_product 8.1b-Y "$org" "$Y"
echo "SLICE12_S8B_PASS"
