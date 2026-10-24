-- REVIEW CANDIDATE ONLY. Not allocated M195; never apply to a live environment.
-- DB-first split: safe UI reads and quarantine of the twelve documented legacy
-- writers. Quarantine disables MO/WO/reservation maintenance, including Admin.
-- This is containment, not implementation of the proposed #170/#154 permissions.
BEGIN;
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
 IF to_regprocedure('public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)') IS NULL
 OR to_regprocedure('public.rpc_close_stage_wip_194(uuid)') IS NULL THEN
   RAISE EXCEPTION 'REQUIRES_REVIEWED_M190_THROUGH_M194';
 END IF;
END $$;

CREATE FUNCTION public.rpc_list_material_issue_orders(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 PERFORM public.wardah_assert_org_member(p_org_id);
 IF NOT public.has_permission(auth.uid(),p_org_id,'manufacturing.material_consumption.consume') THEN
   RAISE EXCEPTION 'MATERIAL_CONSUMPTION_PERMISSION_DENIED';
 END IF;
 -- Include terminal orders: an already-posted event may still need replay.
 RETURN jsonb_build_object('org_id',p_org_id,'orders',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',m.id,'org_id',m.org_id,'label',m.order_number)
                   ORDER BY m.order_number,m.id)
  FROM public.manufacturing_orders m WHERE m.org_id=p_org_id),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.rpc_list_material_issue_orders(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_list_material_issue_orders(uuid) TO authenticated;

CREATE FUNCTION public.rpc_get_material_issue_context(p_mo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid; v_result jsonb;
BEGIN
 SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id=p_mo_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
 PERFORM public.wardah_assert_org_member(v_org);
 IF NOT public.has_permission(auth.uid(),v_org,'manufacturing.material_consumption.consume') THEN
   RAISE EXCEPTION 'MATERIAL_CONSUMPTION_PERMISSION_DENIED';
 END IF;
 -- One statement snapshot. These choices do not authorize a write; M192 locks
 -- and revalidates every selected identity, current status and policy on send.
 SELECT jsonb_build_object('org_id',m.org_id,'mo_id',m.id,
  'scope_valid',
    NOT EXISTS(SELECT 1 FROM public.material_reservations r WHERE r.mo_id=m.id AND r.org_id IS DISTINCT FROM m.org_id)
    AND NOT EXISTS(SELECT 1 FROM public.work_orders w WHERE w.mo_id=m.id AND w.org_id IS DISTINCT FROM m.org_id)
    AND NOT EXISTS(SELECT 1 FROM public.stage_wip_log l LEFT JOIN public.manufacturing_stages s ON s.id=l.stage_id
      WHERE l.mo_id=m.id AND (l.org_id IS DISTINCT FROM m.org_id OR s.org_id IS DISTINCT FROM m.org_id))
    AND NOT EXISTS(SELECT 1 FROM public.stage_wip_log l WHERE l.mo_id=m.id AND NOT l.is_closed
      AND CURRENT_DATE BETWEEN l.period_start AND l.period_end GROUP BY l.stage_id HAVING count(*)>1)
    AND NOT EXISTS(SELECT 1 FROM public.material_reservations r
      LEFT JOIN public.items i ON i.id=r.item_id AND i.org_id=m.org_id
      LEFT JOIN public.products p ON p.id=r.product_id AND p.org_id=m.org_id
      LEFT JOIN public.uoms u ON u.id=p.base_uom_id AND u.is_active AND (u.org_id IS NULL OR u.org_id=m.org_id)
      WHERE r.mo_id=m.id AND r.status='reserved'
        AND r.quantity_reserved-COALESCE(r.quantity_consumed,0)-COALESCE(r.quantity_released,0)>0
        AND (i.id IS NULL OR p.id IS NULL OR u.id IS NULL)),
  'stages',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'label',s.name) ORDER BY s.order_sequence,s.id)
    FROM public.manufacturing_stages s WHERE s.org_id=m.org_id AND
    (SELECT count(*) FROM public.stage_wip_log l WHERE l.mo_id=m.id AND l.org_id=m.org_id AND l.stage_id=s.id
      AND NOT l.is_closed AND CURRENT_DATE BETWEEN l.period_start AND l.period_end)=1),'[]'::jsonb),
  'work_orders',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'label',w.work_order_number||' — '||w.status)
    ORDER BY w.work_order_number,w.id) FROM public.work_orders w
    JOIN wardah_internal.material_issue_wo_policies policy ON policy.org_id=m.org_id
    WHERE w.mo_id=m.id AND w.org_id=m.org_id AND w.status=ANY(policy.allowed_statuses)),'[]'::jsonb),
  'reservations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'label',i.name,
    'item_id',r.item_id,'product_id',r.product_id,'uom_id',u.id,'uom_label',u.code,
    'remaining',r.quantity_reserved-COALESCE(r.quantity_consumed,0)-COALESCE(r.quantity_released,0)) ORDER BY r.id)
    FROM public.material_reservations r JOIN public.items i ON i.id=r.item_id AND i.org_id=m.org_id
    JOIN public.products p ON p.id=r.product_id AND p.org_id=m.org_id
    JOIN public.uoms u ON u.id=p.base_uom_id AND u.is_active AND (u.org_id IS NULL OR u.org_id=m.org_id)
    WHERE r.mo_id=m.id AND r.org_id=m.org_id AND r.status='reserved'
    AND r.quantity_reserved-COALESCE(r.quantity_consumed,0)-COALESCE(r.quantity_released,0)>0),'[]'::jsonb),
  'warehouses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'label',w.name,
    'product_ids',(SELECT jsonb_agg(DISTINCT b.product_id) FROM public.bins b
      WHERE b.warehouse_id=w.id AND b.org_id=m.org_id AND b.actual_qty>0
      AND EXISTS(SELECT 1 FROM public.material_reservations r WHERE r.mo_id=m.id AND r.org_id=m.org_id
        AND r.product_id=b.product_id AND r.status='reserved'
        AND r.quantity_reserved-COALESCE(r.quantity_consumed,0)-COALESCE(r.quantity_released,0)>0))) ORDER BY w.id)
    FROM public.warehouses w WHERE w.org_id=m.org_id AND EXISTS(SELECT 1 FROM public.bins b
      JOIN public.material_reservations r ON r.product_id=b.product_id AND r.mo_id=m.id AND r.org_id=m.org_id
      WHERE b.warehouse_id=w.id AND b.org_id=m.org_id AND b.actual_qty>0 AND r.status='reserved'
      AND r.quantity_reserved-COALESCE(r.quantity_consumed,0)-COALESCE(r.quantity_released,0)>0)),'[]'::jsonb))
 INTO v_result FROM public.manufacturing_orders m WHERE m.id=p_mo_id AND m.org_id=v_org AND m.status='in_progress';
 IF v_result IS NULL THEN RAISE EXCEPTION 'MO_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE'; END IF;
 IF (v_result->>'scope_valid')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'MATERIAL_ISSUE_OPTIONS_SCOPE_INCOMPLETE';
 END IF;
 RETURN v_result-'scope_valid';
END $$;
REVOKE ALL ON FUNCTION public.rpc_get_material_issue_context(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_material_issue_context(uuid) TO authenticated;

DO $$
DECLARE tbl text; col text; client text; fn record; priv text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['manufacturing_orders','work_orders','material_reservations'] LOOP
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated, service_role',tbl);
  FOR col IN SELECT a.attname FROM pg_attribute a WHERE a.attrelid=('public.'||tbl)::regclass
    AND a.attnum>0 AND NOT a.attisdropped LOOP
   FOREACH client IN ARRAY ARRAY['PUBLIC','anon','authenticated','service_role'] LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM %s',col,col,col,tbl,
      CASE WHEN client='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(client) END);
   END LOOP;
  END LOOP;
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
    'rpc_create_mo_with_reservation','create_mo_with_reservation','release_expired_reservations',
    'generate_work_orders_from_mo','schedule_work_order','auto_schedule_work_orders','assign_routing_to_mo',
    'release_manufacturing_order','start_operation','complete_operation','rpc_transition_mo_status','rpc_complete_manufacturing_order']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',fn.sig);
  FOREACH client IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(client,fn.sig,'EXECUTE') THEN
    RAISE EXCEPTION 'LEGACY_RPC_GRANT_REMAINS: % %',client,fn.sig;
   END IF;
  END LOOP;
 END LOOP;
 -- Effective checks also catch inherited table/column grants; fail atomically.
 FOREACH tbl IN ARRAY ARRAY['manufacturing_orders','work_orders','material_reservations'] LOOP
  FOREACH client IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(client,'public.'||tbl,priv)
      OR (CASE WHEN priv IN ('INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(client,'public.'||tbl,priv) ELSE false END) THEN
     RAISE EXCEPTION 'LEGACY_WRITE_GRANT_REMAINS: % % %',client,tbl,priv;
    END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
COMMIT;
