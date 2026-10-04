-- M202 INSERT-only history rehearsal, step 1/3: committed fixture shared by the
-- source and target databases (run once on a disposable copy of the 202 chain,
-- then that database is copied twice). Creates the inspector, three held MOs and
-- the quality policy. Writes no inspection. Disposable cluster only.
\set ON_ERROR_STOP on
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.inspector() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a4'::uuid $$;

INSERT INTO auth.users(id, email) VALUES (pg_temp.inspector(), 'qc-hist-inspector@example.test');
INSERT INTO public.user_organizations(user_id, org_id, role, is_active, is_org_admin)
VALUES (pg_temp.inspector(), pg_temp.org(), 'user', true, false);
INSERT INTO public.roles(id, org_id, name, name_ar, is_active)
VALUES ('ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), 'QC Inspector', 'مراقب', true);
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b4'::uuid, id FROM public.permissions
WHERE permission_key IN ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create');
INSERT INTO public.user_roles(user_id, role_id, org_id, expires_at)
VALUES (pg_temp.inspector(), 'ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), NULL);

SELECT pg_temp.as_user(pg_temp.admin(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, %s)',
  pg_temp.org(),
  jsonb_build_object('release_gate_mode', 'all_orders', 'inspection_scope', 'stages_and_final',
    'allow_conditional_release', false, 'segregation_of_duties', true,
    'admins_subject_to_quality_controls', true),
  (SELECT version FROM wardah_internal.quality_policies WHERE org_id = pg_temp.org())));

-- Three MOs with FIXED ids so both copies carry identical parents; each is put in
-- a QC hold (opens cycle 1) by the inspector through the genuine RPC.
INSERT INTO public.manufacturing_orders(id, org_id, order_number, product_id, quantity, status, created_by)
VALUES ('ed000000-0000-4000-8000-00000000f101', pg_temp.org(), 'HIST-1', pg_temp.fg(), 10, 'in_progress', pg_temp.admin()),
       ('ed000000-0000-4000-8000-00000000f102', pg_temp.org(), 'HIST-2', pg_temp.fg(), 10, 'in_progress', pg_temp.admin()),
       ('ed000000-0000-4000-8000-00000000f103', pg_temp.org(), 'HIST-3-FRESH', pg_temp.fg(), 10, 'in_progress', pg_temp.admin());
INSERT INTO public.stage_wip_log(org_id, mo_id, stage_id, period_start, period_end, created_by)
VALUES (pg_temp.org(), 'ed000000-0000-4000-8000-00000000f102', pg_temp.stage(), CURRENT_DATE, CURRENT_DATE, pg_temp.admin());
SELECT pg_temp.as_user(pg_temp.inspector(), format('SELECT public.rpc_set_mo_quality_hold(%L::uuid, ''hold'', %s, NULL)',
  m.id, m.maintenance_version))
FROM public.manufacturing_orders m WHERE m.order_number IN ('HIST-1','HIST-2','HIST-3-FRESH') ORDER BY m.order_number;
DO $$ BEGIN
  IF (SELECT count(*) FROM wardah_internal.mo_quality_cycles WHERE mo_id IN (
        'ed000000-0000-4000-8000-00000000f101','ed000000-0000-4000-8000-00000000f102','ed000000-0000-4000-8000-00000000f103')) <> 3
     OR EXISTS (SELECT 1 FROM public.quality_inspections) THEN
    RAISE EXCEPTION 'M202_HISTORY_SEED_FAIL';
  END IF;
  RAISE NOTICE 'M202_HISTORY_SEED_OK three held MOs, policy set, no inspection rows';
END $$;
