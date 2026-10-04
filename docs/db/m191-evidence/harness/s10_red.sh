#!/usr/bin/env bash
source "$SCRATCH/s9_fixture.sh"
reset_fixture
# shellcheck disable=SC2034 # read by lib.sh's fail() across sourced scripts
CURRENT_SCENARIO=10.1-RED
GR_YX="jsonb_build_array(
  jsonb_build_object('product_id','$Y','qty_entered',4,'unit_cost',10),
  jsonb_build_object('product_id','$X','qty_entered',4,'unit_cost',10))"
echo '=== 10.1 RED control (pre-Fix-G bodies): reservation [X,Y] vs GR [Y,X] ==='
r=$tmp/s10red; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
PGAPPNAME='s10red-blk' "${PSQL[@]}" >"$r-blk.out" 2>"$r-blk.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE org_id='$org' AND product_id='$X' FOR UPDATE;
\! touch $r-blk.ready
\! bash -c 'while [ ! -f "$r-blk.release" ]; do sleep 0.05; done'
COMMIT;
SQL
blk=$!
wait_for_file "$r-blk.ready" || fail "RED: blocker never locked bin X"
launch() { PGAPPNAME="$1" "${PSQL[@]}" >"$r-$1.out" 2>"$r-$1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
$2
COMMIT;
SQL
LPID=$!; }
launch res "$(mo_payload 'S12-RED-MO' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',3),jsonb_build_object('item_id','$I2','quantity',3))")"
respid=$LPID
w=$(wait_for_lock_waiters 1 "'res'") || fail "RED: reservation never queued on bin X (waiters=$w)"
echo "  RED step1 reservation waiting: $(blocking_evidence res)"
launch gr "SELECT public.rpc_post_goods_receipt(jsonb_build_object('tenant_id','$org','vendor_id','$VEND','warehouse_id','$W','idempotency_key','s12-red-g-$RUN_NONCE','lines',$GR_YX));"
grpid=$LPID
w=$(wait_for_lock_waiters 2 "'res','gr'") || fail "RED: GR never reached its wait while holding bin Y (waiters=$w)"
echo "  RED step2 GR waiting:          $(blocking_evidence gr)"
touch "$r-blk.release"
sr=0; sg=0; wait "$respid" || sr=$?; wait "$grpid" || sg=$?; wait "$blk" || true
if grep -qi 'deadlock detected' "$r-res.err" "$r-gr.err"; then
  echo "  10.1 RED CONFIRMED on pre-Fix-G bodies: genuine 40P01 (res=$sr gr=$sg)"
  grep -i -m1 'deadlock detected' "$r-res.err" "$r-gr.err" | sed 's/^/    /'
else
  echo "  10.1 RED NOT reproduced (res=$sr gr=$sg) - inconclusive control"
  head -2 "$r-res.err" "$r-gr.err" | sed 's/^/    /'
fi
