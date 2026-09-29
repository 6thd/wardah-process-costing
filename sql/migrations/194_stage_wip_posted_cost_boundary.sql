-- #278: protect posted stage-WIP history and issue routing. No data rewrite.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('wardah_internal.guard_posted_wip_delete_193()') IS NULL
     OR to_regclass('wardah_internal.material_issue_events') IS NULL
     OR to_regclass('public.stage_wip_log') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid='public.stage_wip_log'::regclass
         AND tgname='trigger_calculate_wip_eu' AND tgenabled='O'
     ) THEN
    RAISE EXCEPTION 'M194_REQUIRES_M192_M193_WIP_CONTRACT';
  END IF;
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class
      WHERE oid='public.stage_wip_log'::regclass) IS DISTINCT FROM current_user
     OR (SELECT pg_get_userbyid(proowner) FROM pg_proc
         WHERE oid='public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)'::regprocedure)
        IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'M194_REQUIRES_MATCHING_WIP_AND_RPC_OWNER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stage_wip_log w
    LEFT JOIN public.manufacturing_orders m ON m.id=w.mo_id
    LEFT JOIN public.manufacturing_stages s ON s.id=w.stage_id
    WHERE m.org_id IS DISTINCT FROM w.org_id
       OR s.org_id IS DISTINCT FROM w.org_id
  ) THEN
    RAISE EXCEPTION 'M194_EXISTING_WIP_PARENT_ORG_DRIFT';
  END IF;
END
$preflight$;

CREATE TEMP TABLE m194_rpc_acl_preimage ON COMMIT DROP AS
SELECT proacl,prosecdef,proconfig
FROM pg_proc WHERE oid='public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)'::regprocedure;

-- M190 intentionally revoked client EXECUTE on the internal membership
-- helper. This narrow DEFINER operation enforces both membership and the
-- specific WIP permission without exposing the private helper or schema.
CREATE FUNCTION public.wardah_assert_stage_wip_editor_194(
  p_org uuid, p_action text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_action NOT IN ('create','update') THEN
    RAISE EXCEPTION 'WIP_ACTION_INVALID' USING ERRCODE='P0001';
  END IF;
  PERFORM public.wardah_assert_org_member(p_org);
  IF NOT COALESCE(public.has_permission(
    auth.uid(),p_org,'manufacturing.stage_costs.'||p_action
  ),false) THEN
    RAISE EXCEPTION 'WIP_%_PERMISSION_DENIED',upper(p_action)
      USING ERRCODE='P0001';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.wardah_assert_stage_wip_editor_194(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wardah_assert_stage_wip_editor_194(uuid,text)
  TO authenticated;

-- Alphabetical trigger order runs calculate_wip_equivalent_units first. Direct
-- changes to derived columns cannot persist: it recomputes them from inputs.
-- The invoker trigger observes the actual executing role: authenticated for
-- PostgREST and the function owner for the M192 SECURITY DEFINER writer.
CREATE FUNCTION wardah_internal.guard_stage_wip_write_194()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_owner text;
  v_mo_org uuid;
  v_stage_org uuid;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner
    FROM pg_class WHERE oid='public.stage_wip_log'::regclass;

  IF TG_OP='INSERT' THEN
    -- The MO row serializes both concurrent INSERTs and M192's MO→WIP path.
    SELECT org_id INTO v_mo_org FROM public.manufacturing_orders
      WHERE id=NEW.mo_id FOR UPDATE;
    SELECT org_id INTO v_stage_org FROM public.manufacturing_stages
      WHERE id=NEW.stage_id FOR SHARE;
    IF v_mo_org IS DISTINCT FROM NEW.org_id
       OR v_stage_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'WIP_PARENT_ORG_MISMATCH' USING ERRCODE='P0001';
    END IF;
    IF COALESCE(NEW.cost_material,0)<>0
       OR COALESCE(NEW.is_closed,false)
       OR NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL THEN
      RAISE EXCEPTION 'WIP_CLIENT_POSTED_FIELDS_DENIED' USING ERRCODE='P0001';
    END IF;
    IF current_user<>v_owner THEN
      PERFORM public.wardah_assert_stage_wip_editor_194(NEW.org_id,'create');
    END IF;
    IF NOT COALESCE(NEW.is_closed,false) AND EXISTS (
      SELECT 1 FROM public.stage_wip_log w
      WHERE w.org_id=NEW.org_id AND w.mo_id=NEW.mo_id
        AND w.stage_id=NEW.stage_id
        AND COALESCE(w.is_closed,false)=false
        AND NEW.period_start<=w.period_end
        AND w.period_start<=NEW.period_end
    ) THEN
      RAISE EXCEPTION 'WIP_OPEN_PERIOD_OVERLAP' USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE already holds the WIP row. Never acquire an MO lock here.
  IF (NEW.org_id,NEW.mo_id,NEW.stage_id,NEW.period_start,NEW.period_end)
      IS DISTINCT FROM
     (OLD.org_id,OLD.mo_id,OLD.stage_id,OLD.period_start,OLD.period_end) THEN
    RAISE EXCEPTION 'WIP_IDENTITY_OR_PERIOD_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  IF NEW.is_closed IS DISTINCT FROM OLD.is_closed
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by THEN
    IF NOT (
      current_user=v_owner
      AND current_setting('wardah.stage_wip_close_194',true)=OLD.id::text
      AND COALESCE(OLD.is_closed,false)=false
      AND NEW.is_closed IS TRUE
      AND NEW.closed_at IS NOT NULL AND NEW.closed_by=auth.uid()
    ) THEN
      RAISE EXCEPTION 'WIP_CLOSE_REQUIRES_RPC' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF NEW.cost_material IS DISTINCT FROM OLD.cost_material
     AND NOT (current_user=v_owner AND
       current_setting('wardah.material_issue_wip_194',true)=OLD.id::text) THEN
    RAISE EXCEPTION 'WIP_POSTED_MATERIAL_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  IF current_user<>v_owner THEN
    PERFORM public.wardah_assert_stage_wip_editor_194(OLD.org_id,'update');
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.guard_stage_wip_write_194()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_guard_stage_wip_write_194
BEFORE INSERT OR UPDATE ON public.stage_wip_log
FOR EACH ROW EXECUTE FUNCTION wardah_internal.guard_stage_wip_write_194();

-- Only this reviewed operation may close a row. It takes MO before WIP and
-- records who closed it; the token is accepted only in the owner-run trigger.
CREATE FUNCTION public.rpc_close_stage_wip_194(p_wip_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org uuid; v_mo uuid; v_locked_org uuid;
  v_row public.stage_wip_log%ROWTYPE;
  v_actor uuid:=auth.uid();
BEGIN
  SELECT org_id,mo_id INTO v_org,v_mo
    FROM public.stage_wip_log WHERE id=p_wip_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WIP_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT COALESCE(public.has_permission(
    v_actor,v_org,'manufacturing.stage_costs.update'
  ),false) THEN
    RAISE EXCEPTION 'WIP_CLOSE_PERMISSION_DENIED' USING ERRCODE='P0001';
  END IF;
  SELECT org_id INTO v_locked_org FROM public.manufacturing_orders
    WHERE id=v_mo FOR UPDATE;
  IF v_locked_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'WIP_PARENT_ORG_MISMATCH' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO v_row FROM public.stage_wip_log
    WHERE id=p_wip_id FOR UPDATE;
  IF NOT FOUND OR v_row.org_id IS DISTINCT FROM v_org
     OR v_row.mo_id IS DISTINCT FROM v_mo THEN
    RAISE EXCEPTION 'WIP_CHANGED_DURING_CLOSE' USING ERRCODE='P0001';
  END IF;
  IF COALESCE(v_row.is_closed,false) THEN
    RAISE EXCEPTION 'WIP_ALREADY_CLOSED' USING ERRCODE='P0001';
  END IF;
  PERFORM set_config('wardah.stage_wip_close_194',p_wip_id::text,true);
  UPDATE public.stage_wip_log SET
    is_closed=true,closed_at=now(),closed_by=v_actor,
    updated_at=now(),updated_by=v_actor
    WHERE id=p_wip_id;
  PERFORM set_config('wardah.stage_wip_close_194','',true);
  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data
  ) VALUES (
    v_org,v_actor,'STAGE_WIP_CLOSED','stage_wip_log',p_wip_id::text,
    jsonb_build_object('is_closed',v_row.is_closed,'closed_at',v_row.closed_at),
    jsonb_build_object('is_closed',true,'closed_by',v_actor)
  );
  RETURN jsonb_build_object('id',p_wip_id,'is_closed',true);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_close_stage_wip_194(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_close_stage_wip_194(uuid) TO authenticated;

-- M192's full function body is replaced below solely to count eligible rows
-- under its existing MO lock before selecting and locking the unique WIP row.
-- Preserve signature, owner, EXECUTE ACL, SECURITY DEFINER and pinned path.
CREATE OR REPLACE FUNCTION public.rpc_consume_material_event(
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
  v_wip_candidates int; v_wip_id uuid; v_product uuid; v_prefix_product uuid; v_uom uuid;
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

  SELECT count(*) INTO v_wip_candidates FROM public.stage_wip_log
    WHERE org_id=v_org AND mo_id=p_mo_id AND stage_id=p_stage_id
      AND COALESCE(is_closed,false)=false
      AND CURRENT_DATE BETWEEN period_start AND period_end;
  IF v_wip_candidates>1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_OPEN_STAGE_WIP_LOG' USING ERRCODE='P0001';
  END IF;
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
    PERFORM set_config('wardah.material_issue_wip_194',v_wip_id::text,true);
    UPDATE public.stage_wip_log
      SET cost_material=COALESCE(cost_material,0)+v_cogs,
          updated_at=now(),updated_by=v_actor
      WHERE id=v_wip_id;
    PERFORM set_config('wardah.material_issue_wip_194','',true);
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

DO $postflight$
DECLARE v_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.stage_wip_log'::regclass
      AND tgname='zz_guard_stage_wip_write_194' AND tgenabled='O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.rpc_close_stage_wip_194(uuid)'::regprocedure
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) THEN RAISE EXCEPTION 'M194_POSTFLIGHT_GUARD_MISSING'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN m194_rpc_acl_preimage a
    WHERE p.oid='public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)'::regprocedure
      AND (p.proacl,p.prosecdef,p.proconfig) IS DISTINCT FROM
          (a.proacl,a.prosecdef,a.proconfig)
  ) THEN RAISE EXCEPTION 'M194_RPC_ACL_OR_SECURITY_DRIFT'; END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'manufacturing_orders','work_orders','material_reservations',
    'material_consumption','stage_wip_log','labor_time_tracking',
    'operation_execution_logs','quality_inspections'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid=format('public.%I',v_table)::regclass
        AND tgname='deny_history_truncate_193' AND tgenabled='O'
    ) OR has_table_privilege('authenticated',format('public.%I',v_table),'DELETE')
      OR has_table_privilege('authenticated',format('public.%I',v_table),'TRUNCATE')
      OR has_table_privilege('anon',format('public.%I',v_table),'DELETE')
      OR has_table_privilege('anon',format('public.%I',v_table),'TRUNCATE') THEN
      RAISE EXCEPTION 'M194_M193_HISTORY_BOUNDARY_DRIFT: %',v_table;
    END IF;
  END LOOP;
END
$postflight$;
COMMIT;
