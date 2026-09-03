-- Red proof for Migration 186: run on a fresh database through 185.
-- It proves the absent relation is embedded in six live routine bodies, three
-- reachable contracts fail or lie because of it, and the guarded variance
-- report presents a false empty success instead of an inspectable contract.
\set ON_ERROR_STOP on

BEGIN;

DO $preconditions$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.stock_moves') IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_186_RED_LEGACY_RELATION_UNEXPECTEDLY_PRESENT';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~* '\mstock_moves\M';

  IF v_count <> 6 THEN
    RAISE EXCEPTION 'STOCK_186_RED_EXPECTED_SIX_LIVE_REFERENCES: found=%', v_count;
  END IF;

  RAISE NOTICE 'STOCK_186_RED_PRECONDITION_OK: absent relation remains in six live routine bodies';
END
$preconditions$;

DO $balance_failure$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.validate_stock_balance(gen_random_uuid());
  EXCEPTION WHEN undefined_table THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_186_RED_BALANCE_DID_NOT_FAIL_42P01';
  END IF;
  RAISE NOTICE 'STOCK_186_RED_BALANCE_42P01_OK';
END
$balance_failure$;

INSERT INTO public.organizations (id, name, code)
VALUES ('51856186-0000-0000-0000-000000000001', 'Stock 186 Red', 'STK186-RED');

INSERT INTO auth.users (id, email)
VALUES ('51856186-0000-0000-0000-000000000002', 'stock186-red@example.test');

INSERT INTO public.user_organizations (user_id, org_id, is_active)
VALUES (
  '51856186-0000-0000-0000-000000000002',
  '51856186-0000-0000-0000-000000000001',
  true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51856186-0000-0000-0000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856186-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

DO $reservation_failure$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.rpc_create_mo_with_reservation(
      jsonb_build_object(
        'org_id', '51856186-0000-0000-0000-000000000001',
        'order_number', 'STK186-RED-MO',
        'quantity', 1
      ),
      jsonb_build_array(jsonb_build_object(
        'item_id', '51856186-0000-0000-0000-000000000003',
        'quantity', 1
      )),
      NULL
    );
  EXCEPTION WHEN undefined_table THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_186_RED_RESERVATION_DID_NOT_FAIL_42P01';
  END IF;
  RAISE NOTICE 'STOCK_186_RED_RESERVATION_42P01_OK';
END
$reservation_failure$;

DO $legacy_consumption_failure$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.consume_materials_for_mo(
    '51856186-0000-0000-0000-000000000001',
    '51856186-0000-0000-0000-000000000004',
    ARRAY[jsonb_build_object(
      'item_id', '51856186-0000-0000-0000-000000000003',
      'quantity', 1,
      'unit_cost', 1
    )]::jsonb[]
  );

  IF COALESCE((v_result ->> 'success')::boolean, true)
     OR COALESCE(v_result ->> 'error', '') NOT ILIKE '%stock_moves%' THEN
    RAISE EXCEPTION 'STOCK_186_RED_LEGACY_CONSUMPTION_NOT_MASKING_42P01: %', v_result;
  END IF;
  RAISE NOTICE 'STOCK_186_RED_LEGACY_CONSUMPTION_MASKED_ERROR_OK';
END
$legacy_consumption_failure$;

DO $variance_false_empty$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.calculate_material_variances(gen_random_uuid(), NULL, NULL);

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STOCK_186_RED_VARIANCE_EXPECTED_FALSE_EMPTY_RESULT';
  END IF;
  RAISE NOTICE 'STOCK_186_RED_VARIANCE_FALSE_EMPTY_OK';
END
$variance_false_empty$;

RESET ROLE;

\echo 'STOCK_186_RED_PROOF_PASS'
ROLLBACK;
