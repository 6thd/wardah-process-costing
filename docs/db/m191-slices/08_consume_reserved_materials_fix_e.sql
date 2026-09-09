-- Wardah ERP / F2 / M191 review slice 08
-- Object 10 only: rpc_consume_reserved_materials_v2(uuid,uuid,jsonb) — Fix E.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 190, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the existing MO / exact-permission / stage-WIP gates, lock every
--     material_reservations row for the MO regardless of status, ascending id,
--     FOR NO KEY UPDATE;
--   * derive the product prefix from the now-frozen rows whose status is
--     'reserved', using the exact effective-product expression the live loop uses;
--   * acquire the shared deterministic product prefix once before the loop;
--   * change both existing per-line reservation re-acquisitions from FOR UPDATE
--     to FOR NO KEY UPDATE so they match the superset lock instead of upgrading;
--   * after each line resolves v_product, fail closed if it is NULL or outside
--     the canonical prelocked product set.
--
-- Preserved deliberately:
--   * Migration 190 exact permission key and denial behavior;
--   * MO header FOR UPDATE and org-member guard;
--   * CONSUMPTIONS_REQUIRED, stage inference, stage-WIP validation/error order;
--   * per-line reservation selection rules (reservation_id branch vs item_id /
--     created_at,id first-reserved branch) and ACTIVE_RESERVATION_NOT_FOUND;
--   * live effective product expression COALESCE(product_id,
--     wardah_resolve_product_id(...));
--   * UoM, quantity, remaining-reservation, warehouse/work-order validation;
--   * canonical outgoing stock helper call and COGS valuation;
--   * material_consumption insert, stage WIP accumulation, reservation update;
--   * return shape, SECURITY DEFINER, and search_path;
--   * existing client-facing ACL / wrapper behavior is unchanged here.

CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials_v2(
  p_mo_id uuid,
  p_stage_id uuid,
  p_consumptions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid; v_mo_number text; v_stage uuid:=p_stage_id; v_wip_id uuid;
  v_row jsonb; v_res public.material_reservations%rowtype; v_product uuid;
  v_uom uuid; v_qty_entered numeric; v_qty_base numeric; v_factor numeric;
  v_warehouse uuid; v_count integer; v_remaining numeric; v_work_order uuid;
  v_stock jsonb; v_cogs numeric; v_total_cogs numeric:=0; v_unit_cost numeric;
  v_lock_res record;
  v_products uuid[] := '{}'::uuid[];
  v_locked_products uuid[];
BEGIN
  SELECT org_id,order_number INTO v_org,v_mo_number
  FROM public.manufacturing_orders WHERE id=p_mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;

  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT public.has_permission(
    auth.uid(), v_org, 'manufacturing.material_consumption.consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_PERMISSION_DENIED';
  END IF;

  IF jsonb_typeof(p_consumptions)<>'array' OR jsonb_array_length(p_consumptions)=0 THEN
    RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED';
  END IF;

  IF v_stage IS NULL THEN
    v_stage:=NULLIF(p_consumptions->0->>'stage_id','')::uuid;
  END IF;
  IF v_stage IS NULL THEN
    SELECT count(*),(array_agg(stage_id ORDER BY stage_id))[1]
      INTO v_count,v_stage
    FROM public.stage_wip_log
    WHERE org_id=v_org AND mo_id=p_mo_id AND COALESCE(is_closed,false)=false
      AND CURRENT_DATE BETWEEN period_start AND period_end;
    IF v_count<>1 THEN RAISE EXCEPTION 'STAGE_REQUIRED_FOR_MATERIAL_CONSUMPTION'; END IF;
  END IF;

  SELECT id INTO v_wip_id FROM public.stage_wip_log
  WHERE org_id=v_org AND mo_id=p_mo_id AND stage_id=v_stage
    AND COALESCE(is_closed,false)=false
    AND CURRENT_DATE BETWEEN period_start AND period_end
  ORDER BY period_end DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPEN_STAGE_WIP_LOG_NOT_FOUND'; END IF;

  -- M191 Fix E: freeze the complete existing reservation universe for this MO
  -- before deriving which products the unchanged per-line lookup can later use.
  -- Do not filter status in the locking query: an existing non-reserved row must
  -- not be able to flip to reserved after this snapshot and enter the loop.
  FOR v_lock_res IN
    SELECT id,mo_id,item_id,product_id,status
    FROM public.material_reservations
    WHERE org_id=v_org AND mo_id=p_mo_id
    ORDER BY id
    FOR NO KEY UPDATE
  LOOP
    IF v_lock_res.status='reserved' THEN
      v_products:=array_append(
        v_products,
        COALESCE(
          v_lock_res.product_id,
          public.wardah_resolve_product_id(v_org,v_lock_res.item_id,now())
        )
      );
    END IF;
  END LOOP;

  v_locked_products:=
    public.wardah_lock_products_for_stock_write(v_org,v_products);

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_consumptions) LOOP
    IF NULLIF(v_row->>'reservation_id','') IS NOT NULL THEN
      SELECT * INTO v_res FROM public.material_reservations
      WHERE id=(v_row->>'reservation_id')::uuid AND org_id=v_org
        AND mo_id=p_mo_id AND status='reserved' FOR NO KEY UPDATE;
    ELSE
      SELECT * INTO v_res FROM public.material_reservations
      WHERE org_id=v_org AND mo_id=p_mo_id
        AND item_id=(v_row->>'item_id')::uuid AND status='reserved'
      ORDER BY created_at,id LIMIT 1 FOR NO KEY UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_RESERVATION_NOT_FOUND'; END IF;

    v_product:=COALESCE(
      v_res.product_id,
      public.wardah_resolve_product_id(v_org,v_res.item_id,now())
    );
    IF v_product IS NULL
       OR NOT COALESCE(v_product = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_product;
    END IF;

    SELECT COALESCE(NULLIF(v_row->>'uom_id','')::uuid,v_res.uom_id,p.base_uom_id)
      INTO v_uom FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=NULLIF(v_row->>'quantity','')::numeric;
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
      RAISE EXCEPTION 'INVALID_CONSUMPTION_QUANTITY';
    END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
    v_qty_base:=round(v_qty_entered*v_factor,6);

    v_remaining:=v_res.quantity_reserved-COALESCE(v_res.quantity_consumed,0)-COALESCE(v_res.quantity_released,0);
    IF v_qty_base>v_remaining THEN
      RAISE EXCEPTION 'CONSUMPTION_EXCEEDS_RESERVATION: remaining=%, requested_base=%',
        v_remaining,v_qty_base;
    END IF;

    v_warehouse:=NULLIF(v_row->>'warehouse_id','')::uuid;
    IF v_warehouse IS NULL THEN
      SELECT count(*),(array_agg(warehouse_id ORDER BY warehouse_id))[1]
        INTO v_count,v_warehouse
      FROM public.bins
      WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_CONSUMPTION'; END IF;
    END IF;

    v_work_order:=NULLIF(v_row->>'work_order_id','')::uuid;
    IF v_work_order IS NULL THEN
      SELECT count(*),(array_agg(id ORDER BY id))[1]
        INTO v_count,v_work_order
      FROM public.work_orders
      WHERE org_id=v_org AND mo_id=p_mo_id AND status NOT IN ('COMPLETED','CANCELLED');
      IF v_count<>1 THEN RAISE EXCEPTION 'WORK_ORDER_REQUIRED_FOR_CONSUMPTION'; END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.work_orders
      WHERE id=v_work_order AND org_id=v_org AND mo_id=p_mo_id
    ) THEN
      RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND_OR_WRONG_MO';
    END IF;

    v_stock:=public.wardah_apply_stock_outgoing(
      v_org,v_product,v_warehouse,v_qty_base,
      'Material Consumption',p_mo_id,v_mo_number,CURRENT_DATE
    );
    IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN
      RAISE EXCEPTION 'STOCK_OUT_NOT_APPLIED';
    END IF;
    v_cogs:=COALESCE((v_stock->>'cogs')::numeric,0);
    v_unit_cost:=CASE WHEN v_qty_base>0 THEN v_cogs/v_qty_base ELSE 0 END;

    INSERT INTO public.material_consumption(
      org_id,work_order_id,mo_id,item_id,product_id,reservation_id,stage_id,
      planned_quantity,consumed_quantity,consumption_type,warehouse_id,
      unit_cost,total_cost,status,consumption_date,notes,created_by,
      uom_id,qty_entered,conversion_factor_snapshot,stock_valuation_result
    ) VALUES (
      v_org,v_work_order,p_mo_id,v_res.item_id,v_product,v_res.id,v_stage,
      v_res.quantity_reserved,v_qty_base,COALESCE(NULLIF(v_row->>'consumption_type',''),'MANUAL'),v_warehouse,
      v_unit_cost,v_cogs,'POSTED',now(),NULLIF(v_row->>'notes',''),auth.uid(),
      v_uom,v_qty_entered,v_factor,v_stock
    );

    UPDATE public.stage_wip_log
    SET cost_material=COALESCE(cost_material,0)+v_cogs,updated_at=now(),updated_by=auth.uid()
    WHERE id=v_wip_id;

    UPDATE public.material_reservations
    SET product_id=v_product,uom_id=v_uom,
        qty_entered=COALESCE(qty_entered,quantity_reserved),
        conversion_factor_snapshot=COALESCE(conversion_factor_snapshot,1),
        quantity_consumed=COALESCE(quantity_consumed,0)+v_qty_base,
        status=CASE
          WHEN COALESCE(quantity_consumed,0)+v_qty_base+COALESCE(quantity_released,0)>=quantity_reserved
          THEN 'consumed' ELSE 'reserved' END,
        consumed_at=now(),updated_at=now()
    WHERE id=v_res.id;

    v_total_cogs:=v_total_cogs+v_cogs;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,'mo_id',p_mo_id,'stage_id',v_stage,
    'stage_wip_log_id',v_wip_id,
    'consumption_count',jsonb_array_length(p_consumptions),
    'material_cost_posted',round(v_total_cogs,6),
    'inventory_atomic',true,'wip_cost_atomic',true,'uom_atomic',true
  );
END;
$function$;
