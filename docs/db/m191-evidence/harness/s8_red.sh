source "$SCRATCH/s8_fixture.sh"
CURRENT_SCENARIO=8.1a-RED
echo '=== 8.1a RED control (pre-M191 bodies): GR[A,B] vs DN[B,A] crossed bin order ==='
r=$tmp/s8red; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
# External blocker holds bin A so the two documents can be forced into a
# crossed hold/wait pattern deterministically, not by racing shell timings.
PGAPPNAME='s8red-blk' "${PSQL[@]}" >"$r-blk.out" 2>"$r-blk.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE org_id='$org' AND product_id='$A' FOR UPDATE;
\! touch $r-blk.ready
\! bash -c 'while [ ! -f "$r-blk.release" ]; do sleep 0.05; done'
COMMIT;
SQL
blk=$!
wait_for_file "$r-blk.ready" || fail "RED: blocker never locked bin A"
blkpid=$("${PSQL[@]}" -c "SELECT pid FROM pg_stat_activity WHERE application_name='s8red-blk'")

start_doc() { # $1 name $2 call
  PGAPPNAME="$1" "${PSQL[@]}" >"$r-$1.out" 2>"$r-$1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$usr',true);
SELECT set_config('request.jwt.claims','{"sub":"$usr","role":"authenticated"}',true);
$2
COMMIT;
SQL
  DOCPID=$!
}
start_doc gr "SELECT public.rpc_post_goods_receipt(jsonb_build_object('tenant_id','$org','vendor_id','$VEND','warehouse_id','$W','idempotency_key','s12-red-gr','lines',$GR_LINES_AB));"
grpid=$DOCPID
w=$(wait_for_lock_waiters 1 "'gr'") || fail "RED: GR never queued on bin A (waiters=$w)"
echo "  RED step1 GR waiting: $(blocking_evidence gr)"
start_doc dn "SELECT public.rpc_post_delivery_note(jsonb_build_object('tenant_id','$org','sales_invoice_id','$INV','warehouse_id','$W','idempotency_key','s12-red-dn','lines',$DN_LINES_BA));"
dnpid=$DOCPID
w=$(wait_for_lock_waiters 2 "'gr','dn'") || fail "RED: DN never reached its wait on bin A while holding bin B (waiters=$w)"
echo "  RED step2 DN waiting:  $(blocking_evidence dn)"
touch "$r-blk.release"
sg=0; sd=0; wait "$grpid" || sg=$?; wait "$dnpid" || sd=$?; wait "$blk" || true
if grep -qi 'deadlock detected' "$r-gr.err" "$r-dn.err"; then
  echo "  8.1a RED CONFIRMED on pre-M191 bodies: genuine 40P01 (statuses gr=$sg dn=$sd)"
  grep -i -m1 'deadlock detected' "$r-gr.err" "$r-dn.err" | sed 's/^/    /'
else
  echo "  8.1a RED NOT reproduced (gr=$sg dn=$sd) - recording as inconclusive control, not a pass"
  head -2 "$r-gr.err" "$r-dn.err" | sed 's/^/    /'
fi
