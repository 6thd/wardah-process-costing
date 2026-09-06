\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Ordinary active same-org member without the exact permission: denied on
-- every supported consumption entry point and on direct INSERT.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $no_permission$
DECLARE
  v_denied_v2 boolean := false;
  v_denied_legacy boolean := false;
  v_denied_compat boolean := false;
  v_denied_backflush boolean := false;
  v_denied_insert boolean := false;
BEGIN
  IF public.has_permission(
    (SELECT auth.uid()),
    '19019019-1000-4000-8000-000000000001',
    'manufacturing.material_consumption.consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_NO_PERMISSION_FIXTURE_WRONG';
  END IF;

  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2(
      '19019019-1000-4000-8000-000000000030', NULL, '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED' THEN
      v_denied_v2 := true;
    ELSE
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.rpc_consume_reserved_materials(
      '19019019-1000-4000-8000-000000000030', '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED' THEN
      v_denied_legacy := true;
    ELSE
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.consume_materials_for_mo(
      '19019019-1000-4000-8000-000000000001',
      '19019019-1000-4000-8000-000000000030',
      ARRAY[]::jsonb[]
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED' THEN
      v_denied_compat := true;
    ELSE
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM 1 FROM public.backflush_materials(
      '19019019-1000-4000-8000-000000000040', 1
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED' THEN
      v_denied_backflush := true;
    ELSE
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO public.material_consumption(
      id, org_id, work_order_id, mo_id, item_id,
      consumed_quantity, consumption_type, status
    ) VALUES (
      '19019019-1000-4000-8000-000000000051',
      '19019019-1000-4000-8000-000000000001',
      '19019019-1000-4000-8000-000000000040',
      '19019019-1000-4000-8000-000000000030',
      '19019019-1000-4000-8000-000000000010',
      1, 'MANUAL', 'PENDING'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied_insert := true;
  END;

  IF NOT (v_denied_v2 AND v_denied_legacy AND v_denied_compat
          AND v_denied_backflush AND v_denied_insert) THEN
    RAISE EXCEPTION
      'MATERIAL_CONSUMPTION_190_MEMBER_WITHOUT_PERMISSION_NOT_DENIED: v2=% legacy=% compat=% backflush=% insert=%',
      v_denied_v2,v_denied_legacy,v_denied_compat,v_denied_backflush,v_denied_insert;
  END IF;

  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_NO_PERMISSION_DENIED_OK';
END
$no_permission$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Explicit active grant: authorization passes. v2/compatibility wrappers reach
-- the next input-validation gate, backflush reaches its legal empty-BOM result,
-- and compatibility direct INSERT succeeds. UPDATE/DELETE remain unsupported.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $granted$
DECLARE
  v_v2_passed_auth boolean := false;
  v_legacy_passed_auth boolean := false;
  v_compat_passed_auth boolean := false;
  v_backflush_count integer;
  v_update_denied boolean := false;
  v_delete_denied boolean := false;
BEGIN
  IF NOT public.has_permission(
    (SELECT auth.uid()),
    '19019019-1000-4000-8000-000000000001',
    'manufacturing.material_consumption.consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_EXPLICIT_GRANT_NOT_EFFECTIVE';
  END IF;

  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2(
      '19019019-1000-4000-8000-000000000030', NULL, '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='CONSUMPTIONS_REQUIRED' THEN
      v_v2_passed_auth := true;
    ELSE
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.rpc_consume_reserved_materials(
      '19019019-1000-4000-8000-000000000030', '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='CONSUMPTIONS_REQUIRED' THEN
      v_legacy_passed_auth := true;
    ELSE
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.consume_materials_for_mo(
      '19019019-1000-4000-8000-000000000001',
      '19019019-1000-4000-8000-000000000030',
      ARRAY[]::jsonb[]
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='CONSUMPTIONS_REQUIRED' THEN
      v_compat_passed_auth := true;
    ELSE
      RAISE;
    END IF;
  END;

  SELECT count(*) INTO v_backflush_count
  FROM public.backflush_materials(
    '19019019-1000-4000-8000-000000000040', 1
  );

  IF v_backflush_count <> 0 THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_EMPTY_BOM_BACKFLUSH_WRONG: %', v_backflush_count;
  END IF;

  INSERT INTO public.material_consumption(
    id, org_id, work_order_id, mo_id, item_id,
    consumed_quantity, consumption_type, status
  ) VALUES (
    '19019019-1000-4000-8000-000000000050',
    '19019019-1000-4000-8000-000000000001',
    '19019019-1000-4000-8000-000000000040',
    '19019019-1000-4000-8000-000000000030',
    '19019019-1000-4000-8000-000000000010',
    1, 'MANUAL', 'PENDING'
  );

  BEGIN
    UPDATE public.material_consumption
    SET notes='must not update directly'
    WHERE id='19019019-1000-4000-8000-000000000050';
  EXCEPTION WHEN insufficient_privilege THEN
    v_update_denied := true;
  END;

  BEGIN
    DELETE FROM public.material_consumption
    WHERE id='19019019-1000-4000-8000-000000000050';
  EXCEPTION WHEN insufficient_privilege THEN
    v_delete_denied := true;
  END;

  IF NOT (v_v2_passed_auth AND v_legacy_passed_auth AND v_compat_passed_auth)
     OR NOT v_update_denied OR NOT v_delete_denied THEN
    RAISE EXCEPTION
      'MATERIAL_CONSUMPTION_190_EXPLICIT_GRANT_PATH_WRONG: v2=% legacy=% compat=% update_denied=% delete_denied=%',
      v_v2_passed_auth,v_legacy_passed_auth,v_compat_passed_auth,
      v_update_denied,v_delete_denied;
  END IF;

  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_EXPLICIT_GRANT_OK';
  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_DIRECT_UPDATE_DELETE_CLOSED_OK';
END
$granted$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Org admin: ordinary permission keeps the central admin override.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $org_admin$
DECLARE
  v_passed_auth boolean := false;
BEGIN
  IF NOT public.has_permission(
    (SELECT auth.uid()),
    '19019019-1000-4000-8000-000000000001',
    'manufacturing.material_consumption.consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_ORG_ADMIN_OVERRIDE_LOST';
  END IF;

  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2(
      '19019019-1000-4000-8000-000000000030', NULL, '[]'::jsonb
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='CONSUMPTIONS_REQUIRED' THEN
      v_passed_auth := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_passed_auth THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_ORG_ADMIN_RPC_DENIED';
  END IF;

  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_ORG_ADMIN_OK';
END
$org_admin$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Revoked, expired and inactive role: exact grant must not survive.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $revoked$
DECLARE v_denied boolean := false;
BEGIN
  IF public.has_permission((SELECT auth.uid()),'19019019-1000-4000-8000-000000000001','manufacturing.material_consumption.consume') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_REVOKED_PERMISSION_SURVIVED';
  END IF;
  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2('19019019-1000-4000-8000-000000000030',NULL,'[]'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_REVOKED_RPC_NOT_DENIED'; END IF;
  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_REVOKED_OK';
END
$revoked$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $expired$
DECLARE v_denied boolean := false;
BEGIN
  IF public.has_permission((SELECT auth.uid()),'19019019-1000-4000-8000-000000000001','manufacturing.material_consumption.consume') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_EXPIRED_PERMISSION_SURVIVED';
  END IF;
  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2('19019019-1000-4000-8000-000000000030',NULL,'[]'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_EXPIRED_RPC_NOT_DENIED'; END IF;
  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_EXPIRED_OK';
END
$expired$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000006', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $inactive_role$
DECLARE v_denied boolean := false;
BEGIN
  IF public.has_permission((SELECT auth.uid()),'19019019-1000-4000-8000-000000000001','manufacturing.material_consumption.consume') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_INACTIVE_ROLE_PERMISSION_SURVIVED';
  END IF;
  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2('19019019-1000-4000-8000-000000000030',NULL,'[]'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    v_denied := SQLERRM='MATERIAL_CONSUMPTION_PERMISSION_DENIED';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_INACTIVE_ROLE_RPC_NOT_DENIED'; END IF;
  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_INACTIVE_ROLE_OK';
END
$inactive_role$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Inactive membership and cross-org caller: fail closed before any write.
-- Error text belongs to wardah_assert_org_member and is intentionally not
-- coupled here; only the denied outcome is contractual.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000007', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000007","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $inactive_membership$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2('19019019-1000-4000-8000-000000000030',NULL,'[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_INACTIVE_MEMBERSHIP_RPC_ALLOWED'; END IF;

  BEGIN
    INSERT INTO public.material_consumption(
      org_id,work_order_id,mo_id,item_id,consumed_quantity,consumption_type,status
    ) VALUES (
      '19019019-1000-4000-8000-000000000001','19019019-1000-4000-8000-000000000040',
      '19019019-1000-4000-8000-000000000030','19019019-1000-4000-8000-000000000010',
      1,'MANUAL','PENDING'
    );
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_INACTIVE_MEMBERSHIP_INSERT_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_INACTIVE_MEMBERSHIP_OK';
END
$inactive_membership$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '19019019-0000-4000-8000-000000000008', true);
SELECT set_config('request.jwt.claims', '{"sub":"19019019-0000-4000-8000-000000000008","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $cross_org$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.rpc_consume_reserved_materials_v2('19019019-1000-4000-8000-000000000030',NULL,'[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_CROSS_ORG_RPC_ALLOWED'; END IF;

  BEGIN
    INSERT INTO public.material_consumption(
      org_id,work_order_id,mo_id,item_id,consumed_quantity,consumption_type,status
    ) VALUES (
      '19019019-1000-4000-8000-000000000001','19019019-1000-4000-8000-000000000040',
      '19019019-1000-4000-8000-000000000030','19019019-1000-4000-8000-000000000010',
      1,'MANUAL','PENDING'
    );
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_CROSS_ORG_INSERT_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_CROSS_ORG_OK';
END
$cross_org$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- ACL/policy invariants: authenticated read + guarded insert remain;
-- unsupported direct mutations and anon mutation grants are gone.
-- ---------------------------------------------------------------------------
DO $surface$
DECLARE v_insert_policies integer;
BEGIN
  IF NOT has_table_privilege('authenticated','public.material_consumption','SELECT')
     OR NOT has_table_privilege('authenticated','public.material_consumption','INSERT') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_COMPATIBILITY_SURFACE_LOST';
  END IF;

  IF has_table_privilege('authenticated','public.material_consumption','UPDATE')
     OR has_table_privilege('authenticated','public.material_consumption','DELETE')
     OR has_table_privilege('anon','public.material_consumption','INSERT')
     OR has_table_privilege('anon','public.material_consumption','UPDATE')
     OR has_table_privilege('anon','public.material_consumption','DELETE') THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_DIRECT_MUTATION_SURFACE_REOPENED';
  END IF;

  SELECT count(*) INTO v_insert_policies
  FROM pg_policies
  WHERE schemaname='public' AND tablename='material_consumption'
    AND cmd='INSERT' AND roles='{authenticated}'
    AND coalesce(with_check,'') ILIKE '%manufacturing.material_consumption.consume%';
  IF v_insert_policies <> 1 THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_INSERT_RLS_DRIFT: %', v_insert_policies;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='material_consumption'
      AND cmd IN ('UPDATE','DELETE')
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_UNSUPPORTED_POLICY_REOPENED';
  END IF;

  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_SURFACE_OK';
END
$surface$;

ROLLBACK;

SELECT 'MATERIAL_CONSUMPTION_190_GREEN_ACCEPTANCE_PASS' AS result;
