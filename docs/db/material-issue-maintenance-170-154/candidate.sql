-- REVIEW CANDIDATE, no migration number allocated. Requires #291 containment.
-- Material-issue preparation only; not general MES or terminal completion.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
 IF to_regprocedure('public.rpc_get_material_issue_context(uuid)') IS NULL
 OR has_table_privilege('authenticated','public.material_reservations','UPDATE') THEN
  RAISE EXCEPTION 'REQUIRES_M194_AND_291_CONTAINMENT';
 END IF;
END $$;

INSERT INTO public.permissions(module_id,resource,resource_ar,action,action_ar,
 permission_key,description,description_ar)
SELECT m.id,v.resource,v.resource_ar,v.action,v.action_ar,v.key,v.description,v.description
FROM public.modules m CROSS JOIN (VALUES
 ('material_reservation','حجز المواد','reserve','حجز','manufacturing.material_reservation.reserve','Create/resize active base-unit material reservations'),
 ('material_reservation','حجز المواد','release','إطلاق','manufacturing.material_reservation.release','Release unconsumed reservation balance without erasing history'),
 ('material_issue_setup','تجهيز صرف المواد','prepare','تجهيز','manufacturing.material_issue_setup.prepare','Prepare manual material-issue MO/WO eligibility; excludes MES execution and completion')
) v(resource,resource_ar,action,action_ar,key,description)
WHERE m.name='manufacturing' ON CONFLICT(permission_key) DO NOTHING;

-- No automatic grants, including Org Admin/super-admin bypass. The new keys
-- require an explicit active role grant. Template exclusion is appended below.
CREATE FUNCTION wardah_internal.assert_issue_maintenance_permission(p_org uuid,p_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM public.wardah_assert_org_member(p_org);
 IF NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  JOIN public.roles r ON r.id=ur.role_id AND r.org_id=ur.org_id AND r.is_active IS TRUE
  JOIN public.role_permissions rp ON rp.role_id=r.id
  JOIN public.permissions p ON p.id=rp.permission_id
  WHERE ur.user_id=auth.uid() AND ur.org_id=p_org AND p.permission_key=p_key
  AND (ur.expires_at IS NULL OR ur.expires_at>clock_timestamp())
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUE_MAINTENANCE_PERMISSION_DENIED'; END IF;
END $$;
REVOKE ALL ON FUNCTION wardah_internal.assert_issue_maintenance_permission(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE wardah_internal.material_issue_maintenance_events (
 org_id uuid NOT NULL REFERENCES public.organizations(id),event_id uuid NOT NULL,
 actor_id uuid NOT NULL,command jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(org_id,event_id)
);
REVOKE ALL ON wardah_internal.material_issue_maintenance_events FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.manufacturing_orders ADD COLUMN maintenance_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.work_orders ADD COLUMN maintenance_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.material_reservations ADD COLUMN maintenance_version bigint NOT NULL DEFAULT 1;
CREATE FUNCTION wardah_internal.bump_issue_maintenance_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.maintenance_version:=OLD.maintenance_version+1; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION wardah_internal.bump_issue_maintenance_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_issue_maintenance_version BEFORE UPDATE ON public.manufacturing_orders
 FOR EACH ROW EXECUTE FUNCTION wardah_internal.bump_issue_maintenance_version();
CREATE TRIGGER zz_issue_maintenance_version BEFORE UPDATE ON public.work_orders
 FOR EACH ROW EXECUTE FUNCTION wardah_internal.bump_issue_maintenance_version();
CREATE TRIGGER zz_issue_maintenance_version BEFORE UPDATE ON public.material_reservations
 FOR EACH ROW EXECUTE FUNCTION wardah_internal.bump_issue_maintenance_version();
-- The old trigger writes uppercase MO states, has an ambiguous aggregate and
-- reverses WO->MO locking. Never re-enable implicit/financial completion here.
DROP TRIGGER IF EXISTS trigger_update_mo_status ON public.work_orders;

CREATE FUNCTION public.rpc_manage_material_issue_setup(p_org_id uuid,p_event_id uuid,p_command jsonb,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 op text:=p_command->>'operation'; allowed text[]; required_key text;
 mo public.manufacturing_orders%ROWTYPE; wo public.work_orders%ROWTYPE;
 res public.material_reservations%ROWTYPE; prev jsonb; result jsonb; entity jsonb;
 target uuid; product uuid; persisted uuid; base_uom uuid; qty numeric; available numeric;
 total_reserved numeric; current_remaining numeric; new_status text; response jsonb; line jsonb;
BEGIN
 IF p_org_id IS NULL OR p_event_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'INVALID_ISSUE_SETUP_COMMAND'; END IF;
 CASE op
 WHEN 'create_order' THEN
  allowed:=ARRAY['operation','order','materials']; required_key:='manufacturing.material_issue_setup.prepare';
 WHEN 'set_order_status' THEN
  allowed:=ARRAY['operation','mo_id','status','expected_version']; required_key:='manufacturing.material_issue_setup.prepare';
 WHEN 'create_work_order' THEN
  allowed:=ARRAY['operation','mo_id','work_center_id','name','quantity']; required_key:='manufacturing.material_issue_setup.prepare';
 WHEN 'set_work_order_status' THEN
  allowed:=ARRAY['operation','mo_id','work_order_id','status','expected_version']; required_key:='manufacturing.material_issue_setup.prepare';
 WHEN 'open_stage_wip' THEN
  allowed:=ARRAY['operation','mo_id','stage_id','period_start','period_end']; required_key:='manufacturing.material_issue_setup.prepare';
 WHEN 'reserve' THEN
  allowed:=ARRAY['operation','mo_id','item_id','uom_id','quantity']; required_key:='manufacturing.material_reservation.reserve';
 WHEN 'resize_reservation' THEN
  allowed:=ARRAY['operation','mo_id','reservation_id','quantity','expected_version']; required_key:='manufacturing.material_reservation.reserve';
 WHEN 'release_reservation' THEN
  allowed:=ARRAY['operation','mo_id','reservation_id','quantity','expected_version']; required_key:='manufacturing.material_reservation.release';
 ELSE RAISE EXCEPTION 'UNSUPPORTED_ISSUE_SETUP_OPERATION';
 END CASE;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT(k=ANY(allowed))) THEN
  RAISE EXCEPTION 'UNSUPPORTED_ISSUE_SETUP_FIELD'; END IF;
 PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,required_key);
 IF p_actor_id IS NULL OR p_actor_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUE_SETUP_IDENTITY_CHANGED'; END IF;
 IF op='create_order' THEN
  IF NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.orders.create') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MO_CREATE_PERMISSION_DENIED'; END IF;
  IF jsonb_array_length(COALESCE(p_command->'materials','[]'::jsonb))>0 THEN
   PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,'manufacturing.material_reservation.reserve'); END IF;
 ELSIF op='set_order_status' AND NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.orders.update') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MO_UPDATE_PERMISSION_DENIED';
 ELSIF op='open_stage_wip' AND NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.stage_costs.create') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WIP_CREATE_PERMISSION_DENIED';
 END IF;
 -- Stable event -> MO -> child reservations/WO -> products -> bins.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'wardah-issue-setup:'||p_org_id::text||':'||p_event_id::text,0));
 PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,required_key);
 IF op='create_order' THEN
  IF NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.orders.create') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MO_CREATE_PERMISSION_DENIED'; END IF;
  IF jsonb_array_length(COALESCE(p_command->'materials','[]'::jsonb))>0 THEN
   PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,'manufacturing.material_reservation.reserve'); END IF;
 ELSIF op='set_order_status' AND NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.orders.update') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MO_UPDATE_PERMISSION_DENIED';
 ELSIF op='open_stage_wip' AND NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.stage_costs.create') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WIP_CREATE_PERMISSION_DENIED';
 END IF;
 SELECT e.command,e.result INTO prev,result FROM wardah_internal.material_issue_maintenance_events e
 WHERE e.org_id=p_org_id AND e.event_id=p_event_id;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM wardah_internal.material_issue_maintenance_events e
   WHERE e.org_id=p_org_id AND e.event_id=p_event_id AND e.actor_id=p_actor_id) THEN
   RAISE EXCEPTION 'ISSUE_SETUP_EVENT_ACTOR_MISMATCH'; END IF;
  IF prev IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'ISSUE_SETUP_EVENT_PAYLOAD_MISMATCH'; END IF;
  RETURN result;
 END IF;

 IF op='create_order' THEN
  IF jsonb_typeof(p_command->'order') IS DISTINCT FROM 'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command->'order') k
   WHERE k NOT IN ('order_number','product_id','item_id','quantity','notes','start_date','due_date')) THEN
   RAISE EXCEPTION 'INVALID_ISSUE_SETUP_ORDER'; END IF;
  qty:=(p_command->'order'->>'quantity')::numeric;
  IF qty IS NULL OR qty<=0 OR qty::text IN ('NaN','Infinity','-Infinity')
  OR qty<>round(qty,6) OR qty>=1000000000000 THEN RAISE EXCEPTION 'INVALID_BASE_QUANTITY'; END IF;
  product:=NULLIF(p_command->'order'->>'product_id','')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=product AND p.org_id=p_org_id AND p.is_active) THEN
   RAISE EXCEPTION 'ISSUE_SETUP_PRODUCT_SCOPE_INVALID'; END IF;
  IF p_command->'order'->>'item_id' IS NOT NULL AND
    public.wardah_resolve_product_id(p_org_id,(p_command->'order'->>'item_id')::uuid,clock_timestamp()) IS DISTINCT FROM product THEN
   RAISE EXCEPTION 'ISSUE_SETUP_PRODUCT_SCOPE_INVALID'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(COALESCE(p_command->'materials','[]'::jsonb)) LOOP
   IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(line) k
    WHERE k NOT IN ('item_id','quantity')) THEN RAISE EXCEPTION 'INVALID_RESERVATION_LINE'; END IF;
   qty:=(line->>'quantity')::numeric;
   IF qty IS NULL OR qty<=0 OR qty::text IN ('NaN','Infinity','-Infinity') OR qty<>round(qty,6)
    OR qty>=1000000000000 THEN RAISE EXCEPTION 'INVALID_BASE_QUANTITY'; END IF;
  END LOOP;
  -- New-MO exception: reviewed M191 captures products and locks stock before
  -- inserting a new parent. Legacy entry point stays quarantined for clients.
  response:=public.rpc_create_mo_with_reservation(
   (p_command->'order')||jsonb_build_object('org_id',p_org_id,'status','draft'),
   COALESCE(p_command->'materials','[]'::jsonb),p_org_id);
  IF NOT COALESCE((response->>'success')::boolean,false) THEN RAISE EXCEPTION 'ORDER_CREATION_FAILED'; END IF;
  target:=(response->>'mo_id')::uuid;
  UPDATE public.manufacturing_orders SET created_by=auth.uid(),auto_backflush=false,backflush_timing='MANUAL'
   WHERE id=target RETURNING * INTO mo;
  entity:=to_jsonb(mo);
 ELSE
  SELECT * INTO mo FROM public.manufacturing_orders m WHERE m.id=(p_command->>'mo_id')::uuid AND m.org_id=p_org_id FOR UPDATE;
  IF NOT FOUND OR mo.org_id IS DISTINCT FROM p_org_id THEN RAISE EXCEPTION 'ISSUE_SETUP_MO_SCOPE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM public.work_orders w WHERE w.mo_id=mo.id AND w.org_id IS DISTINCT FROM p_org_id)
   OR EXISTS(SELECT 1 FROM public.material_reservations r WHERE r.mo_id=mo.id AND r.org_id IS DISTINCT FROM p_org_id)
   OR EXISTS(SELECT 1 FROM public.stage_wip_log l WHERE l.mo_id=mo.id AND l.org_id IS DISTINCT FROM p_org_id) THEN
   RAISE EXCEPTION 'ISSUE_SETUP_CHILD_SCOPE_INCOMPLETE'; END IF;
  IF op<>'release_reservation' AND NOT COALESCE(mo.status IN ('draft','confirmed','in_progress','on_hold'),false) THEN
   RAISE EXCEPTION 'ISSUE_SETUP_MO_NOT_ELIGIBLE'; END IF;
  IF op='set_order_status' THEN
   IF mo.maintenance_version IS DISTINCT FROM (p_command->>'expected_version')::bigint THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='ISSUE_SETUP_STALE_VERSION'; END IF;
   new_status:=p_command->>'status';
   IF new_status IS NULL OR new_status NOT IN ('confirmed','in_progress','on_hold') THEN
    RAISE EXCEPTION 'ISSUE_SETUP_TERMINAL_TRANSITION_FORBIDDEN'; END IF;
   PERFORM public.validate_mo_transition(mo.status,new_status);
   UPDATE public.manufacturing_orders SET status=new_status WHERE id=mo.id RETURNING * INTO mo;
   entity:=to_jsonb(mo);
  ELSIF op='create_work_order' THEN
   IF NOT EXISTS(SELECT 1 FROM public.work_centers w WHERE w.id=(p_command->>'work_center_id')::uuid
    AND w.org_id=p_org_id AND w.is_active) THEN RAISE EXCEPTION 'ISSUE_SETUP_WORK_CENTER_SCOPE_INVALID'; END IF;
   qty:=(p_command->>'quantity')::numeric;
   IF qty IS NULL OR qty<=0 OR qty::text IN ('NaN','Infinity','-Infinity') OR qty<>round(qty,4)
    OR qty>=100000000 OR qty>mo.quantity OR NULLIF(btrim(p_command->>'name'),'') IS NULL THEN
    RAISE EXCEPTION 'INVALID_WORK_ORDER_QUANTITY_OR_NAME'; END IF;
   INSERT INTO public.work_orders(org_id,mo_id,work_center_id,work_order_number,operation_sequence,
    operation_name,planned_quantity,status,created_by)
   VALUES(p_org_id,mo.id,(p_command->>'work_center_id')::uuid,'MI-'||p_event_id::text,
    (SELECT COALESCE(max(w.operation_sequence),0)+1 FROM public.work_orders w WHERE w.mo_id=mo.id),
    p_command->>'name',qty,'READY',auth.uid()) RETURNING * INTO wo;
   entity:=to_jsonb(wo);
  ELSIF op='set_work_order_status' THEN
   SELECT * INTO wo FROM public.work_orders w WHERE w.id=(p_command->>'work_order_id')::uuid AND w.org_id=p_org_id AND w.mo_id=mo.id FOR UPDATE;
   IF NOT FOUND OR wo.org_id IS DISTINCT FROM p_org_id OR wo.mo_id IS DISTINCT FROM mo.id THEN
    RAISE EXCEPTION 'ISSUE_SETUP_WO_SCOPE_INVALID'; END IF;
   IF wo.maintenance_version IS DISTINCT FROM (p_command->>'expected_version')::bigint THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='ISSUE_SETUP_STALE_VERSION'; END IF;
   new_status:=p_command->>'status';
   -- This edits material-issue eligibility, not MES labor/start/pause/reporting.
   IF mo.status IS DISTINCT FROM 'in_progress' OR NOT COALESCE(wo.status IN ('READY','IN_SETUP','IN_PROGRESS','ON_HOLD'),false)
    OR new_status IS NULL OR new_status NOT IN ('READY','IN_SETUP','IN_PROGRESS','ON_HOLD') THEN
    RAISE EXCEPTION 'ISSUE_SETUP_WO_TRANSITION_FORBIDDEN'; END IF;
   UPDATE public.work_orders SET status=new_status WHERE id=wo.id RETURNING * INTO wo;
   entity:=to_jsonb(wo);
  ELSIF op='open_stage_wip' THEN
   IF NOT EXISTS(SELECT 1 FROM public.manufacturing_stages s WHERE s.id=(p_command->>'stage_id')::uuid
    AND s.org_id=p_org_id AND s.is_active)
    OR p_command->>'period_start' IS NULL OR p_command->>'period_end' IS NULL
    OR NOT isfinite((p_command->>'period_start')::date) OR NOT isfinite((p_command->>'period_end')::date)
    OR CURRENT_DATE NOT BETWEEN (p_command->>'period_start')::date AND (p_command->>'period_end')::date THEN
    RAISE EXCEPTION 'ISSUE_SETUP_WIP_SCOPE_OR_PERIOD_INVALID'; END IF;
   INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end,created_by)
    VALUES(p_org_id,mo.id,(p_command->>'stage_id')::uuid,(p_command->>'period_start')::date,
     (p_command->>'period_end')::date,auth.uid()) RETURNING to_jsonb(stage_wip_log.*) INTO entity;
  ELSE
   -- Lock the full reservation universe before the product prefix, as M192.
   PERFORM 1 FROM public.material_reservations r WHERE r.mo_id=mo.id ORDER BY r.id FOR UPDATE;
   IF op='reserve' THEN
    product:=public.wardah_resolve_product_id(p_org_id,(p_command->>'item_id')::uuid,clock_timestamp());
   ELSE
    SELECT * INTO res FROM public.material_reservations r WHERE r.id=(p_command->>'reservation_id')::uuid;
    IF NOT FOUND OR res.org_id IS DISTINCT FROM p_org_id OR res.mo_id IS DISTINCT FROM mo.id THEN
     RAISE EXCEPTION 'ISSUE_SETUP_RESERVATION_SCOPE_INVALID'; END IF;
    IF res.maintenance_version IS DISTINCT FROM (p_command->>'expected_version')::bigint THEN
     RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='ISSUE_SETUP_STALE_VERSION'; END IF;
    IF res.status IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION 'ISSUE_SETUP_RESERVATION_NOT_ACTIVE'; END IF;
    IF res.quantity_reserved::text IN ('NaN','Infinity','-Infinity')
     OR COALESCE(res.quantity_consumed,0)::text IN ('NaN','Infinity','-Infinity')
     OR COALESCE(res.quantity_released,0)::text IN ('NaN','Infinity','-Infinity')
     OR res.quantity_reserved<COALESCE(res.quantity_consumed,0)+COALESCE(res.quantity_released,0) THEN
     RAISE EXCEPTION 'ISSUE_SETUP_RESERVATION_HISTORY_INVALID'; END IF;
    IF op='resize_reservation' AND res.expires_at IS NOT NULL AND res.expires_at<=clock_timestamp() THEN
     RAISE EXCEPTION 'ISSUE_SETUP_RESERVATION_EXPIRED'; END IF;
    product:=res.product_id;
   END IF;
   PERFORM public.wardah_lock_products_for_stock_write(p_org_id,ARRAY[product]);
   SELECT p.base_uom_id INTO base_uom FROM public.products p WHERE p.id=product AND p.org_id=p_org_id AND p.is_active;
   IF base_uom IS NULL THEN RAISE EXCEPTION 'ISSUE_SETUP_PRODUCT_SCOPE_INVALID'; END IF;
   PERFORM 1 FROM public.bins b WHERE b.org_id=p_org_id AND b.product_id=product ORDER BY b.warehouse_id,b.id FOR UPDATE;
   qty:=(p_command->>'quantity')::numeric;
   IF qty IS NULL OR qty<=0 OR qty::text IN ('NaN','Infinity','-Infinity') OR qty<>round(qty,6)
    OR qty>=1000000000000 THEN RAISE EXCEPTION 'INVALID_BASE_QUANTITY'; END IF;
   IF op='release_reservation' THEN
    current_remaining:=res.quantity_reserved-COALESCE(res.quantity_consumed,0)-COALESCE(res.quantity_released,0);
    IF qty>current_remaining THEN RAISE EXCEPTION 'RELEASE_EXCEEDS_RESERVATION'; END IF;
    UPDATE public.material_reservations SET quantity_released=COALESCE(quantity_released,0)+qty,
     status=CASE WHEN qty=current_remaining THEN 'released' ELSE 'reserved' END,released_at=clock_timestamp()
     WHERE id=res.id RETURNING * INTO res;
   ELSE
    IF op='resize_reservation' AND (COALESCE(res.quantity_consumed,0)>0 OR COALESCE(res.quantity_released,0)>0) THEN
     RAISE EXCEPTION 'ISSUE_SETUP_HISTORICAL_RESERVATION_IMMUTABLE'; END IF;
    SELECT COALESCE(sum(b.actual_qty-COALESCE(b.reserved_qty,0)),0) INTO available FROM public.bins b WHERE b.org_id=p_org_id AND b.product_id=product;
    SELECT COALESCE(sum(r.quantity_reserved-COALESCE(r.quantity_consumed,0)-COALESCE(r.quantity_released,0)),0)
     INTO total_reserved FROM public.material_reservations r WHERE r.org_id=p_org_id AND r.product_id=product
     AND r.status='reserved' AND (op='reserve' OR r.id<>res.id);
    IF qty>available-total_reserved THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
    IF op='reserve' THEN
     IF base_uom IS DISTINCT FROM (p_command->>'uom_id')::uuid THEN RAISE EXCEPTION 'BASE_UOM_REQUIRED'; END IF;
     INSERT INTO public.material_reservations(org_id,mo_id,item_id,product_id,quantity_reserved,uom_id,qty_entered,conversion_factor_snapshot)
      VALUES(p_org_id,mo.id,(p_command->>'item_id')::uuid,product,qty,base_uom,qty,1) RETURNING * INTO res;
    ELSE
     UPDATE public.material_reservations SET quantity_reserved=qty,qty_entered=qty WHERE id=res.id RETURNING * INTO res;
    END IF;
   END IF;
   IF res.product_id IS DISTINCT FROM product THEN RAISE EXCEPTION 'ITEM_PRODUCT_MAPPING_DRIFT'; END IF;
   entity:=to_jsonb(res);
  END IF;
 END IF;
 -- Recheck after lock waits/writes; a revoked grant rolls back every effect.
 PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,required_key);
 IF op='create_order' THEN
  IF NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.orders.create') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MO_CREATE_PERMISSION_DENIED'; END IF;
  IF jsonb_array_length(COALESCE(p_command->'materials','[]'::jsonb))>0 THEN
   PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,'manufacturing.material_reservation.reserve'); END IF;
 ELSIF op='set_order_status' AND NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.orders.update') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MO_UPDATE_PERMISSION_DENIED';
 ELSIF op='open_stage_wip' AND NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.stage_costs.create') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WIP_CREATE_PERMISSION_DENIED';
 END IF;
 result:=jsonb_build_object('event_id',p_event_id,'org_id',p_org_id,'operation',op,'entity',entity);
 INSERT INTO wardah_internal.material_issue_maintenance_events(org_id,event_id,actor_id,command,result)
 VALUES(p_org_id,p_event_id,auth.uid(),p_command,result);
 INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,new_data,metadata)
 VALUES(p_org_id,auth.uid(),'manufacturing.issue_setup.'||op,'material_issue_setup',entity->>'id',entity,
  jsonb_build_object('event_id',p_event_id,'source','rpc_manage_material_issue_setup'));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid) TO authenticated;
-- Read-only base-UOM options; no EXECUTE restored on the private product resolver.
CREATE FUNCTION public.rpc_get_material_reservation_setup(p_org_id uuid,p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE product uuid; base_uom uuid;
BEGIN
 PERFORM wardah_internal.assert_issue_maintenance_permission(p_org_id,'manufacturing.material_reservation.reserve');
 product:=public.wardah_resolve_product_id(p_org_id,p_item_id,clock_timestamp());
 SELECT p.base_uom_id INTO base_uom FROM public.products p
  WHERE p.id=product AND p.org_id=p_org_id AND p.is_active;
 IF base_uom IS NULL THEN RAISE EXCEPTION 'ISSUE_SETUP_PRODUCT_SCOPE_INVALID'; END IF;
 RETURN jsonb_build_object('org_id',p_org_id,'item_id',p_item_id,'product_id',product,'uom_id',base_uom);
END $$;
REVOKE ALL ON FUNCTION public.rpc_get_material_reservation_setup(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_material_reservation_setup(uuid,uuid) TO authenticated;
-- Template exclusion follows, then postflight/COMMIT.

CREATE OR REPLACE FUNCTION public.create_role_from_template(
  p_org_id uuid,
  p_template_id uuid,
  p_custom_name character varying DEFAULT NULL::character varying,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_template role_templates%ROWTYPE;
    v_new_role_id UUID;
    v_perm_key TEXT;
    v_granted_keys jsonb;
BEGIN
    -- [120] admin gate on the target org; p_created_by is ignored (would
    -- otherwise allow impersonating a different creator).
    PERFORM public.wardah_assert_org_admin(p_org_id);

    SELECT * INTO v_template FROM role_templates WHERE id = p_template_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;

    INSERT INTO roles (org_id, name, name_ar, description_ar, created_by)
    VALUES (
        p_org_id,
        COALESCE(p_custom_name, v_template.name),
        v_template.name_ar,
        v_template.description_ar,
        auth.uid()
    )
    RETURNING id INTO v_new_role_id;

    FOREACH v_perm_key IN ARRAY v_template.permission_keys
    LOOP
        INSERT INTO role_permissions (role_id, permission_id, created_by)
        SELECT v_new_role_id, p.id, auth.uid()
        FROM permissions p
        WHERE (p.permission_key LIKE REPLACE(v_perm_key, '%', '%%')
           OR p.permission_key LIKE v_perm_key)
          AND p.permission_key NOT IN ('manufacturing.material_reservation.reserve',
             'manufacturing.material_reservation.release', 'manufacturing.material_issue_setup.prepare')
        ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT COALESCE(jsonb_agg(p.permission_key ORDER BY p.permission_key), '[]'::jsonb)
      INTO v_granted_keys
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_new_role_id;

    -- Preserve the M175 audit record; this candidate only excludes the three
    -- new keys from template expansion above.
    INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
    VALUES (
      p_org_id, auth.uid(), 'rbac.role.create', 'role', v_new_role_id::text,
      NULL,
      jsonb_build_object('role_id', v_new_role_id,
                         'name', COALESCE(p_custom_name, v_template.name),
                         'permission_keys', v_granted_keys),
      jsonb_build_object(
        'migration', 175,
        'source', 'template',
        'template_id', p_template_id,
        'permission_count', jsonb_array_length(v_granted_keys),
        'sensitive_keys', (
          SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
          FROM jsonb_array_elements_text(v_granted_keys) AS t(k)
          WHERE wardah_is_sensitive_permission(k)
        ))
    );

    RETURN v_new_role_id;
END;
$function$;
DO $$ DECLARE role_name text; table_name text; privilege_name text; BEGIN
 IF (SELECT count(*) FROM public.permissions WHERE permission_key IN
 ('manufacturing.material_reservation.reserve','manufacturing.material_reservation.release','manufacturing.material_issue_setup.prepare'))<>3
 THEN RAISE EXCEPTION 'MAINTENANCE_PERMISSION_CATALOG_INCOMPLETE'; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH table_name IN ARRAY ARRAY['manufacturing_orders','work_orders','material_reservations'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege(role_name,'public.'||table_name,privilege_name)
     OR (privilege_name IN ('INSERT','UPDATE') AND has_any_column_privilege(role_name,'public.'||table_name,privilege_name))
    THEN RAISE EXCEPTION 'CONTAINMENT_GRANT_REGRESSION: % % %',role_name,table_name,privilege_name; END IF;
   END LOOP;
  END LOOP;
  IF has_table_privilege(role_name,'wardah_internal.material_issue_maintenance_events','SELECT')
   OR has_table_privilege(role_name,'wardah_internal.material_issue_maintenance_events','INSERT')
  THEN RAISE EXCEPTION 'PRIVATE_RECEIPT_GRANT_REGRESSION'; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'MAINTENANCE_RPC_GRANT_REGRESSION'; END IF;
END $$;
COMMIT;
