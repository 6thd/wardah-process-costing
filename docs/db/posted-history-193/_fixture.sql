-- Included inside each acceptance transaction after the RED fixture is loaded.
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

-- try_as expects a result-producing SQL command. Keep TRUNCATE itself in a
-- SECURITY INVOKER helper so the same authenticated role executes it.
CREATE FUNCTION pg_temp.truncate_wip_193()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $fn$
BEGIN
  TRUNCATE public.stage_wip_log;
  RETURN 'true'::jsonb;
END
$fn$;

CREATE FUNCTION pg_temp.truncate_history_193(p_table text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $fn$
BEGIN
  IF p_table <> ALL(ARRAY[
    'manufacturing_orders','work_orders','material_reservations',
    'material_consumption','stage_wip_log','labor_time_tracking',
    'operation_execution_logs','quality_inspections'
  ]) THEN RAISE EXCEPTION 'UNREVIEWED_TRUNCATE_TARGET'; END IF;
  EXECUTE format('TRUNCATE public.%I CASCADE',p_table);
  RETURN 'true'::jsonb;
END
$fn$;

-- The shared try_as helper always switches to authenticated. This variant
-- proves the anon grant boundary with the same subtransaction semantics.
CREATE FUNCTION pg_temp.try_anon_193(p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb; v_state text; v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    EXECUTE p_sql INTO v_res;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('ok',true,'result',v_res);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    RETURN jsonb_build_object('ok',false,'sqlstate',v_state,'error',v_msg);
  END;
END
$fn$;

CREATE FUNCTION pg_temp.issue_193(p_mo uuid, p_event uuid)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format(
    $q$SELECT public.rpc_consume_material_event(
      %L::uuid,%L::uuid,%L::uuid,
      jsonb_build_array(jsonb_build_object(
        'item_id',%L,'reservation_id',%L,'warehouse_id',%L,
        'work_order_id',%L,'uom_id',%L,'quantity',10,
        'consumption_type','MANUAL')))$q$,
    p_mo, pg_temp.stage(), p_event, pg_temp.raw_item(),
    (SELECT id FROM public.material_reservations WHERE mo_id=p_mo ORDER BY id LIMIT 1),
    pg_temp.w1(),
    (SELECT id FROM public.work_orders WHERE mo_id=p_mo ORDER BY id LIMIT 1),
    (SELECT base_uom_id FROM public.products WHERE id=pg_temp.raw()));
$fn$;
