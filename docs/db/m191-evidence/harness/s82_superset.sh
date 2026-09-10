#!/usr/bin/env bash
source "$SCRATCH/s9_fixture.sh"
reset_fixture
r=$tmp/s82; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err

mk_mo2() { # $1 order -> echo mo_id ; reserves I1 and I2
  as_user "$(mo_payload "$1" "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',4),jsonb_build_object('item_id','$I2','quantity',4))")" >/dev/null
  local m; m=$("${PSQL[@]}" -c "SELECT id FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='$1'")
  mk_wip "$m"; echo "$m"
}
consume() { # $1 mo $2 items-json -> runs as the permitted user
  as_user "SELECT public.rpc_consume_reserved_materials_v2('$1','$STAGE',$2);"
}

echo '=== 8.2(3) real full per-MO superset + guard: GREEN, no guard error, no deadlock ==='
CURRENT_SCENARIO=8.2-3
MO=$(mk_mo2 'S12-82-MO-A')
out=$(consume "$MO" "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2),jsonb_build_object('item_id','$I2','quantity',2))" 2>&1) || fail "8.2(3): real consumption failed: $out"
echo "$out" | grep -q 'PRODUCT_NOT_PRELOCKED' && fail "8.2(3): real superset raised the guard"
read -r qx qy <<<"$("${PSQL[@]}" -c "SELECT (SELECT actual_qty FROM public.bins WHERE product_id='$X')||' '||(SELECT actual_qty FROM public.bins WHERE product_id='$Y')")"
num_eq "$qx" 98 || fail "8.2(3): X bin=$qx expected 98"
num_eq "$qy" 98 || fail "8.2(3): Y bin=$qy expected 98"
wip=$("${PSQL[@]}" -c "SELECT cost_material FROM public.stage_wip_log WHERE mo_id='$MO' AND stage_id='$STAGE'")
mc=$("${PSQL[@]}" -c "SELECT count(*)||'/'||coalesce(SUM(total_cost)::text,'0') FROM public.material_consumption WHERE mo_id='$MO'")
echo "  8.2(3) PASS bins X=$qx Y=$qy consumption(rows/COGS)=$mc stage_wip cost_material=$wip"
reconcile_product 8.2-3-X "$org" "$X"; reconcile_product 8.2-3-Y "$org" "$Y"

echo '=== 8.2(1) narrowed superset + guard retained => PRODUCT_NOT_PRELOCKED ==='
CURRENT_SCENARIO=8.2-1
# Test-only mutant: identical to the candidate except the prefix is narrowed to
# the FIRST reservation only, with the guard left in place.
"${PSQL[@]}" <<'MUT'
DO $mk$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure);
  v_def := replace(v_def,
    'rpc_consume_reserved_materials_v2(p_mo_id uuid, p_stage_id uuid, p_consumptions jsonb)',
    'zz_m191_testonly_consume_narrow(p_mo_id uuid, p_stage_id uuid, p_consumptions jsonb)');
  -- narrow the prefix: keep only the lowest-id reservation's product
  v_def := replace(v_def,
    'v_locked_products:=' || chr(10) || '    public.wardah_lock_products_for_stock_write(v_org,v_products);',
    'v_products := (SELECT CASE WHEN cardinality(v_products)>0 THEN ARRAY[v_products[1]] ELSE v_products END);' || chr(10) ||
    '  v_locked_products:=' || chr(10) || '    public.wardah_lock_products_for_stock_write(v_org,v_products);');
  IF position('zz_m191_testonly_consume_narrow' in v_def)=0 THEN
    RAISE EXCEPTION 'MUTANT_RENAME_FAILED';
  END IF;
  IF position('ARRAY[v_products[1]]' in v_def)=0 THEN
    RAISE EXCEPTION 'MUTANT_NARROWING_NOT_APPLIED - the anchor text did not match the live body';
  END IF;
  EXECUTE v_def;
END $mk$;
MUT
MO1=$(mk_mo2 'S12-82-MO-B')
set +e
out=$(as_user "SELECT public.zz_m191_testonly_consume_narrow('$MO1','$STAGE',
  jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',1),jsonb_build_object('item_id','$I2','quantity',1)));" 2>&1)
rc=$?
set -e
echo "$out" | grep -q 'PRODUCT_NOT_PRELOCKED' \
  || fail "8.2(1): narrowed superset with the guard retained did NOT raise PRODUCT_NOT_PRELOCKED (rc=$rc): $(echo "$out" | tr -d '\n' | tail -c 300)"
echo "  8.2(1) PASS narrowed superset is caught by the guard: $(echo "$out" | grep -o 'PRODUCT_NOT_PRELOCKED[^ ]*' | head -1)"
left=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_consumption WHERE mo_id='$MO1'")
[[ "$left" == "0" ]] || fail "8.2(1): guard fired but $left consumption row(s) survived"
# The mutant is a copy of a SECURITY DEFINER body and is created with the
# default PUBLIC EXECUTE grant, so it must never be left behind, even in a
# disposable database.
"${PSQL[@]}" -c "DROP FUNCTION public.zz_m191_testonly_consume_narrow(uuid,uuid,jsonb);"
echo "SLICE12_S82_1_PASS"
