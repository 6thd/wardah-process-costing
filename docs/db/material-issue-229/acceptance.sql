\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql
CREATE FUNCTION pg_temp.scope_mo(p_key text) RETURNS uuid LANGUAGE sql AS $$
 SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k=p_key;
$$;
CREATE FUNCTION pg_temp.scope_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'mo',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.manufacturing_orders t),
 'wo',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.work_orders t),
 'res',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_reservations t),
 'consumption',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_consumption t),
 'wip',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stage_wip_log t),
 'bin',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t),
 'sle',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t),
 'receipt',(SELECT jsonb_agg(to_jsonb(t) ORDER BY event_id) FROM wardah_internal.material_issue_events t));
$$;
CREATE FUNCTION pg_temp.scope_denied(p_user uuid,p_sql text,p_state text,p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_state jsonb:=pg_temp.scope_state(); r jsonb;
BEGIN
 r:=pg_temp.try_as(p_user,p_sql);
 IF (r->>'ok')::boolean OR r->>'sqlstate' IS DISTINCT FROM p_state
 OR (p_message IS NOT NULL AND r->>'error' IS DISTINCT FROM p_message) THEN
  RAISE EXCEPTION 'EXPECTED_PRECISE_DENIAL: % -> %',p_sql,r;
 END IF;
 IF pg_temp.scope_state() IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'DENIAL_MUTATED_STATE'; END IF;
END $$;
DO $$
DECLARE r jsonb; old_state jsonb; receipt jsonb; actor uuid; tbl text; row_id uuid; client text; priv text; fn record;
 mo uuid:=pg_temp.scope_mo('mo'); event uuid:='ed000000-0000-4000-8000-000000000195';
BEGIN
 r:=pg_temp.as_user(pg_temp.consumer(),format('SELECT public.rpc_get_material_issue_context(%L::uuid)',mo));
 IF r->>'org_id' <> pg_temp.org()::text OR r->>'mo_id' <> mo::text
 OR jsonb_array_length(r->'stages')<>1 OR jsonb_array_length(r->'work_orders')<>1
 OR jsonb_array_length(r->'reservations')<>1 OR jsonb_array_length(r->'warehouses')<>1 THEN
  RAISE EXCEPTION 'VALID_SCOPED_OPTIONS_MISSING: %',r;
 END IF;
 r:=pg_temp.as_user(pg_temp.consumer(),format('SELECT public.rpc_list_material_issue_orders(%L::uuid)',pg_temp.org()));
 IF jsonb_array_length(r->'orders')<>2 THEN RAISE EXCEPTION 'ORDER_LIST_MISSING'; END IF;
 PERFORM pg_temp.scope_denied(pg_temp.reader(),format('SELECT public.rpc_get_material_issue_context(%L::uuid)',mo),
  'P0001','MATERIAL_CONSUMPTION_PERMISSION_DENIED');
 PERFORM pg_temp.scope_denied(pg_temp.consumer(),
  'SELECT public.rpc_list_material_issue_orders(''ffffffff-ffff-4fff-8fff-ffffffffffff''::uuid)','P0001','NOT_ORG_MEMBER');

 -- Valid populated targets; no missing-row or incidental constraint false-green.
 FOREACH actor IN ARRAY ARRAY[pg_temp.reader(),pg_temp.consumer(),pg_temp.admin()] LOOP
  FOREACH tbl IN ARRAY ARRAY['manufacturing_orders','work_orders','material_reservations'] LOOP
   EXECUTE format('SELECT id FROM public.%I ORDER BY id LIMIT 1',tbl) INTO row_id;
   PERFORM pg_temp.scope_denied(actor,format('WITH changed AS (UPDATE public.%I SET id=id WHERE id=%L::uuid RETURNING id) SELECT to_jsonb(count(*)) FROM changed',tbl,row_id),'42501');
   PERFORM pg_temp.scope_denied(actor,format('WITH changed AS (DELETE FROM public.%I WHERE id=%L::uuid RETURNING id) SELECT to_jsonb(count(*)) FROM changed',tbl,row_id),'42501');
   PERFORM pg_temp.scope_denied(actor,format('WITH changed AS (INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,to_jsonb(t)||jsonb_build_object(''id'',gen_random_uuid()))).* FROM public.%1$I t WHERE id=%2$L::uuid RETURNING id) SELECT to_jsonb(count(*)) FROM changed',tbl,row_id),'42501');
   PERFORM pg_temp.scope_denied(actor,format('SELECT pg_temp.truncate_history_193(%L)',tbl),'42501');
  END LOOP;
 END LOOP;
 FOREACH client IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH tbl IN ARRAY ARRAY['manufacturing_orders','work_orders','material_reservations'] LOOP
   FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(client,'public.'||tbl,priv) OR
     (CASE WHEN priv IN ('INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(client,'public.'||tbl,priv) ELSE false END) THEN
      RAISE EXCEPTION 'UNSAFE_EFFECTIVE_GRANT: % % %',client,tbl,priv;
    END IF;
   END LOOP;
  END LOOP;
  FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=ANY(ARRAY['rpc_create_mo_with_reservation','create_mo_with_reservation',
    'release_expired_reservations','generate_work_orders_from_mo','schedule_work_order','auto_schedule_work_orders',
    'assign_routing_to_mo','release_manufacturing_order','start_operation','complete_operation',
    'rpc_transition_mo_status','rpc_complete_manufacturing_order']) LOOP
    IF has_function_privilege(client,fn.sig,'EXECUTE') THEN RAISE EXCEPTION 'LEGACY_RPC_STILL_EXECUTABLE: % %',client,fn.sig; END IF;
  END LOOP;
 END LOOP;
 PERFORM pg_temp.scope_denied(pg_temp.admin(),format('SELECT public.rpc_transition_mo_status(%L::uuid,''done'',NULL,%L::uuid)',mo,pg_temp.org()),'42501');
 PERFORM pg_temp.scope_denied(pg_temp.reader(),'SELECT to_jsonb(public.release_expired_reservations())','42501');

 receipt:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(mo,event));
 IF receipt->>'event_id'<>event::text OR (receipt->>'material_cost_posted')::numeric<>100 THEN RAISE EXCEPTION 'BAD_RECEIPT: %',receipt; END IF;
 old_state:=pg_temp.scope_state();
 r:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(mo,event));
 IF r IS DISTINCT FROM receipt OR pg_temp.scope_state() IS DISTINCT FROM old_state THEN RAISE EXCEPTION 'REPLAY_MUTATED_STATE'; END IF;
 r:=pg_temp.consumption_state(mo);
 IF (r->>'sle_rows')::int<>1 OR (r->>'sle_qty')::numeric<>-10
 OR (r->>'mc_rows')::int<>1 OR (r->>'mc_qty')::numeric<>10
 OR (r->>'reservation_consumed')::numeric<>10 OR (r->>'wip_material_cost')::numeric<>100
 OR (r->>'bin_raw_w1_qty')::numeric<>990 THEN RAISE EXCEPTION 'RECONCILIATION_FAILED: %',r; END IF;

 PERFORM pg_temp.as_user(pg_temp.admin(),format(
  'SELECT public.rpc_replace_user_roles(jsonb_build_object(''org_id'',%L,''user_id'',%L,''role_ids'',jsonb_build_array(jsonb_build_object(''role_id'',''ed000000-0000-4000-8000-0000000000b1'',''expires_at'',(now()-interval ''1 day'')::text))))',pg_temp.org(),pg_temp.consumer()));
 PERFORM pg_temp.scope_denied(pg_temp.consumer(),format('SELECT public.rpc_get_material_issue_context(%L::uuid)',mo),'P0001','MATERIAL_CONSUMPTION_PERMISSION_DENIED');
 PERFORM pg_temp.as_user(pg_temp.admin(),format(
  'SELECT public.rpc_replace_user_roles(jsonb_build_object(''org_id'',%L,''user_id'',%L,''role_ids'',jsonb_build_array(jsonb_build_object(''role_id'',''ed000000-0000-4000-8000-0000000000b1'',''expires_at'',NULL))))',pg_temp.org(),pg_temp.consumer()));
 DELETE FROM public.role_permissions WHERE role_id='ed000000-0000-4000-8000-0000000000b1';
 PERFORM pg_temp.scope_denied(pg_temp.consumer(),pg_temp.issue_193(mo,event),'P0001','MATERIAL_CONSUMPTION_PERMISSION_DENIED');
 UPDATE public.user_organizations SET is_active=false WHERE user_id=pg_temp.admin();
 PERFORM pg_temp.scope_denied(pg_temp.admin(),format('SELECT public.rpc_list_material_issue_orders(%L::uuid)',pg_temp.org()),'P0001','NOT_ORG_MEMBER');
END $$;
SELECT 'ISSUE_SCOPE_CONTAINMENT_AND_M192_REPLAY_PASS' AS result;
ROLLBACK;
