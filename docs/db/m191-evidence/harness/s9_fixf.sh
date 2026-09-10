#!/usr/bin/env bash
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

# =============================================================================
# 9.4 / 9.5  REAL acquisition-order probe  (final-review remediation, Finding 2)
# =============================================================================
#
# WHY THIS EXISTS. At the reviewed head fa1de77f07077af97623c34c0a743b5d00000785
# nothing above proved that the DEPLOYED release_expired_reservations acquires
# reservation rows in ascending id order:
#   * §9.1 proves reversed-vs-ascending deadlocks, but does it with two
#     handwritten test-only functions, so it says nothing about the real body;
#   * §9.2 lets the real release FINISH before consumption starts competing, so
#     it proves serialization, not acquisition ORDER.
# Flipping the real body's `ORDER BY mr.id` to `ORDER BY mr.id DESC` was
# reproduced GREEN through the catalog contract, the static gate and all of §9.
#
# WHAT THIS PROVES. Two independent blockers each hold exactly one reservation
# row. The real function is then started and its acquisition sequence is read
# out of pg_blocking_pids — observed backend state, never a sleep. Releasing the
# blocker it is actually waiting on lets it move to the next one, so the
# recorded sequence is the order the function itself chose.
#
# The same probe is then run against a DESC mutant derived from the DEPLOYED
# body (identical but for the lock order). The mutant must show the reversed
# sequence; if it does not, the probe cannot discriminate and this scenario
# fails as a harness defect rather than passing vacuously.

CURRENT_SCENARIO=9.4
MUTANT_FN=public.zz_m191_testonly_release_desc_probe
drop_mutant() {
  "${PSQL[@]}" -c "DROP FUNCTION IF EXISTS $MUTANT_FN(uuid);" >/dev/null 2>&1 || true
}
# Test-only instrumentation must not survive this script on any path: the
# catalog contract fails closed on any public.zz_% function.
trap drop_mutant EXIT

# Sets PROBE_ORDER ("<first>-><second>" in R1/R2 terms), PROBE_STATUS,
# PROBE_OUT and PROBE_ERR. Deliberately not a command substitution: that would
# run the probe in a subshell, so neither the results nor the observed lock
# evidence would reach the caller.
probe_acquisition_order() { # $1 label  $2 fully-qualified release function
  local lbl=$1 fn=$2 k rid first second
  local r="$tmp/$lbl"; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err

  # One blocker per reservation row, each holding ONLY its own row. Neither
  # blocker can be reached except by a sweep that actually wants that row.
  for k in 1 2; do
    eval "rid=\$R$k"
    PGAPPNAME="$lbl-b$k" "${PSQL[@]}" >"$r-b$k.out" 2>"$r-b$k.err" <<SQL &
BEGIN;
SELECT id FROM public.material_reservations WHERE id='$rid' FOR NO KEY UPDATE;
\! touch $r-b$k.ready
\! bash -c 'while [ ! -f "$r-b$k.release" ]; do sleep 0.05; done'
COMMIT;
SQL
    eval "B${k}PID=\$!"
    wait_for_file "$r-b$k.ready" || fail "$lbl: blocker_R$k never took its row: $(tr -d '\n' < "$r-b$k.err")"
  done

  PGAPPNAME="$lbl-rel" "${PSQL[@]}" >"$r-rel.out" 2>"$r-rel.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
SELECT $fn('$org');
COMMIT;
SQL
  local relpid=$!

  first=$(wait_for_any_blocker "$lbl-rel") \
    || fail "$lbl: release never blocked on a reservation row (blockers='$first') - HARNESS_FAIL"
  echo "  EVIDENCE[$lbl first] $(blocking_evidence "$lbl-rel")"
  case "$first" in
    "$lbl-b1") first=R1 ;;
    "$lbl-b2") first=R2 ;;
    *) touch "$r-b1.release" "$r-b2.release"; wait "$relpid" || true
       fail "$lbl: release blocked on an unexpected backend set '$first'" ;;
  esac

  # Let go of exactly the row it is waiting on; it must then move to the other.
  if [[ $first == R1 ]]; then
    touch "$r-b1.release"; second=$(wait_for_blockers "$lbl-rel" "$lbl-b2") || second="TIMEOUT($second)"
    [[ $second == "$lbl-b2" ]] && second=R2
    echo "  EVIDENCE[$lbl second] $(blocking_evidence "$lbl-rel")"
    touch "$r-b2.release"
  else
    touch "$r-b2.release"; second=$(wait_for_blockers "$lbl-rel" "$lbl-b1") || second="TIMEOUT($second)"
    [[ $second == "$lbl-b1" ]] && second=R1
    echo "  EVIDENCE[$lbl second] $(blocking_evidence "$lbl-rel")"
    touch "$r-b1.release"
  fi

  PROBE_STATUS=0; wait "$relpid" || PROBE_STATUS=$?
  wait "$B1PID" || true; wait "$B2PID" || true
  PROBE_ERR=$(tr -d '\n' < "$r-rel.err")
  # Last line only: the two set_config() calls above echo their own results.
  PROBE_OUT=$(tail -1 "$r-rel.out" | tr -d '\n')
  PROBE_ORDER="$first->$second"
}

prepare_two_reservations() { # sets R1 (lower uuid) and R2 (higher uuid)
  reset_fixture
  mk_mo "$1" >/dev/null
  expire_all
  local n
  n=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE org_id='$org' AND status='reserved' AND expires_at < now()")
  num_eq "$n" 2 || fail "$CURRENT_SCENARIO: fixture must present exactly 2 expired reservations, got $n"
  # uuid has no min()/max() aggregate; take the extremes by the same ordering
  # the function under test is supposed to use.
  R1=$("${PSQL[@]}" -c "SELECT id FROM public.material_reservations WHERE org_id='$org' AND status='reserved' ORDER BY id ASC LIMIT 1")
  R2=$("${PSQL[@]}" -c "SELECT id FROM public.material_reservations WHERE org_id='$org' AND status='reserved' ORDER BY id DESC LIMIT 1")
  # Assert the precondition with PostgreSQL's own uuid comparison, not bash's
  # locale-dependent string ordering.
  local ord
  ord=$("${PSQL[@]}" -c "SELECT '$R1'::uuid < '$R2'::uuid")
  [[ "$ord" == "t" ]] || fail "$CURRENT_SCENARIO: fixture precondition R1 < R2 violated (R1=$R1 R2=$R2)"
  echo "  fixture: R1=$R1 < R2=$R2"
}

echo '=== 9.4 GREEN: the DEPLOYED release_expired_reservations acquires R1 then R2 ==='
prepare_two_reservations 'S12-F-MO-4'
probe_acquisition_order s9f-p4 public.release_expired_reservations
ORDER_REAL=$PROBE_ORDER
echo "  observed acquisition order (real function) = $ORDER_REAL status=$PROBE_STATUS returned=$PROBE_OUT"
[[ $PROBE_STATUS -eq 0 ]] || fail "9.4: the real release must complete once both blockers let go: $PROBE_ERR"
[[ "$ORDER_REAL" == "R1->R2" ]] || fail "9.4: the deployed release_expired_reservations acquired reservations in $ORDER_REAL, not ascending R1->R2"
num_eq "$PROBE_OUT" 2 || fail "9.4: the sweep must release both expired reservations, returned $PROBE_OUT"
echo "  9.4 PASS ascending acquisition proven from pg_blocking_pids against the real function"

echo '=== 9.5 DISCRIMINATOR: the same probe on a DESC mutant of the deployed body ==='
CURRENT_SCENARIO=9.5
prepare_two_reservations 'S12-F-MO-5'
# The mutant is derived from the DEPLOYED body, so it differs from it in exactly
# one respect: the lock order. Anything else that changes would be a harness
# defect, and the assertions below refuse to build a mutant that is not that.
"${PSQL[@]}" <<'SQL'
DO $mut$
DECLARE
  v_def text;
  v_mut text;
  v_hits integer;
BEGIN
  v_def := pg_get_functiondef('public.release_expired_reservations(uuid)'::regprocedure);

  SELECT count(*) INTO v_hits
  FROM regexp_matches(v_def, 'ORDER BY mr\.id', 'g');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'S12_S9_MUTANT_ORDER_CLAUSE_HITS: % (expected exactly 1)', v_hits;
  END IF;

  v_mut := replace(v_def,
    'FUNCTION public.release_expired_reservations(',
    'FUNCTION public.zz_m191_testonly_release_desc_probe(');
  IF v_mut = v_def THEN
    RAISE EXCEPTION 'S12_S9_MUTANT_RENAME_FAILED';
  END IF;

  v_mut := replace(v_mut, 'ORDER BY mr.id', 'ORDER BY mr.id DESC');
  EXECUTE v_mut;
END
$mut$;
SQL
DIFFLINES=$("${PSQL[@]}" -c "
SELECT count(*) FROM (
  SELECT unnest(string_to_array(replace(pg_get_functiondef('public.release_expired_reservations(uuid)'::regprocedure),'release_expired_reservations','X'), E'\n'))
  EXCEPT ALL
  SELECT unnest(string_to_array(replace(pg_get_functiondef('$MUTANT_FN(uuid)'::regprocedure),'zz_m191_testonly_release_desc_probe','X'), E'\n'))
) d")
num_eq "$DIFFLINES" 1 || fail "9.5: the mutant must differ from the deployed body in exactly 1 line (the lock order), differs in $DIFFLINES"
echo "  mutant derived from the deployed body; single differing line = the ORDER BY clause"

probe_acquisition_order s9f-p5 "$MUTANT_FN"
ORDER_MUT=$PROBE_ORDER
echo "  observed acquisition order (DESC mutant) = $ORDER_MUT status=$PROBE_STATUS returned=$PROBE_OUT"
[[ "$ORDER_MUT" != "R1->R2" ]] || fail "9.5: the DESC mutant produced the SAME ascending order as the real function - the probe cannot discriminate, so 9.4 proves nothing"
[[ "$ORDER_MUT" == "R2->R1" ]] || fail "9.5: expected the DESC mutant to acquire R2->R1, observed $ORDER_MUT"
echo "  9.5 PASS reversed lock order is observed as R2->R1, so 9.4's R1->R2 is a real discriminating result"

drop_mutant
LEAKED=$("${PSQL[@]}" -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'zz\_%'")
num_eq "$LEAKED" 0 || fail "9.5: test-only instrumentation survived ($LEAKED function(s))"
echo "  9.5 cleanup: no public.zz_% function left behind"

echo "SLICE12_S9_PASS"
