\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP VIEW quarantine_state AS
SELECT jsonb_build_object(
 'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.manufacturing_orders t),
 'reservations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.material_reservations t),
 'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t),
 'sle',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t)
) AS state;
CREATE TEMP TABLE quarantine_before AS SELECT state FROM quarantine_state;
CREATE FUNCTION pg_temp.assert_legacy_mo_closed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM public.rpc_create_mo_with_reservation(NULL::jsonb,NULL::jsonb,NULL::uuid);
 RAISE EXCEPTION 'LEGACY_MO_RPC_WAS_CALLABLE';
EXCEPTION WHEN insufficient_privilege THEN
 IF SQLERRM <> 'permission denied for function rpc_create_mo_with_reservation' THEN RAISE; END IF;
 RAISE NOTICE 'LEGACY_MO_QUARANTINE_DENIED role=% sqlstate=42501',current_user;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_legacy_mo_closed() TO authenticated,anon,service_role;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_legacy_mo_closed();
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_legacy_mo_closed();
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_legacy_mo_closed();
RESET ROLE;
DO $$ BEGIN
 IF (SELECT state FROM quarantine_before) IS DISTINCT FROM (SELECT state FROM quarantine_state) THEN
  RAISE EXCEPTION 'LEGACY_MO_QUARANTINE_CHANGED_STATE';
 END IF;
 RAISE NOTICE 'M195_198_LEGACY_MO_QUARANTINE_PASS roles=3 state_unchanged=true';
END $$;
ROLLBACK;
