-- #229: retry-safe reserved-material consumption; requires M190 and M191.
-- Applying this migration to any live database requires a separate decision and
-- an operator readback proving M190/M191 were each applied exactly once.
BEGIN;

DO $preflight$
DECLARE
  v_body text;
BEGIN
  IF to_regprocedure('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.wardah_lock_products_for_stock_write(uuid,uuid[])') IS NULL
     OR to_regprocedure('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_admin(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.permissions
                    WHERE permission_key='manufacturing.material_consumption.consume') THEN
    RAISE EXCEPTION 'M192_REQUIRES_M190_AND_M191';
  END IF;
  v_body := pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure);
  IF v_body NOT LIKE '%PRODUCT_NOT_PRELOCKED%'
     OR v_body NOT LIKE '%wardah_lock_products_for_stock_write%'
     OR v_body NOT LIKE '%FOR NO KEY UPDATE%' THEN
    RAISE EXCEPTION 'M192_M191_FIX_E_DRIFT';
  END IF;
END
$preflight$;

-- The legacy 12,4 and cost 12,4 columns would silently round M191's
-- six-decimal stock quantity/cost while WIP and reservations retain six.
ALTER TABLE public.material_consumption
  ALTER COLUMN planned_quantity TYPE numeric(18,6),
  ALTER COLUMN consumed_quantity TYPE numeric(18,6),
  ALTER COLUMN unit_cost TYPE numeric(30,12),
  ALTER COLUMN total_cost TYPE numeric(18,6);

CREATE SCHEMA IF NOT EXISTS wardah_internal;
REVOKE ALL ON SCHEMA wardah_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE wardah_internal.material_issue_wo_policies (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  allowed_statuses text[] NOT NULL DEFAULT ARRAY['IN_PROGRESS']::text[],
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT material_issue_wo_allowed CHECK (
    allowed_statuses = ARRAY['IN_PROGRESS']::text[]
    OR allowed_statuses = ARRAY['IN_PROGRESS','READY']::text[]
    OR allowed_statuses = ARRAY['IN_PROGRESS','IN_SETUP']::text[]
    OR allowed_statuses = ARRAY['IN_PROGRESS','READY','IN_SETUP']::text[]
  )
);
REVOKE ALL ON wardah_internal.material_issue_wo_policies FROM PUBLIC, anon, authenticated;

INSERT INTO wardah_internal.material_issue_wo_policies(org_id)
SELECT id FROM public.organizations;

CREATE FUNCTION wardah_internal.seed_material_issue_wo_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO wardah_internal.material_issue_wo_policies(org_id) VALUES (NEW.id);
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.seed_material_issue_wo_policy() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER seed_material_issue_wo_policy
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION wardah_internal.seed_material_issue_wo_policy();

CREATE TABLE wardah_internal.material_issue_events (
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  event_id uuid NOT NULL,
  mo_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  canonical_request jsonb NOT NULL,
  request_hash text NOT NULL,
  policy_version bigint NOT NULL,
  allowed_wo_statuses text[] NOT NULL,
  consumption_ids uuid[] NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,event_id)
);
REVOKE ALL ON wardah_internal.material_issue_events FROM PUBLIC, anon, authenticated;

-- A SECURITY DEFINER RPC is the only write surface for this private setting.
CREATE FUNCTION public.rpc_set_material_issue_wo_statuses(
  p_org_id uuid, p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before wardah_internal.material_issue_wo_policies%ROWTYPE;
  v_after wardah_internal.material_issue_wo_policies%ROWTYPE;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);
  IF p_allowed_statuses IS NULL OR NOT (
    p_allowed_statuses = ARRAY['IN_PROGRESS']::text[]
    OR p_allowed_statuses = ARRAY['IN_PROGRESS','READY']::text[]
    OR p_allowed_statuses = ARRAY['IN_PROGRESS','IN_SETUP']::text[]
    OR p_allowed_statuses = ARRAY['IN_PROGRESS','READY','IN_SETUP']::text[]
  ) THEN
    RAISE EXCEPTION 'INVALID_MATERIAL_ISSUE_WO_STATUSES';
  END IF;
  SELECT * INTO v_before FROM wardah_internal.material_issue_wo_policies
    WHERE org_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_ISSUE_WO_POLICY_MISSING'; END IF;
  UPDATE wardah_internal.material_issue_wo_policies
    SET allowed_statuses=p_allowed_statuses, version=version+1,
        updated_at=now(), updated_by=auth.uid()
    WHERE org_id=p_org_id RETURNING * INTO v_after;
  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata
  ) VALUES (
    p_org_id,auth.uid(),'manufacturing.material_issue_wo_policy.update',
    'material_issue_wo_policy',p_org_id::text,
    jsonb_build_object('statuses',v_before.allowed_statuses,'version',v_before.version),
    jsonb_build_object('statuses',v_after.allowed_statuses,'version',v_after.version),
    jsonb_build_object('source','rpc_set_material_issue_wo_statuses')
  );
  RETURN jsonb_build_object('org_id',p_org_id,'allowed_statuses',v_after.allowed_statuses,
                            'version',v_after.version);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_material_issue_wo_statuses(uuid,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_material_issue_wo_statuses(uuid,text[]) TO authenticated;

CREATE FUNCTION public.rpc_get_material_issue_wo_statuses(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_policy wardah_internal.material_issue_wo_policies%ROWTYPE;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  SELECT * INTO v_policy FROM wardah_internal.material_issue_wo_policies WHERE org_id=p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_ISSUE_WO_POLICY_MISSING'; END IF;
  RETURN jsonb_build_object('org_id',p_org_id,'allowed_statuses',v_policy.allowed_statuses,
                            'version',v_policy.version);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_get_material_issue_wo_statuses(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_material_issue_wo_statuses(uuid) TO authenticated;

-- The only event-bearing material issue writer. Lock order: event key, MO,
-- policy, WOs, stage WIP, full MO reservation set, product prefix, bin rows.
CREATE FUNCTION public.rpc_consume_material_event(
  p_mo_id uuid, p_stage_id uuid, p_event_id uuid, p_consumptions jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org uuid; v_locked_org uuid; v_mo_number text; v_mo_status text;
  v_actor uuid := auth.uid(); v_request jsonb; v_lines jsonb := '[]'::jsonb;
  v_row jsonb; v_receipt wardah_internal.material_issue_events%ROWTYPE;
  v_policy wardah_internal.material_issue_wo_policies%ROWTYPE;
  v_res public.material_reservations%ROWTYPE;
  v_work_order record; v_wo_count int:=0;
  v_wip_id uuid; v_product uuid; v_prefix_product uuid; v_uom uuid;
  v_qty_entered numeric; v_qty_base numeric; v_factor numeric;
  v_warehouse uuid; v_work_order_id uuid; v_remaining numeric;
  v_stock jsonb; v_cogs numeric; v_total_cogs numeric:=0; v_unit_cost numeric;
  v_lock_res record; v_products uuid[]:='{}'::uuid[];
  v_locked_products uuid[]; v_seen uuid[]:='{}'::uuid[];
  v_consumption_id uuid; v_ids uuid[]:='{}'::uuid[]; v_result jsonb;
BEGIN
  -- Read the MO's own org for the event-lock key. Check it again after the
  -- MO lock; neither a client-selected org nor a JWT org claim supplies it.
  SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id=p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT COALESCE(public.has_permission(
    v_actor,v_org,'manufacturing.material_consumption.consume'
  ),false) THEN RAISE EXCEPTION 'MATERIAL_CONSUMPTION_PERMISSION_DENIED'; END IF;
  IF p_event_id IS NULL OR p_stage_id IS NULL THEN
    RAISE EXCEPTION 'EVENT_AND_STAGE_REQUIRED';
  END IF;
  IF jsonb_typeof(p_consumptions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_consumptions)=0 THEN
    RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED';
  END IF;

  -- Normalize only supplied business fields; no stock/UoM/state lookup here.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_consumptions) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object'
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_row) AS k(key)
         WHERE k.key NOT IN ('item_id','reservation_id','warehouse_id',
                             'work_order_id','uom_id','quantity',
                             'consumption_type','notes')
       )
       OR jsonb_typeof(v_row->'quantity') IS DISTINCT FROM 'number'
       OR v_row->>'consumption_type' IS DISTINCT FROM 'MANUAL'
       OR (v_row ? 'notes' AND jsonb_typeof(v_row->'notes') NOT IN ('string','null'))
       OR NULLIF(v_row->>'item_id','') IS NULL
       OR NULLIF(v_row->>'reservation_id','') IS NULL
       OR NULLIF(v_row->>'warehouse_id','') IS NULL
       OR NULLIF(v_row->>'work_order_id','') IS NULL
       OR NULLIF(v_row->>'uom_id','') IS NULL THEN
      RAISE EXCEPTION 'INVALID_MATERIAL_ISSUE_LINE';
    END IF;
    v_qty_entered:=(v_row->>'quantity')::numeric;
    IF v_qty_entered<=0 OR v_qty_entered<>round(v_qty_entered,6) THEN
      RAISE EXCEPTION 'INVALID_CONSUMPTION_QUANTITY';
    END IF;
    IF (v_row->>'reservation_id')::uuid = ANY(v_seen) THEN
      RAISE EXCEPTION 'DUPLICATE_RESERVATION_IN_EVENT';
    END IF;
    v_seen:=array_append(v_seen,(v_row->>'reservation_id')::uuid);
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'item_id',(v_row->>'item_id')::uuid,
      'reservation_id',(v_row->>'reservation_id')::uuid,
      'warehouse_id',(v_row->>'warehouse_id')::uuid,
      'work_order_id',(v_row->>'work_order_id')::uuid,
      'uom_id',(v_row->>'uom_id')::uuid,
      'quantity',v_qty_entered,
      'consumption_type','MANUAL',
      'notes',v_row->>'notes'
    ));
  END LOOP;
  v_request:=jsonb_build_object(
    'org_id',v_org,'actor_id',v_actor,'mo_id',p_mo_id,
    'stage_id',p_stage_id,'event_id',p_event_id,'lines',v_lines
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_org::text||':'||p_event_id::text,0)
  );
  SELECT org_id,order_number,status INTO v_locked_org,v_mo_number,v_mo_status
    FROM public.manufacturing_orders WHERE id=p_mo_id FOR UPDATE;
  IF NOT FOUND OR v_locked_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'MANUFACTURING_ORDER_OR_ORG_CHANGED';
  END IF;

  SELECT * INTO v_receipt FROM wardah_internal.material_issue_events
    WHERE org_id=v_org AND event_id=p_event_id;
  IF FOUND THEN
    IF v_receipt.canonical_request IS DISTINCT FROM v_request THEN
      RAISE EXCEPTION 'MATERIAL_ISSUE_EVENT_CONFLICT';
    END IF;
    RETURN v_receipt.result;
  END IF;

  IF v_mo_status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_IN_PROGRESS';
  END IF;
  SELECT * INTO v_policy FROM wardah_internal.material_issue_wo_policies
    WHERE org_id=v_org FOR SHARE;
  IF NOT FOUND
     OR v_policy.allowed_statuses IS NULL
     OR v_policy.allowed_statuses NOT IN (
       ARRAY['IN_PROGRESS']::text[],
       ARRAY['IN_PROGRESS','READY']::text[],
       ARRAY['IN_PROGRESS','IN_SETUP']::text[],
       ARRAY['IN_PROGRESS','READY','IN_SETUP']::text[]
     ) THEN RAISE EXCEPTION 'MATERIAL_ISSUE_WO_POLICY_INVALID'; END IF;

  FOR v_work_order IN
    SELECT id,mo_id,org_id,status FROM public.work_orders
    WHERE id=ANY(ARRAY(
      SELECT DISTINCT (value->>'work_order_id')::uuid
      FROM jsonb_array_elements(v_lines) AS x(value)
    ))
    ORDER BY id FOR UPDATE
  LOOP
    v_wo_count:=v_wo_count+1;
    IF v_work_order.org_id IS DISTINCT FROM v_org
       OR v_work_order.mo_id IS DISTINCT FROM p_mo_id
       OR NOT COALESCE(v_work_order.status=ANY(v_policy.allowed_statuses),false) THEN
      RAISE EXCEPTION 'WORK_ORDER_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE';
    END IF;
  END LOOP;
  IF v_wo_count <> (
    SELECT count(DISTINCT (value->>'work_order_id')::uuid)
    FROM jsonb_array_elements(v_lines) AS x(value)
  ) THEN RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND_OR_WRONG_MO'; END IF;

  SELECT id INTO v_wip_id FROM public.stage_wip_log
    WHERE org_id=v_org AND mo_id=p_mo_id AND stage_id=p_stage_id
      AND COALESCE(is_closed,false)=false
      AND CURRENT_DATE BETWEEN period_start AND period_end
    ORDER BY period_end DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPEN_STAGE_WIP_LOG_NOT_FOUND'; END IF;

  -- M191 Fix E: lock the whole reservation universe, including inactive rows,
  -- before deriving the product prefix; do not throw from prefix resolution.
  FOR v_lock_res IN
    SELECT id,mo_id,item_id,product_id,status
    FROM public.material_reservations
    WHERE org_id=v_org AND mo_id=p_mo_id
    ORDER BY id FOR NO KEY UPDATE
  LOOP
    IF v_lock_res.status<>'reserved' THEN CONTINUE; END IF;
    IF v_lock_res.product_id IS NOT NULL THEN
      v_products:=array_append(v_products,v_lock_res.product_id);
      CONTINUE;
    END IF;
    SELECT m.product_id INTO v_prefix_product
      FROM public.item_product_map m
      WHERE m.org_id=v_org AND m.item_id=v_lock_res.item_id AND m.is_active
        AND m.valid_from<=now() AND (m.valid_to IS NULL OR m.valid_to>now())
      ORDER BY m.valid_from DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT p.id INTO v_prefix_product FROM public.products p
        WHERE p.id=v_lock_res.item_id AND p.org_id=v_org;
    END IF;
    IF FOUND THEN v_products:=array_append(v_products,v_prefix_product); END IF;
  END LOOP;
  v_locked_products:=public.wardah_lock_products_for_stock_write(v_org,v_products);

  -- An uncommitted receipt, all lines and every projection share one transaction.
  INSERT INTO wardah_internal.material_issue_events(
    org_id,event_id,mo_id,actor_id,canonical_request,request_hash,
    policy_version,allowed_wo_statuses,consumption_ids,result
  ) VALUES (
    v_org,p_event_id,p_mo_id,v_actor,v_request,md5(v_request::text),
    v_policy.version,v_policy.allowed_statuses,'{}'::uuid[],'{}'::jsonb
  );

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_res FROM public.material_reservations
      WHERE id=(v_row->>'reservation_id')::uuid AND org_id=v_org
        AND mo_id=p_mo_id AND status='reserved'
      FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_RESERVATION_NOT_FOUND'; END IF;
    IF v_res.item_id IS DISTINCT FROM (v_row->>'item_id')::uuid THEN
      RAISE EXCEPTION 'RESERVATION_ITEM_MISMATCH';
    END IF;
    v_product:=COALESCE(
      v_res.product_id,
      public.wardah_resolve_product_id(v_org,v_res.item_id,now())
    );
    IF v_product IS NULL
       OR NOT COALESCE(v_product=ANY(v_locked_products),false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %',v_product;
    END IF;
    v_uom:=(v_row->>'uom_id')::uuid;
    v_qty_entered:=(v_row->>'quantity')::numeric;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
    v_qty_base:=round(v_qty_entered*v_factor,6);
    IF v_qty_base<=0 THEN RAISE EXCEPTION 'INVALID_BASE_CONSUMPTION_QUANTITY'; END IF;
    v_remaining:=v_res.quantity_reserved-COALESCE(v_res.quantity_consumed,0)
                 -COALESCE(v_res.quantity_released,0);
    IF v_qty_base>v_remaining THEN
      RAISE EXCEPTION 'CONSUMPTION_EXCEEDS_RESERVATION';
    END IF;
    v_warehouse:=(v_row->>'warehouse_id')::uuid;
    v_work_order_id:=(v_row->>'work_order_id')::uuid;
    v_consumption_id:=gen_random_uuid();
    -- The M191 ten-argument helper writes the SLE with source_line_id,
    -- making the exact stock row traceable to this consumption ID.
    v_stock:=public.wardah_apply_stock_outgoing(
      v_org,v_product,v_warehouse,v_qty_base,
      'Material Consumption',p_mo_id,v_mo_number,CURRENT_DATE,v_consumption_id
    );
    IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN
      RAISE EXCEPTION 'STOCK_OUT_NOT_APPLIED';
    END IF;
    v_cogs:=COALESCE((v_stock->>'cogs')::numeric,0);
    v_unit_cost:=v_cogs/v_qty_base;
    INSERT INTO public.material_consumption(
      id,org_id,work_order_id,mo_id,item_id,product_id,reservation_id,stage_id,
      planned_quantity,consumed_quantity,consumption_type,warehouse_id,
      unit_cost,total_cost,status,consumption_date,notes,created_by,
      uom_id,qty_entered,conversion_factor_snapshot,stock_valuation_result
    ) VALUES (
      v_consumption_id,v_org,v_work_order_id,p_mo_id,v_res.item_id,v_product,
      v_res.id,p_stage_id,v_res.quantity_reserved,v_qty_base,'MANUAL',v_warehouse,
      v_unit_cost,v_cogs,'POSTED',now(),v_row->>'notes',v_actor,
      v_uom,v_qty_entered,v_factor,v_stock
    );
    UPDATE public.stage_wip_log
      SET cost_material=COALESCE(cost_material,0)+v_cogs,
          updated_at=now(),updated_by=v_actor
      WHERE id=v_wip_id;
    UPDATE public.material_reservations
      SET product_id=v_product,uom_id=v_uom,
          qty_entered=COALESCE(qty_entered,quantity_reserved),
          conversion_factor_snapshot=COALESCE(conversion_factor_snapshot,1),
          quantity_consumed=COALESCE(quantity_consumed,0)+v_qty_base,
          status=CASE WHEN COALESCE(quantity_consumed,0)+v_qty_base
                           +COALESCE(quantity_released,0)>=quantity_reserved
                      THEN 'consumed' ELSE 'reserved' END,
          consumed_at=now(),updated_at=now()
      WHERE id=v_res.id;
    v_ids:=array_append(v_ids,v_consumption_id);
    v_total_cogs:=v_total_cogs+v_cogs;
  END LOOP;
  v_result:=jsonb_build_object(
    'success',true,'org_id',v_org,'mo_id',p_mo_id,'stage_id',p_stage_id,
    'event_id',p_event_id,'stage_wip_log_id',v_wip_id,
    'consumption_ids',v_ids,'consumption_count',cardinality(v_ids),
    'material_cost_posted',round(v_total_cogs,6),
    'inventory_atomic',true,'wip_cost_atomic',true,'uom_atomic',true
  );
  UPDATE wardah_internal.material_issue_events
    SET consumption_ids=v_ids,result=v_result
    WHERE org_id=v_org AND event_id=p_event_id;
  RETURN v_result;
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)
  TO authenticated;

-- All eventless compatibility signatures fail before any write. The same
-- contract applies even to callers holding the M190 permission.
CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials_v2(
  p_mo_id uuid,p_stage_id uuid,p_consumptions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE='0A000',
    MESSAGE='MATERIAL_CONSUMPTION_EVENT_ID_REQUIRED';
END
$fn$;
CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials(
  p_mo_id uuid,p_consumptions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE='0A000',
    MESSAGE='MATERIAL_CONSUMPTION_EVENT_ID_REQUIRED';
END
$fn$;
CREATE OR REPLACE FUNCTION public.consume_materials_for_mo(
  p_org_id uuid,p_mo_id uuid,p_consumptions jsonb[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE='0A000',
    MESSAGE='MATERIAL_CONSUMPTION_EVENT_ID_REQUIRED';
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_consume_reserved_materials(uuid,jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_materials_for_mo(uuid,uuid,jsonb[])
  FROM PUBLIC, anon;

-- A client must never create a POSTED cost line without the stock/reservation
-- and WIP effects. The private event writer retains owner privileges.
DROP POLICY IF EXISTS material_consumption_insert_policy
  ON public.material_consumption;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.material_consumption FROM PUBLIC, anon, authenticated;

DO $postflight$
DECLARE
  v_owner oid;
  v_new regprocedure:='public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)'::regprocedure;
  v_body text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    LEFT JOIN wardah_internal.material_issue_wo_policies s ON s.org_id=o.id
    WHERE s.org_id IS NULL
  ) THEN RAISE EXCEPTION 'M192_ORG_POLICY_ROW_MISSING'; END IF;
  IF has_table_privilege('authenticated','public.material_consumption','INSERT')
     OR has_table_privilege('anon','public.material_consumption','INSERT')
     OR has_table_privilege('authenticated','wardah_internal.material_issue_events','INSERT')
     OR has_table_privilege('authenticated','wardah_internal.material_issue_wo_policies','UPDATE')
     OR has_table_privilege('anon','wardah_internal.material_issue_events','INSERT')
     OR has_table_privilege('anon','wardah_internal.material_issue_wo_policies','UPDATE') THEN
    RAISE EXCEPTION 'M192_CLIENT_DIRECT_WRITE_GRANT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
             AND tablename='material_consumption' AND cmd='INSERT') THEN
    RAISE EXCEPTION 'M192_DIRECT_INSERT_POLICY_REMAINS';
  END IF;
  IF has_function_privilege('anon',v_new,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_new,'EXECUTE')
     OR has_function_privilege('anon',
          'public.rpc_set_material_issue_wo_statuses(uuid,text[])','EXECUTE')
     OR has_function_privilege('anon',
          'public.rpc_get_material_issue_wo_statuses(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'M192_FUNCTION_ACL_DRIFT';
  END IF;
  SELECT proowner INTO v_owner FROM pg_proc WHERE oid=v_new;
  IF NOT has_function_privilege(
     v_owner,'public.wardah_lock_products_for_stock_write(uuid,uuid[])','EXECUTE'
  ) THEN RAISE EXCEPTION 'M192_WRITER_CANNOT_LOCK_PRODUCTS'; END IF;
  v_body:=pg_get_functiondef(v_new);
  IF v_body NOT LIKE '%FOR NO KEY UPDATE%'
     OR v_body NOT LIKE '%PRODUCT_NOT_PRELOCKED%'
     OR v_body NOT LIKE '%wardah_lock_products_for_stock_write%'
     OR v_body NOT LIKE '%MATERIAL_CONSUMPTION_PERMISSION_DENIED%'
     OR v_body NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'M192_WRITER_GUARD_DRIFT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.organizations'::regclass
      AND tgname='seed_material_issue_wo_policy' AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'M192_NEW_ORG_SEED_TRIGGER_MISSING'; END IF;
END
$postflight$;
COMMIT;
