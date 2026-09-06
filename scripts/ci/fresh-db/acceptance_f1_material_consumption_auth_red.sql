\set ON_ERROR_STOP on

BEGIN;

DO $red$
DECLARE
  v_def text;
  v_count integer;
BEGIN
  -- Client-reachable mutation surfaces must exist on the current chain.
  IF to_regprocedure('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.rpc_consume_reserved_materials(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.consume_materials_for_mo(uuid,uuid,jsonb[])') IS NULL
     OR to_regprocedure('public.backflush_materials(uuid,numeric)') IS NULL THEN
    RAISE EXCEPTION 'F1_RED_REQUIRED_CONSUMPTION_SURFACE_MISSING';
  END IF;

  -- All four are directly callable by authenticated on the reviewed live contract.
  IF NOT has_function_privilege('authenticated', 'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_consume_reserved_materials(uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.backflush_materials(uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F1_RED_AUTHENTICATED_EXECUTE_NOT_REPRODUCED';
  END IF;

  -- The two privileged write functions must still be membership-only before the fix.
  SELECT pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure)
  INTO v_def;
  IF position('wardah_assert_org_member' in v_def) = 0
     OR position('has_permission' in v_def) > 0
     OR position('wardah_has_exact_permission' in v_def) > 0 THEN
    RAISE EXCEPTION 'F1_RED_V2_MEMBERSHIP_ONLY_NOT_REPRODUCED';
  END IF;

  SELECT pg_get_functiondef('public.backflush_materials(uuid,numeric)'::regprocedure)
  INTO v_def;
  IF position('wardah_assert_org_member' in v_def) = 0
     OR position('has_permission' in v_def) > 0
     OR position('wardah_has_exact_permission' in v_def) > 0 THEN
    RAISE EXCEPTION 'F1_RED_BACKFLUSH_MEMBERSHIP_ONLY_NOT_REPRODUCED';
  END IF;

  -- Direct table DML is reachable to authenticated; RLS is membership-only.
  IF NOT has_table_privilege('authenticated', 'public.material_consumption', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.material_consumption', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.material_consumption', 'DELETE') THEN
    RAISE EXCEPTION 'F1_RED_DIRECT_DML_GRANTS_NOT_REPRODUCED';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'material_consumption'
    AND cmd IN ('INSERT','UPDATE','DELETE')
    AND coalesce(qual, '') NOT ILIKE '%has_permission%'
    AND coalesce(with_check, '') NOT ILIKE '%has_permission%'
    AND coalesce(qual, '') NOT ILIKE '%wardah_has_exact_permission%'
    AND coalesce(with_check, '') NOT ILIKE '%wardah_has_exact_permission%';

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'F1_RED_MEMBERSHIP_ONLY_RLS_NOT_REPRODUCED: %', v_count;
  END IF;

  -- There is currently no semantically exact material-consumption permission key.
  IF EXISTS (
    SELECT 1 FROM public.permissions
    WHERE permission_key IN (
      'manufacturing.material_consumption.post',
      'manufacturing.material_consumption.consume',
      'manufacturing.material_consumption.reverse'
    )
  ) THEN
    RAISE EXCEPTION 'F1_RED_EXACT_PERMISSION_ALREADY_EXISTS';
  END IF;

  RAISE NOTICE 'F1_RED_PROOF_PASS: authenticated consumption RPCs + direct table DML remain membership-only and no exact permission key exists';
END
$red$;

ROLLBACK;

SELECT 'F1_RED_ACCEPTANCE_PASS' AS result;
