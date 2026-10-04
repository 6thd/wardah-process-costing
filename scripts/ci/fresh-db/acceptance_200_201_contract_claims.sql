-- Contract-claim proofs for Migrations 200 and 201: run on a fresh database
-- through 201 (the live contract is the union of both).
--
-- Each block proves one written claim from
-- docs/db/GL_EVENT_MAPPING_WRITE_CLOSURE_200_RUNBOOK.md §8 or
-- docs/db/MANUFACTURING_SETTINGS_PERMISSIONS_201_RUNBOOK.md §3–§4 that the
-- main acceptance suites do not already cover. The claim ledger in
-- docs/db/CLAIM_LEDGER_200_201.md maps every claim to its proof.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- Fixtures (written as the table owner).
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52010202-0000-0000-0000-0000000000a1', 'Claims 200/201 A', 'CLM201-A'),
  ('52010202-0000-0000-0000-0000000000b1', 'Claims 200/201 B', 'CLM201-B');

INSERT INTO auth.users (id, email) VALUES
  ('52010202-0000-0000-0000-0000000000a2', 'clm201-role-admin@example.test'),
  ('52010202-0000-0000-0000-0000000000a3', 'clm201-flag-admin@example.test'),
  ('52010202-0000-0000-0000-0000000000a4', 'clm201-member@example.test'),
  ('52010202-0000-0000-0000-0000000000a5', 'clm201-super-member@example.test'),
  ('52010202-0000-0000-0000-0000000000a6', 'clm201-super-outsider@example.test'),
  ('52010202-0000-0000-0000-0000000000a7', 'clm201-inactive-keyholder@example.test'),
  ('52010202-0000-0000-0000-0000000000a8', 'clm201-expired-keyholder@example.test'),
  ('52010202-0000-0000-0000-0000000000a9', 'clm201-inactive-role-keyholder@example.test'),
  ('52010202-0000-0000-0000-0000000000aa', 'clm201-read-only-keyholder@example.test'),
  ('52010202-0000-0000-0000-0000000000ab', 'clm201-inactive-admin@example.test'),
  ('52010202-0000-0000-0000-0000000000ac', 'clm201-manager@example.test');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('52010202-0000-0000-0000-0000000000a2', '52010202-0000-0000-0000-0000000000a1', 'admin', true, false),
  ('52010202-0000-0000-0000-0000000000a3', '52010202-0000-0000-0000-0000000000a1', 'user',  true, true),
  ('52010202-0000-0000-0000-0000000000a4', '52010202-0000-0000-0000-0000000000a1', 'user',  true, false),
  ('52010202-0000-0000-0000-0000000000a5', '52010202-0000-0000-0000-0000000000a1', 'user',  true, false),
  ('52010202-0000-0000-0000-0000000000a7', '52010202-0000-0000-0000-0000000000a1', 'user',  true, false),
  ('52010202-0000-0000-0000-0000000000a8', '52010202-0000-0000-0000-0000000000a1', 'user',  true, false),
  ('52010202-0000-0000-0000-0000000000a9', '52010202-0000-0000-0000-0000000000a1', 'user',  true, false),
  ('52010202-0000-0000-0000-0000000000aa', '52010202-0000-0000-0000-0000000000a1', 'user',  true, false),
  ('52010202-0000-0000-0000-0000000000ab', '52010202-0000-0000-0000-0000000000a1', 'admin', false, true),
  ('52010202-0000-0000-0000-0000000000ac', '52010202-0000-0000-0000-0000000000a1', 'manager', true, false);
-- No 'owner' row: user_organizations_role_check allows only user, manager and
-- admin, so the 'owner' branch of wardah_is_org_admin is unreachable.

INSERT INTO public.super_admins (user_id, email, is_active) VALUES
  ('52010202-0000-0000-0000-0000000000a5', 'clm201-super-member@example.test', true),
  ('52010202-0000-0000-0000-0000000000a6', 'clm201-super-outsider@example.test', true);

-- c1: active role with both keys. c2: inactive role with the update key.
-- c3: active role with the read key only.
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('52010202-0000-0000-0000-0000000000c1', '52010202-0000-0000-0000-0000000000a1', 'Settings editor', 'محرر', true),
  ('52010202-0000-0000-0000-0000000000c2', '52010202-0000-0000-0000-0000000000a1', 'Disabled editor', 'معطل', false),
  ('52010202-0000-0000-0000-0000000000c3', '52010202-0000-0000-0000-0000000000a1', 'Settings viewer', 'مشاهد', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES ('52010202-0000-0000-0000-0000000000c1'::uuid, 'manufacturing.settings.read'),
             ('52010202-0000-0000-0000-0000000000c1'::uuid, 'manufacturing.settings.update'),
             ('52010202-0000-0000-0000-0000000000c2'::uuid, 'manufacturing.settings.update'),
             ('52010202-0000-0000-0000-0000000000c3'::uuid, 'manufacturing.settings.read')) AS r(id, key)
JOIN public.permissions p ON p.permission_key = r.key;
INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  ('52010202-0000-0000-0000-0000000000a7', '52010202-0000-0000-0000-0000000000c1', '52010202-0000-0000-0000-0000000000a1', NULL),
  ('52010202-0000-0000-0000-0000000000a8', '52010202-0000-0000-0000-0000000000c1', '52010202-0000-0000-0000-0000000000a1', now() - interval '1 day'),
  ('52010202-0000-0000-0000-0000000000a9', '52010202-0000-0000-0000-0000000000c2', '52010202-0000-0000-0000-0000000000a1', NULL),
  ('52010202-0000-0000-0000-0000000000aa', '52010202-0000-0000-0000-0000000000c3', '52010202-0000-0000-0000-0000000000a1', NULL);

-- 175 refuses a role for an inactive member, so a7 held the role while
-- active and was deactivated afterwards (the realistic path).
UPDATE public.user_organizations SET is_active = false
WHERE user_id = '52010202-0000-0000-0000-0000000000a7' AND org_id = '52010202-0000-0000-0000-0000000000a1';

INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance, is_active, allow_posting) VALUES
  ('52010202-0000-0000-0000-0000000000a1', '131100', 'Raw materials', 'ASSET', 'inventory', 'DEBIT', true, true),
  ('52010202-0000-0000-0000-0000000000a1', '134100', 'WIP', 'ASSET', 'inventory', 'DEBIT', true, true),
  ('52010202-0000-0000-0000-0000000000a1', '135100', 'Finished goods', 'ASSET', 'inventory', 'DEBIT', true, NULL),
  ('52010202-0000-0000-0000-0000000000a1', '139000', 'Inactive', 'ASSET', 'inventory', 'DEBIT', false, true),
  ('52010202-0000-0000-0000-0000000000a1', '139100', 'Header only', 'ASSET', 'inventory', 'DEBIT', true, false),
  ('52010202-0000-0000-0000-0000000000b1', '139900', 'Org B only', 'ASSET', 'inventory', 'DEBIT', true, true);

INSERT INTO public.work_centers (org_id, code, name) VALUES
  ('52010202-0000-0000-0000-0000000000a1', 'WC1', 'Work center 1');

CREATE FUNCTION pg_temp.clm_try(p_call text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_call;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END
$fn$;

CREATE FUNCTION pg_temp.clm_as(p_user uuid) RETURNS void
LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  SELECT set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '' ELSE
      json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$fn$;

CREATE FUNCTION pg_temp.clm_set(p_event text, p_debit text, p_credit text,
                                p_wc text DEFAULT NULL, p_desc text DEFAULT NULL,
                                p_active boolean DEFAULT true) RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_temp.clm_try(format(
    'SELECT public.rpc_set_gl_event_mapping(%L, %L, %L, %L, %L, %L, %L)',
    '52010202-0000-0000-0000-0000000000a1', p_event, p_debit, p_credit, p_wc, p_desc, p_active));
$fn$;

CREATE FUNCTION pg_temp.clm_expect(p_label text, p_got text, p_want text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_got IS DISTINCT FROM p_want AND p_got NOT LIKE p_want || '%' THEN
    RAISE EXCEPTION 'CLAIMS_200_201_UNEXPECTED: % -> got %, want %', p_label, p_got, p_want;
  END IF;
END
$fn$;

GRANT EXECUTE ON FUNCTION pg_temp.clm_try(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.clm_as(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.clm_set(text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.clm_expect(text, text, text) TO authenticated;

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------
-- 200 §8.2: guard failure order — NOT_AUTHENTICATED, then membership.
-- ---------------------------------------------------------------------
SELECT pg_temp.clm_as(NULL);
SELECT pg_temp.clm_expect('no auth.uid()', pg_temp.clm_set('FG_RECEIPT', '135100', '134100'), 'P0001:NOT_AUTHENTICATED');
SELECT pg_temp.clm_as('52010202-0000-0000-0000-0000000000ab');
SELECT pg_temp.clm_expect('inactive admin', pg_temp.clm_set('FG_RECEIPT', '135100', '134100'), 'P0001:NOT_ORG_MEMBER');
DO $$ BEGIN RAISE NOTICE 'CLAIMS_200_GUARD_ORDER_OK'; END $$;

-- ---------------------------------------------------------------------
-- 200 §8.3: validation order and SQLSTATE 22023. Each call fixes only the
-- previously reported input, so the error must be the next row of the table.
-- ---------------------------------------------------------------------
SELECT pg_temp.clm_as('52010202-0000-0000-0000-0000000000a2');
SELECT pg_temp.clm_expect('1 event', pg_temp.clm_set('bad code!', '', '', 'NOPE', NULL, NULL), '22023:GL_EVENT_MAPPING_INVALID_EVENT_CODE');
SELECT pg_temp.clm_expect('2 is_active', pg_temp.clm_set('FG_RECEIPT', '', '', 'NOPE', NULL, NULL), '22023:GL_EVENT_MAPPING_IS_ACTIVE_REQUIRED');
SELECT pg_temp.clm_expect('3 wc override', pg_temp.clm_set('FG_RECEIPT', '', '', 'NOPE'), '22023:GL_EVENT_MAPPING_WORK_CENTER_OVERRIDE_NOT_SUPPORTED');
SELECT pg_temp.clm_expect('4 wc missing', pg_temp.clm_set('OH_APPLIED', '', '', 'NOPE'), '22023:GL_EVENT_MAPPING_WORK_CENTER_NOT_FOUND');
SELECT pg_temp.clm_expect('5 account required', pg_temp.clm_set('OH_APPLIED', '', '134100', 'WC1'), '22023:GL_EVENT_MAPPING_ACCOUNT_REQUIRED');
SELECT pg_temp.clm_expect('6 same account', pg_temp.clm_set('OH_APPLIED', '134100', '134100', 'WC1'), '22023:GL_EVENT_MAPPING_SAME_ACCOUNT');
SELECT pg_temp.clm_expect('7 debit before credit', pg_temp.clm_set('OH_APPLIED', '999999', '999998', 'WC1'), '22023:GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID');
SELECT pg_temp.clm_expect('8 credit', pg_temp.clm_set('OH_APPLIED', '134100', '999998', 'WC1'), '22023:GL_EVENT_MAPPING_CREDIT_ACCOUNT_INVALID');
-- lower-case and padded event codes are normalized (upper(btrim)).
SELECT pg_temp.clm_expect('event normalized', pg_temp.clm_set('  oh_applied ', '134100', '131100', ' WC1 '), 'OK');
-- a blank work center is NULL, so it is not an override.
SELECT pg_temp.clm_expect('blank wc is NULL', pg_temp.clm_set('FG_RECEIPT', '135100', '134100', '   '), 'OK');
DO $$ BEGIN RAISE NOTICE 'CLAIMS_200_VALIDATION_ORDER_OK'; END $$;

-- 200 §8.3 rows 7–8: same org, active, allow_posting IS NOT FALSE.
SELECT pg_temp.clm_expect('other org account', pg_temp.clm_set('MATERIAL_ISSUE', '139900', '131100'), '22023:GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID');
SELECT pg_temp.clm_expect('inactive account', pg_temp.clm_set('MATERIAL_ISSUE', '139000', '131100'), '22023:GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID');
SELECT pg_temp.clm_expect('allow_posting false', pg_temp.clm_set('MATERIAL_ISSUE', '131100', '139100'), '22023:GL_EVENT_MAPPING_CREDIT_ACCOUNT_INVALID');
-- 135100 has allow_posting NULL: accepted (IS NOT FALSE), proven by the blank-wc call above.
DO $$ BEGIN RAISE NOTICE 'CLAIMS_200_ACCOUNT_RULES_OK'; END $$;

-- ---------------------------------------------------------------------
-- 200 §8.4–§8.5: return shape, audit shape, description semantics.
-- ---------------------------------------------------------------------
DO $shape$
DECLARE
  v_ret jsonb;
  v_audit public.audit_logs%ROWTYPE;
  v_desc text;
  v_n int;
BEGIN
  -- Create.
  v_ret := public.rpc_set_gl_event_mapping('52010202-0000-0000-0000-0000000000a1',
             'COGS_DELIVERY', '131100', '134100', NULL, 'first description', true);
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_ret) k)
     <> ARRAY['created','credit_account_code','debit_account_code','event_code','id','is_active','org_id','work_center_code'] THEN
    RAISE EXCEPTION 'CLAIMS_200_RETURN_KEYS_WRONG: %', v_ret;
  END IF;
  IF (v_ret ->> 'created')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'CLAIMS_200_CREATED_WRONG: %', v_ret;
  END IF;

  -- All calls share one transaction (same created_at), so rows are matched
  -- by content: the create is the only row without a before-image.
  SELECT * INTO v_audit FROM public.audit_logs
  WHERE org_id = '52010202-0000-0000-0000-0000000000a1' AND entity_id = v_ret ->> 'id'
    AND old_data IS NULL;
  IF v_audit.action <> 'accounting.gl_event_mapping.set'
     OR v_audit.entity_type <> 'gl_event_mapping'
     OR v_audit.user_id <> '52010202-0000-0000-0000-0000000000a2'
     OR v_audit.old_data IS NOT NULL
     OR v_audit.metadata <> '{"source": "rpc_set_gl_event_mapping", "migration": 200}'::jsonb
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_audit.new_data) k)
        <> ARRAY['credit_account_code','debit_account_code','event_code','is_active','work_center_code'] THEN
    RAISE EXCEPTION 'CLAIMS_200_AUDIT_CREATE_WRONG: %', row_to_json(v_audit);
  END IF;

  -- Update with NULL description keeps the old one; is_active false is stored.
  v_ret := public.rpc_set_gl_event_mapping('52010202-0000-0000-0000-0000000000a1',
             'COGS_DELIVERY', '134100', '131100', NULL, NULL, false);
  SELECT description INTO v_desc FROM public.gl_event_mappings WHERE id = (v_ret ->> 'id')::uuid;
  IF (v_ret ->> 'created')::boolean IS NOT FALSE OR (v_ret ->> 'is_active')::boolean IS NOT FALSE
     OR v_desc IS DISTINCT FROM 'first description' THEN
    RAISE EXCEPTION 'CLAIMS_200_UPDATE_WRONG: % desc=%', v_ret, v_desc;
  END IF;
  SELECT * INTO v_audit FROM public.audit_logs
  WHERE org_id = '52010202-0000-0000-0000-0000000000a1' AND entity_id = v_ret ->> 'id'
    AND old_data ->> 'debit_account_code' = '131100';
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_audit.old_data) k)
        <> ARRAY['credit_account_code','debit_account_code','event_code','is_active','work_center_code']
     OR v_audit.old_data ->> 'debit_account_code' <> '131100'
     OR v_audit.new_data ->> 'debit_account_code' <> '134100' THEN
    RAISE EXCEPTION 'CLAIMS_200_AUDIT_UPDATE_WRONG: %', row_to_json(v_audit);
  END IF;

  -- An empty string replaces the description with ''; NULL is unreachable.
  v_ret := public.rpc_set_gl_event_mapping('52010202-0000-0000-0000-0000000000a1',
             'COGS_DELIVERY', '134100', '131100', NULL, '', false);
  SELECT description INTO v_desc FROM public.gl_event_mappings WHERE id = (v_ret ->> 'id')::uuid;
  IF v_desc IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'CLAIMS_200_EMPTY_DESCRIPTION_WRONG: %', v_desc;
  END IF;

  -- One audit row per successful call (3), none for the refused calls above.
  SELECT count(*) INTO v_n FROM public.audit_logs
  WHERE org_id = '52010202-0000-0000-0000-0000000000a1' AND entity_id = v_ret ->> 'id';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'CLAIMS_200_AUDIT_COUNT_WRONG: %', v_n;
  END IF;
  RAISE NOTICE 'CLAIMS_200_SHAPES_OK';
END
$shape$;

-- ---------------------------------------------------------------------
-- 201 §3: who may save. The old guard and the new predicate are evaluated
-- for each user; the new set must contain the old one (strict superset).
-- ---------------------------------------------------------------------
CREATE TEMP TABLE clm_matrix (user_id uuid, label text, old_ok boolean, new_ok boolean, saves text) ON COMMIT DROP;
GRANT ALL ON clm_matrix TO authenticated;

DO $matrix$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('52010202-0000-0000-0000-0000000000a2'::uuid, 'role admin'),
    ('52010202-0000-0000-0000-0000000000a3'::uuid, 'flag admin'),
    ('52010202-0000-0000-0000-0000000000ac'::uuid, 'manager'),
    ('52010202-0000-0000-0000-0000000000a4'::uuid, 'plain member'),
    ('52010202-0000-0000-0000-0000000000a5'::uuid, 'super admin, member'),
    ('52010202-0000-0000-0000-0000000000a6'::uuid, 'super admin, not a member'),
    ('52010202-0000-0000-0000-0000000000a7'::uuid, 'inactive member with key'),
    ('52010202-0000-0000-0000-0000000000a8'::uuid, 'expired key'),
    ('52010202-0000-0000-0000-0000000000a9'::uuid, 'key on inactive role'),
    ('52010202-0000-0000-0000-0000000000aa'::uuid, 'read key only'),
    ('52010202-0000-0000-0000-0000000000ab'::uuid, 'inactive admin')) AS t(user_id, label)
  LOOP
    PERFORM pg_temp.clm_as(r.user_id);
    INSERT INTO clm_matrix VALUES (r.user_id, r.label, NULL, NULL,
      pg_temp.clm_try(format('SELECT public.rpc_set_material_issue_wo_statuses(%L, %L::text[])',
        '52010202-0000-0000-0000-0000000000a1', '{IN_PROGRESS,READY}')));
  END LOOP;
END
$matrix$;

RESET ROLE;
-- Neither the old guard nor the new predicate is executable by clients;
-- evaluate both as owner under each identity. Old: wardah_assert_org_admin
-- (the pre-201 guard of all three writers). New: wardah_assert_org_member,
-- then the 201 predicate (the post-201 guard).
DO $predicate$
DECLARE r record; v_old boolean; v_new boolean;
BEGIN
  FOR r IN SELECT user_id FROM clm_matrix LOOP
    PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);
    BEGIN
      PERFORM public.wardah_assert_org_admin('52010202-0000-0000-0000-0000000000a1');
      v_old := true;
    EXCEPTION WHEN OTHERS THEN v_old := false;
    END;
    BEGIN
      PERFORM public.wardah_assert_org_member('52010202-0000-0000-0000-0000000000a1');
      v_new := wardah_internal.manufacturing_settings_can_update_201('52010202-0000-0000-0000-0000000000a1');
    EXCEPTION WHEN OTHERS THEN v_new := false;
    END;
    UPDATE clm_matrix SET old_ok = v_old, new_ok = v_new WHERE user_id = r.user_id;
  END LOOP;
END
$predicate$;

DO $verdict$
DECLARE r record; v_want jsonb := jsonb_build_object(
  'role admin', true, 'flag admin', true, 'manager', false, 'plain member', false,
  'super admin, member', true, 'super admin, not a member', false,
  'inactive member with key', false, 'expired key', false, 'key on inactive role', false,
  'read key only', false, 'inactive admin', false);
BEGIN
  FOR r IN SELECT * FROM clm_matrix ORDER BY label LOOP
    RAISE NOTICE 'matrix: % old=% new=% call=%', r.label, r.old_ok, r.new_ok, r.saves;
    IF r.old_ok AND NOT r.new_ok THEN
      RAISE EXCEPTION 'CLAIMS_201_NOT_A_SUPERSET: % lost access', r.label;
    END IF;
    IF r.new_ok IS DISTINCT FROM (v_want ->> r.label)::boolean
       OR (r.saves = 'OK') IS DISTINCT FROM r.new_ok THEN
      RAISE EXCEPTION 'CLAIMS_201_MATRIX_WRONG: % new=% call=%', r.label, r.new_ok, r.saves;
    END IF;
  END LOOP;
  -- The old guard must admit exactly the admins and the member super admin;
  -- otherwise the superset comparison above would be vacuous.
  IF (SELECT array_agg(label ORDER BY label) FROM clm_matrix WHERE old_ok)
     IS DISTINCT FROM ARRAY['flag admin','role admin','super admin, member'] THEN
    RAISE EXCEPTION 'CLAIMS_201_OLD_GUARD_SET_WRONG: %',
      (SELECT array_agg(label ORDER BY label) FROM clm_matrix WHERE old_ok);
  END IF;
  RAISE NOTICE 'CLAIMS_201_SUPERSET_MATRIX_OK';
END
$verdict$;

-- 201 §3 "why not has_permission alone": it misses the role-only admin.
DO $why$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '52010202-0000-0000-0000-0000000000a2', true);
  IF public.has_permission('52010202-0000-0000-0000-0000000000a2', '52010202-0000-0000-0000-0000000000a1',
                           'manufacturing.settings.update')
     OR NOT public.wardah_is_org_admin('52010202-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'CLAIMS_201_HAS_PERMISSION_GAP_NOT_REPRODUCED';
  END IF;
  RAISE NOTICE 'CLAIMS_201_HAS_PERMISSION_ALONE_GAP_OK';
END
$why$;

-- 201 §3 "reads stay for members": a plain member reads both policies.
SET LOCAL ROLE authenticated;
SELECT pg_temp.clm_as('52010202-0000-0000-0000-0000000000a4');
SELECT pg_temp.clm_expect('member reads statuses', pg_temp.clm_try(
  'SELECT public.rpc_get_material_issue_wo_statuses(''52010202-0000-0000-0000-0000000000a1'')'), 'OK');
SELECT pg_temp.clm_expect('member reads quality policy', pg_temp.clm_try(
  'SELECT public.rpc_get_quality_policy(''52010202-0000-0000-0000-0000000000a1'')'), 'OK');
DO $$ BEGIN RAISE NOTICE 'CLAIMS_201_MEMBER_READS_OK'; END $$;
RESET ROLE;

-- ---------------------------------------------------------------------
-- 200 §8.6 / §9.6: how the posting readers treat the table. Runs as owner
-- with an org identity (the readers resolve the org with wardah_org_id).
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52010202-0000-0000-0000-0000000000d1', 'Claims readers', 'CLM201-R');
INSERT INTO auth.users (id, email) VALUES
  ('52010202-0000-0000-0000-0000000000d2', 'clm201-readers@example.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active) VALUES
  ('52010202-0000-0000-0000-0000000000d2', '52010202-0000-0000-0000-0000000000d1', 'admin', true);
INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance, is_active) VALUES
  ('52010202-0000-0000-0000-0000000000d1', '131100', 'RM', 'ASSET', 'inventory', 'DEBIT', true),
  ('52010202-0000-0000-0000-0000000000d1', '134100', 'WIP', 'ASSET', 'inventory', 'DEBIT', true),
  ('52010202-0000-0000-0000-0000000000d1', '520000', 'OH applied', 'EXPENSE', 'overhead', 'DEBIT', true);
SELECT set_config('request.jwt.claim.sub', '52010202-0000-0000-0000-0000000000d2', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"52010202-0000-0000-0000-0000000000d2","role":"authenticated","org_id":"52010202-0000-0000-0000-0000000000d1"}', true);

DO $readers$
DECLARE
  v_org uuid := '52010202-0000-0000-0000-0000000000d1';
  v_err text;
  v_id uuid;
BEGIN
  -- No mapping: fail-closed.
  BEGIN
    PERFORM public.rpc_post_event_journal('MATERIAL_ISSUE', 10, 'claims', 'test', NULL, v_org);
    v_err := 'posted';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err NOT LIKE 'MAPPING_MISSING%' THEN RAISE EXCEPTION 'CLAIMS_200_READER_NO_MAPPING: %', v_err; END IF;

  -- Inactive mapping only: same refusal.
  INSERT INTO public.gl_event_mappings (org_id, event_code, debit_account_code, credit_account_code, is_active)
  VALUES (v_org, 'MATERIAL_ISSUE', '134100', '131100', false);
  BEGIN
    PERFORM public.rpc_post_event_journal('MATERIAL_ISSUE', 10, 'claims', 'test', NULL, v_org);
    v_err := 'posted';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err NOT LIKE 'MAPPING_MISSING%' THEN RAISE EXCEPTION 'CLAIMS_200_READER_INACTIVE_MAPPING: %', v_err; END IF;

  -- §9.6: account activity is checked only when the mapping is set; posting
  -- through an active mapping to an account deactivated later succeeds.
  UPDATE public.gl_event_mappings SET is_active = true WHERE org_id = v_org;
  UPDATE public.gl_accounts SET is_active = false WHERE org_id = v_org AND code = '134100';
  v_id := public.rpc_post_event_journal('MATERIAL_ISSUE', 10, 'claims', 'test', NULL, v_org);
  IF v_id IS NULL THEN RAISE EXCEPTION 'CLAIMS_200_READER_INACTIVE_ACCOUNT_NOT_POSTED'; END IF;
  UPDATE public.gl_accounts SET is_active = true WHERE org_id = v_org AND code = '134100';

  -- OH: neither a work-center row nor a general row: fail-closed.
  BEGIN
    PERFORM public.rpc_post_work_center_oh('WC9', 5, 'claims', 'test', NULL, v_org);
    v_err := 'posted';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  IF v_err NOT LIKE 'MAPPING_MISSING%' THEN RAISE EXCEPTION 'CLAIMS_200_READER_OH_NO_MAPPING: %', v_err; END IF;

  -- OH: an inactive work-center row falls back to the general row.
  INSERT INTO public.gl_event_mappings (org_id, event_code, work_center_code, debit_account_code, credit_account_code, is_active) VALUES
    (v_org, 'OH_APPLIED', 'WC9', '131100', '520000', false),
    (v_org, 'OH_APPLIED', NULL, '134100', '520000', true);
  v_id := public.rpc_post_work_center_oh('WC9', 5, 'claims', 'test', NULL, v_org);
  IF NOT EXISTS (SELECT 1 FROM public.gl_entry_lines l JOIN public.gl_accounts a ON a.id = l.account_id
                 WHERE l.entry_id = v_id AND a.code = '134100' AND l.debit > 0) THEN
    RAISE EXCEPTION 'CLAIMS_200_READER_OH_FALLBACK_WRONG';
  END IF;
  RAISE NOTICE 'CLAIMS_200_READERS_OK';
END
$readers$;

\echo 'CLAIMS_200_201_PASS'
ROLLBACK;
