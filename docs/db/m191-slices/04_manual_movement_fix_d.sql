-- Wardah ERP / F2 / M191 review slice 04
-- Object 6 only: rpc_manual_stock_movement_v2(jsonb) — Fix D.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 134, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized change in this slice only:
--   * after resolving v_org and preserving the existing quantity validation,
--     acquire the shared one-product prefix before the warehouse-inference
--     IF block and therefore before any bins read for this product.
--
-- Preserved deliberately:
--   * payload cast/parse order and PRODUCT_NOT_FOUND behavior;
--   * wardah_assert_org_member placement;
--   * INVALID_MOVEMENT_QUANTITY before the new prefix;
--   * UoM factor/base-quantity/base-rate calculations;
--   * warehouse inference, warehouse validation, and locked target-bin read;
--   * in/out/adjustment delta semantics and INVALID_MOVEMENT_TYPE;
--   * calls to the canonical incoming/outgoing helpers and return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- The prefix is unconditional with respect to movement_type: warehouse
-- inference may read bins for in/out/adjustment alike when warehouse_id is
-- omitted. No RED-A/RED-B logic or authorization change belongs in Fix D.

CREATE OR REPLACE FUNCTION public.rpc_manual_stock_movement_v2(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_product uuid; v_org uuid; v_warehouse uuid; v_uom uuid;
  v_qty_entered numeric; v_qty_base numeric; v_factor numeric; v_current numeric;
  v_delta numeric; v_rate_entered numeric; v_rate_base numeric;
  v_voucher uuid:=gen_random_uuid(); v_count integer; v_result jsonb;
BEGIN
  v_product:=NULLIF(p_payload->>'product_id','')::uuid;
  v_warehouse:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  v_qty_entered:=COALESCE(NULLIF(p_payload->>'qty_entered','')::numeric,NULLIF(p_payload->>'quantity','')::numeric);
  SELECT org_id,COALESCE(NULLIF(p_payload->>'uom_id','')::uuid,base_uom_id),
         COALESCE(NULLIF(p_payload->>'unit_cost_entered','')::numeric,cost_price,0)
  INTO v_org,v_uom,v_rate_entered FROM public.products WHERE id=v_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF v_qty_entered IS NULL OR v_qty_entered<0 THEN RAISE EXCEPTION 'INVALID_MOVEMENT_QUANTITY'; END IF;
  PERFORM public.wardah_lock_products_for_stock_write(v_org,ARRAY[v_product]::uuid[]);
  v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
  v_qty_base:=round(v_qty_entered*v_factor,6); v_rate_base:=round(v_rate_entered/v_factor,6);
  IF v_warehouse IS NULL THEN
    SELECT count(*),min(warehouse_id) INTO v_count,v_warehouse FROM public.bins WHERE org_id=v_org AND product_id=v_product;
    IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=v_warehouse AND org_id=v_org) THEN RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND_OR_WRONG_ORG'; END IF;
  SELECT COALESCE(actual_qty,0) INTO v_current FROM public.bins
  WHERE org_id=v_org AND product_id=v_product AND warehouse_id=v_warehouse FOR UPDATE;
  v_current:=COALESCE(v_current,0);
  CASE lower(COALESCE(p_payload->>'movement_type',''))
    WHEN 'in' THEN v_delta:=v_qty_base;
    WHEN 'out' THEN v_delta:=-v_qty_base;
    WHEN 'adjustment' THEN v_delta:=v_qty_base-v_current;
    ELSE RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE';
  END CASE;
  IF v_delta>0 THEN
    v_result:=public.wardah_apply_stock_incoming(v_org,v_product,v_warehouse,v_delta,v_rate_base,
      'Manual Stock Movement',v_voucher,'MAN-'||substr(v_voucher::text,1,8),CURRENT_DATE);
  ELSIF v_delta<0 THEN
    v_result:=public.wardah_apply_stock_outgoing(v_org,v_product,v_warehouse,abs(v_delta),
      'Manual Stock Movement',v_voucher,'MAN-'||substr(v_voucher::text,1,8),CURRENT_DATE);
  ELSE v_result:=jsonb_build_object('applied',false,'reason','NO_CHANGE'); END IF;
  RETURN v_result||jsonb_build_object('uom_atomic',true,'uom_id',v_uom,'qty_entered',v_qty_entered,
    'conversion_factor',v_factor,'base_quantity',v_qty_base,'notes',NULLIF(p_payload->>'notes',''));
END;
$function$;
