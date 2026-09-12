#!/usr/bin/env bash
source "$SCRATCH/s9_fixture.sh"
reset_fixture
# shellcheck disable=SC2034 # read by lib.sh's fail() across sourced scripts
CURRENT_SCENARIO=10.2
GRH='00002296-0000-0000-0000-0000000000aa'
"${PSQL[@]}" -c "INSERT INTO public.goods_receipts (id,org_id,vendor_id) VALUES ('$GRH','$org','$VEND');"
r=$tmp/s102; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err

echo '=== 10.2 real helper (FOR NO KEY UPDATE): FK child insert must NOT block ==='
# Blocker owns bin X so the reservation stops AFTER the product prefix, on its bin.
PGAPPNAME='p102-blk' "${PSQL[@]}" >"$r-blk.out" 2>"$r-blk.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE org_id='$org' AND product_id='$X' FOR UPDATE;
\! touch $r-blk.ready
\! bash -c 'while [ ! -f "$r-blk.release" ]; do sleep 0.05; done'
COMMIT;
SQL
blk=$!
wait_for_file "$r-blk.ready" || fail "10.2: blocker never locked bin X"
PGAPPNAME='p102-res' "${PSQL[@]}" >"$r-res.out" 2>"$r-res.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
$(mo_payload 'S12-102-MO' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',3))")
COMMIT;
SQL
respid=$!
w=$(wait_for_lock_waiters 1 "'p102-res'") || fail "10.2: reservation never blocked on its bin (waiters=$w)"
echo "  reservation state: $(blocking_evidence p102-res)"
echo "  reservation holds: $(held_relations p102-res)"
held=$(held_relations p102-res)
case "$held" in *products*) : ;; *) fail "10.2: reservation is not holding a products lock - it never reached the prefix" ;; esac

# Independent FK child probe. FK on goods_receipt_lines.product_id takes an
# implicit FOR KEY SHARE on the product, which FOR NO KEY UPDATE must allow.
probe_out="$r-probe1.out"; probe_err="$r-probe1.err"
PGAPPNAME='p102-probe1' timeout 20 "${PSQL[@]}" >"$probe_out" 2>"$probe_err" <<SQL
BEGIN;
INSERT INTO public.goods_receipt_lines (org_id,goods_receipt_id,product_id,ordered_quantity,received_quantity,unit_cost)
VALUES ('$org','$GRH','$X',1,1,10);
COMMIT;
SELECT 'PROBE1_COMPLETED';
SQL
pr1=$?
[[ $pr1 -eq 0 ]] || fail "10.2: FK child insert did NOT complete under the real FOR NO KEY UPDATE helper (rc=$pr1): $(tr -d '\n' < "$probe_err")"
grep -q PROBE1_COMPLETED "$probe_out" || fail "10.2: probe 1 produced no completion marker"
echo "  10.2 PASS(a): FK child insert completed while the reservation held product X FOR NO KEY UPDATE"
touch "$r-blk.release"; wait "$blk" || true; sres=0; wait "$respid" || sres=$?
echo "  reservation final status=$sres"

echo '=== 10.2 FOR UPDATE mutant: the same FK child insert MUST block ==='
PGAPPNAME='p102-mut' "${PSQL[@]}" >"$r-mut.out" 2>"$r-mut.err" <<SQL &
BEGIN;
SELECT id FROM public.products WHERE org_id='$org' AND id='$X' FOR UPDATE;
\! touch $r-mut.ready
\! bash -c 'while [ ! -f "$r-mut.release" ]; do sleep 0.05; done'
COMMIT;
SQL
mut=$!
wait_for_file "$r-mut.ready" || fail "10.2: FOR UPDATE mutant never locked product X"
PGAPPNAME='p102-probe2' "${PSQL[@]}" >"$r-probe2.out" 2>"$r-probe2.err" <<SQL &
BEGIN;
INSERT INTO public.goods_receipt_lines (org_id,goods_receipt_id,product_id,ordered_quantity,received_quantity,unit_cost)
VALUES ('$org','$GRH','$X',1,1,10);
COMMIT;
SQL
pb2=$!
w=$(wait_for_lock_waiters 1 "'p102-probe2'") || fail "10.2: FK child insert did NOT block against the FOR UPDATE mutant (waiters=$w) - the probe is non-discriminating, so PASS(a) proves nothing"
echo "  10.2 PASS(b): the same FK child insert blocked against FOR UPDATE: $(blocking_evidence p102-probe2)"
touch "$r-mut.release"; wait "$mut" || true; sp2=0; wait "$pb2" || sp2=$?
[[ $sp2 -eq 0 ]] || fail "10.2: probe 2 failed after release (rc=$sp2)"
echo "  10.2 PASS: KEY SHARE compatibility (real) vs blocking (FOR UPDATE mutant) is the discriminator, both observed"
echo "SLICE12_S10_2_PASS"
