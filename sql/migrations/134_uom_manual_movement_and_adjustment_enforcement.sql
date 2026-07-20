-- migration_number: 134
-- description: Enforce UoM normalization on manual stock movements and stock
--              adjustment lines, including direct table writes.
-- safety: additive v2 RPC + compatibility wrapper + BEFORE trigger.

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

CREATE OR REPLACE FUNCTION public.rpc_manual_stock_movement(
  p_product_id uuid,p_quantity numeric,p_movement_type text,p_warehouse_id uuid DEFAULT NULL,p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT public.rpc_manual_stock_movement_v2(jsonb_build_object(
    'product_id',p_product_id,'quantity',p_quantity,'movement_type',p_movement_type,
    'warehouse_id',p_warehouse_id,'notes',p_notes));
$function$;

CREATE OR REPLACE FUNCTION public.trg_normalize_stock_adjustment_uom()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid:=NEW.organization_id; v_uom uuid; v_factor numeric;
BEGIN
  SELECT COALESCE(NEW.uom_id,p.base_uom_id) INTO v_uom
  FROM public.products p WHERE p.id=NEW.product_id AND p.org_id=v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_PRODUCT_NOT_FOUND_OR_WRONG_ORG'; END IF;
  v_factor:=public.wardah_uom_factor(v_org,NEW.product_id,v_uom,now());
  NEW.uom_id:=v_uom; NEW.conversion_factor_snapshot:=v_factor;
  IF NEW.current_qty_entered IS NOT NULL THEN NEW.current_qty:=round(NEW.current_qty_entered*v_factor,6);
  ELSE NEW.current_qty_entered:=round(NEW.current_qty/v_factor,6); END IF;
  IF NEW.new_qty_entered IS NOT NULL THEN NEW.new_qty:=round(NEW.new_qty_entered*v_factor,6);
  ELSE NEW.new_qty_entered:=round(NEW.new_qty/v_factor,6); END IF;
  NEW.qty_entered:=NEW.new_qty_entered;
  NEW.difference_qty:=round(NEW.new_qty-NEW.current_qty,6);
  NEW.value_difference:=round(NEW.difference_qty*COALESCE(NEW.new_rate,NEW.current_rate,0),2);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_stock_adjustment_uom ON public.stock_adjustment_items;
CREATE TRIGGER normalize_stock_adjustment_uom
BEFORE INSERT OR UPDATE OF organization_id,product_id,uom_id,current_qty,new_qty,current_qty_entered,new_qty_entered,current_rate,new_rate
ON public.stock_adjustment_items FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_stock_adjustment_uom();

REVOKE EXECUTE ON FUNCTION public.rpc_manual_stock_movement_v2(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_manual_stock_movement_v2(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_manual_stock_movement(uuid,numeric,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_manual_stock_movement(uuid,numeric,text,uuid,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_stock_adjustment_uom() FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.rpc_manual_stock_movement_v2(jsonb) IS
  'UoM-aware manual movement. All legal ledger quantities are normalized to product base UoM.';
