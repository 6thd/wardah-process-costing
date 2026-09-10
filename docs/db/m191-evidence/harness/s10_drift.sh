source "$SCRATCH/s9_fixture.sh"
reset_fixture
r=$tmp/s10d; rm -f "$r"-*.ready "$r"-*.release "$r"-*.out "$r"-*.err
GA=1030001   # gate A: after snapshot+prefix, before first bins query
GB=1040001   # gate B: after MO creation, before first reservation INSERT

# --- Isolation precondition (§10.3-10.5 hard requirement) -------------------
CURRENT_SCENARIO=10.3-precondition
iso=$("${PSQL[@]}" -c "SHOW default_transaction_isolation")
[[ "$iso" == "read committed" ]] || fail "HARNESS_FAIL: default_transaction_isolation=$iso (drift fixtures require read committed)"
echo "  ISOLATION ASSERTED immediately before Drift A: default_transaction_isolation=$iso"

# --- Build the gated mutant from the LIVE candidate body --------------------
"${PSQL[@]}" <<MUT
DO \$mk\$
DECLARE v_def text; v_a int; v_b int;
BEGIN
  v_def := pg_get_functiondef('public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'::regprocedure);
  v_def := replace(v_def,
    'FUNCTION public.rpc_create_mo_with_reservation(',
    'FUNCTION public.zz_m191_testonly_mo_gated(');
  -- Gate A: immediately after the product prefix, before any bins query.
  v_def := replace(v_def,
    'PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);',
    'PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);' || chr(10) ||
    '  PERFORM pg_advisory_lock($GA); PERFORM pg_advisory_unlock($GA);');
  -- Gate B: after MO creation, before the first reservation INSERT.
  v_def := replace(v_def,
    'RETURNING id INTO v_mo_id;',
    'RETURNING id INTO v_mo_id;' || chr(10) ||
    '  PERFORM pg_advisory_lock($GB); PERFORM pg_advisory_unlock($GB);');
  IF position('zz_m191_testonly_mo_gated' in v_def)=0 THEN RAISE EXCEPTION 'GATED_RENAME_FAILED'; END IF;
  v_a := (length(v_def) - length(replace(v_def,'pg_advisory_lock($GA)','')))/length('pg_advisory_lock($GA)');
  v_b := (length(v_def) - length(replace(v_def,'pg_advisory_lock($GB)','')))/length('pg_advisory_lock($GB)');
  IF v_a <> 1 THEN RAISE EXCEPTION 'GATE_A_ANCHOR_NOT_MATCHED_EXACTLY_ONCE: %', v_a; END IF;
  IF v_b <> 1 THEN RAISE EXCEPTION 'GATE_B_ANCHOR_NOT_MATCHED_EXACTLY_ONCE: %', v_b; END IF;
  IF position('ITEM_PRODUCT_MAPPING_DRIFT' in v_def)=0 THEN RAISE EXCEPTION 'GATED_MUTANT_LOST_THE_DRIFT_GUARD'; END IF;
  EXECUTE v_def;
END \$mk\$;
MUT
echo "  gated mutant built from the live body; both gate anchors matched exactly once; drift guard intact"

hold_gate() { # $1 key $2 tag
  PGAPPNAME="gate-$2" "${PSQL[@]}" >"$r-gate$2.out" 2>"$r-gate$2.err" <<SQL &
SELECT pg_advisory_lock($1);
\! touch $r-gate$2.ready
\! bash -c 'while [ ! -f "$r-gate$2.release" ]; do sleep 0.05; done'
SELECT pg_advisory_unlock($1);
SQL
  GPID=$!
  wait_for_file "$r-gate$2.ready" || fail "gate $2 never acquired"
}
run_gated() { # $1 tag $2 order_number $3 materials
  PGAPPNAME="cand-$1" "${PSQL[@]}" >"$r-c$1.out" 2>"$r-c$1.err" <<SQL &
BEGIN;
SELECT set_config('request.jwt.claim.sub','$adm',true);
SELECT set_config('request.jwt.claims','{"sub":"$adm","role":"authenticated"}',true);
SELECT public.zz_m191_testonly_mo_gated(
  jsonb_build_object('org_id','$org','order_number','$2','product_id','$FG','quantity',1),
  $3, NULL);
COMMIT;
SQL
  CPID=$!
}
cand_xact_start() { "${PSQL[@]}" -c "SELECT xact_start FROM pg_stat_activity WHERE application_name='cand-$1'"; }
restore_mappings() {
  "${PSQL[@]}" <<SQL
BEGIN;
UPDATE public.item_product_map SET is_active=false WHERE org_id='$org';
UPDATE public.item_product_map SET is_active=true
 WHERE org_id='$org' AND ((item_id='$I1' AND product_id='$X') OR (item_id='$I2' AND product_id='$Y'));
COMMIT;
SQL
  local a b
  a=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I1',now())")
  b=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I2',now())")
  [[ "$a" == "$X" && "$b" == "$Y" ]] || fail "restore_mappings: baseline not restored (I1->$a I2->$b)"
}
remap() { # $1 item $2 new_product $3 valid_from
  # Fail closed on an empty timestamp. A non-portable psql invocation used to
  # produce one silently here, which turned a drift fixture into an insert of
  # ''::timestamptz instead of a real remap.
  [[ -n "$3" ]] || fail "remap: empty valid_from - the mapping timestamp query returned nothing"
  "${PSQL[@]}" <<SQL
BEGIN;
-- uq_item_product_map_current_product makes (org_id, product_id) unique among
-- active rows, so free the target product first: this stays a legal in-place
-- remap rather than a constraint violation.
UPDATE public.item_product_map SET is_active=false
 WHERE org_id='$org' AND is_active AND (item_id='$1' OR product_id='$2');
INSERT INTO public.item_product_map (org_id,item_id,product_id,mapping_source,is_active,valid_from)
VALUES ('$org','$1','$2','MANUAL',true,'$3'::timestamptz);
COMMIT;
SQL
}

echo '=== 10.3 Mapping drift A: gate after snapshot+prefix, before first bins query ==='
CURRENT_SCENARIO=10.3
# A blocker owns Y's bin for the WHOLE remainder of the candidate. If the
# candidate wrongly re-resolved I1 to Y it would have to wait on this blocker
# and could not finish; finishing is therefore positive proof it stayed on X.
PGAPPNAME='driftA-blkY' "${PSQL[@]}" >"$r-blkY.out" 2>"$r-blkY.err" <<SQL &
BEGIN;
SELECT id FROM public.bins WHERE org_id='$org' AND product_id='$Y' FOR UPDATE;
\! touch $r-blkY.ready
\! bash -c 'while [ ! -f "$r-blkY.release" ]; do sleep 0.05; done'
COMMIT;
SQL
blkY=$!
wait_for_file "$r-blkY.ready" || fail "10.3: Y-bin blocker never acquired"
blkYpid=$("${PSQL[@]}" -c "SELECT pid FROM pg_stat_activity WHERE application_name='driftA-blkY'")
hold_gate $GA A; gA=$GPID
run_gated A 'S12-DRIFT-A' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2))"
candA=$CPID
w=$(wait_for_lock_waiters 1 "'cand-A'") || fail "10.3: candidate never reached gate A (waiters=$w)"
XS=$(cand_xact_start A)
echo "  candidate gated at A; its mapping timestamp (xact_start) = $XS"
capt=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I1','$XS'::timestamptz)")
[[ "$capt" == "$X" ]] || fail "10.3: fixture precondition - captured resolution is $capt, expected X"
remap "$I1" "$Y" "$("${PSQL[@]}" -c "SELECT ('$XS'::timestamptz - interval '1 second')")"
now_res=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I1','$XS'::timestamptz)")
[[ "$now_res" == "$Y" ]] || fail "10.3: mapper did not achieve an eligible in-place remap (resolver still returns $now_res) - HARNESS_FAIL"
echo "  mapper committed in-place remap I1: X -> Y, eligible at the candidate's own timestamp (resolver now returns Y)"
touch "$r-gateA.release"; wait "$gA" || true
sa=0
if wait "$candA"; then sa=0; else sa=$?; fi
echo "  candidate finished while the Y-bin blocker was STILL held (status=$sa)"
grep -qi 'deadlock' "$r-cA.err" && fail "10.3: deadlock"
errA=$(tr -d '\n' < "$r-cA.err")
echo "$errA" | grep -q 'ITEM_PRODUCT_MAPPING_DRIFT' || fail "10.3: expected ITEM_PRODUCT_MAPPING_DRIFT, got: ${errA: -300}"
echo "  10.3 PASS(a) candidate never acquired Y's bin (it completed against a held Y-bin lock) => bins work stayed on captured X"
echo "  10.3 PASS(b) drift detected: ITEM_PRODUCT_MAPPING_DRIFT"
mo=$("${PSQL[@]}" -c "SELECT count(*) FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='S12-DRIFT-A'")
rs=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE org_id='$org'")
[[ "$mo" == "0" && "$rs" == "0" ]] || fail "10.3: rollback incomplete (mo=$mo reservations=$rs)"
echo "  10.3 PASS(c) whole-RPC rollback: 0 MO, 0 reservation"
touch "$r-blkY.release"; wait "$blkY" || true
# restore the mapping for the next fixtures
restore_mappings

echo '=== 10.4 Mapping drift B: gate after MO creation, before first reservation INSERT ==='
CURRENT_SCENARIO=10.4
iso=$("${PSQL[@]}" -c "SHOW default_transaction_isolation"); [[ "$iso" == "read committed" ]] || fail "HARNESS_FAIL: isolation=$iso"
hold_gate $GB B; gB=$GPID
run_gated B 'S12-DRIFT-B' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2))"
candB=$CPID
w=$(wait_for_lock_waiters 1 "'cand-B'") || fail "10.4: candidate never reached gate B (waiters=$w)"
XS=$(cand_xact_start B)
echo "  candidate gated at B; mapping timestamp = $XS"
remap "$I1" "$Y" "$("${PSQL[@]}" -c "SELECT ('$XS'::timestamptz - interval '1 second')")"
nr=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I1','$XS'::timestamptz)")
[[ "$nr" == "$Y" ]] || fail "10.4: remap not eligible at the candidate timestamp (got $nr) - HARNESS_FAIL"
echo "  mapper committed in-place remap I1: X -> Y with an already-eligible valid_from"
touch "$r-gateB.release"; wait "$gB" || true
sb=0; wait "$candB" || sb=$?
errB=$(tr -d '\n' < "$r-cB.err")
[[ $sb -ne 0 ]] || fail "10.4: candidate succeeded despite a persisted product different from the captured one"
echo "$errB" | grep -q 'ITEM_PRODUCT_MAPPING_DRIFT' || fail "10.4: expected ITEM_PRODUCT_MAPPING_DRIFT, got: ${errB: -300}"
echo "  10.4 PASS drift detected at the RETURNING comparison: ITEM_PRODUCT_MAPPING_DRIFT"
mo=$("${PSQL[@]}" -c "SELECT count(*) FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='S12-DRIFT-B'")
rs=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE org_id='$org'")
[[ "$mo" == "0" ]] || fail "10.4: a surviving MO row remains ($mo) - rollback incomplete"
[[ "$rs" == "0" ]] || fail "10.4: surviving reservation rows remain ($rs) - rollback incomplete"
echo "  10.4 PASS whole-RPC rollback: zero surviving MO and zero reservation"
restore_mappings

echo '=== 10.5 Mapping drift C: uniqueness-preserving swap I1<->I2 at the persistence gate ==='
CURRENT_SCENARIO=10.5
iso=$("${PSQL[@]}" -c "SHOW default_transaction_isolation"); [[ "$iso" == "read committed" ]] || fail "HARNESS_FAIL: isolation=$iso"
hold_gate $GB C; gC=$GPID
run_gated C 'S12-DRIFT-C' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2),jsonb_build_object('item_id','$I2','quantity',2))"
candC=$CPID
w=$(wait_for_lock_waiters 1 "'cand-C'") || fail "10.5: candidate never reached the persistence gate (waiters=$w)"
XS=$(cand_xact_start C)
echo "  candidate gated; captured I1->X, I2->Y; prefix {X,Y}; mapping timestamp = $XS"
VF=$("${PSQL[@]}" -c "SELECT ('$XS'::timestamptz - interval '1 second')")
# Legal uniqueness-preserving swap. valid_from is EXPLICIT and <= the candidate's
# mapping timestamp: DEFAULT now() would be this mapper transaction's own start,
# which is later than the candidate's and would make the swap invisible to it.
"${PSQL[@]}" <<SQL
BEGIN;
UPDATE public.item_product_map SET is_active=false
 WHERE org_id='$org' AND item_id IN ('$I1','$I2') AND is_active;
INSERT INTO public.item_product_map (org_id,item_id,product_id,mapping_source,is_active,valid_from) VALUES
 ('$org','$I1','$Y','MANUAL',true,'$VF'::timestamptz),
 ('$org','$I2','$X','MANUAL',true,'$VF'::timestamptz);
COMMIT;
SQL
r1=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I1','$XS'::timestamptz)")
r2=$("${PSQL[@]}" -c "SELECT public.wardah_resolve_product_id('$org','$I2','$XS'::timestamptz)")
[[ "$r1" == "$Y" ]] || fail "10.5: HARNESS_FAIL - at the candidate's own timestamp I1 resolves to $r1, expected Y"
[[ "$r2" == "$X" ]] || fail "10.5: HARNESS_FAIL - at the candidate's own timestamp I2 resolves to $r2, expected X"
echo "  proved at the candidate's mapping timestamp: I1 -> Y and I2 -> X (uniqueness preserved, both directions swapped)"
touch "$r-gateC.release"; wait "$gC" || true
sc=0; wait "$candC" || sc=$?
errC=$(tr -d '\n' < "$r-cC.err")
[[ $sc -ne 0 ]] || fail "10.5: candidate succeeded despite a full identity swap"
echo "$errC" | grep -q 'ITEM_PRODUCT_MAP_MISSING' && fail "10.5: got ITEM_PRODUCT_MAP_MISSING - that is a fixture failure, not drift evidence"
echo "$errC" | grep -q 'ITEM_PRODUCT_MAPPING_DRIFT' || fail "10.5: expected ITEM_PRODUCT_MAPPING_DRIFT, got: ${errC: -300}"
echo "  10.5 PASS ITEM_PRODUCT_MAPPING_DRIFT (not MAP_MISSING)"
mo=$("${PSQL[@]}" -c "SELECT count(*) FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='S12-DRIFT-C'")
rs=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE org_id='$org'")
[[ "$mo" == "0" && "$rs" == "0" ]] || fail "10.5: rollback incomplete (mo=$mo reservations=$rs)"
echo "  10.5 PASS whole-RPC rollback: 0 MO, 0 reservation"

echo '=== 10.6 Fix G timestamp reject-list invariants (recorded) ==='
CURRENT_SCENARIO=10.6
trg=$("${PSQL[@]}" -c "SELECT CASE WHEN position('COALESCE(NEW.created_at,now())' IN replace(pg_get_functiondef('public.trg_resolve_item_product_reference()'::regprocedure),' ',''))>0 THEN 'COALESCE(NEW.created_at, now())' ELSE 'CHANGED' END")
[[ "$trg" != "CHANGED" ]] || fail "10.6: the reservation trigger no longer resolves on COALESCE(NEW.created_at, now()) - Fix G's captured-vs-trigger identity assumption must be re-reviewed"
echo "  INVARIANT-1 recorded: reservation trigger resolution uses $trg."
echo "    Captured-vs-trigger identity assumes a normal INSERT does not inject a"
echo "    materially different historical/future created_at. A future migration that"
echo "    does so must re-review Fix G."
echo "  INVARIANT-2 recorded: every drift fixture above used an EXPLICIT valid_from <="
echo "    the candidate transaction's own mapping timestamp (asserted live via the"
echo "    resolver before releasing each gate). A valid_from newer than that timestamp"
echo "    does not prove resolver drift and is rejected as a fixture failure."
"${PSQL[@]}" -c "DROP FUNCTION public.zz_m191_testonly_mo_gated(jsonb,jsonb,uuid);"
echo "SLICE12_S10_DRIFT_PASS"
