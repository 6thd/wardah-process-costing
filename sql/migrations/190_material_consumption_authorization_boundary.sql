-- 190_material_consumption_authorization_boundary
--
-- Astra audit F1 / S0. Closes the material-consumption authorization gap
-- proven by PR #232 without changing canonical inventory/costing semantics.
--
-- Contract:
--   * one ordinary exact permission: manufacturing.material_consumption.consume
--   * org-admin semantics remain those of the central has_permission() contract
--   * canonical consumption RPCs are protected by an exact permission guard
--   * the legacy backflush RPC is permission-gated then explicitly retired until
--     issue #234 reimplements it on the canonical BOM + inventory contract
--   * the broken auto-backflush trigger is removed so it cannot bypass the same
--     authorization boundary via direct material_consumption writes
--   * direct INSERT remains as a compatibility path for mesService.consumeMaterial,
--     but RLS now requires the same exact permission
--   * direct UPDATE/DELETE are unsupported and their grants/policies are removed
--   * SELECT behavior is deliberately unchanged
--
-- No data rewrite. No role is auto-granted the new permission.

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE
  v_manufacturing_module_count integer;
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.modules') IS NULL
     OR to_regclass('public.material_consumption') IS NULL
     OR to_regclass('public.manufacturing_orders') IS NULL
     OR to_regclass('public.work_orders') IS NULL THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_REQUIRED_TABLE_MISSING';
  END IF;

  IF to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL
     OR to_regprocedure('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.rpc_consume_reserved_materials(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.consume_materials_for_mo(uuid,uuid,jsonb[])') IS NULL
     OR to_regprocedure('public.backflush_materials(uuid,numeric)') IS NULL THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_REQUIRED_FUNCTION_MISSING';
  END IF;

  SELECT count(*) INTO v_manufacturing_module_count
  FROM public.modules
  WHERE name = 'manufacturing';

  IF v_manufacturing_module_count <> 1 THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_MANUFACTURING_MODULE_DRIFT: %',
      v_manufacturing_module_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.permissions p
    JOIN public.modules m ON m.id = p.module_id
    WHERE p.permission_key = 'manufacturing.material_consumption.consume'
      AND (
        m.name IS DISTINCT FROM 'manufacturing'
        OR p.resource IS DISTINCT FROM 'material_consumption'
        OR p.action IS DISTINCT FROM 'consume'
      )
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_PERMISSION_KEY_COLLISION';
  END IF;
END
$preflight$;

INSERT INTO public.permissions (
  id, module_id, resource, resource_ar, action, action_ar,
  permission_key, description, description_ar
)
SELECT
  '19019019-0000-4000-8000-000000000001'::uuid,
  m.id,
  'material_consumption',
  'استهلاك المواد',
  'consume',
  'استهلاك',
  'manufacturing.material_consumption.consume',
  'Consume manufacturing materials and create material-consumption records',
  'استهلاك مواد التصنيع وإنشاء سجلات استهلاك المواد'
FROM public.modules m
WHERE m.name = 'manufacturing'
ON CONFLICT (permission_key) DO NOTHING;

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

    v_product:=COALESCE(
      v_res.product_id,
      public.wardah_resolve_product_id(v_org,v_res.item_id,now())
    );
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
      SELECT count(*),min(warehouse_id) INTO v_count,v_warehouse
      FROM public.bins
      WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_CONSUMPTION'; END IF;
    END IF;

    v_work_order:=NULLIF(v_row->>'work_order_id','')::uuid;
    IF v_work_order IS NULL THEN
      SELECT count(*),min(id) INTO v_count,v_work_order
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

-- Legacy backflush is not a legal canonical consumption implementation: the
-- current body references the retired manufacturing_orders.bom_id column and
-- writes material_consumption directly without the reservation/ledger/WIP
-- atomic contract. Keep the published entry point only as a guarded, explicit
-- retirement until #234 reimplements backflush on the canonical path.
CREATE OR REPLACE FUNCTION public.backflush_materials(
  p_work_order_id uuid,
  p_quantity_produced numeric
)
RETURNS SETOF material_consumption
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT mo.org_id INTO v_org
  FROM public.work_orders wo
  JOIN public.manufacturing_orders mo ON mo.id=wo.mo_id
  WHERE wo.id=p_work_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND';
  END IF;

  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT public.has_permission(
    auth.uid(), v_org, 'manufacturing.material_consumption.consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_PERMISSION_DENIED';
  END IF;

  RAISE EXCEPTION 'BACKFLUSH_RETIRED_PENDING_CANONICAL_REIMPLEMENTATION'
    USING ERRCODE='0A000',
          HINT='Tracked in GitHub issue #234; use rpc_consume_reserved_materials_v2 for canonical material consumption.';
END;
$function$;

COMMENT ON FUNCTION public.backflush_materials(uuid,numeric) IS
  'Permission-gated retired legacy backflush. The former implementation referenced manufacturing_orders.bom_id and bypassed canonical reservation/ledger/WIP consumption. Tracked by #234.';

-- The automatic trigger had the same retired bom_id dependency and performed a
-- direct material_consumption INSERT outside the exact-permission boundary.
-- Disable the trigger fail-closed until #234 defines canonical automatic
-- execution and system-actor authorization semantics.
DROP TRIGGER IF EXISTS trigger_auto_backflush ON public.work_orders;

-- Compatibility direct INSERT remains, but only for callers holding the exact
-- material-consumption permission. SELECT remains unchanged.
DROP POLICY IF EXISTS material_consumption_insert_policy
  ON public.material_consumption;
CREATE POLICY material_consumption_insert_policy
  ON public.material_consumption
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(
      (SELECT auth.uid()),
      org_id,
      'manufacturing.material_consumption.consume'::character varying
    )
  );

-- No repository consumer updates or deletes material_consumption directly.
-- Remove the latent mutation path entirely instead of permission-gating it.
DROP POLICY IF EXISTS material_consumption_update_policy
  ON public.material_consumption;
DROP POLICY IF EXISTS material_consumption_delete_policy
  ON public.material_consumption;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.material_consumption
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.material_consumption
  FROM anon;

DO $postflight$
DECLARE
  v_def text;
  v_policy_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.permissions p
    JOIN public.modules m ON m.id=p.module_id
    WHERE p.permission_key='manufacturing.material_consumption.consume'
      AND m.name='manufacturing'
      AND p.resource='material_consumption'
      AND p.action='consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_PERMISSION_MISSING';
  END IF;

  SELECT pg_get_functiondef(
    'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure
  ) INTO v_def;
  IF position('manufacturing.material_consumption.consume' in v_def)=0
     OR position('has_permission' in v_def)=0 THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_V2_GUARD_MISSING';
  END IF;

  SELECT pg_get_functiondef(
    'public.backflush_materials(uuid,numeric)'::regprocedure
  ) INTO v_def;
  IF position('manufacturing.material_consumption.consume' in v_def)=0
     OR position('has_permission' in v_def)=0
     OR position('BACKFLUSH_RETIRED_PENDING_CANONICAL_REIMPLEMENTATION' in v_def)=0
     OR v_def ~* '\mINSERT\s+INTO\s+(public\.)?material_consumption\M' THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_BACKFLUSH_QUARANTINE_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='work_orders'
      AND t.tgname='trigger_auto_backflush'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_AUTO_BACKFLUSH_TRIGGER_REMAINS';
  END IF;

  IF NOT has_function_privilege(
      'authenticated','public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege(
      'authenticated','public.rpc_consume_reserved_materials(uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege(
      'authenticated','public.consume_materials_for_mo(uuid,uuid,jsonb[])','EXECUTE')
     OR NOT has_function_privilege(
      'authenticated','public.backflush_materials(uuid,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_AUTHENTICATED_RPC_ACL_DRIFT';
  END IF;

  IF NOT has_table_privilege('authenticated','public.material_consumption','SELECT')
     OR NOT has_table_privilege('authenticated','public.material_consumption','INSERT') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_AUTHENTICATED_READ_INSERT_MUST_REMAIN';
  END IF;

  IF has_table_privilege('authenticated','public.material_consumption','UPDATE')
     OR has_table_privilege('authenticated','public.material_consumption','DELETE')
     OR has_table_privilege('authenticated','public.material_consumption','TRUNCATE')
     OR has_table_privilege('authenticated','public.material_consumption','REFERENCES')
     OR has_table_privilege('authenticated','public.material_consumption','TRIGGER') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_AUTHENTICATED_UNSUPPORTED_MUTATION_REMAINS';
  END IF;

  IF has_table_privilege('anon','public.material_consumption','INSERT')
     OR has_table_privilege('anon','public.material_consumption','UPDATE')
     OR has_table_privilege('anon','public.material_consumption','DELETE')
     OR has_table_privilege('anon','public.material_consumption','TRUNCATE')
     OR has_table_privilege('anon','public.material_consumption','REFERENCES')
     OR has_table_privilege('anon','public.material_consumption','TRIGGER') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_ANON_MUTATION_REMAINS';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename='material_consumption'
    AND cmd='INSERT'
    AND roles='{authenticated}'
    AND coalesce(with_check,'') ILIKE '%has_permission%'
    AND coalesce(with_check,'') ILIKE '%manufacturing.material_consumption.consume%';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_INSERT_POLICY_WRONG: %', v_policy_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='material_consumption'
      AND cmd IN ('UPDATE','DELETE')
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_UNSUPPORTED_WRITE_POLICY_REMAINS';
  END IF;

  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_POSTFLIGHT_PASS';
END
$postflight$;

COMMIT;
