#!/usr/bin/env bash
source "$SCRATCH/lib.sh"
org='00002293-f2f2-0000-0000-000000000001'
actor='00002293-f2f2-0000-0000-000000000002'
# A < B by uuid ordering, guaranteed by construction and asserted below.
A='00002293-0000-0000-0000-00000000000a'
B='00002293-0000-0000-0000-00000000000b'
GATE=919101

"${PSQL[@]}" <<SQL
DELETE FROM public.bins WHERE org_id='$org';
DELETE FROM public.products WHERE org_id='$org';
DELETE FROM public.user_organizations WHERE org_id='$org';
DELETE FROM public.organizations WHERE id='$org';
DELETE FROM auth.users WHERE id='$actor';
INSERT INTO public.organizations (id,name,code) VALUES ('$org','M191 S12 Prefix','M191-S12-PFX');
INSERT INTO auth.users (id,email) VALUES ('$actor','m191-s12-pfx@wardah-e2e.invalid');
INSERT INTO public.user_organizations (user_id,org_id,is_active) VALUES ('$actor','$org',true);
INSERT INTO public.products (id,org_id,code,name,is_stockable,base_uom_id)
SELECT p.id,'$org',p.code,p.name,true,u.id FROM (VALUES
 ('$A'::uuid,'S12-PFX-A','Prefix A'),('$B'::uuid,'S12-PFX-B','Prefix B')) AS p(id,code,name)
CROSS JOIN LATERAL (SELECT id FROM public.uoms WHERE org_id IS NULL AND is_active AND NOT is_product_specific LIMIT 1) u;
SQL

CURRENT_SCENARIO=6.1
ord=$("${PSQL[@]}" -c "SELECT ('$A'::uuid < '$B'::uuid)")
[[ "$ord" == "t" ]] || fail "fixture precondition A<B not met"
echo "  PRECONDITION A<B = $ord  (A=$A  B=$B)"

echo '=== 6.1 RED: ordering-removed mutant, crossed arrays ==='
# Test-only mutant: locks in the caller-supplied array order (no ORDER BY),
# with an advisory barrier after the FIRST lock so both backends are proven to
# hold one row lock before either reaches its second.
"${PSQL[@]}" <<SQL
CREATE OR REPLACE FUNCTION public.zz_m191_testonly_mutant_unordered(
  p_org uuid, p_product_ids uuid[], p_gate bigint
) RETURNS uuid[] LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public','pg_temp' AS \$fn\$
DECLARE v_locked uuid[] := '{}'::uuid[]; v_id uuid; v_n int := 0;
BEGIN
  FOR v_id IN SELECT u.id FROM unnest(p_product_ids) WITH ORDINALITY AS u(id,ord) ORDER BY u.ord
  LOOP
    PERFORM p.id FROM public.products p
     WHERE p.org_id = p_org AND p.id = v_id FOR NO KEY UPDATE;
    v_locked := array_append(v_locked, v_id);
    v_n := v_n + 1;
    IF v_n = 1 THEN
      PERFORM pg_advisory_lock(p_gate);
      PERFORM pg_advisory_unlock(p_gate);
    END IF;
  END LOOP;
  RETURN v_locked;
END \$fn\$;
SQL

r=$tmp/s61; rm -f "$r"-*.out "$r"-*.err "$r"-*.ready "$r"-*.release
# Barrier holder
PGAPPNAME='s61-gate' "${PSQL[@]}" >"$r-gate.out" 2>"$r-gate.err" <<SQL &
SELECT pg_advisory_lock($GATE);
\! touch $r-gate.ready
\! bash -c 'while [ ! -f "$r-gate.release" ]; do sleep 0.05; done'
SELECT pg_advisory_unlock($GATE);
SQL
gate_pid=$!
wait_for_file "$r-gate.ready" || fail "6.1: barrier session never acquired the advisory gate"

for side in 1 2; do
  if [[ $side == 1 ]]; then arr="ARRAY['$A'::uuid,'$B'::uuid]"; else arr="ARRAY['$B'::uuid,'$A'::uuid]"; fi
  PGAPPNAME="s61-$side" "${PSQL[@]}" >"$r-$side.out" 2>"$r-$side.err" <<SQL &
BEGIN;
SELECT public.zz_m191_testonly_mutant_unordered('$org',$arr,$GATE);
COMMIT;
SQL
  eval "m_pid_$side=\$!"
done

w=$(wait_for_lock_waiters 2 "'s61-1','s61-2'") || fail "6.1: expected both mutant backends to reach the advisory barrier holding one product row each; got $w"
echo "  EVIDENCE[6.1-barrier] $(blocking_evidence s61-1) || $(blocking_evidence s61-2)"
touch "$r-gate.release"
s1=0; s2=0; wait "$m_pid_1" || s1=$?; wait "$m_pid_2" || s2=$?
wait "$gate_pid" || true
if grep -qi 'deadlock detected' "$r-1.err" "$r-2.err"; then
  loser=$(grep -li 'deadlock detected' "$r-1.err" "$r-2.err" | head -1)
  echo "  6.1 RED CONFIRMED: genuine symmetric deadlock (40P01) in $(basename "$loser") statuses=$s1,$s2"
  grep -i -m1 'deadlock detected' "$loser" | sed 's/^/    /'
else
  fail "6.1: crossed-array mutant did NOT deadlock (statuses=$s1,$s2) - the RED control is not reproducing, so the GREEN result below would prove nothing"
fi
"${PSQL[@]}" -c "DROP FUNCTION public.zz_m191_testonly_mutant_unordered(uuid,uuid[],bigint);"

echo '=== 6.2 GREEN: real helper, two independent blockers, input ARRAY[B,A] ==='
# shellcheck disable=SC2034 # read by lib.sh's fail() across sourced scripts
CURRENT_SCENARIO=6.2
r=$tmp/s62; rm -f "$r"-*.out "$r"-*.err "$r"-*.ready "$r"-*.release

start_blocker() { # $1=name $2=product ; sets BPID (no subshell, so wait works)
  PGAPPNAME="$1" "${PSQL[@]}" >"$r-$1.out" 2>"$r-$1.err" <<SQL &
BEGIN;
SELECT p.id FROM public.products p WHERE p.org_id='$org' AND p.id='$2' FOR NO KEY UPDATE;
\! touch $r-$1.ready
\! bash -c 'while [ ! -f "$r-$1.release" ]; do sleep 0.05; done'
COMMIT;
SQL
  BPID=$!
}
start_blocker blkA "$A"; bpidA=$BPID
wait_for_file "$r-blkA.ready" || fail "6.2: blocker A never locked product A"
start_blocker blkB "$B"; bpidB=$BPID
wait_for_file "$r-blkB.ready" || fail "6.2: blocker B never locked product B"
backA=$("${PSQL[@]}" -c "SELECT pid FROM pg_stat_activity WHERE application_name='blkA'")
backB=$("${PSQL[@]}" -c "SELECT pid FROM pg_stat_activity WHERE application_name='blkB'")
[[ -n "$backA" && -n "$backB" && "$backA" != "$backB" ]] || fail "6.2: blockers are not two independent backends (A=$backA B=$backB)"
echo "  blockers: A holds only product A (pid=$backA), B holds only product B (pid=$backB)"

PGAPPNAME='s62-caller' "${PSQL[@]}" >"$r-caller.out" 2>"$r-caller.err" <<SQL &
BEGIN;
SELECT public.wardah_lock_products_for_stock_write('$org', ARRAY['$B'::uuid,'$A'::uuid]);
COMMIT;
SQL
cpid=$!

# Step 1: caller must block on A only.
w=$(wait_for_lock_waiters 1 "'s62-caller'") || fail "6.2: caller never blocked (waiters=$w)"
blockers1=$("${PSQL[@]}" -c "SELECT array_to_string(pg_blocking_pids(pid),',') FROM pg_stat_activity WHERE application_name='s62-caller'")
echo "  STEP1 caller blocked_by=[$blockers1] (expect exactly A pid=$backA)"
[[ "$blockers1" == "$backA" ]] || fail "6.2: caller must block on product A FIRST and ONLY; blocked_by=[$blockers1], A=$backA, B=$backB"

# Step 2: release A -> caller must then block on B only.
touch "$r-blkA.release"; wait "$bpidA" || fail "6.2: blocker A failed to commit"
for _ in $(seq 1 400); do
  blockers2=$("${PSQL[@]}" -c "SELECT coalesce(array_to_string(pg_blocking_pids(pid),','),'') FROM pg_stat_activity WHERE application_name='s62-caller' AND state='active' AND wait_event_type='Lock'")
  [[ "$blockers2" == "$backB" ]] && break
  sleep 0.05
done
echo "  STEP2 caller blocked_by=[$blockers2] (expect exactly B pid=$backB)"
[[ "$blockers2" == "$backB" ]] || fail "6.2: after releasing A the caller must block on B ONLY; blocked_by=[$blockers2]"

# Step 3: release B -> caller completes, no deadlock.
touch "$r-blkB.release"; wait "$bpidB" || fail "6.2: blocker B failed to commit"
cst=0; wait "$cpid" || cst=$?
grep -qi 'deadlock\|40P01' "$r-caller.err" && fail "6.2: caller hit 40P01"
[[ $cst -eq 0 ]] || fail "6.2: caller failed (status=$cst): $(tr -d '\n' < "$r-caller.err")"
ret=$(tr -d '\n' < "$r-caller.out")
echo "  STEP3 caller completed without deadlock; returned=$ret"
case "$ret" in
  *"$A"*"$B"*) echo "  6.2 PASS: real helper acquired A then B (canonical ascending) despite ARRAY[B,A] input" ;;
  *) fail "6.2: helper return is not canonical ascending [A,B]: $ret" ;;
esac
echo "SLICE12_S6_PASS"
