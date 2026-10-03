-- Red proof for Migration 201: run through 200 with 201 omitted.
--
-- Before 201 the org admin cannot delegate manufacturing settings to anyone:
-- there is no permission key to put on a role, and the three settings writers
-- admit org admins only. A non-admin member whose role carries every existing
-- manufacturing key is still refused by all three.
\set ON_ERROR_STOP on

BEGIN;

DO $preconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permissions
             WHERE permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update'))
     OR to_regprocedure('wardah_internal.manufacturing_settings_can_update_201(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_RED_PRECONDITION_FAILED: 201 already applied';
  END IF;
  IF to_regprocedure('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_RED_PRECONDITION_FAILED: 200 missing from the red chain';
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_RED_PRECONDITION_OK: no settings keys; writers are admin-only';
END
$preconditions$;

INSERT INTO public.organizations (id, name, code)
VALUES ('52010201-0000-0000-0000-0000000000e1', 'MFG Settings 201 Red', 'MFS201-RED');
INSERT INTO auth.users (id, email)
VALUES ('52010201-0000-0000-0000-0000000000e2', 'mfs201-red-delegate@example.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
VALUES ('52010201-0000-0000-0000-0000000000e2', '52010201-0000-0000-0000-0000000000e1', 'user', true, false);

-- The best an org admin can do today: a role with every manufacturing key.
INSERT INTO public.roles (id, org_id, name, name_ar, is_active)
VALUES ('52010201-0000-0000-0000-0000000000e3', '52010201-0000-0000-0000-0000000000e1',
        'All manufacturing keys', 'كل مفاتيح التصنيع', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52010201-0000-0000-0000-0000000000e3'::uuid, p.id
FROM public.permissions p WHERE p.permission_key LIKE 'manufacturing.%';
INSERT INTO public.user_roles (user_id, role_id, org_id)
VALUES ('52010201-0000-0000-0000-0000000000e2', '52010201-0000-0000-0000-0000000000e3',
        '52010201-0000-0000-0000-0000000000e1');

INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance, is_active) VALUES
  ('52010201-0000-0000-0000-0000000000e1', '134100', 'WIP', 'ASSET', 'inventory', 'DEBIT', true),
  ('52010201-0000-0000-0000-0000000000e1', '135100', 'Finished goods', 'ASSET', 'inventory', 'DEBIT', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '52010201-0000-0000-0000-0000000000e2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"52010201-0000-0000-0000-0000000000e2","role":"authenticated","org_id":"52010201-0000-0000-0000-0000000000e1"}', true);

DO $probe$
DECLARE
  v_org uuid := '52010201-0000-0000-0000-0000000000e1';
  v_refused int := 0;
BEGIN
  BEGIN
    PERFORM public.rpc_set_gl_event_mapping(v_org, 'FG_RECEIPT', '135100', '134100');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NOT_ORG_ADMIN%' THEN v_refused := v_refused + 1; ELSE RAISE; END IF;
  END;
  BEGIN
    PERFORM public.rpc_set_material_issue_wo_statuses(v_org, ARRAY['IN_PROGRESS','READY']);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NOT_ORG_ADMIN%' THEN v_refused := v_refused + 1; ELSE RAISE; END IF;
  END;
  BEGIN
    PERFORM public.rpc_set_quality_policy(v_org,
      '{"release_gate_mode":"off","inspection_scope":"final_only","allow_conditional_release":false,"segregation_of_duties":true,"admins_subject_to_quality_controls":true}'::jsonb,
      (public.rpc_get_quality_policy(v_org) ->> 'version')::bigint);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%NOT_ORG_ADMIN%' THEN v_refused := v_refused + 1; ELSE RAISE; END IF;
  END;

  IF v_refused <> 3 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_RED_PROBE_UNEXPECTED: refused=%', v_refused;
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_RED_PROOF_OK: a member holding every manufacturing key is refused by all three writers';
END
$probe$;

RESET ROLE;

\echo 'MFG_SETTINGS_201_RED_PROOF_PASS'
ROLLBACK;
