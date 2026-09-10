source "$SCRATCH/s9_fixture.sh"
reset_fixture
CURRENT_SCENARIO=C1
I3='00002296-0000-0000-0000-000000000103'   # item with NO mapping and NOT a product
echo '=== 8.2 C1: an unrelated unresolvable reserved row must not poison a valid consumption ==='
as_user "$(mo_payload 'S12-C1-MO' "jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',4))")" >/dev/null
MO=$("${PSQL[@]}" -c "SELECT id FROM public.manufacturing_orders WHERE org_id='$org' AND order_number='S12-C1-MO'")
mk_wip "$MO"
"${PSQL[@]}" -c "INSERT INTO public.items (id,org_id,code,name) VALUES ('$I3','$org','S12-I3','Item 3 unmapped');" >/dev/null
# The live BEFORE trigger resolves product_id and would reject this row, so the
# legacy shape (reserved + product_id IS NULL + unresolvable item) is seeded with
# the trigger disabled. This constructs the documented precondition only; the
# candidate under test is not modified.
"${PSQL[@]}" <<SQL
ALTER TABLE public.material_reservations DISABLE TRIGGER resolve_material_reservation_product;
INSERT INTO public.material_reservations (org_id,mo_id,item_id,product_id,quantity_reserved,quantity_consumed,status,reserved_at)
VALUES ('$org','$MO','$I3',NULL,3,0,'reserved',now());
ALTER TABLE public.material_reservations ENABLE TRIGGER resolve_material_reservation_product;
SQL
poison=$("${PSQL[@]}" -c "SELECT count(*) FROM public.material_reservations WHERE mo_id='$MO' AND product_id IS NULL AND status='reserved'")
[[ "$poison" == "1" ]] || fail "C1: the unresolvable reserved row was not seeded (got $poison)"
echo "  seeded: 1 unrelated reserved row with product_id IS NULL and an item with no mapping"

echo '--- C1(a) consuming the VALID named reservation must still succeed ---'
set +e
out=$(as_user "SELECT public.rpc_consume_reserved_materials_v2('$MO','$STAGE',
  jsonb_build_array(jsonb_build_object('item_id','$I1','quantity',2)));" 2>&1); rc=$?
set -e
[[ $rc -eq 0 ]] || fail "C1(a): the unresolvable unrelated row POISONED a valid consumption: $(echo "$out" | tr -d '\n' | tail -c 300)"
echo "$out" | grep -q 'ITEM_PRODUCT_MAP_MISSING' && fail "C1(a): resolver error leaked from the superset into a valid consumption"
qx=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$X'")
num_eq "$qx" 98 || fail "C1(a): X bin=$qx expected 98"
echo "  C1(a) PASS valid consumption succeeded, X bin=$qx"
reconcile_product C1a-X "$org" "$X"

echo '--- C1(b) NAMING the unresolved reservation must still raise the predecessor error ---'
set +e
out2=$(as_user "SELECT public.rpc_consume_reserved_materials_v2('$MO','$STAGE',
  jsonb_build_array(jsonb_build_object('item_id','$I3','quantity',1)));" 2>&1); rc2=$?
set -e
[[ $rc2 -ne 0 ]] || fail "C1(b): naming the unresolvable reservation unexpectedly succeeded"
echo "$out2" | grep -q 'ITEM_PRODUCT_MAP_MISSING' \
  || fail "C1(b): expected the predecessor ITEM_PRODUCT_MAP_MISSING at its original semantic point, got: $(echo "$out2" | tr -d '\n' | tail -c 300)"
echo "  C1(b) PASS predecessor resolver error preserved: $(echo "$out2" | grep -o 'ITEM_PRODUCT_MAP_MISSING[^C]*' | head -1 | tr -d '\n')"
qx2=$("${PSQL[@]}" -c "SELECT actual_qty FROM public.bins WHERE product_id='$X'")
num_eq "$qx2" 98 || fail "C1(b): failed call left a partial effect (X bin=$qx2, expected unchanged 98)"
echo "  C1(b) zero partial effect, X bin unchanged=$qx2"
echo "SLICE12_C1_PASS"
