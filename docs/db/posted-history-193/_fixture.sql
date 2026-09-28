-- Included inside each acceptance transaction after the RED fixture is loaded.
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

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
