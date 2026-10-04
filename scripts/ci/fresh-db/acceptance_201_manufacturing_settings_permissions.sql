-- Acceptance for Migration 201: run on a fresh database through 201.
--
-- Owner decision D3: editing manufacturing settings is a role permission the
-- org admin grants. Proves, for each of the three settings writers:
--   * a non-admin whose role the org admin granted manufacturing.settings.update
--     can save;
--   * an active member without that key is refused (42501);
--   * every current org admin still saves — both an admin by membership role
--     ('admin') and one by the is_org_admin flag — so 201 locks nobody out;
--   * another org's admin cannot reach this org;
-- and that wildcard templates do not hand out the new keys.
--
-- Fixture rows are written as the table owner (176 closed client writes on
-- RBAC tables); every probe runs as authenticated through the public RPCs.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Catalog.
-- ---------------------------------------------------------------------
DO $catalog$
BEGIN
  IF (SELECT count(*) FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
      WHERE m.name = 'manufacturing'
        AND p.permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update')) <> 2 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_KEYS_MISSING';
  END IF;
  IF public.wardah_is_sensitive_permission('manufacturing.settings.update') THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_KEY_SENSITIVE';
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_CATALOG_OK';
END
$catalog$;

-- ---------------------------------------------------------------------
-- Fixtures: org A with admin, key holder (ordinary member + role), plain
-- member; org B with its own admin.
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52010201-0000-0000-0000-0000000000a1', 'MFG Settings 201 A', 'MFS201-A'),
  ('52010201-0000-0000-0000-0000000000b1', 'MFG Settings 201 B', 'MFS201-B');

INSERT INTO auth.users (id, email) VALUES
  ('52010201-0000-0000-0000-0000000000a2', 'mfs201-admin@example.test'),
  ('52010201-0000-0000-0000-0000000000a3', 'mfs201-keyholder@example.test'),
  ('52010201-0000-0000-0000-0000000000a4', 'mfs201-member@example.test'),
  ('52010201-0000-0000-0000-0000000000a5', 'mfs201-flag-admin@example.test'),
  ('52010201-0000-0000-0000-0000000000b2', 'mfs201-other-admin@example.test');

-- a2 is an admin by membership role only (is_org_admin false): has_permission's
-- own admin bypass would NOT see this user, wardah_is_org_admin does.
-- a5 is an admin by the is_org_admin flag only.
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('52010201-0000-0000-0000-0000000000a2', '52010201-0000-0000-0000-0000000000a1', 'admin', true, false),
  ('52010201-0000-0000-0000-0000000000a3', '52010201-0000-0000-0000-0000000000a1', 'user', true, false),
  ('52010201-0000-0000-0000-0000000000a4', '52010201-0000-0000-0000-0000000000a1', 'user', true, false),
  ('52010201-0000-0000-0000-0000000000a5', '52010201-0000-0000-0000-0000000000a1', 'user', true, true),
  ('52010201-0000-0000-0000-0000000000b2', '52010201-0000-0000-0000-0000000000b1', 'admin', true, false);

-- The role an org admin would create on /org-admin/roles.
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('52010201-0000-0000-0000-0000000000c1', '52010201-0000-0000-0000-0000000000a1',
   'Manufacturing Settings Editor', 'محرر إعدادات التصنيع', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52010201-0000-0000-0000-0000000000c1'::uuid, p.id
FROM public.permissions p
WHERE p.permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update');
INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
  ('52010201-0000-0000-0000-0000000000a3', '52010201-0000-0000-0000-0000000000c1',
   '52010201-0000-0000-0000-0000000000a1');

INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance, is_active) VALUES
  ('52010201-0000-0000-0000-0000000000a1', '131100', 'Raw materials', 'ASSET', 'inventory', 'DEBIT', true),
  ('52010201-0000-0000-0000-0000000000a1', '134100', 'WIP', 'ASSET', 'inventory', 'DEBIT', true),
  ('52010201-0000-0000-0000-0000000000a1', '135100', 'Finished goods', 'ASSET', 'inventory', 'DEBIT', true);

DO $seeded$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.quality_policies
                 WHERE org_id = '52010201-0000-0000-0000-0000000000a1')
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.material_issue_wo_policies
                    WHERE org_id = '52010201-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_POLICY_SEED_MISSING';
  END IF;
END
$seeded$;

-- Probe helper (pg_temp: disappears with the session; runs as the caller).
CREATE FUNCTION pg_temp.mfs201_try(p_label text, p_call text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_call;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$fn$;

CREATE FUNCTION pg_temp.mfs201_as(p_user uuid, p_org uuid) RETURNS void
LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true);
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'org_id', p_org)::text, true);
$fn$;

-- The three writers as one probe set. Quality uses the current version so a
-- refusal can only come from the guard.
CREATE FUNCTION pg_temp.mfs201_probe(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE
  v_version bigint;
BEGIN
  SELECT (public.rpc_get_quality_policy(p_org) ->> 'version')::bigint INTO v_version;
  RETURN jsonb_build_object(
    'gl', pg_temp.mfs201_try('gl', format(
      'SELECT public.rpc_set_gl_event_mapping(%L, %L, %L, %L)',
      p_org, 'FG_RECEIPT', '135100', '134100')),
    'issue', pg_temp.mfs201_try('issue', format(
      'SELECT public.rpc_set_material_issue_wo_statuses(%L, %L::text[])',
      p_org, '{IN_PROGRESS,READY}')),
    'quality', pg_temp.mfs201_try('quality', format(
      'SELECT public.rpc_set_quality_policy(%L, %L::jsonb, %s)',
      p_org,
      '{"release_gate_mode":"off","inspection_scope":"final_only","allow_conditional_release":false,"segregation_of_duties":true,"admins_subject_to_quality_controls":true}',
      COALESCE(v_version, -1))),
    'can_manage', public.rpc_get_quality_policy(p_org) -> 'capabilities' -> 'can_manage_policy');
END
$fn$;

GRANT EXECUTE ON FUNCTION pg_temp.mfs201_try(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.mfs201_as(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.mfs201_probe(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Ordinary member without the key: every writer refused.
-- ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.mfs201_as('52010201-0000-0000-0000-0000000000a4', '52010201-0000-0000-0000-0000000000a1');

DO $member$
DECLARE
  v jsonb := pg_temp.mfs201_probe('52010201-0000-0000-0000-0000000000a1');
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['gl', 'issue', 'quality'] LOOP
    IF v ->> k NOT LIKE '42501:MANUFACTURING_SETTINGS_UPDATE_DENIED%' THEN
      RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_MEMBER_NOT_REFUSED: % -> %', k, v ->> k;
    END IF;
  END LOOP;
  IF (v -> 'can_manage')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_MEMBER_CAPABILITY_WRONG: %', v;
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_MEMBER_DENIED_OK';
END
$member$;

-- ---------------------------------------------------------------------
-- 3. Non-admin key holder: every writer admitted.
-- ---------------------------------------------------------------------
SELECT pg_temp.mfs201_as('52010201-0000-0000-0000-0000000000a3', '52010201-0000-0000-0000-0000000000a1');

DO $keyholder$
DECLARE
  v jsonb;
  k text;
BEGIN
  IF public.wardah_is_org_admin('52010201-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_KEYHOLDER_IS_ADMIN';
  END IF;
  v := pg_temp.mfs201_probe('52010201-0000-0000-0000-0000000000a1');
  FOREACH k IN ARRAY ARRAY['gl', 'issue', 'quality'] LOOP
    IF v ->> k <> 'OK' THEN
      RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_KEYHOLDER_REFUSED: % -> %', k, v ->> k;
    END IF;
  END LOOP;
  IF (v -> 'can_manage')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_KEYHOLDER_CAPABILITY_WRONG: %', v;
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_KEYHOLDER_OK';
END
$keyholder$;

-- ---------------------------------------------------------------------
-- 4. Org admins without any explicit role keep access (no lockout): the
--    admin by membership role, then the admin by flag.
-- ---------------------------------------------------------------------
SELECT pg_temp.mfs201_as('52010201-0000-0000-0000-0000000000a2', '52010201-0000-0000-0000-0000000000a1');

DO $admin_role$
DECLARE
  v jsonb;
  k text;
BEGIN
  IF COALESCE(public.has_permission(auth.uid(), '52010201-0000-0000-0000-0000000000a1',
       'manufacturing.settings.update'), false) THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_FIXTURE_ROLE_ADMIN_SEEN_BY_HAS_PERMISSION';
  END IF;
  v := pg_temp.mfs201_probe('52010201-0000-0000-0000-0000000000a1');
  FOREACH k IN ARRAY ARRAY['gl', 'issue', 'quality'] LOOP
    IF v ->> k <> 'OK' THEN
      RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_ROLE_ADMIN_REFUSED: % -> %', k, v ->> k;
    END IF;
  END LOOP;
  IF (v -> 'can_manage')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_ROLE_ADMIN_CAPABILITY_WRONG: %', v;
  END IF;
END
$admin_role$;

SELECT pg_temp.mfs201_as('52010201-0000-0000-0000-0000000000a5', '52010201-0000-0000-0000-0000000000a1');

DO $admin_flag$
DECLARE
  v jsonb := pg_temp.mfs201_probe('52010201-0000-0000-0000-0000000000a1');
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['gl', 'issue', 'quality'] LOOP
    IF v ->> k <> 'OK' THEN
      RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_FLAG_ADMIN_REFUSED: % -> %', k, v ->> k;
    END IF;
  END LOOP;
  IF (v -> 'can_manage')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_FLAG_ADMIN_CAPABILITY_WRONG: %', v;
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_ADMIN_OK: role admin and flag admin both keep access';
END
$admin_flag$;

-- ---------------------------------------------------------------------
-- 5. Another org's admin cannot reach org A.
-- ---------------------------------------------------------------------
SELECT pg_temp.mfs201_as('52010201-0000-0000-0000-0000000000b2', '52010201-0000-0000-0000-0000000000b1');

DO $cross_org$
DECLARE
  r text;
BEGIN
  r := pg_temp.mfs201_try('gl', format('SELECT public.rpc_set_gl_event_mapping(%L, %L, %L, %L)',
    '52010201-0000-0000-0000-0000000000a1', 'FG_RECEIPT', '135100', '134100'));
  IF r = 'OK' THEN RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_CROSS_ORG_GL'; END IF;
  r := pg_temp.mfs201_try('issue', format('SELECT public.rpc_set_material_issue_wo_statuses(%L, %L::text[])',
    '52010201-0000-0000-0000-0000000000a1', '{IN_PROGRESS}'));
  IF r = 'OK' THEN RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_CROSS_ORG_ISSUE'; END IF;
  r := pg_temp.mfs201_try('quality', format('SELECT public.rpc_set_quality_policy(%L, %L::jsonb, %s)',
    '52010201-0000-0000-0000-0000000000a1',
    '{"release_gate_mode":"off","inspection_scope":"final_only","allow_conditional_release":false,"segregation_of_duties":true,"admins_subject_to_quality_controls":true}', 1));
  IF r = 'OK' THEN RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_CROSS_ORG_QUALITY'; END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_CROSS_ORG_OK';
END
$cross_org$;

RESET ROLE;

-- ---------------------------------------------------------------------
-- 6. Template expansion: wildcards never grant the settings keys; an exact
--    name does.
-- ---------------------------------------------------------------------
INSERT INTO public.role_templates (id, name, name_ar, permission_keys, category, is_active) VALUES
  ('52010201-0000-0000-0000-0000000000d1', 'MFS201 All', 'الكل', ARRAY['*'], 'test', true),
  ('52010201-0000-0000-0000-0000000000d2', 'MFS201 Manufacturing', 'التصنيع', ARRAY['manufacturing.%'], 'test', true),
  ('52010201-0000-0000-0000-0000000000d3', 'MFS201 Settings', 'الإعدادات',
   ARRAY['manufacturing.settings.read', 'manufacturing.settings.update'], 'test', true);

SET LOCAL ROLE authenticated;
SELECT pg_temp.mfs201_as('52010201-0000-0000-0000-0000000000a2', '52010201-0000-0000-0000-0000000000a1');

CREATE TEMP TABLE mfs201_roles (template_id uuid, role_id uuid) ON COMMIT DROP;
GRANT ALL ON mfs201_roles TO authenticated;
INSERT INTO mfs201_roles
SELECT t, public.create_role_from_template('52010201-0000-0000-0000-0000000000a1', t, 'MFS201 ' || t::text)
FROM unnest(ARRAY['52010201-0000-0000-0000-0000000000d1',
                  '52010201-0000-0000-0000-0000000000d2',
                  '52010201-0000-0000-0000-0000000000d3']::uuid[]) t;

RESET ROLE;

DO $templates$
DECLARE
  v_star int; v_mfg int; v_exact int; v_mfg_other int;
BEGIN
  SELECT count(*) INTO v_star FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  JOIN mfs201_roles r ON r.role_id = rp.role_id
  WHERE r.template_id = '52010201-0000-0000-0000-0000000000d1'
    AND p.permission_key LIKE 'manufacturing.settings.%';

  SELECT count(*) INTO v_mfg FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  JOIN mfs201_roles r ON r.role_id = rp.role_id
  WHERE r.template_id = '52010201-0000-0000-0000-0000000000d2'
    AND p.permission_key LIKE 'manufacturing.settings.%';

  -- The wildcard still grants ordinary manufacturing keys (expansion works).
  SELECT count(*) INTO v_mfg_other FROM public.role_permissions rp
  JOIN mfs201_roles r ON r.role_id = rp.role_id
  WHERE r.template_id = '52010201-0000-0000-0000-0000000000d2';

  SELECT count(*) INTO v_exact FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  JOIN mfs201_roles r ON r.role_id = rp.role_id
  WHERE r.template_id = '52010201-0000-0000-0000-0000000000d3'
    AND p.permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update');

  IF v_star <> 0 OR v_mfg <> 0 OR v_mfg_other = 0 OR v_exact <> 2 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ACCEPTANCE_TEMPLATE_EXPANSION_WRONG: star=% mfg=% mfg_other=% exact=%',
      v_star, v_mfg, v_mfg_other, v_exact;
  END IF;
  RAISE NOTICE 'MFG_SETTINGS_201_TEMPLATE_EXPANSION_OK';
END
$templates$;

\echo 'MFG_SETTINGS_201_ACCEPTANCE_PASS'
ROLLBACK;
