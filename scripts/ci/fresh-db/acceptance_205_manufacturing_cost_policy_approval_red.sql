-- RED for Migration 205: run on a fresh database through 204 (before 205).
--
-- Proves the gaps 205 addresses, as they stand in the schema:
--   1. no draft, approval, settings, budget or legacy-resolution object exists;
--   2. a cost policy version exists the moment its creator writes it: the 204 path has one right
--      (manufacturing.settings.update) and no approval step, so the creator alone puts a version in force
--      and orders are pinned to it;
--   3. a pool has a basis and a rate only: no activity (run/setup) and no link to the budgets it loads, and
--      the 204 computation takes one labor-hours figure (no run/setup split);
--   4. no cost-policy permission key exists beyond the two M201 settings keys.
\set ON_ERROR_STOP on

BEGIN;
DO $red$
DECLARE
  v jsonb;
BEGIN
  IF to_regclass('wardah_internal.mfg_cost_policy_drafts_205') IS NOT NULL
     OR to_regprocedure('public.rpc_approve_mfg_cost_policy_draft_205(uuid,uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.permissions WHERE permission_key LIKE 'manufacturing.cost_policy.%') THEN
    RAISE EXCEPTION 'CP205_RED_NOT_PRE_205';
  END IF;
  IF to_regclass('wardah_internal.mfg_cost_policy_versions') IS NULL
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'wardah_internal.mfg_cost_policy_pools'::regclass
                AND attname IN ('activity', 'budgets', 'budget_code') AND NOT attisdropped)
     OR to_regprocedure('wardah_internal.mfg_cost_policy_compute_204(uuid,uuid,uuid,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'CP205_RED_SCHEMA_UNEXPECTED';
  END IF;

  INSERT INTO public.organizations (id, name, code) VALUES ('52050205-0000-0000-0000-0000000ed0a1', 'CP205 red', 'CP205-RED');
  INSERT INTO auth.users (id, email) VALUES ('52050205-0000-0000-0000-0000000ed0a2', 'red@cp205.test');
  INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
  VALUES ('52050205-0000-0000-0000-0000000ed0a2', '52050205-0000-0000-0000-0000000ed0a1', 'user', true, false);
  INSERT INTO public.roles (id, org_id, name, name_ar, is_active)
  VALUES ('52050205-0000-0000-0000-0000000ed0a3', '52050205-0000-0000-0000-0000000ed0a1', 'editor', 'محرر', true);
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT '52050205-0000-0000-0000-0000000ed0a3', id FROM public.permissions WHERE permission_key = 'manufacturing.settings.update';
  INSERT INTO public.user_roles (user_id, role_id, org_id)
  VALUES ('52050205-0000-0000-0000-0000000ed0a2', '52050205-0000-0000-0000-0000000ed0a3', '52050205-0000-0000-0000-0000000ed0a1');
  PERFORM set_config('request.jwt.claim.sub', '52050205-0000-0000-0000-0000000ed0a2', true);
  v := public.rpc_create_mfg_cost_policy_version('52050205-0000-0000-0000-0000000ed0a1', jsonb_build_object(
    'effective_from', wardah_internal.mfg_cost_policy_org_today_204('52050205-0000-0000-0000-0000000ed0a1', true)::text,
    'labor_cost_source', 'work_center_rate', 'default_labor_rate_per_hour', 30, 'pin_event', 'mo_created',
    'overhead_pools', jsonb_build_array(jsonb_build_object('pool_code', 'MACHINE_OH', 'name', 'M', 'basis', 'machine_hours', 'rate', 40))),
    0, gen_random_uuid());
  INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity)
  VALUES ('52050205-0000-0000-0000-0000000ed0a4', '52050205-0000-0000-0000-0000000ed0a1', 'CP205-RED-MO', 1);
  IF (SELECT created_by FROM wardah_internal.mfg_cost_policy_versions WHERE id = (v->>'policy_version_id')::uuid)
       <> '52050205-0000-0000-0000-0000000ed0a2'
     OR (SELECT policy_version_id FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52050205-0000-0000-0000-0000000ed0a4')
       <> (v->>'policy_version_id')::uuid THEN
    RAISE EXCEPTION 'CP205_RED_SINGLE_STEP_NOT_SHOWN';
  END IF;
  RAISE NOTICE 'CP205_RED: one user with manufacturing.settings.update created version % and an order is pinned to it; no approval step',
    (SELECT version_no FROM wardah_internal.mfg_cost_policy_versions WHERE id = (v->>'policy_version_id')::uuid);
  RAISE NOTICE 'MFG_COST_POLICY_205_RED_PROOF_OK';
END
$red$;
ROLLBACK;
