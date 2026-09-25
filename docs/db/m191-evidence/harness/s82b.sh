#!/usr/bin/env bash
source "$SCRATCH/s9_fixture.sh"
reset_fixture
r=$tmp/s82b; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
GATE=982101
echo '=== 8.2(2) narrowed superset + guard REMOVED, crossed MOs => deterministic 40P01 ==='
# shellcheck disable=SC2034 # read by lib.sh's fail() across sourced scripts
CURRENT_SCENARIO=8.2-2
"${PSQL[@]}" <<MUT
DO \$mk\$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure);
  v_def := replace(v_def,
    'rpc_consume_reserved_materials_v2(p_mo_id uuid, p_stage_id uuid, p_consumptions jsonb)',
    'zz_m191_testonly_consume_noguard(p_mo_id uuid, p_stage_id uuid, p_consumptions jsonb)');
  v_def := replace(v_def,
    'v_locked_products:=' || chr(10) || '    public.wardah_lock_products_for_stock_write(v_org,v_products);',
    'v_products := (SELECT CASE WHEN cardinality(v_products)>0 THEN ARRAY[v_products[1]] ELSE v_products END);' || chr(10) ||
    '  v_locked_products:=' || chr(10) || '    public.wardah_lock_products_for_stock_write(v_org,v_products);' || chr(10) ||
    '  PERFORM pg_advisory_lock($GATE); PERFORM pg_advisory_unlock($GATE);');
  v_def := replace(v_def,
    'RAISE EXCEPTION ''PRODUCT_NOT_PRELOCKED: %'', v_product;',
    'NULL; -- guard removed for this RED mutant only');
  IF position('zz_m191_testonly_consume_noguard' in v_def)=0 THEN RAISE EXCEPTION 'MUTANT_RENAME_FAILED'; END IF;
  IF position('ARRAY[v_products[1]]' in v_def)=0 THEN RAISE EXCEPTION 'MUTANT_NARROWING_NOT_APPLIED'; END IF;
  IF position('guard removed for this RED mutant only' in v_def)=0 THEN RAISE EXCEPTION 'MUTANT_GUARD_REMOVAL_NOT_APPLIED'; END IF;
  IF position('PRODUCT_NOT_PRELOCKED' in v_def)<>0 THEN RAISE EXCEPTION 'MUTANT_GUARD_STILL_PRESENT'; END IF;
  EXECUTE v_def;
END \$mk\$;
MUT
echo "  mutant built (narrowed prefix + guard removed + barrier), verified by three anchor assertions"

narrowed_product() { "${PSQL[@]}" -c "SELECT product_id FROM public.material_reservations WHERE mo_id='$1' AND status='reserved' ORDER BY id LIMIT 1"; }
MOX=''; MOY=''
for i in 1 2 3 4 5 6 7 8; do
  as_user "$(mo_payload "S12-82B-MO-$i" "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2),jsonb_build_object('item_id','$I2','quantity',2))")" >/dev/null
  m=$("${PSQL[@]}" -c "SELECT id FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='S12-82B-MO-$i'")
  mk_wip "$m"
  np=$(narrowed_product "$m")
  [[ -z "$MOX" && "$np" == "$X" ]] && MOX=$m
  [[ -z "$MOY" && "$np" == "$Y" ]] && MOY=$m
  [[ -n "$MOX" && -n "$MOY" ]] && break
done
[[ -n "$MOX" && -n "$MOY" ]] || fail "8.2(2): could not obtain one MO narrowing to X and one to Y"
echo "  crossed pair: MO narrowing to X=$MOX ; MO narrowing to Y=$MOY"

PGAPPNAME='s82b-gate' "${PSQL[@]}" >"$r-gate.out" 2>"$r-gate.err" <<SQL &
SELECT pg_advisory_lock($GATE);
\! touch $r-gate.ready
\! bash -c 'while [ ! -f "$r-gate.release" ]; do sleep 0.05; done'
SELECT pg_advisory_unlock($GATE);
SQL
gp=$!
wait_for_file "$r-gate.ready" || fail "8.2(2): barrier never acquired"
launch() { PGAPPNAME="$1" "${PSQL[@]}" >"$r-$1.out" 2>"$r-$1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
SELECT public.zz_m191_testonly_consume_noguard('$2','$STAGE',$3);
COMMIT;
SQL
LP=$!; }
launch ca "$MOX" "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',1),jsonb_build_object('item_id','$I2','quantity',1))"; pa=$LP
launch cb "$MOY" "jsonb_build_array(jsonb_build_object('item_id','$I2','quantity',1),jsonb_build_object('item_id','$I1','quantity',1))"; pb=$LP
w=$(wait_for_lock_waiters 2 "'ca','cb'") || fail "8.2(2): both mutants never reached the barrier (waiters=$w)"
echo "  barrier: $(blocking_evidence ca) || $(blocking_evidence cb)"
touch "$r-gate.release"
sa=0; sb=0; wait "$pa" || sa=$?; wait "$pb" || sb=$?; wait "$gp" || true
if grep -qi 'deadlock detected' "$r-ca.err" "$r-cb.err"; then
  echo "  8.2(2) RED CONFIRMED: narrowed superset without the guard deadlocks (40P01) ca=$sa cb=$sb"
  grep -i -m1 'deadlock detected' "$r-ca.err" "$r-cb.err" | sed 's/^/    /'
else
  fail "8.2(2): narrowed+unguarded mutant did NOT deadlock (ca=$sa cb=$sb) - this RED control is not discriminating"
fi
"${PSQL[@]}" -c "DROP FUNCTION public.zz_m191_testonly_consume_noguard(uuid,uuid,jsonb);"
echo "SLICE12_S82_2_PASS"
