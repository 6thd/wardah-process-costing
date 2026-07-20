-- migration_number: 138
-- description: Normalize BOM quantities to component base UoM and flow actual
--              partial material-consumption valuation into stage WIP atomically.
-- safety: additive audit columns + replace-only functions/triggers. Existing
--         unresolved BOM rows are logged and are not guessed.

ALTER TABLE public.material_consumption
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.material_reservations(id),
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.manufacturing_stages(id),
  ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES public.uoms(id),
  ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS conversion_factor_snapshot numeric(30,12),
  ADD COLUMN IF NOT EXISTS stock_valuation_result jsonb;

CREATE OR REPLACE FUNCTION public.trg_normalize_bom_line_uom()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_product uuid; v_uom uuid; v_factor numeric;
BEGIN
  v_product:=COALESCE(NEW.product_id,public.wardah_resolve_product_id(
    NEW.org_id,NEW.item_id,COALESCE(NEW.created_at,now())));
  SELECT COALESCE(NEW.uom_id,p.base_uom_id) INTO v_uom
  FROM public.products p WHERE p.id=v_product AND p.org_id=NEW.org_id;
  IF NOT FOUND OR v_uom IS NULL THEN RAISE EXCEPTION 'BOM_PRODUCT_OR_BASE_UOM_MISSING'; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity<=0 THEN RAISE EXCEPTION 'BOM_QUANTITY_MUST_BE_POSITIVE'; END IF;
  v_factor:=public.wardah_uom_factor(NEW.org_id,v_product,v_uom,COALESCE(NEW.created_at,now()));
  NEW.product_id:=v_product;
  NEW.uom_id:=v_uom;
  NEW.qty_entered:=NEW.quantity;
  NEW.conversion_factor_snapshot:=v_factor;
  NEW.quantity_base:=round(NEW.quantity*v_factor,6);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_bom_line_uom ON public.bom_lines;
CREATE TRIGGER normalize_bom_line_uom
BEFORE INSERT OR UPDATE OF org_id,item_id,product_id,quantity,uom_id
ON public.bom_lines FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_bom_line_uom();

-- Deterministic backfill only. Unknown conversions remain visible as open issues.
UPDATE public.bom_lines bl
SET quantity_base=round(bl.quantity,6),
    qty_entered=COALESCE(bl.qty_entered,bl.quantity),
    conversion_factor_snapshot=COALESCE(bl.conversion_factor_snapshot,1)
FROM public.products p
WHERE bl.product_id=p.id AND bl.org_id=p.org_id
  AND bl.uom_id=p.base_uom_id AND bl.quantity_base IS NULL;

UPDATE public.bom_lines bl
SET quantity_base=round(bl.quantity*c.factor_to_base,6),
    qty_entered=COALESCE(bl.qty_entered,bl.quantity),
    conversion_factor_snapshot=COALESCE(bl.conversion_factor_snapshot,c.factor_to_base)
FROM public.product_uom_conversions c
WHERE bl.org_id=c.org_id AND bl.product_id=c.product_id AND bl.uom_id=c.uom_id
  AND c.is_active AND c.valid_to IS NULL AND bl.quantity_base IS NULL;

INSERT INTO public.uom_backfill_issues(org_id,source_table,source_id,source_value,issue_code,details)
SELECT bl.org_id,'bom_lines',bl.id,bl.uom,'BOM_QUANTITY_BASE_UNRESOLVED',
       jsonb_build_object('bom_id',bl.bom_id,'item_id',bl.item_id,'product_id',bl.product_id,'uom_id',bl.uom_id)
FROM public.bom_lines bl
WHERE bl.quantity_base IS NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.explode_bom(
  p_bom_id uuid,p_quantity numeric DEFAULT 1,p_org_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  level_number integer,item_id uuid,item_code varchar,item_name varchar,
  quantity_required numeric,unit_of_measure varchar,is_critical boolean,
  scrap_factor numeric,line_type varchar
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid; v_header_qty numeric;
BEGIN
  SELECT org_id,quantity INTO v_org,v_header_qty
  FROM public.bom_headers WHERE id=p_bom_id AND (p_org_id IS NULL OR org_id=p_org_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'BOM_NOT_FOUND_OR_WRONG_ORG'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR COALESCE(v_header_qty,0)<=0 THEN
    RAISE EXCEPTION 'BOM_EXPLOSION_QUANTITY_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bom_lines WHERE bom_id=p_bom_id AND quantity_base IS NULL AND line_type<>'REFERENCE') THEN
    RAISE EXCEPTION 'BOM_HAS_UNRESOLVED_UOM_LINES';
  END IF;

  RETURN QUERY
  WITH RECURSIVE bom_tree AS (
    SELECT 1 AS level,
           bl.item_id,bl.product_id,
           round((p_quantity/v_header_qty)*bl.quantity_base*(1+COALESCE(bl.scrap_factor,0)/100),6) AS qty_required,
           COALESCE(bl.is_critical,false) AS critical,
           COALESCE(bl.scrap_factor,0) AS scrap,
           COALESCE(bl.line_type,'COMPONENT')::text AS kind,
           ARRAY[bl.item_id]::uuid[] AS path
    FROM public.bom_lines bl
    WHERE bl.bom_id=p_bom_id AND bl.line_type<>'REFERENCE'

    UNION ALL

    SELECT bt.level+1,
           child.item_id,child.product_id,
           round((bt.qty_required/child_header.quantity)*child.quantity_base*
                 (1+COALESCE(child.scrap_factor,0)/100),6),
           COALESCE(child.is_critical,false),COALESCE(child.scrap_factor,0),
           COALESCE(child.line_type,'COMPONENT')::text,
           bt.path||child.item_id
    FROM bom_tree bt
    JOIN LATERAL (
      SELECT bh.id,bh.quantity
      FROM public.bom_headers bh
      WHERE bh.org_id=v_org AND bh.item_id=bt.item_id AND COALESCE(bh.is_active,true)
        AND COALESCE(bh.effective_date,CURRENT_DATE)<=CURRENT_DATE
      ORDER BY COALESCE(bh.bom_version,1) DESC,bh.effective_date DESC NULLS LAST,bh.created_at DESC
      LIMIT 1
    ) child_header ON true
    JOIN public.bom_lines child ON child.bom_id=child_header.id AND child.line_type<>'REFERENCE'
    WHERE bt.level<20
      AND child.quantity_base IS NOT NULL
      AND NOT child.item_id=ANY(bt.path)
  )
  SELECT min(bt.level)::integer,
         bt.item_id,
         COALESCE(i.code,i.item_code)::varchar,
         COALESCE(i.name,i.item_name)::varchar,
         round(sum(bt.qty_required),6),
         u.symbol::varchar,
         bool_or(bt.critical),
         max(bt.scrap),
         min(bt.kind)::varchar
  FROM bom_tree bt
  LEFT JOIN public.items i ON i.id=bt.item_id
  LEFT JOIN public.products p ON p.id=bt.product_id
  LEFT JOIN public.uoms u ON u.id=p.base_uom_id
  GROUP BY bt.item_id,i.code,i.item_code,i.name,i.item_name,u.symbol
  ORDER BY min(bt.level),COALESCE(i.code,i.item_code);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials_v2(
  p_mo_id uuid,p_stage_id uuid,p_consumptions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_mo_number text; v_stage uuid:=p_stage_id; v_wip_id uuid;
  v_row jsonb; v_res public.material_reservations%rowtype; v_product uuid;
  v_uom uuid; v_qty_entered numeric; v_qty_base numeric; v_factor numeric;
  v_warehouse uuid; v_count integer; v_remaining numeric; v_work_order uuid;
  v_stock jsonb; v_cogs numeric; v_total_cogs numeric:=0; v_unit_cost numeric;
BEGIN
  SELECT org_id,order_number INTO v_org,v_mo_number
  FROM public.manufacturing_orders WHERE id=p_mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF jsonb_typeof(p_consumptions)<>'array' OR jsonb_array_length(p_consumptions)=0 THEN RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED'; END IF;

  IF v_stage IS NULL THEN
    v_stage:=NULLIF(p_consumptions->0->>'stage_id','')::uuid;
  END IF;
  IF v_stage IS NULL THEN
    SELECT count(*),min(stage_id) INTO v_count,v_stage
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

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_consumptions) LOOP
    IF NULLIF(v_row->>'reservation_id','') IS NOT NULL THEN
      SELECT * INTO v_res FROM public.material_reservations
      WHERE id=(v_row->>'reservation_id')::uuid AND org_id=v_org
        AND mo_id=p_mo_id AND status='reserved' FOR UPDATE;
    ELSE
      SELECT * INTO v_res FROM public.material_reservations
      WHERE org_id=v_org AND mo_id=p_mo_id
        AND item_id=(v_row->>'item_id')::uuid AND status='reserved'
      ORDER BY created_at,id LIMIT 1 FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_RESERVATION_NOT_FOUND'; END IF;

    v_product:=COALESCE(v_res.product_id,public.wardah_resolve_product_id(v_org,v_res.item_id,now()));
    SELECT COALESCE(NULLIF(v_row->>'uom_id','')::uuid,v_res.uom_id,p.base_uom_id)
      INTO v_uom FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=NULLIF(v_row->>'quantity','')::numeric;
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN RAISE EXCEPTION 'INVALID_CONSUMPTION_QUANTITY'; END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
    v_qty_base:=round(v_qty_entered*v_factor,6);

    v_remaining:=v_res.quantity_reserved-COALESCE(v_res.quantity_consumed,0)-COALESCE(v_res.quantity_released,0);
    IF v_qty_base>v_remaining THEN RAISE EXCEPTION 'CONSUMPTION_EXCEEDS_RESERVATION: remaining=%, requested_base=%',v_remaining,v_qty_base; END IF;

    v_warehouse:=NULLIF(v_row->>'warehouse_id','')::uuid;
    IF v_warehouse IS NULL THEN
      SELECT count(*),min(warehouse_id) INTO v_count,v_warehouse
      FROM public.bins WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_CONSUMPTION'; END IF;
    END IF;

    v_work_order:=NULLIF(v_row->>'work_order_id','')::uuid;
    IF v_work_order IS NULL THEN
      SELECT count(*),min(id) INTO v_count,v_work_order
      FROM public.work_orders
      WHERE org_id=v_org AND mo_id=p_mo_id AND status NOT IN ('COMPLETED','CANCELLED');
      IF v_count<>1 THEN RAISE EXCEPTION 'WORK_ORDER_REQUIRED_FOR_CONSUMPTION'; END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.work_orders WHERE id=v_work_order AND org_id=v_org AND mo_id=p_mo_id
    ) THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND_OR_WRONG_MO';
    END IF;

    v_stock:=public.wardah_apply_stock_outgoing(v_org,v_product,v_warehouse,v_qty_base,
      'Material Consumption',p_mo_id,v_mo_number,CURRENT_DATE);
    IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN RAISE EXCEPTION 'STOCK_OUT_NOT_APPLIED'; END IF;
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
        status=CASE WHEN COALESCE(quantity_consumed,0)+v_qty_base+COALESCE(quantity_released,0)>=quantity_reserved
                    THEN 'consumed' ELSE 'reserved' END,
        consumed_at=now(),updated_at=now()
    WHERE id=v_res.id;

    v_total_cogs:=v_total_cogs+v_cogs;
  END LOOP;

  RETURN jsonb_build_object('success',true,'mo_id',p_mo_id,'stage_id',v_stage,
    'stage_wip_log_id',v_wip_id,'consumption_count',jsonb_array_length(p_consumptions),
    'material_cost_posted',round(v_total_cogs,6),'inventory_atomic',true,
    'wip_cost_atomic',true,'uom_atomic',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials(p_mo_id uuid,p_consumptions jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
  SELECT public.rpc_consume_reserved_materials_v2(
    p_mo_id,NULLIF(p_consumptions->0->>'stage_id','')::uuid,p_consumptions
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid,jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_bom_line_uom() FROM PUBLIC,anon,authenticated;

COMMENT ON FUNCTION public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb) IS
  'Consumes reserved material in base UoM, records actual ledger COGS and adds it to the open stage WIP material pool atomically.';
