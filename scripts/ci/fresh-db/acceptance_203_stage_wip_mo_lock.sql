-- Focused acceptance for migration 203. One transaction, rolled back.
-- Requires a database through 203 (M195 containment already in force).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, code) VALUES
  ('20320320-1000-4000-8000-000000000001', 'WIP Lock Org A', 'W203-A'),
  ('20320320-2000-4000-8000-000000000001', 'WIP Lock Org B', 'W203-B');

INSERT INTO auth.users (id, email) VALUES
  ('20320320-0000-4000-8000-000000000002', 'w203-noperm@example.test'),
  ('20320320-0000-4000-8000-000000000003', 'w203-granted@example.test'),
  ('20320320-0000-4000-8000-000000000007', 'w203-inactive@example.test'),
  ('20320320-0000-4000-8000-000000000008', 'w203-cross@example.test');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('20320320-0000-4000-8000-000000000002', '20320320-1000-4000-8000-000000000001', 'user', true, false),
  ('20320320-0000-4000-8000-000000000003', '20320320-1000-4000-8000-000000000001', 'user', true, false),
  ('20320320-0000-4000-8000-000000000007', '20320320-1000-4000-8000-000000000001', 'user', true, false),
  ('20320320-0000-4000-8000-000000000008', '20320320-2000-4000-8000-000000000001', 'user', true, false);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('20320320-3000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001', 'W203 Granted', 'W203', true),
  ('20320320-3000-4000-8000-000000000002', '20320320-2000-4000-8000-000000000001', 'W203 Cross', 'W203', true);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.id IN (
    '20320320-3000-4000-8000-000000000001'::uuid,
    '20320320-3000-4000-8000-000000000002'::uuid)
  AND p.permission_key = 'manufacturing.stage_costs.create';

INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
  ('20320320-0000-4000-8000-000000000003', '20320320-3000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001'),
  ('20320320-0000-4000-8000-000000000008', '20320320-3000-4000-8000-000000000002', '20320320-2000-4000-8000-000000000001');

UPDATE public.user_organizations
SET is_active = false
WHERE user_id = '20320320-0000-4000-8000-000000000007'
  AND org_id = '20320320-1000-4000-8000-000000000001';

INSERT INTO public.manufacturing_stages (id, org_id, code, name, order_sequence) VALUES
  ('20320320-4000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001', 'W203-A', 'Stage A', 1),
  ('20320320-4000-4000-8000-000000000002', '20320320-2000-4000-8000-000000000001', 'W203-B', 'Stage B', 1);

INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity, status) VALUES
  ('20320320-5000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001', 'W203-MO-A', 1, 'draft'),
  ('20320320-5000-4000-8000-000000000002', '20320320-2000-4000-8000-000000000001', 'W203-MO-B', 1, 'draft');

CREATE FUNCTION pg_temp.w203_as(p_uid uuid, p_org uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config(
    'request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}'::text
         ELSE json_build_object('sub', p_uid, 'role', 'authenticated', 'org_id', p_org)::text END,
    true);
END
$fn$;

-- Authorized same-org insert.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000003', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
VALUES (
  '20320320-6000-4000-8000-000000000001',
  '20320320-1000-4000-8000-000000000001',
  '20320320-5000-4000-8000-000000000001',
  '20320320-4000-4000-8000-000000000001',
  DATE '2026-01-01', DATE '2026-01-31');
RESET ROLE;
DO $ok$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stage_wip_log
    WHERE id = '20320320-6000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'STAGE_WIP_203_AUTHORIZED_INSERT_MISSING';
  END IF;
  RAISE NOTICE 'STAGE_WIP_203_AUTHORIZED_INSERT_OK';
END
$ok$;

-- Missing permission.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000002', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
  VALUES (
    '20320320-6000-4000-8000-000000000002',
    '20320320-1000-4000-8000-000000000001',
    '20320320-5000-4000-8000-000000000001',
    '20320320-4000-4000-8000-000000000001',
    DATE '2026-02-01', DATE '2026-02-28');
  RAISE EXCEPTION 'STAGE_WIP_203_NO_PERMISSION_NOT_DENIED';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'WIP_CREATE_PERMISSION_DENIED' THEN RAISE; END IF;
  RAISE NOTICE 'STAGE_WIP_203_NO_PERMISSION_OK';
END
$deny$;
RESET ROLE;

-- Inactive membership reaches the helper directly. The table policy may also
-- refuse the INSERT before the trigger; either way no row is written.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000007', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  BEGIN
    PERFORM public.wardah_lock_mo_for_stage_wip_203(
      '20320320-5000-4000-8000-000000000001',
      '20320320-1000-4000-8000-000000000001');
    RAISE EXCEPTION 'STAGE_WIP_203_INACTIVE_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NOT_ORG_MEMBER' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
    VALUES (
      '20320320-6000-4000-8000-000000000003',
      '20320320-1000-4000-8000-000000000001',
      '20320320-5000-4000-8000-000000000001',
      '20320320-4000-4000-8000-000000000001',
      DATE '2026-03-01', DATE '2026-03-31');
    RAISE EXCEPTION 'STAGE_WIP_203_INACTIVE_INSERT_NOT_DENIED';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN raise_exception THEN
      IF SQLERRM <> 'NOT_ORG_MEMBER' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'STAGE_WIP_203_INACTIVE_MEMBER_OK';
END
$deny$;
RESET ROLE;

-- Missing claims.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
  VALUES (
    '20320320-6000-4000-8000-000000000004',
    '20320320-1000-4000-8000-000000000001',
    '20320320-5000-4000-8000-000000000001',
    '20320320-4000-4000-8000-000000000001',
    DATE '2026-04-01', DATE '2026-04-30');
  RAISE EXCEPTION 'STAGE_WIP_203_MISSING_CLAIMS_NOT_DENIED';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'NOT_AUTHENTICATED' THEN RAISE; END IF;
  RAISE NOTICE 'STAGE_WIP_203_MISSING_CLAIMS_OK';
END
$deny$;
RESET ROLE;

-- Cross-org MO with the caller's own org, via the real insert and the helper.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000008', '20320320-2000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  BEGIN
    INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
    VALUES (
      '20320320-6000-4000-8000-000000000005',
      '20320320-2000-4000-8000-000000000001',
      '20320320-5000-4000-8000-000000000001',
      '20320320-4000-4000-8000-000000000002',
      DATE '2026-05-01', DATE '2026-05-31');
    RAISE EXCEPTION 'STAGE_WIP_203_CROSS_ORG_MO_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'WIP_MO_NOT_IN_AUTHORIZED_ORG' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.wardah_lock_mo_for_stage_wip_203(
      '20320320-5000-4000-8000-000000000001',
      '20320320-2000-4000-8000-000000000001');
    RAISE EXCEPTION 'STAGE_WIP_203_DIRECT_CROSS_ORG_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'WIP_MO_NOT_IN_AUTHORIZED_ORG' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'STAGE_WIP_203_CROSS_ORG_MO_OK';
END
$deny$;
RESET ROLE;

-- Cross-org stage. The MO is in the caller's org; the stage is not.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000003', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
  VALUES (
    '20320320-6000-4000-8000-000000000006',
    '20320320-1000-4000-8000-000000000001',
    '20320320-5000-4000-8000-000000000001',
    '20320320-4000-4000-8000-000000000002',
    DATE '2026-06-01', DATE '2026-06-30');
  RAISE EXCEPTION 'STAGE_WIP_203_CROSS_ORG_STAGE_NOT_DENIED';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'WIP_PARENT_ORG_MISMATCH' THEN RAISE; END IF;
  RAISE NOTICE 'STAGE_WIP_203_CROSS_ORG_STAGE_OK';
END
$deny$;
RESET ROLE;

-- Nonexistent MO. Same refusal as a foreign MO, and no row information.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000003', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  PERFORM public.wardah_lock_mo_for_stage_wip_203(
    '20320320-5000-4000-8000-000000000099',
    '20320320-1000-4000-8000-000000000001');
  RAISE EXCEPTION 'STAGE_WIP_203_MISSING_MO_NOT_DENIED';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'WIP_MO_NOT_IN_AUTHORIZED_ORG' THEN RAISE; END IF;
  RAISE NOTICE 'STAGE_WIP_203_MISSING_MO_OK';
END
$deny$;

-- Direct helper denials match the insert path.
DO $deny$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '20320320-0000-4000-8000-000000000002', true);
  PERFORM set_config('request.jwt.claims',
    '{"sub":"20320320-0000-4000-8000-000000000002","role":"authenticated","org_id":"20320320-1000-4000-8000-000000000001"}', true);
  BEGIN
    PERFORM public.wardah_lock_mo_for_stage_wip_203(
      '20320320-5000-4000-8000-000000000001',
      '20320320-1000-4000-8000-000000000001');
    RAISE EXCEPTION 'STAGE_WIP_203_DIRECT_NO_PERMISSION_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'WIP_CREATE_PERMISSION_DENIED' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'STAGE_WIP_203_DIRECT_HELPER_OK';
END
$deny$;
RESET ROLE;

-- Posted-field and overlap rules still refuse. Identity update still refuses.
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000003', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $rules$
BEGIN
  BEGIN
    INSERT INTO public.stage_wip_log (
      id, org_id, mo_id, stage_id, period_start, period_end, cost_material)
    VALUES (
      '20320320-6000-4000-8000-000000000007',
      '20320320-1000-4000-8000-000000000001',
      '20320320-5000-4000-8000-000000000001',
      '20320320-4000-4000-8000-000000000001',
      DATE '2026-07-01', DATE '2026-07-31', 1);
    RAISE EXCEPTION 'STAGE_WIP_203_POSTED_FIELD_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'WIP_CLIENT_POSTED_FIELDS_DENIED' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
    VALUES (
      '20320320-6000-4000-8000-000000000008',
      '20320320-1000-4000-8000-000000000001',
      '20320320-5000-4000-8000-000000000001',
      '20320320-4000-4000-8000-000000000001',
      DATE '2026-01-15', DATE '2026-02-15');
    RAISE EXCEPTION 'STAGE_WIP_203_OVERLAP_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'WIP_OPEN_PERIOD_OVERLAP' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.stage_wip_log
    SET period_end = DATE '2026-03-01'
    WHERE id = '20320320-6000-4000-8000-000000000001';
    RAISE EXCEPTION 'STAGE_WIP_203_IDENTITY_NOT_DENIED';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'WIP_IDENTITY_OR_PERIOD_IMMUTABLE' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'STAGE_WIP_203_M194_RULES_OK';
END
$rules$;
RESET ROLE;

-- Catalog owner insert does not use the helper and does not need the permission.
INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
VALUES (
  '20320320-6000-4000-8000-000000000009',
  '20320320-1000-4000-8000-000000000001',
  '20320320-5000-4000-8000-000000000001',
  '20320320-4000-4000-8000-000000000001',
  DATE '2026-08-01', DATE '2026-08-31');

-- A definer owned by the table owner, called by a member without the
-- permission, is the M192 writer shape: current_user inside the trigger is
-- the owner, so the original FOR UPDATE path runs.
CREATE FUNCTION pg_temp.w203_owner_insert() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
  VALUES (
    '20320320-6000-4000-8000-000000000010',
    '20320320-1000-4000-8000-000000000001',
    '20320320-5000-4000-8000-000000000001',
    '20320320-4000-4000-8000-000000000001',
    DATE '2026-09-01', DATE '2026-09-30');
END
$fn$;
REVOKE ALL ON FUNCTION pg_temp.w203_owner_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.w203_owner_insert() TO authenticated;
SELECT pg_temp.w203_as('20320320-0000-4000-8000-000000000002', '20320320-1000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT pg_temp.w203_owner_insert();
RESET ROLE;
DO $owner$
BEGIN
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc
      WHERE oid = 'public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)'::regprocedure)
     IS DISTINCT FROM
     (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.stage_wip_log'::regclass)
     OR NOT (SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'STAGE_WIP_203_M192_OWNER_CONTRACT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stage_wip_log WHERE id = '20320320-6000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'STAGE_WIP_203_DEFINER_WRITER_MISSING';
  END IF;
  RAISE NOTICE 'STAGE_WIP_203_OWNER_PATH_OK';
END
$owner$;

DO $grants$
DECLARE
  v_client text;
  v_priv text;
BEGIN
  FOREACH v_client IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_client, 'public.manufacturing_orders', v_priv) THEN
        RAISE EXCEPTION 'STAGE_WIP_203_CONTAINMENT_OPEN: % %', v_client, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF to_regprocedure('wardah_internal.qc_assert_closed_graph_202()') IS NOT NULL THEN
    PERFORM wardah_internal.qc_assert_closed_graph_202();
    RAISE NOTICE 'STAGE_WIP_203_M202_GRAPH_OK';
  END IF;
  RAISE NOTICE 'STAGE_WIP_203_CONTAINMENT_OK';
  RAISE NOTICE 'STAGE_WIP_203_ACCEPTANCE_PASS';
END
$grants$;
ROLLBACK;
