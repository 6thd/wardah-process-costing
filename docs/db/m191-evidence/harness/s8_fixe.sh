#!/usr/bin/env bash
source "$SCRATCH/s8_fixture.sh"

echo '=== 8.1a Goods Receipt [A,B] vs Delivery Note [B,A] ==='
CURRENT_SCENARIO=8.1a
pairE gr-vs-dn \
"SELECT public.rpc_post_goods_receipt(jsonb_build_object('tenant_id','$org','vendor_id','$VEND','warehouse_id','$W','idempotency_key','s12-gr-1-$RUN_NONCE','lines',$GR_LINES_AB));" \
"SELECT public.rpc_post_delivery_note(jsonb_build_object('tenant_id','$org','sales_invoice_id','$INV','warehouse_id','$W','idempotency_key','s12-dn-1-$RUN_NONCE','lines',$DN_LINES_BA));"
[[ $ST1 -eq 0 && $ST2 -eq 0 ]] || fail "8.1a: both documents must complete; b1=$ST1 b2=$ST2"
read -r qa qb <<<"$("${PSQL[@]}" -c "SELECT (SELECT actual_qty FROM public.bins WHERE product_id='$A')||' '||(SELECT actual_qty FROM public.bins WHERE product_id='$B')")"
num_eq "$qa" 102 || fail "8.1a: A bin=$qa expected 102 (100 +5 GR -3 DN)"
num_eq "$qb" 102 || fail "8.1a: B bin=$qb expected 102"
echo "  8.1a PASS bins A=$qa B=$qb, no 40P01, crossed product order serialized at the shared prefix"
reconcile_product 8.1a-A "$org" "$A"; reconcile_product 8.1a-B "$org" "$B"
