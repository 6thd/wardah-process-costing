source "$SCRATCH/s9_fixture.sh"
reset_fixture
r=$tmp/s9f; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err

mk_mo() { # $1 order_number -> echoes mo_id ; materials I1,I2 qty 5 each
  as_user "$(mo_payload "$1" "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',5),jsonb_build_object('item_id','$I2','quantity',5))")" >/dev/null
  "${PSQL[@]}" -c "SELECT id FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='$1'"
}
expire_all() { "${PSQL[@]}" -c "UPDATE public.material_reservations SET expires_at=now()-interval '1 hour' WHERE org_id='$org' AND status='reserved';" >/dev/null; }
stage_of() { mk_wip "$1"; echo "$STAGE"; }

echo '=== 9.1 RED: reversed reservation-lock order vs ascending order => 40P01 ==='
CURRENT_SCENARIO=9.1
MO1=$(mk_mo 'S12-F-MO-1'); expire_all
"${PSQL[@]}" <<SQL
CREATE OR REPLACE FUNCTION public.zz_m191_testonly_release_desc(p_org uuid, p_gate bigint)
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS \$fn\$
DECLARE v_id uuid; v_n int:=0;
BEGIN
  -- Rows are locked ONE AT A TIME so the two orderings can genuinely interleave.
  -- A single set-locking query would lock the whole set atomically and could
  -- never cross, which would make this RED vacuous.
  FOR v_id IN SELECT mr.id FROM public.material_reservations mr
    WHERE mr.org_id=p_org AND mr.status='reserved' ORDER BY mr.id DESC
  LOOP
    PERFORM 1 FROM public.material_reservations WHERE id=v_id FOR NO KEY UPDATE;
    v_n:=v_n+1;
    IF v_n=1 THEN PERFORM pg_advisory_lock(p_gate); PERFORM pg_advisory_unlock(p_gate); END IF;
  END LOOP; RETURN v_n;
END \$fn\$;
CREATE OR REPLACE FUNCTION public.zz_m191_testonly_release_asc(p_org uuid, p_gate bigint)
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS \$fn\$
DECLARE v_id uuid; v_n int:=0;
BEGIN
  -- Rows are locked ONE AT A TIME so the two orderings can genuinely interleave.
  -- A single set-locking query would lock the whole set atomically and could
  -- never cross, which would make this RED vacuous.
  FOR v_id IN SELECT mr.id FROM public.material_reservations mr
    WHERE mr.org_id=p_org AND mr.status='reserved' ORDER BY mr.id ASC
  LOOP
    PERFORM 1 FROM public.material_reservations WHERE id=v_id FOR NO KEY UPDATE;
    v_n:=v_n+1;
    IF v_n=1 THEN PERFORM pg_advisory_lock(p_gate); PERFORM pg_advisory_unlock(p_gate); END IF;
  END LOOP; RETURN v_n;
END \$fn\$;
SQL
GATE=929101
PGAPPNAME='s9f-gate' "${PSQL[@]}" >"$r-gate.out" 2>"$r-gate.err" <<SQL &
SELECT pg_advisory_lock($GATE);
\! touch $r-gate.ready
\! bash -c 'while [ ! -f "$r-gate.release" ]; do sleep 0.05; done'
SELECT pg_advisory_unlock($GATE);
SQL
gp=$!
wait_for_file "$r-gate.ready" || fail "9.1: barrier never acquired"
for v in desc asc; do
  PGAPPNAME="s9f-$v" "${PSQL[@]}" >"$r-$v.out" 2>"$r-$v.err" <<SQL &
BEGIN;
SELECT public.zz_m191_testonly_release_$v('$org',$GATE);
COMMIT;
SQL
  eval "pid_$v=\$!"
done
w=$(wait_for_lock_waiters 2 "'s9f-desc','s9f-asc'") || fail "9.1: both orderings never reached the barrier (waiters=$w)"
echo "  barrier: $(blocking_evidence s9f-desc) || $(blocking_evidence s9f-asc)"
touch "$r-gate.release"
sd=0; sa=0; wait "$pid_desc" || sd=$?; wait "$pid_asc" || sa=$?; wait "$gp" || true
if grep -qi 'deadlock detected' "$r-desc.err" "$r-asc.err"; then
  echo "  9.1 RED CONFIRMED: reversed vs ascending reservation locking deadlocks (40P01) desc=$sd asc=$sa"
else
  fail "9.1: reversed-order RED did not reproduce (desc=$sd asc=$sa) - the Fix F GREEN below would prove nothing"
fi
"${PSQL[@]}" -c "DROP FUNCTION public.zz_m191_testonly_release_desc(uuid,bigint); DROP FUNCTION public.zz_m191_testonly_release_asc(uuid,bigint);"

echo '=== 9.2 GREEN: real release_expired_reservations vs consumption ==='
CURRENT_SCENARIO=9.2
reset_fixture
MO2=$(mk_mo 'S12-F-MO-2'); ST2ID=$(stage_of "$MO2"); expire_all
echo "  mo=$MO2 stage=$ST2ID reservations=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE mo_id='$MO2'")"
# release holds open; consumption must serialize behind it, not deadlock.
PGAPPNAME='s9f-rel' "${PSQL[@]}" >"$r-rel.out" 2>"$r-rel.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT public.release_expired_reservations('$org');
\! touch $r-rel.ready
\! bash -c 'while [ ! -f "$r-rel.release" ]; do sleep 0.05; done'
COMMIT;
SQL
relpid=$!
wait_for_file "$r-rel.ready" || fail "9.2: release never completed: $(tr -d '\n' < "$r-rel.err")"
PGAPPNAME='s9f-con' "${PSQL[@]}" >"$r-con.out" 2>"$r-con.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
SELECT public.rpc_consume_reserved_materials_v2('$MO2','$ST2ID',
  jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2)));
COMMIT;
SQL
conpid=$!
w=$(wait_for_lock_waiters 1 "'s9f-con'") || fail "9.2: consumption never blocked on the release (waiters=$w) - HARNESS_FAIL"
echo "  EVIDENCE[9.2] $(blocking_evidence s9f-con)"
touch "$r-rel.release"
sr=0; sc=0; wait "$relpid" || sr=$?; wait "$conpid" || sc=$?
grep -qi 'deadlock detected\|40P01' "$r-rel.err" "$r-con.err" && fail "9.2: 40P01 deadlock between release and consumption"
echo "  STATUS[9.2] release=$sr(returned $(tr -d '\n' < "$r-rel.out")) consumption=$sc"
[[ $sr -eq 0 ]] || fail "9.2: release must succeed"
# release won the serialization => consumption must hit the predecessor error, atomically
[[ $sc -ne 0 ]] || fail "9.2: release committed first, so consumption of an expired reservation must fail with ACTIVE_RESERVATION_NOT_FOUND, but it succeeded"
grep -q 'ACTIVE_RESERVATION_NOT_FOUND' "$r-con.err" || fail "9.2: wrong error after release won: $(tr -d '\n' < "$r-con.err")"
mc=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_consumption WHERE mo_id='$MO2'")
[[ "$mc" == "0" ]] || fail "9.2: partial consumption survived a business failure ($mc rows)"
sq=$("${PSQL[@]}" -c "SELECT coalesce(SUM(quantity_consumed),0) FROM public.material_reservations WHERE mo_id='$MO2'")
num_eq "$sq" 0 || fail "9.2: quantity_consumed changed despite failure ($sq)"
echo "  9.2 PASS release wins => ACTIVE_RESERVATION_NOT_FOUND, zero partial consumption/SLE"
"${PSQL[@]}" -c "SELECT '  released semantics: '||string_agg(status||' reserved='||quantity_reserved||' consumed='||quantity_consumed||' released='||coalesce(quantity_released::text,'NULL'),' | ' ORDER BY id) FROM public.material_reservations WHERE mo_id='$MO2'"
badrel=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE mo_id='$MO2' AND status='expired' AND quantity_released IS DISTINCT FROM (quantity_reserved - quantity_consumed)")
[[ "$badrel" == "0" ]] || fail "9.2: quantity_released <> quantity_reserved - quantity_consumed on $badrel row(s)"
reconcile_product 9.2-X "$org" "$X"

echo '=== 9.3 GREEN: consumption exhausts first, then release returns 0 for that row ==='
CURRENT_SCENARIO=9.3
reset_fixture
MO3=$(mk_mo 'S12-F-MO-3'); ST3ID=$(stage_of "$MO3")
as_user "SELECT set_config('request.jwt.claims','{\"sub\":\"$adm\",\"role\":\"authenticated\"}',true);
SELECT public.rpc_consume_reserved_materials_v2('$MO3','$ST3ID',
  jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',5)));" > "$r-con3.out" 2>"$r-con3.err" || fail "9.3: full consumption failed: $(tr -d '\n' < "$r-con3.err")"
st=$("${PSQL[@]}" -c "SELECT status||'/'||quantity_consumed FROM public.material_reservations WHERE mo_id='$MO3' AND item_id='$I1'")
echo "  after full consumption I1 reservation=$st"
expire_all
rel=$("${PSQL[@]}" -c "SELECT public.release_expired_reservations('$org')")
echo "  release_expired_reservations returned=$rel (only the still-'reserved' I2 row qualifies)"
i1st=$("${PSQL[@]}" -c "SELECT status||'/'||quantity_consumed||'/'||coalesce(quantity_released::text,'NULL') FROM public.material_reservations WHERE mo_id='$MO3' AND item_id='$I1'")
case "$i1st" in
  consumed/*) echo "  9.3 PASS exhausted reservation untouched by the sweep: $i1st" ;;
  *) fail "9.3: fully consumed reservation was corrupted by the release sweep: $i1st" ;;
esac
num_eq "$rel" 1 || fail "9.3: expected the sweep to release exactly the 1 remaining reserved row, got $rel"
reconcile_product 9.3-X "$org" "$X"
echo "SLICE12_S9_PASS"
