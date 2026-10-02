\set ON_ERROR_STOP on
-- Post-M195 regression oracle for the quarantined legacy MO surface.
-- M195 asserts its revokes only at apply time; this file re-proves them on
-- whatever chain it runs after, by real denied calls and real denied writes.
BEGIN;
CREATE TEMP VIEW quarantine_state AS
SELECT jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.manufacturing_orders t),
 'work_orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.work_orders t),
 'reservations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_reservations t),
 'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t),
 'sle',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t)
) AS state;
CREATE TEMP TABLE quarantine_before AS SELECT state FROM quarantine_state;

-- Exact reviewed roster: the 12 names M195 quarantines, one signature each.
-- A new overload, a missing function or a changed signature fails here and
-- must be reviewed explicitly instead of passing unprobed.
CREATE TEMP TABLE quarantine_roster(sig text PRIMARY KEY);
INSERT INTO quarantine_roster VALUES
 ('assign_routing_to_mo(uuid,uuid)'),
 ('auto_schedule_work_orders(uuid,timestamp with time zone,uuid)'),
 ('complete_operation(uuid,numeric,numeric,text)'),
 ('create_mo_with_reservation(uuid,jsonb,jsonb[])'),
 ('generate_work_orders_from_mo(uuid)'),
 ('release_expired_reservations(uuid)'),
 ('release_manufacturing_order(uuid)'),
 ('rpc_complete_manufacturing_order(jsonb)'),
 ('rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'),
 ('rpc_transition_mo_status(uuid,text,text,uuid)'),
 ('schedule_work_order(uuid,timestamp with time zone,uuid)'),
 ('start_operation(uuid,uuid,boolean)');
DO $$
DECLARE live text[]; expected text[];
BEGIN
 SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) INTO live
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
  'rpc_create_mo_with_reservation','create_mo_with_reservation','release_expired_reservations',
  'generate_work_orders_from_mo','schedule_work_order','auto_schedule_work_orders','assign_routing_to_mo',
  'release_manufacturing_order','start_operation','complete_operation','rpc_transition_mo_status',
  'rpc_complete_manufacturing_order']);
 SELECT array_agg(sig ORDER BY sig) INTO expected FROM quarantine_roster;
 IF live IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'LEGACY_MO_QUARANTINE_ROSTER_DRIFT: live=% expected=%',live,expected;
 END IF;
END $$;

-- The call carries NULL for every argument. A denied EXECUTE fails before the
-- body runs; a reopened grant reaches the body and cannot satisfy the exact
-- privilege error, so it fails this probe either way.
CREATE FUNCTION pg_temp.assert_legacy_mo_closed() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; probes integer := 0;
BEGIN
 FOR r IN
  SELECT p.proname,
         format('SELECT public.%I(%s)',p.proname,
          COALESCE((SELECT string_agg(format('NULL::%s',format_type(a.t,NULL)),',' ORDER BY a.o)
                    FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(t,o)),'')) AS call
  FROM pg_temp.quarantine_roster q JOIN pg_proc p ON p.oid=('public.'||q.sig)::regprocedure
  ORDER BY q.sig
 LOOP
  BEGIN
   EXECUTE r.call;
   RAISE EXCEPTION 'LEGACY_MO_RPC_WAS_CALLABLE: %',r.call;
  EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM <> format('permission denied for function %s',r.proname) THEN RAISE; END IF;
  END;
  probes := probes+1;
 END LOOP;
 FOR r IN SELECT t, format(s,t) AS stmt
  FROM unnest(ARRAY['manufacturing_orders','work_orders','material_reservations']) t,
       unnest(ARRAY['INSERT INTO public.%I DEFAULT VALUES',
                    'UPDATE public.%I SET id=id WHERE false',
                    'DELETE FROM public.%I WHERE false',
                    'TRUNCATE public.%I']) s
 LOOP
  BEGIN
   EXECUTE r.stmt;
   RAISE EXCEPTION 'LEGACY_MO_TABLE_WAS_WRITABLE: %',r.stmt;
  EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM <> format('permission denied for table %s',r.t) THEN RAISE; END IF;
  END;
  probes := probes+1;
 END LOOP;
 RAISE NOTICE 'LEGACY_MO_QUARANTINE_DENIED role=% probes=% sqlstate=42501',current_user,probes;
 RETURN probes;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_legacy_mo_closed() TO authenticated,anon,service_role;
GRANT SELECT ON pg_temp.quarantine_roster TO authenticated,anon,service_role;
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE quarantine_probe_authenticated AS SELECT pg_temp.assert_legacy_mo_closed() AS n;
RESET ROLE;
SET LOCAL ROLE anon;
CREATE TEMP TABLE quarantine_probe_anon AS SELECT pg_temp.assert_legacy_mo_closed() AS n;
RESET ROLE;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE quarantine_probe_service_role AS SELECT pg_temp.assert_legacy_mo_closed() AS n;
RESET ROLE;
DO $$
DECLARE total integer;
BEGIN
 SELECT (SELECT n FROM quarantine_probe_authenticated)+(SELECT n FROM quarantine_probe_anon)
       +(SELECT n FROM quarantine_probe_service_role) INTO total;
 -- 3 roles x (12 functions + 3 tables x 4 write kinds).
 IF total IS DISTINCT FROM 72 THEN
  RAISE EXCEPTION 'LEGACY_MO_QUARANTINE_PROBE_COUNT: %',total;
 END IF;
 IF (SELECT state FROM quarantine_before) IS DISTINCT FROM (SELECT state FROM quarantine_state) THEN
  RAISE EXCEPTION 'LEGACY_MO_QUARANTINE_CHANGED_STATE';
 END IF;
 RAISE NOTICE 'M195_198_LEGACY_MO_QUARANTINE_PASS roles=3 functions=12 table_writes=12 probes=% state_unchanged=true',total;
END $$;
ROLLBACK;
