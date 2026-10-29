-- Acceptance for Migration 205 on a fresh database through 205 (plan docs/db/MIGRATION_205_OVERHEAD_PLAN.md §9).
--
-- Proves, through the public RPCs as authenticated (fixtures and storage checks as the table owner):
--   1. catalog: private storage, RPC grants to authenticated only, internals closed, four ordinary keys;
--   2. draft guards and shape, ownership (205-Q3) and identity refusals, nothing written on refusal;
--   3. approval: separate right, version written only on approval, the 204 pin picks it up, a pending
--      draft pins nothing, expected_latest_version_no, idempotency, one-way status, immutability;
--   4. 205-Q1: self-approval off by default, needs the company setting and the explicit key; the setting
--      needs its own explicit key, a reason, and is audited; approve alone changes nothing;
--   5. the 205-only checker: org admin without assignment refused, other org's assignment, disabled role
--      and expired assignment grant nothing, platform super admin refused in all three explicit paths;
--   6. identity from the session: approver, exception approver, resolution creator/approver = auth.uid();
--      identity fields in a payload refused; no session user refused;
--   7. 205-Q4: block by default; the policy only for the org admin with the explicit key; controlled
--      exception recorded with amounts, reason, treatment, approver; never absorbed; the exception relaxes
--      no other rule; changing the policy back does not reopen an approved version;
--   8. computation: stored compute = compute_205 on the version's JSON; labor and each pool line equal the
--      204 SQL computation called with the hours the pool activity selects; NaN, infinity, negative hours;
--   9. legacy 204 versions: refused unresolved; resolution through draft/approval; version rows unchanged;
--      resolution immutable; not applicable twice or on a 205 version; pools must match;
--  10. org isolation; the cost-center tenant relation is unproven, so no center is accepted;
--  11. role templates: a wildcard template no longer grants the three explicit keys (section 1b of
--      205); a template that names one exactly still grants it; approve still expands;
--  12. the approval is bound to the draft revision the approver reviewed: an edit after the approver
--      read the draft makes the approval of the old revision refuse, and the revision moves only with
--      the content; rates with 204's precision (six decimals) at the policy default, a pool and a
--      work-center override, each amount rounded once at the cent; seven decimals refused.
-- Rolled back at the end.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Catalog and privileges.
-- ---------------------------------------------------------------------
DO $catalog$
DECLARE
  v_t text;
  v_fn text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'wardah_internal.mfg_cost_policy_drafts_205', 'wardah_internal.mfg_cost_policy_budgets_205',
    'wardah_internal.mfg_cost_policy_pool_ext_205', 'wardah_internal.mfg_cost_policy_pool_budgets_205',
    'wardah_internal.mfg_cost_policy_setup_acks_205', 'wardah_internal.mfg_cost_policy_unallocated_exceptions_205',
    'wardah_internal.mfg_cost_policy_approvals_205', 'wardah_internal.mfg_cost_policy_legacy_resolutions_205',
    'wardah_internal.mfg_cost_policy_approval_settings_205', 'wardah_internal.mfg_cost_policy_approval_settings_audit_205'] LOOP
    IF has_table_privilege('authenticated', v_t, 'SELECT') OR has_table_privilege('authenticated', v_t, 'INSERT')
       OR has_table_privilege('authenticated', v_t, 'UPDATE') OR has_table_privilege('authenticated', v_t, 'DELETE')
       OR has_table_privilege('anon', v_t, 'SELECT') OR has_table_privilege('service_role', v_t, 'SELECT') THEN
      RAISE EXCEPTION 'CP205_TABLE_EXPOSED: %', v_t;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_get_mfg_cost_policy_205(uuid)',
    'public.rpc_create_mfg_cost_policy_draft_205(uuid,jsonb,integer,uuid)',
    'public.rpc_create_legacy_resolution_draft_205(uuid,uuid,jsonb,text,uuid)',
    'public.rpc_update_mfg_cost_policy_draft_205(uuid,uuid,jsonb,integer)',
    'public.rpc_withdraw_mfg_cost_policy_draft_205(uuid,uuid,text)',
    'public.rpc_reject_mfg_cost_policy_draft_205(uuid,uuid,text)',
    'public.rpc_approve_mfg_cost_policy_draft_205(uuid,uuid,integer)',
    'public.rpc_set_cost_policy_self_approval_205(uuid,boolean,text)',
    'public.rpc_set_cost_policy_unallocated_policy_205(uuid,text,text)',
    'public.rpc_preview_mfg_cost_absorption_205(uuid,uuid,uuid,jsonb,numeric)'] LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'CP205_RPC_ACL_UNEXPECTED: %', v_fn;
    END IF;
  END LOOP;
  FOR v_fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'wardah_internal' AND p.proname LIKE '%\_205%' ESCAPE '\' LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'CP205_INTERNAL_EXPOSED: %', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
      WHERE m.name = 'manufacturing' AND p.permission_key IN ('manufacturing.cost_policy.approve',
        'manufacturing.cost_policy.self_approve', 'manufacturing.cost_policy.approval_settings.manage',
        'manufacturing.cost_policy.unallocated_policy.manage')) <> 4
     OR EXISTS (SELECT 1 FROM public.permissions WHERE permission_key LIKE 'manufacturing.cost_policy.%'
                AND public.wardah_is_sensitive_permission(permission_key)) THEN
    RAISE EXCEPTION 'CP205_PERMISSION_CATALOG_UNEXPECTED';
  END IF;
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approval_settings_205)
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_drafts_205) THEN
    RAISE EXCEPTION 'CP205_UNEXPECTED_SEED';
  END IF;
  RAISE NOTICE 'CP205_CATALOG_OK';
END
$catalog$;

-- ---------------------------------------------------------------------
-- Fixtures (as owner). Org A and org B.
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52050205-0000-0000-0000-0000000000a1', 'Cost Policy 205 A', 'CP205-A'),
  ('52050205-0000-0000-0000-0000000000b1', 'Cost Policy 205 B', 'CP205-B');

CREATE TEMP TABLE cp_users (k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO cp_users VALUES
  ('admin',      '52050205-0000-0000-0000-000000000a01'),  -- org admin of A, no explicit assignment
  ('creator',    '52050205-0000-0000-0000-000000000a02'),  -- settings.update
  ('approver',   '52050205-0000-0000-0000-000000000a03'),  -- approve (+ settings.read)
  ('self',       '52050205-0000-0000-0000-000000000a04'),  -- approve + self_approve + settings.update
  ('approver2',  '52050205-0000-0000-0000-000000000a05'),  -- approve + settings.update, no self_approve
  ('settings',   '52050205-0000-0000-0000-000000000a06'),  -- approval_settings.manage
  ('q4admin',    '52050205-0000-0000-0000-000000000a07'),  -- org admin + unallocated_policy.manage
  ('q4member',   '52050205-0000-0000-0000-000000000a08'),  -- unallocated_policy.manage, not admin
  ('expired',    '52050205-0000-0000-0000-000000000a09'),  -- approval_settings.manage, assignment expired
  ('disabled',   '52050205-0000-0000-0000-000000000a0a'),  -- approval_settings.manage on a disabled role
  ('member',     '52050205-0000-0000-0000-000000000a0b'),  -- plain member
  ('otherorg',   '52050205-0000-0000-0000-000000000a0c'),  -- plain in A; approval_settings.manage + unallocated key in B
  ('super',      '52050205-0000-0000-0000-000000000a0d'),  -- platform super admin, member of A without assignment
  ('super_out',  '52050205-0000-0000-0000-000000000a0e'),  -- platform super admin, not a member of A
  ('b_admin',    '52050205-0000-0000-0000-000000000b02');  -- org admin of B, approve via admin bypass
GRANT SELECT ON cp_users TO authenticated;

INSERT INTO auth.users (id, email) SELECT id, k || '@cp205.example.test' FROM cp_users;
INSERT INTO public.super_admins (user_id, email, is_active)
SELECT id, k || '@cp205.example.test', true FROM cp_users WHERE k IN ('super', 'super_out');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
SELECT u.id, '52050205-0000-0000-0000-0000000000a1', CASE WHEN u.k IN ('admin','q4admin') THEN 'admin' ELSE 'user' END,
       true, u.k IN ('admin','q4admin')
FROM cp_users u WHERE u.k NOT IN ('super_out', 'b_admin');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('52050205-0000-0000-0000-000000000b02', '52050205-0000-0000-0000-0000000000b1', 'admin', true, true),
  ('52050205-0000-0000-0000-000000000a0c', '52050205-0000-0000-0000-0000000000b1', 'admin', true, true);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('52050205-0000-0000-0000-0000000000c1', '52050205-0000-0000-0000-0000000000a1', 'CP205 creator', 'منشئ', true),
  ('52050205-0000-0000-0000-0000000000c2', '52050205-0000-0000-0000-0000000000a1', 'CP205 approver', 'معتمد', true),
  ('52050205-0000-0000-0000-0000000000c3', '52050205-0000-0000-0000-0000000000a1', 'CP205 self', 'ذاتي', true),
  ('52050205-0000-0000-0000-0000000000c4', '52050205-0000-0000-0000-0000000000a1', 'CP205 approver2', 'معتمد2', true),
  ('52050205-0000-0000-0000-0000000000c5', '52050205-0000-0000-0000-0000000000a1', 'CP205 settings', 'إعدادات', true),
  ('52050205-0000-0000-0000-0000000000c6', '52050205-0000-0000-0000-0000000000a1', 'CP205 q4', 'سياسة', true),
  ('52050205-0000-0000-0000-0000000000c7', '52050205-0000-0000-0000-0000000000a1', 'CP205 disabled', 'معطل', false),
  ('52050205-0000-0000-0000-0000000000c8', '52050205-0000-0000-0000-0000000000b1', 'CP205 B keys', 'مفاتيح', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id::uuid, p.id FROM (VALUES
  ('52050205-0000-0000-0000-0000000000c1', 'manufacturing.settings.read'),
  ('52050205-0000-0000-0000-0000000000c1', 'manufacturing.settings.update'),
  ('52050205-0000-0000-0000-0000000000c2', 'manufacturing.settings.read'),
  ('52050205-0000-0000-0000-0000000000c2', 'manufacturing.cost_policy.approve'),
  ('52050205-0000-0000-0000-0000000000c3', 'manufacturing.settings.update'),
  ('52050205-0000-0000-0000-0000000000c3', 'manufacturing.cost_policy.approve'),
  ('52050205-0000-0000-0000-0000000000c3', 'manufacturing.cost_policy.self_approve'),
  ('52050205-0000-0000-0000-0000000000c4', 'manufacturing.settings.update'),
  ('52050205-0000-0000-0000-0000000000c4', 'manufacturing.cost_policy.approve'),
  ('52050205-0000-0000-0000-0000000000c5', 'manufacturing.cost_policy.approval_settings.manage'),
  ('52050205-0000-0000-0000-0000000000c6', 'manufacturing.cost_policy.unallocated_policy.manage'),
  ('52050205-0000-0000-0000-0000000000c7', 'manufacturing.cost_policy.approval_settings.manage'),
  ('52050205-0000-0000-0000-0000000000c8', 'manufacturing.cost_policy.approval_settings.manage'),
  ('52050205-0000-0000-0000-0000000000c8', 'manufacturing.cost_policy.unallocated_policy.manage'),
  ('52050205-0000-0000-0000-0000000000c8', 'manufacturing.cost_policy.self_approve')
) r(role_id, key) JOIN public.permissions p ON p.permission_key = r.key;
INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at)
SELECT u.id, r.role_id::uuid, r.org_id::uuid, r.expires_at FROM (VALUES
  ('creator',   '52050205-0000-0000-0000-0000000000c1', '52050205-0000-0000-0000-0000000000a1', NULL::timestamptz),
  ('approver',  '52050205-0000-0000-0000-0000000000c2', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('self',      '52050205-0000-0000-0000-0000000000c3', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('approver2', '52050205-0000-0000-0000-0000000000c4', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('settings',  '52050205-0000-0000-0000-0000000000c5', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('q4admin',   '52050205-0000-0000-0000-0000000000c6', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('q4member',  '52050205-0000-0000-0000-0000000000c6', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('expired',   '52050205-0000-0000-0000-0000000000c5', '52050205-0000-0000-0000-0000000000a1', now() - interval '1 day'),
  ('disabled',  '52050205-0000-0000-0000-0000000000c7', '52050205-0000-0000-0000-0000000000a1', NULL),
  ('otherorg',  '52050205-0000-0000-0000-0000000000c8', '52050205-0000-0000-0000-0000000000b1', NULL)
) r(k, role_id, org_id, expires_at) JOIN cp_users u ON u.k = r.k;

INSERT INTO public.gl_accounts (id, org_id, code, name, category, subtype, normal_balance) VALUES
  ('52050205-0000-0000-0000-0000000005a1', '52050205-0000-0000-0000-0000000000a1', '5101', 'Electricity', 'EXPENSE', 'OVERHEAD', 'DEBIT'),
  ('52050205-0000-0000-0000-0000000005a2', '52050205-0000-0000-0000-0000000000a1', '5201', 'Depreciation', 'EXPENSE', 'OVERHEAD', 'DEBIT'),
  ('52050205-0000-0000-0000-0000000005a3', '52050205-0000-0000-0000-0000000000a1', '5301', 'Supervision', 'EXPENSE', 'OVERHEAD', 'DEBIT'),
  ('52050205-0000-0000-0000-0000000005a4', '52050205-0000-0000-0000-0000000000a1', '5401', 'Setup crew', 'EXPENSE', 'OVERHEAD', 'DEBIT'),
  ('52050205-0000-0000-0000-0000000005a5', '52050205-0000-0000-0000-0000000000a1', '5501', 'Unused in any version', 'EXPENSE', 'OVERHEAD', 'DEBIT'),
  ('52050205-0000-0000-0000-0000000005b1', '52050205-0000-0000-0000-0000000000b1', '5101', 'Electricity B', 'EXPENSE', 'OVERHEAD', 'DEBIT');
-- A cost center whose tenant_id is A's id: even so it cannot be accepted (no proven relation).
INSERT INTO public.cost_centers (id, code, name, tenant_id) VALUES
  ('52050205-0000-0000-0000-0000000006a1', 'CC-PROD', 'Production', '52050205-0000-0000-0000-0000000000a1');

INSERT INTO public.work_centers (id, org_id, code, name, is_active) VALUES
  ('52050205-0000-0000-0000-0000000000d1', '52050205-0000-0000-0000-0000000000a1', 'WC-A', 'Mixing', true),
  ('52050205-0000-0000-0000-0000000000d2', '52050205-0000-0000-0000-0000000000a1', 'WC-B', 'Packing', true),
  ('52050205-0000-0000-0000-0000000000d3', '52050205-0000-0000-0000-0000000000a1', 'WC-C', 'Curing', true),
  ('52050205-0000-0000-0000-0000000000e1', '52050205-0000-0000-0000-0000000000b1', 'WC-B1', 'Other org', true);

CREATE TEMP TABLE cp_ids (k text PRIMARY KEY, id uuid);
GRANT SELECT, INSERT, UPDATE ON cp_ids TO authenticated;
SELECT set_config('cp.today', wardah_internal.mfg_cost_policy_org_today_204('52050205-0000-0000-0000-0000000000a1', true)::text, false);

-- The base draft: case (b) of the design annex DX0 with A's accounts, run-only machine pool with a
-- scoped setup acknowledgement, and the 204 acceptance work-center rules.
CREATE FUNCTION pg_temp.draft(p_days int, p_variant text DEFAULT 'base') RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  b jsonb := jsonb_build_object(
    'effective_from', (current_setting('cp.today')::date + p_days)::text,
    'labor_cost_source', 'work_center_rate', 'default_labor_rate_per_hour', 30, 'pin_event', 'mo_created',
    'overhead_pools', jsonb_build_array(
      jsonb_build_object('pool_code', 'MACHINE_OH', 'name', 'Machine overhead', 'basis', 'machine_hours', 'rate', 46,
                         'activity', 'run', 'budgets', jsonb_build_array('ELECTRICITY', 'DEPRECIATION', 'SETUP_CREW')),
      jsonb_build_object('pool_code', 'LABOR_OH', 'name', 'Labor overhead', 'basis', 'labor_hours', 'rate', 12,
                         'activity', 'run', 'budgets', jsonb_build_array('SUPERVISION'))),
    'work_center_rules', jsonb_build_array(
      jsonb_build_object('work_center_id', '52050205-0000-0000-0000-0000000000d1', 'labor_rate_per_hour', 35,
                         'pools', jsonb_build_array(jsonb_build_object('pool_code', 'MACHINE_OH', 'applies', true, 'rate', 55))),
      jsonb_build_object('work_center_id', '52050205-0000-0000-0000-0000000000d2',
                         'pools', jsonb_build_array(jsonb_build_object('pool_code', 'LABOR_OH', 'applies', false)))),
    'budgets', jsonb_build_array(
      jsonb_build_object('budget_code', 'ELECTRICITY', 'gl_account_id', '52050205-0000-0000-0000-0000000005a1', 'setup_related', false, 'amount', 9000),
      jsonb_build_object('budget_code', 'DEPRECIATION', 'gl_account_id', '52050205-0000-0000-0000-0000000005a2', 'setup_related', false, 'amount', 15000),
      jsonb_build_object('budget_code', 'SUPERVISION', 'gl_account_id', '52050205-0000-0000-0000-0000000005a3', 'setup_related', false, 'amount', 4800.50),
      jsonb_build_object('budget_code', 'SETUP_CREW', 'gl_account_id', '52050205-0000-0000-0000-0000000005a4', 'setup_related', true, 'amount', 3600, 'planned_hours', 60)),
    'setup_acks', jsonb_build_array(jsonb_build_object('pool_code', 'MACHINE_OH', 'budget_code', 'SETUP_CREW')));
BEGIN
  IF p_variant = 'base' THEN
    RETURN b;
  END IF;
  -- SUPERVISION selected, no pool loads it (LABOR_OH and the work-center rule naming it removed).
  b := jsonb_set(jsonb_set(b, '{overhead_pools}', jsonb_build_array(b->'overhead_pools'->0)),
                 '{work_center_rules}', jsonb_build_array(b->'work_center_rules'->0));
  IF p_variant = 'unallocated' THEN
    RETURN b;
  ELSIF p_variant = 'exception' THEN
    RETURN b
      || jsonb_build_object('unallocated_exception', jsonb_build_object('budgets', jsonb_build_array('SUPERVISION'),
           'reason', 'supervision kept as a period cost this quarter',
           'treatment', 'reported as unabsorbed overhead of the period; not charged to orders'));
  END IF;
  RAISE EXCEPTION 'unknown variant %', p_variant;
END
$fn$;

-- Runs p_call as p_user (authenticated) and requires the outcome to contain p_expected ('OK' or a code).
-- A refused call leaves no trace (subtransaction).
CREATE FUNCTION pg_temp.cp_expect(p_user text, p_label text, p_call text, p_expected text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_got text; v_uid text;
BEGIN
  SELECT COALESCE((SELECT id::text FROM cp_users WHERE k = p_user), '') INTO v_uid;
  PERFORM set_config('request.jwt.claim.sub', v_uid, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', NULLIF(v_uid, ''), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    EXECUTE p_call;
    v_got := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  IF position(p_expected IN v_got) = 0 THEN
    RAISE EXCEPTION 'CP205_EXPECT_FAILED [%]: expected % got %', p_label, p_expected, v_got;
  END IF;
  RETURN v_got;
END
$fn$;

-- Runs p_call (returning jsonb) as p_user and returns its result; raises on refusal.
CREATE FUNCTION pg_temp.cp_call(p_user text, p_call text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_uid text;
BEGIN
  SELECT id::text INTO v_uid FROM cp_users WHERE k = p_user;
  PERFORM set_config('request.jwt.claim.sub', v_uid, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE p_call INTO v;
  PERFORM set_config('role', 'none', true);
  RETURN v;
END
$fn$;

CREATE FUNCTION pg_temp.create_draft(p_draft jsonb, p_expected int, p_key uuid) RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_create_mfg_cost_policy_draft_205(%L, %L::jsonb, %s, %L)',
                '52050205-0000-0000-0000-0000000000a1', p_draft, COALESCE(p_expected::text, 'NULL'), p_key);
$fn$;
-- Approves the revision the draft has now (the one an approver reading it would see); section 12
-- approves an older revision explicitly.
CREATE FUNCTION pg_temp.approve(p_draft uuid) RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_approve_mfg_cost_policy_draft_205(%L, %L, %s)', '52050205-0000-0000-0000-0000000000a1', p_draft,
                COALESCE((SELECT revision::text FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = p_draft), 'NULL'));
$fn$;
CREATE FUNCTION pg_temp.id(p_k text) RETURNS uuid LANGUAGE sql AS $fn$ SELECT id FROM cp_ids WHERE k = p_k $fn$;
CREATE FUNCTION pg_temp.uid(p_k text) RETURNS uuid LANGUAGE sql AS $fn$ SELECT id FROM cp_users WHERE k = p_k $fn$;
CREATE FUNCTION pg_temp.keep(p_k text, p_id uuid) RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO cp_ids VALUES (p_k, p_id) ON CONFLICT (k) DO UPDATE SET id = EXCLUDED.id;
$fn$;
CREATE FUNCTION pg_temp.hours(p_lr text, p_ls text, p_mr text, p_ms text) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('labor', jsonb_build_object('run', p_lr::jsonb, 'setup', p_ls::jsonb),
                            'machine', jsonb_build_object('run', p_mr::jsonb, 'setup', p_ms::jsonb));
$fn$;
CREATE FUNCTION pg_temp.preview(p_version uuid, p_wc uuid, p_hours jsonb, p_rec numeric DEFAULT NULL) RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_preview_mfg_cost_absorption_205(%L, %L, %L, %L::jsonb, %s)',
                '52050205-0000-0000-0000-0000000000a1', p_version, p_wc, p_hours, COALESCE(p_rec::text, 'NULL'));
$fn$;

-- ---------------------------------------------------------------------
-- 2. Draft guards, shapes, ownership, identity. Nothing is written by a refusal.
-- ---------------------------------------------------------------------
SELECT pg_temp.cp_expect('member', 'member creates', pg_temp.create_draft(pg_temp.draft(0), 0, gen_random_uuid()),
  '42501:MANUFACTURING_SETTINGS_UPDATE_DENIED');
SELECT pg_temp.cp_expect('approver', 'approver creates', pg_temp.create_draft(pg_temp.draft(0), 0, gen_random_uuid()),
  '42501:MANUFACTURING_SETTINGS_UPDATE_DENIED');
SELECT pg_temp.cp_expect('b_admin', 'other org creates', pg_temp.create_draft(pg_temp.draft(0), 0, gen_random_uuid()),
  'NOT_ORG_MEMBER');
SELECT pg_temp.cp_expect('', 'no session user creates', pg_temp.create_draft(pg_temp.draft(0), 0, gen_random_uuid()),
  'NOT_AUTHENTICATED');
SELECT pg_temp.cp_expect('member', 'member reads', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$,
  '42501:MANUFACTURING_SETTINGS_READ_DENIED');

DO $shapes$
DECLARE
  b jsonb := pg_temp.draft(0);
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('identity top', b || '{"approved_by":"x"}', 'COST_POLICY_DRAFT_IDENTITY_FIELD: approved_by'),
    ('identity nested', jsonb_set(b, '{budgets,0,created_by}', '"x"'), 'COST_POLICY_DRAFT_IDENTITY_FIELD: created_by'),
    ('identity in exception', b || '{"unallocated_exception":{"budgets":[],"reason":"r","treatment":"t","approved_by":"u"}}',
      'COST_POLICY_DRAFT_IDENTITY_FIELD: approved_by'),
    ('unknown key', b || '{"rate_mode":"x"}', 'COST_POLICY_UNKNOWN_KEY: rate_mode'),
    ('pool code duplicate', jsonb_set(b, '{overhead_pools,1,pool_code}', '"MACHINE_OH"'), 'COST_POLICY_POOL_CODE_DUPLICATE'),
    ('pool unknown key', jsonb_set(b, '{overhead_pools,0,setup}', 'true'), 'COST_POLICY_UNKNOWN_KEY: overhead_pools[1].setup'),
    ('pool rate NaN string', jsonb_set(b, '{overhead_pools,0,rate}', '"NaN"'), 'COST_POLICY_RATE_INVALID: overhead_pools[1].rate'),
    ('pool budgets type', jsonb_set(b, '{overhead_pools,0,budgets}', '"ELECTRICITY"'), 'COST_POLICY_INVALID: overhead_pools[1].budgets'),
    ('activity type', jsonb_set(b, '{overhead_pools,0,activity}', '1'), 'COST_POLICY_INVALID: overhead_pools[1].activity'),
    ('budgets missing', b - 'budgets', 'COST_POLICY_INVALID: budgets'),
    ('budget unknown key', jsonb_set(b, '{budgets,0,rate}', '1'), 'COST_POLICY_UNKNOWN_KEY: budgets[1].rate'),
    ('budget code format', jsonb_set(b, '{budgets,0,budget_code}', '"electricity"'), 'COST_POLICY_INVALID: budgets[1].budget_code'),
    ('budget code duplicate', jsonb_set(b, '{budgets,1,budget_code}', '"ELECTRICITY"'), 'COST_POLICY_BUDGET_CODE_DUPLICATE: ELECTRICITY'),
    ('gl not uuid', jsonb_set(b, '{budgets,0,gl_account_id}', '"GL-5101"'), 'COST_POLICY_INVALID: budgets[1].gl_account_id'),
    ('gl of org B', jsonb_set(b, '{budgets,0,gl_account_id}', '"52050205-0000-0000-0000-0000000005b1"'),
      'COST_POLICY_GL_ACCOUNT_FOREIGN: budgets[1]'),
    ('gl unknown', jsonb_set(b, '{budgets,0,gl_account_id}', '"52050205-0000-0000-0000-0000000005ff"'),
      'COST_POLICY_GL_ACCOUNT_FOREIGN: budgets[1]'),
    ('cost center (tenant relation unproven)', jsonb_set(b, '{budgets,0,cost_center_id}', '"52050205-0000-0000-0000-0000000006a1"'),
      'COST_POLICY_COST_CENTER_FOREIGN: budgets[1]'),
    ('setup flag missing', b #- '{budgets,0,setup_related}', 'COST_POLICY_INVALID: budgets[1].setup_related'),
    ('amount type', jsonb_set(b, '{budgets,0,amount}', 'true'), 'COST_POLICY_INVALID: budgets[1].amount'),
    ('planned hours negative', jsonb_set(b, '{budgets,3,planned_hours}', '-1'), 'COST_POLICY_INVALID: budgets[4].planned_hours'),
    ('planned hours NaN', jsonb_set(b, '{budgets,3,planned_hours}', '"NaN"'), 'COST_POLICY_INVALID: budgets[4].planned_hours'),
    ('planned hours Infinity', jsonb_set(b, '{budgets,3,planned_hours}', '"Infinity"'), 'COST_POLICY_INVALID: budgets[4].planned_hours'),
    ('ack duplicate', jsonb_set(b, '{setup_acks}', (b->'setup_acks') || (b->'setup_acks')), 'COST_POLICY_INVALID: setup_acks[2]'),
    ('exception policy key', b || '{"unallocated_exception":{"budgets":[],"reason":"r","treatment":"t","policy":"block"}}',
      'COST_POLICY_UNKNOWN_KEY: unallocated_exception.policy'),
    ('past date', b || jsonb_build_object('effective_from', (current_setting('cp.today')::date - 1)::text),
      'COST_POLICY_EFFECTIVE_DATE_IN_PAST'),
    ('204 rule still applies', b - 'pin_event', 'COST_POLICY_INVALID: pin_event')
  ) v(label, payload, code) LOOP
    PERFORM pg_temp.cp_expect('creator', c.label, pg_temp.create_draft(c.payload, 0, gen_random_uuid()), c.code);
  END LOOP;
  PERFORM pg_temp.cp_expect('creator', 'expected latest wrong', pg_temp.create_draft(b, 3, gen_random_uuid()),
    'COST_POLICY_VERSION_CONFLICT: latest=0');
  PERFORM pg_temp.cp_expect('creator', 'no idempotency key',
    format('SELECT public.rpc_create_mfg_cost_policy_draft_205(%L, %L::jsonb, 0, NULL)', '52050205-0000-0000-0000-0000000000a1', b),
    'COST_POLICY_IDEMPOTENCY_KEY_REQUIRED');
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_drafts_205) THEN
    RAISE EXCEPTION 'CP205_REFUSAL_WROTE_A_DRAFT';
  END IF;
  RAISE NOTICE 'CP205_DRAFT_SHAPES_OK';
END
$shapes$;

-- ---------------------------------------------------------------------
-- 3. Approval writes the version; a pending draft pins nothing.
-- ---------------------------------------------------------------------
-- An order created while the only draft is pending: no version in force, no pin timing, no pin.
INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity)
VALUES ('52050205-0000-0000-0000-0000000007a1', '52050205-0000-0000-0000-0000000000a1', 'CP205-MO-1', 1);

DO $approve1$
DECLARE
  v jsonb;
  v_d1 uuid;
BEGIN
  v := pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(0), 0, '52050205-0000-0000-0000-00000000f001'));
  v_d1 := (v->>'draft_id')::uuid;
  PERFORM pg_temp.keep('d1', v_d1);
  -- Replay: same key, same payload -> same draft; same key, other payload -> conflict.
  v := pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(0), 0, '52050205-0000-0000-0000-00000000f001'));
  IF (v->>'draft_id')::uuid <> v_d1 OR NOT (v->>'replayed')::boolean THEN
    RAISE EXCEPTION 'CP205_DRAFT_REPLAY_UNEXPECTED: %', v;
  END IF;
  PERFORM pg_temp.cp_expect('creator', 'key reused', pg_temp.create_draft(pg_temp.draft(1), 0, '52050205-0000-0000-0000-00000000f001'),
    'COST_POLICY_IDEMPOTENCY_CONFLICT');
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '52050205-0000-0000-0000-0000000000a1')
     OR EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52050205-0000-0000-0000-0000000007a1')
     OR EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pin_timing WHERE mo_id = '52050205-0000-0000-0000-0000000007a1') THEN
    RAISE EXCEPTION 'CP205_DRAFT_REACHED_204';
  END IF;
  PERFORM pg_temp.cp_expect('member', 'member approves', pg_temp.approve(v_d1), '42501:COST_POLICY_APPROVE_DENIED');
  PERFORM pg_temp.cp_expect('creator', 'creator without approve', pg_temp.approve(v_d1), '42501:COST_POLICY_APPROVE_DENIED');
  PERFORM pg_temp.cp_expect('', 'no session user approves', pg_temp.approve(v_d1), 'NOT_AUTHENTICATED');
  PERFORM pg_temp.cp_expect('b_admin', 'other org approves', pg_temp.approve(v_d1), 'NOT_ORG_MEMBER');
  PERFORM pg_temp.cp_expect('b_admin', 'other org approves through its own org',
    format('SELECT public.rpc_approve_mfg_cost_policy_draft_205(%L, %L, 1)', '52050205-0000-0000-0000-0000000000b1', v_d1),
    'COST_POLICY_DRAFT_UNKNOWN');
  PERFORM pg_temp.cp_expect('approver', 'approver edits', format('SELECT public.rpc_update_mfg_cost_policy_draft_205(%L, %L, %L::jsonb, 0)',
    '52050205-0000-0000-0000-0000000000a1', v_d1, pg_temp.draft(0)), 'MANUFACTURING_SETTINGS_UPDATE_DENIED');
  PERFORM pg_temp.cp_expect('self', 'non-creator edits', format('SELECT public.rpc_update_mfg_cost_policy_draft_205(%L, %L, %L::jsonb, 0)',
    '52050205-0000-0000-0000-0000000000a1', v_d1, pg_temp.draft(0)), '42501:COST_POLICY_DRAFT_EDIT_DENIED');
  PERFORM pg_temp.cp_expect('self', 'non-creator withdraws', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', v_d1, 'x'), '42501:COST_POLICY_DRAFT_EDIT_DENIED');

  v := pg_temp.cp_call('approver', pg_temp.approve(v_d1));
  PERFORM pg_temp.keep('v1', (v->>'policy_version_id')::uuid);
  IF (v->>'self_approved')::boolean OR v->'unallocated' <> '{}'::jsonb OR (v->>'exception')::boolean THEN
    RAISE EXCEPTION 'CP205_APPROVE1_UNEXPECTED: %', v;
  END IF;
  RAISE NOTICE 'CP205_APPROVE_GUARDS_OK';
END
$approve1$;

DO $stored1$
DECLARE
  v1 uuid := pg_temp.id('v1');
  a wardah_internal.mfg_cost_policy_approvals_205%ROWTYPE;
  ver wardah_internal.mfg_cost_policy_versions%ROWTYPE;
BEGIN
  SELECT * INTO ver FROM wardah_internal.mfg_cost_policy_versions WHERE id = v1;
  SELECT * INTO a FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE policy_version_id = v1;
  IF ver.version_no <> 1 OR ver.created_by <> pg_temp.uid('creator') OR ver.idempotency_key <> pg_temp.id('d1')
     OR a.approved_by <> pg_temp.uid('approver') OR a.created_by <> pg_temp.uid('creator') OR a.self_approved
     OR a.self_approval_enabled_at_approval OR a.unallocated_policy_at_approval <> 'block' OR a.kind <> 'version'
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_pools WHERE policy_version_id = v1) <> 2
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_wc_rules WHERE policy_version_id = v1) <> 2
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_wc_pool_rules WHERE policy_version_id = v1) <> 2
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_budgets_205 WHERE policy_version_id = v1) <> 4
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_pool_ext_205 WHERE policy_version_id = v1) <> 2
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_pool_budgets_205 WHERE policy_version_id = v1) <> 4
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_setup_acks_205 WHERE policy_version_id = v1) <> 1
     OR (SELECT status FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = pg_temp.id('d1')) <> 'approved'
     OR (SELECT decided_by FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = pg_temp.id('d1')) <> pg_temp.uid('approver')
     OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'manufacturing.cost_policy.approve' AND entity_id = v1::text
                    AND user_id = pg_temp.uid('approver')) THEN
    RAISE EXCEPTION 'CP205_STORED_V1_UNEXPECTED';
  END IF;
  -- The existing 204 pin trigger picks up the approved version for a new order; the earlier order stays unpinned.
  INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity)
  VALUES ('52050205-0000-0000-0000-0000000007a2', '52050205-0000-0000-0000-0000000000a1', 'CP205-MO-2', 1);
  IF (SELECT policy_version_id FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52050205-0000-0000-0000-0000000007a2') <> v1
     OR EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52050205-0000-0000-0000-0000000007a1') THEN
    RAISE EXCEPTION 'CP205_PIN_UNEXPECTED';
  END IF;
  RAISE NOTICE 'CP205_APPROVAL_WRITES_VERSION_AND_PIN_OK';
END
$stored1$;

-- One-way status and immutability.
DO $immutable$
DECLARE
  v1 uuid := pg_temp.id('v1');
  d1 uuid := pg_temp.id('d1');
  c record;
BEGIN
  PERFORM pg_temp.cp_expect('approver', 'approve twice', pg_temp.approve(d1), 'COST_POLICY_DRAFT_NOT_PENDING');
  PERFORM pg_temp.cp_expect('creator', 'edit approved', format('SELECT public.rpc_update_mfg_cost_policy_draft_205(%L, %L, %L::jsonb, 1)',
    '52050205-0000-0000-0000-0000000000a1', d1, pg_temp.draft(1)), 'COST_POLICY_DRAFT_NOT_PENDING');
  PERFORM pg_temp.cp_expect('creator', 'withdraw approved', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', d1, 'late'), 'COST_POLICY_DRAFT_NOT_PENDING');
  FOR c IN SELECT * FROM (VALUES
    ('update budget', format('UPDATE wardah_internal.mfg_cost_policy_budgets_205 SET amount = 1 WHERE policy_version_id = %L', v1), 'COST_POLICY_IMMUTABLE'),
    ('delete budget', format('DELETE FROM wardah_internal.mfg_cost_policy_budgets_205 WHERE policy_version_id = %L', v1), 'COST_POLICY_IMMUTABLE'),
    ('add budget after approval', format('INSERT INTO wardah_internal.mfg_cost_policy_budgets_205 (policy_version_id, org_id, budget_code, gl_account_id, setup_related) VALUES (%L, %L, %L, %L, false)',
       v1, '52050205-0000-0000-0000-0000000000a1', 'EXTRA', '52050205-0000-0000-0000-0000000005a5'), 'COST_POLICY_IMMUTABLE'),
    ('update activity', format('UPDATE wardah_internal.mfg_cost_policy_pool_ext_205 SET activity = %L WHERE policy_version_id = %L', 'both', v1), 'COST_POLICY_IMMUTABLE'),
    ('move a budget', format('UPDATE wardah_internal.mfg_cost_policy_pool_budgets_205 SET pool_code = %L WHERE policy_version_id = %L', 'LABOR_OH', v1), 'COST_POLICY_IMMUTABLE'),
    ('delete ack', format('DELETE FROM wardah_internal.mfg_cost_policy_setup_acks_205 WHERE policy_version_id = %L', v1), 'COST_POLICY_IMMUTABLE'),
    ('update approval', format('UPDATE wardah_internal.mfg_cost_policy_approvals_205 SET self_approved = false WHERE policy_version_id = %L', v1), 'COST_POLICY_IMMUTABLE'),
    ('update approved draft', format('UPDATE wardah_internal.mfg_cost_policy_drafts_205 SET decision_reason = %L WHERE id = %L', 'x', d1), 'COST_POLICY_DRAFT_NOT_PENDING'),
    ('delete draft', format('DELETE FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = %L', d1), 'COST_POLICY_DRAFT_IMMUTABLE'),
    ('update 204 pool', format('UPDATE wardah_internal.mfg_cost_policy_pools SET rate = 1 WHERE policy_version_id = %L', v1), 'COST_POLICY_IMMUTABLE')
  ) t(label, stmt, code) LOOP
    BEGIN
      EXECUTE c.stmt;
      RAISE EXCEPTION 'CP205_IMMUTABILITY_NOT_ENFORCED: %', c.label;
    EXCEPTION WHEN OTHERS THEN
      IF position(c.code IN SQLERRM) = 0 THEN
        RAISE EXCEPTION 'CP205_IMMUTABILITY_WRONG_ERROR [%]: %', c.label, SQLERRM;
      END IF;
    END;
  END LOOP;
  RAISE NOTICE 'CP205_ONE_WAY_AND_IMMUTABLE_OK';
END
$immutable$;

-- ---------------------------------------------------------------------
-- 4 and 5. 205-Q1 and the 205-only checker.
-- ---------------------------------------------------------------------
DO $q1$
DECLARE
  v jsonb;
  d uuid;
  k text;
BEGIN
  -- Own drafts of four users, each expecting version 1 and starting on later days.
  d := (pg_temp.cp_call('self', pg_temp.create_draft(pg_temp.draft(1), 1, gen_random_uuid()))->>'draft_id')::uuid;
  PERFORM pg_temp.keep('d_self', d);
  d := (pg_temp.cp_call('approver2', pg_temp.create_draft(pg_temp.draft(1), 1, gen_random_uuid()))->>'draft_id')::uuid;
  PERFORM pg_temp.keep('d_approver2', d);
  d := (pg_temp.cp_call('admin', pg_temp.create_draft(pg_temp.draft(1), 1, gen_random_uuid()))->>'draft_id')::uuid;
  PERFORM pg_temp.keep('d_admin', d);

  -- Setting off (default, no row): no self-approval for anyone.
  PERFORM pg_temp.cp_expect('self', 'self-approval while off', pg_temp.approve(pg_temp.id('d_self')),
    '42501:COST_POLICY_SELF_APPROVAL_NOT_ALLOWED');
  PERFORM pg_temp.cp_expect('admin', 'org admin self-approval while off', pg_temp.approve(pg_temp.id('d_admin')),
    '42501:COST_POLICY_SELF_APPROVAL_NOT_ALLOWED');

  -- Who may change the setting: only an assigned approval_settings.manage in this org.
  FOREACH k IN ARRAY ARRAY['approver', 'self', 'admin', 'q4admin', 'expired', 'disabled', 'otherorg', 'super', 'member'] LOOP
    PERFORM pg_temp.cp_expect(k, 'set self-approval as ' || k,
      format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, true, %L)', '52050205-0000-0000-0000-0000000000a1', 'try'),
      '42501:COST_POLICY_APPROVAL_SETTINGS_DENIED');
  END LOOP;
  PERFORM pg_temp.cp_expect('super_out', 'super admin outside the org',
    format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, true, %L)', '52050205-0000-0000-0000-0000000000a1', 'try'),
    'NOT_ORG_MEMBER');
  PERFORM pg_temp.cp_expect('', 'no session user sets',
    format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, true, %L)', '52050205-0000-0000-0000-0000000000a1', 'try'),
    'NOT_AUTHENTICATED');
  PERFORM pg_temp.cp_expect('settings', 'no reason',
    format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, true, %L)', '52050205-0000-0000-0000-0000000000a1', '  '),
    'COST_POLICY_SETTING_REASON_REQUIRED');
  PERFORM pg_temp.cp_expect('settings', 'unchanged',
    format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, false, %L)', '52050205-0000-0000-0000-0000000000a1', 'noop'),
    'COST_POLICY_SETTING_UNCHANGED');
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approval_settings_205)
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approval_settings_audit_205) THEN
    RAISE EXCEPTION 'CP205_REFUSED_SETTING_WROTE';
  END IF;
  v := pg_temp.cp_call('settings', format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, true, %L)',
         '52050205-0000-0000-0000-0000000000a1', 'small team this quarter'));
  IF NOT (v->>'self_approval_enabled')::boolean OR v->>'unallocated_budget_policy' <> 'block'
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_approval_settings_audit_205
         WHERE setting = 'self_approval_enabled' AND old_value = 'false' AND new_value = 'true'
           AND changed_by = pg_temp.uid('settings') AND reason = 'small team this quarter') <> 1
     OR (SELECT updated_by FROM wardah_internal.mfg_cost_policy_approval_settings_205
         WHERE org_id = '52050205-0000-0000-0000-0000000000a1') <> pg_temp.uid('settings') THEN
    RAISE EXCEPTION 'CP205_SETTING_UNEXPECTED: %', v;
  END IF;

  -- Setting on: approve alone is not enough (approver2), the org admin without the assigned key is refused,
  -- the assigned self_approve holder is accepted and recorded as self-approval.
  PERFORM pg_temp.cp_expect('approver2', 'self-approval without self_approve', pg_temp.approve(pg_temp.id('d_approver2')),
    '42501:COST_POLICY_SELF_APPROVAL_NOT_ALLOWED');
  PERFORM pg_temp.cp_expect('admin', 'org admin self-approval without assignment', pg_temp.approve(pg_temp.id('d_admin')),
    '42501:COST_POLICY_SELF_APPROVAL_NOT_ALLOWED');
  v := pg_temp.cp_call('self', pg_temp.approve(pg_temp.id('d_self')));
  PERFORM pg_temp.keep('v2', (v->>'policy_version_id')::uuid);
  IF NOT (v->>'self_approved')::boolean
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205
                    WHERE policy_version_id = pg_temp.id('v2') AND self_approved AND self_approval_enabled_at_approval
                      AND approved_by = pg_temp.uid('self') AND created_by = pg_temp.uid('self')) THEN
    RAISE EXCEPTION 'CP205_SELF_APPROVAL_NOT_RECORDED: %', v;
  END IF;
  -- The other drafts expected version 1; version 2 now exists.
  PERFORM pg_temp.cp_expect('approver', 'stale expected version', pg_temp.approve(pg_temp.id('d_approver2')),
    'COST_POLICY_VERSION_CONFLICT: latest=2');
  -- Reject and withdraw.
  PERFORM pg_temp.cp_expect('approver', 'reject without reason', format('SELECT public.rpc_reject_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', pg_temp.id('d_approver2'), ''), 'COST_POLICY_DECISION_REASON_REQUIRED');
  PERFORM pg_temp.cp_expect('member', 'member rejects', format('SELECT public.rpc_reject_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', pg_temp.id('d_approver2'), 'x'), '42501:COST_POLICY_APPROVE_DENIED');
  PERFORM pg_temp.cp_call('approver', format('SELECT public.rpc_reject_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', pg_temp.id('d_approver2'), 'stale'));
  PERFORM pg_temp.cp_call('admin', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', pg_temp.id('d_admin'), 'not needed'));
  IF (SELECT status FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = pg_temp.id('d_approver2')) <> 'rejected'
     OR (SELECT decided_by FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = pg_temp.id('d_approver2')) <> pg_temp.uid('approver')
     OR (SELECT status FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = pg_temp.id('d_admin')) <> 'withdrawn' THEN
    RAISE EXCEPTION 'CP205_REJECT_WITHDRAW_UNEXPECTED';
  END IF;
  PERFORM pg_temp.cp_expect('approver', 'approve rejected', pg_temp.approve(pg_temp.id('d_approver2')), 'COST_POLICY_DRAFT_NOT_PENDING');

  -- The checker itself (the session user is the only identity it reads).
  PERFORM set_config('request.jwt.claim.sub', pg_temp.uid('admin')::text, true);
  IF wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.self_approve')
     OR NOT COALESCE(public.has_permission(pg_temp.uid('admin'), '52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.self_approve'), false) THEN
    RAISE EXCEPTION 'CP205_CHECKER_ORG_ADMIN';   -- has_permission (174) grants it by the admin override; the checker does not
  END IF;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.uid('super')::text, true);
  IF wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.approval_settings.manage')
     OR NOT COALESCE(public.has_permission(pg_temp.uid('super'), '52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.approval_settings.manage'), false) THEN
    RAISE EXCEPTION 'CP205_CHECKER_SUPER_ADMIN';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.uid('otherorg')::text, true);
  IF wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.approval_settings.manage')
     OR NOT wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000b1', 'manufacturing.cost_policy.approval_settings.manage') THEN
    RAISE EXCEPTION 'CP205_CHECKER_OTHER_ORG';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', pg_temp.uid('settings')::text, true);
  IF NOT wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.approval_settings.manage') THEN
    RAISE EXCEPTION 'CP205_CHECKER_ASSIGNED';
  END IF;
  UPDATE public.user_organizations SET is_active = false
  WHERE user_id = pg_temp.uid('settings') AND org_id = '52050205-0000-0000-0000-0000000000a1';
  IF wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.approval_settings.manage') THEN
    RAISE EXCEPTION 'CP205_CHECKER_INACTIVE_MEMBER';
  END IF;
  UPDATE public.user_organizations SET is_active = true
  WHERE user_id = pg_temp.uid('settings') AND org_id = '52050205-0000-0000-0000-0000000000a1';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF wardah_internal.mfg_cost_policy_has_assigned_205('52050205-0000-0000-0000-0000000000a1', 'manufacturing.cost_policy.approval_settings.manage') THEN
    RAISE EXCEPTION 'CP205_CHECKER_NO_SESSION';
  END IF;
  RAISE NOTICE 'CP205_Q1_AND_CHECKER_OK';
END
$q1$;

-- ---------------------------------------------------------------------
-- 7. 205-Q4.
-- ---------------------------------------------------------------------
DO $q4$
DECLARE
  v jsonb;
  k text;
  d_unalloc uuid;
  d_exc uuid;
  d_noreason uuid;
  d_dup uuid;
  d_double uuid;
  b jsonb;
BEGIN
  d_unalloc := (pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(2, 'unallocated'), 2, gen_random_uuid()))->>'draft_id')::uuid;
  d_exc := (pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(2, 'exception'), 2, gen_random_uuid()))->>'draft_id')::uuid;
  d_noreason := (pg_temp.cp_call('creator', pg_temp.create_draft(
    pg_temp.draft(2, 'exception') #- '{unallocated_exception,reason}', 2, gen_random_uuid()))->>'draft_id')::uuid;
  -- With a valid exception: duplicate source and double allocation are still refused (X18 in the database).
  b := pg_temp.draft(2, 'exception');
  d_dup := (pg_temp.cp_call('creator', pg_temp.create_draft(
    jsonb_set(b, '{budgets,1,gl_account_id}', b->'budgets'->0->'gl_account_id'), 2, gen_random_uuid()))->>'draft_id')::uuid;
  d_double := (pg_temp.cp_call('creator', pg_temp.create_draft(
    jsonb_set(b, '{overhead_pools}', (b->'overhead_pools') || jsonb_build_array(jsonb_build_object(
      'pool_code', 'LABOR_OH', 'name', 'L', 'basis', 'labor_hours', 'rate', 12, 'activity', 'run',
      'budgets', jsonb_build_array('ELECTRICITY')))), 2, gen_random_uuid()))->>'draft_id')::uuid;

  -- Default 'block'.
  PERFORM pg_temp.cp_expect('approver', 'unallocated under block', pg_temp.approve(d_unalloc), 'COST_POLICY_BUDGET_UNALLOCATED');
  PERFORM pg_temp.cp_expect('approver', 'exception under block', pg_temp.approve(d_exc), 'COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED');

  -- Who may change the policy: the org admin of this company holding the explicit key, and no one else.
  FOREACH k IN ARRAY ARRAY['admin', 'q4member', 'settings', 'approver', 'self', 'super', 'otherorg', 'member'] LOOP
    PERFORM pg_temp.cp_expect(k, 'set Q4 policy as ' || k,
      format('SELECT public.rpc_set_cost_policy_unallocated_policy_205(%L, %L, %L)', '52050205-0000-0000-0000-0000000000a1',
             'controlled_exception', 'try'), '42501:COST_POLICY_UNALLOCATED_POLICY_DENIED');
  END LOOP;
  PERFORM pg_temp.cp_expect('super_out', 'super admin outside the org sets Q4',
    format('SELECT public.rpc_set_cost_policy_unallocated_policy_205(%L, %L, %L)', '52050205-0000-0000-0000-0000000000a1',
           'controlled_exception', 'try'), 'NOT_ORG_MEMBER');
  PERFORM pg_temp.cp_expect('q4admin', 'unknown policy',
    format('SELECT public.rpc_set_cost_policy_unallocated_policy_205(%L, %L, %L)', '52050205-0000-0000-0000-0000000000a1',
           'allow', 'try'), 'COST_POLICY_UNALLOCATED_POLICY_INVALID');
  PERFORM pg_temp.cp_expect('q4admin', 'Q4 no reason',
    format('SELECT public.rpc_set_cost_policy_unallocated_policy_205(%L, %L, NULL)', '52050205-0000-0000-0000-0000000000a1',
           'controlled_exception'), 'COST_POLICY_SETTING_REASON_REQUIRED');
  v := pg_temp.cp_call('q4admin', format('SELECT public.rpc_set_cost_policy_unallocated_policy_205(%L, %L, %L)',
         '52050205-0000-0000-0000-0000000000a1', 'controlled_exception', 'quarter with idle supervision'));
  IF v->>'unallocated_budget_policy' <> 'controlled_exception' OR NOT (v->>'self_approval_enabled')::boolean
     OR (SELECT count(*) FROM wardah_internal.mfg_cost_policy_approval_settings_audit_205
         WHERE setting = 'unallocated_budget_policy' AND old_value = 'block' AND new_value = 'controlled_exception'
           AND changed_by = pg_temp.uid('q4admin')) <> 1 THEN
    RAISE EXCEPTION 'CP205_Q4_SETTING_UNEXPECTED: %', v;
  END IF;

  -- Under controlled_exception: no exception -> still refused; an incomplete exception -> refused;
  -- the exception relaxes no other rule.
  PERFORM pg_temp.cp_expect('approver', 'unallocated without exception', pg_temp.approve(d_unalloc), 'COST_POLICY_BUDGET_UNALLOCATED');
  PERFORM pg_temp.cp_expect('approver', 'exception without reason', pg_temp.approve(d_noreason),
    'COST_POLICY_UNALLOCATED_EXCEPTION_INVALID: reason');
  PERFORM pg_temp.cp_expect('approver', 'exception + duplicate source', pg_temp.approve(d_dup), 'COST_POLICY_BUDGET_DUPLICATE_SOURCE');
  PERFORM pg_temp.cp_expect('approver', 'exception + double allocation', pg_temp.approve(d_double), 'COST_POLICY_BUDGET_DOUBLE_ALLOCATION');

  v := pg_temp.cp_call('approver', pg_temp.approve(d_exc));
  PERFORM pg_temp.keep('v_exc', (v->>'policy_version_id')::uuid);
  PERFORM pg_temp.keep('d_exc', d_exc);
  IF v->'unallocated' <> '{"SUPERVISION": 480050}'::jsonb OR NOT (v->>'exception')::boolean THEN
    RAISE EXCEPTION 'CP205_Q4_APPROVAL_UNEXPECTED: %', v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_unallocated_exceptions_205
                 WHERE policy_version_id = pg_temp.id('v_exc') AND draft_id = d_exc
                   AND budgets = '{"SUPERVISION": 4800.50}'::jsonb
                   AND reason = 'supervision kept as a period cost this quarter'
                   AND treatment = 'reported as unabsorbed overhead of the period; not charged to orders'
                   AND approved_by = pg_temp.uid('approver') AND policy_at_approval = 'controlled_exception')
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205
                    WHERE policy_version_id = pg_temp.id('v_exc') AND unallocated_policy_at_approval = 'controlled_exception')
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_pool_budgets_205
                WHERE policy_version_id = pg_temp.id('v_exc') AND budget_code = 'SUPERVISION') THEN
    RAISE EXCEPTION 'CP205_Q4_EXCEPTION_NOT_RECORDED';
  END IF;
  BEGIN
    UPDATE wardah_internal.mfg_cost_policy_unallocated_exceptions_205 SET reason = 'changed' WHERE policy_version_id = pg_temp.id('v_exc');
    RAISE EXCEPTION 'CP205_Q4_EXCEPTION_MUTABLE';
  EXCEPTION WHEN OTHERS THEN
    IF position('COST_POLICY_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  -- d_dup and d_double were refused and stay pending; withdraw them.
  PERFORM pg_temp.cp_call('creator', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', d_dup, 'test'));
  PERFORM pg_temp.cp_call('creator', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', d_double, 'test'));
  RAISE NOTICE 'CP205_Q4_OK';
END
$q4$;

-- ---------------------------------------------------------------------
-- 8. Computation through the preview.
-- ---------------------------------------------------------------------
DO $compute$
DECLARE
  v1 uuid := pg_temp.id('v1');
  vx uuid := pg_temp.id('v_exc');
  h jsonb := pg_temp.hours('"18"', '"2"', '"15"', '"1.5"');
  wc uuid;
  p jsonb;
  c204 jsonb;
  c204l jsonb;
  ref jsonb;
  vj jsonb;
BEGIN
  -- Stored compute = compute_205 on the draft's own JSON (the calculator form the parity cases prove).
  vj := wardah_internal.mfg_cost_policy_draft_v_205('52050205-0000-0000-0000-0000000000a1', pg_temp.draft(5));
  vj := vj - 'exception_request';
  FOREACH wc IN ARRAY ARRAY['52050205-0000-0000-0000-0000000000d1', '52050205-0000-0000-0000-0000000000d2',
                            '52050205-0000-0000-0000-0000000000d3']::uuid[] LOOP
    p := pg_temp.cp_call('approver', pg_temp.preview(v1, wc, h));
    ref := wardah_internal.mfg_cost_policy_compute_205_v(vj, wc::text, h, NULL, NULL);
    IF p->'cents' <> ref THEN
      RAISE EXCEPTION 'CP205_PREVIEW_NOT_COMPUTE_205 at %: % vs %', wc, p->'cents', ref;
    END IF;
    -- Each line equals the 204 SQL computation given the hours the activity selects: labor on run + setup,
    -- both pools here are 'run' (machine run, labor run).
    c204l := wardah_internal.mfg_cost_policy_compute_204('52050205-0000-0000-0000-0000000000a1', v1, wc, 20, 15, NULL);
    c204 := wardah_internal.mfg_cost_policy_compute_204('52050205-0000-0000-0000-0000000000a1', v1, wc, 18, 15, NULL);
    IF (p->'labor'->>'amount')::numeric <> (c204l->'labor'->>'amount')::numeric
       OR (SELECT jsonb_object_agg(e->>'pool_code', (e->>'amount')::numeric) FROM jsonb_array_elements(p->'overhead') e)
          IS DISTINCT FROM (SELECT jsonb_object_agg(e->>'pool_code', (e->>'amount')::numeric) FROM jsonb_array_elements(c204->'overhead') e)
       OR p->'excluded_pools' <> c204->'excluded_pools' THEN
      RAISE EXCEPTION 'CP205_LINES_NOT_204 at %: % vs % / %', wc, p, c204l, c204;
    END IF;
  END LOOP;
  -- Accepted case (b) at WC-C: labor 600.00, machine 15 h x 46, labor overhead 18 h x 12.
  p := pg_temp.cp_call('approver', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3', h));
  IF p->'cents' <> '{"labor": 60000, "pools": {"LABOR_OH": 21600, "MACHINE_OH": 69000}, "total": 150600}'::jsonb
     OR p->'unallocated_budgets' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'CP205_CASE_B_UNEXPECTED: %', p;
  END IF;

  -- Required hours: NULL is not measured; 0 is measured; negative, NaN and Infinity are refused.
  PERFORM pg_temp.cp_expect('approver', 'hour missing', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3',
    pg_temp.hours('"18"', 'null', '"15"', '"1"')), 'COST_POLICY_DRIVER_MISSING: labor.setup');
  PERFORM pg_temp.cp_expect('approver', 'hour negative', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3',
    pg_temp.hours('"18"', '"2"', '-1', '"0"')), 'COST_POLICY_HOURS_INVALID: machine.run');
  PERFORM pg_temp.cp_expect('approver', 'hour NaN', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3',
    pg_temp.hours('"18"', '"2"', '"NaN"', '"0"')), 'COST_POLICY_HOURS_INVALID: machine.run');
  PERFORM pg_temp.cp_expect('approver', 'hour Infinity', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3',
    pg_temp.hours('"Infinity"', '"2"', '"15"', '"0"')), 'COST_POLICY_HOURS_INVALID: labor.run');
  PERFORM pg_temp.cp_expect('approver', 'hour text', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3',
    pg_temp.hours('"18"', '"abc"', '"15"', '"0"')), 'COST_POLICY_HOURS_INVALID: labor.setup');
  p := pg_temp.cp_call('approver', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3', pg_temp.hours('0', '0', '0', 'null')));
  IF p->'cents'->>'total' <> '0' THEN
    RAISE EXCEPTION 'CP205_MEASURED_ZERO: %', p;   -- machine setup is not needed by a run-only pool
  END IF;
  PERFORM pg_temp.cp_expect('approver', 'other org work center', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000e1', h),
    'COST_POLICY_WORK_CENTER_UNKNOWN');
  PERFORM pg_temp.cp_expect('b_admin', 'other org preview', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3', h), 'NOT_ORG_MEMBER');
  PERFORM pg_temp.cp_expect('member', 'member preview', pg_temp.preview(v1, '52050205-0000-0000-0000-0000000000d3', h),
    'MANUFACTURING_SETTINGS_READ_DENIED');

  -- The excepted budget is shown with its amount and absorbed nowhere: the version computes exactly as
  -- the same version without that budget (X16 in the database).
  p := pg_temp.cp_call('approver', pg_temp.preview(vx, '52050205-0000-0000-0000-0000000000d3', h));
  vj := wardah_internal.mfg_cost_policy_version_v_205(vx);
  vj := (vj - 'unallocated_exception') || jsonb_build_object('budgets',
          (SELECT jsonb_agg(e ORDER BY e->>'code') FROM jsonb_array_elements(vj->'budgets') e WHERE e->>'code' <> 'SUPERVISION'));
  IF p->'unallocated_budgets' <> '[{"amount": 4800.50, "budget_code": "SUPERVISION"}]'::jsonb
     OR p->'cents' <> wardah_internal.mfg_cost_policy_compute_205_v(vj, '52050205-0000-0000-0000-0000000000d3', h, NULL, NULL)
     OR p->'cents'->'pools' ? 'LABOR_OH' THEN
    RAISE EXCEPTION 'CP205_EXCEPTION_ABSORBED: %', p;
  END IF;
  PERFORM set_config('cp.vx_cents', (p->'cents')::text, false);
  RAISE NOTICE 'CP205_COMPUTE_OK';
END
$compute$;

-- The policy back to 'block' does not reopen the approved version; a new exception is refused again.
DO $q4back$
DECLARE
  p jsonb;
  d uuid;
BEGIN
  PERFORM pg_temp.cp_call('q4admin', format('SELECT public.rpc_set_cost_policy_unallocated_policy_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', 'block', 'quarter closed'));
  p := pg_temp.cp_call('approver', pg_temp.preview(pg_temp.id('v_exc'), '52050205-0000-0000-0000-0000000000d3',
         pg_temp.hours('"18"', '"2"', '"15"', '"1.5"')));
  IF p->'cents' <> current_setting('cp.vx_cents')::jsonb THEN
    RAISE EXCEPTION 'CP205_POLICY_CHANGE_REOPENED_VERSION';
  END IF;
  d := (pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(3, 'exception'), 3, gen_random_uuid()))->>'draft_id')::uuid;
  PERFORM pg_temp.cp_expect('approver', 'exception after the policy is back to block', pg_temp.approve(d),
    'COST_POLICY_UNALLOCATED_EXCEPTION_NOT_ALLOWED');
  RAISE NOTICE 'CP205_Q4_POLICY_CHANGE_FORWARD_ONLY_OK';
END
$q4back$;

-- ---------------------------------------------------------------------
-- 9. Legacy 204 versions.
-- ---------------------------------------------------------------------
DO $legacy$
DECLARE
  v jsonb;
  v_legacy uuid;
  v_before text;
  d uuid;
  res jsonb := jsonb_build_object(
    'pools', jsonb_build_array(
      jsonb_build_object('pool_code', 'LABOR_OH', 'activity', 'both', 'budgets', jsonb_build_array('SUPERVISION')),
      jsonb_build_object('pool_code', 'MACHINE_OH', 'activity', 'run', 'budgets', jsonb_build_array('ELECTRICITY', 'DEPRECIATION', 'SETUP_CREW'))),
    'budgets', pg_temp.draft(0)->'budgets',
    'setup_acks', pg_temp.draft(0)->'setup_acks');
  h jsonb := pg_temp.hours('"18"', '"2"', '"15"', '"1.5"');
BEGIN
  -- A version created through the 204 path, which stays callable until plan §8 step 4.
  v := pg_temp.cp_call('creator', format('SELECT public.rpc_create_mfg_cost_policy_version(%L, %L::jsonb, 3, gen_random_uuid())',
    '52050205-0000-0000-0000-0000000000a1', jsonb_build_object(
      'effective_from', (current_setting('cp.today')::date + 10)::text, 'labor_cost_source', 'work_center_rate',
      'default_labor_rate_per_hour', 30, 'pin_event', 'mo_created',
      'overhead_pools', jsonb_build_array(
        jsonb_build_object('pool_code', 'LABOR_OH', 'name', 'L', 'basis', 'labor_hours', 'rate', 12),
        jsonb_build_object('pool_code', 'MACHINE_OH', 'name', 'M', 'basis', 'machine_hours', 'rate', 40)),
      'work_center_rules', jsonb_build_array(jsonb_build_object('work_center_id', '52050205-0000-0000-0000-0000000000d1',
        'labor_rate_per_hour', 35, 'pools', jsonb_build_array(jsonb_build_object('pool_code', 'MACHINE_OH', 'applies', true, 'rate', 55)))))));
  v_legacy := (v->>'policy_version_id')::uuid;
  PERFORM pg_temp.keep('v_legacy', v_legacy);
  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_before FROM (
    SELECT to_jsonb(x)::text AS t FROM wardah_internal.mfg_cost_policy_versions x WHERE id = v_legacy
    UNION ALL SELECT to_jsonb(x)::text FROM wardah_internal.mfg_cost_policy_pools x WHERE policy_version_id = v_legacy
    UNION ALL SELECT to_jsonb(x)::text FROM wardah_internal.mfg_cost_policy_wc_rules x WHERE policy_version_id = v_legacy
    UNION ALL SELECT to_jsonb(x)::text FROM wardah_internal.mfg_cost_policy_wc_pool_rules x WHERE policy_version_id = v_legacy) s;

  PERFORM pg_temp.cp_expect('approver', 'legacy unresolved', pg_temp.preview(v_legacy, '52050205-0000-0000-0000-0000000000d1', h),
    'COST_POLICY_LEGACY_UNRESOLVED');
  v := pg_temp.cp_call('approver', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$);
  IF (SELECT e->>'policy_205' FROM jsonb_array_elements(v->'versions') e WHERE (e->>'id')::uuid = v_legacy) <> 'legacy_unresolved'
     OR (SELECT e->>'policy_205' FROM jsonb_array_elements(v->'versions') e WHERE (e->>'id')::uuid = pg_temp.id('v1')) <> 'approved_205' THEN
    RAISE EXCEPTION 'CP205_LEGACY_STATUS_UNEXPECTED: %', v->'versions';
  END IF;

  -- Resolution drafts: guards and shapes.
  PERFORM pg_temp.cp_expect('approver', 'resolution without create right',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000a1', v_legacy, res, 'r'), 'MANUFACTURING_SETTINGS_UPDATE_DENIED');
  PERFORM pg_temp.cp_expect('creator', 'resolution without reason',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, NULL, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000a1', v_legacy, res), 'COST_POLICY_LEGACY_REASON_REQUIRED');
  PERFORM pg_temp.cp_expect('creator', 'resolution with identity',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000a1', v_legacy, res || '{"resolved_by":"x"}', 'r'), 'COST_POLICY_DRAFT_IDENTITY_FIELD: resolved_by');
  PERFORM pg_temp.cp_expect('creator', 'resolution duplicate pool',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000a1', v_legacy, jsonb_set(res, '{pools,1,pool_code}', '"LABOR_OH"'), 'r'),
    'COST_POLICY_POOL_CODE_DUPLICATE');
  PERFORM pg_temp.cp_expect('creator', 'resolution on a 205 version',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000a1', pg_temp.id('v1'), res, 'r'), 'COST_POLICY_LEGACY_NOT_APPLICABLE');
  PERFORM pg_temp.cp_expect('b_admin', 'resolution from another org',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000b1', v_legacy, res, 'r'), 'COST_POLICY_VERSION_UNKNOWN');
  -- Pools not covering the version exactly: accepted as a draft, refused at approval.
  d := (pg_temp.cp_call('creator', format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
         '52050205-0000-0000-0000-0000000000a1', v_legacy,
         jsonb_set(jsonb_set(res, '{pools}', jsonb_build_array(res->'pools'->1)), '{budgets}',
                   jsonb_build_array(res->'budgets'->0, res->'budgets'->1, res->'budgets'->3)), 'partial'))->>'draft_id')::uuid;
  PERFORM pg_temp.cp_expect('approver', 'resolution pools mismatch', pg_temp.approve(d), 'COST_POLICY_LEGACY_POOLS_MISMATCH');
  PERFORM pg_temp.cp_call('creator', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', d, 'partial'));

  -- Self-approval of a resolution follows Q1: turned off again, the creator-approver is refused.
  PERFORM pg_temp.cp_call('settings', format('SELECT public.rpc_set_cost_policy_self_approval_205(%L, false, %L)',
    '52050205-0000-0000-0000-0000000000a1', 'back to four eyes'));
  d := (pg_temp.cp_call('self', format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
         '52050205-0000-0000-0000-0000000000a1', v_legacy, res, 'version created before 205'))->>'draft_id')::uuid;
  PERFORM pg_temp.cp_expect('self', 'resolution self-approval while off', pg_temp.approve(d), '42501:COST_POLICY_SELF_APPROVAL_NOT_ALLOWED');
  PERFORM pg_temp.cp_expect('member', 'resolution approval without approve', pg_temp.approve(d), '42501:COST_POLICY_APPROVE_DENIED');
  v := pg_temp.cp_call('approver', pg_temp.approve(d));
  IF (v->>'policy_version_id')::uuid <> v_legacy
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_legacy_resolutions_205
                    WHERE policy_version_id = v_legacy AND draft_id = d AND created_by = pg_temp.uid('self')
                      AND approved_by = pg_temp.uid('approver') AND reason = 'version created before 205')
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205
                    WHERE policy_version_id = v_legacy AND kind = 'legacy_resolution' AND NOT self_approved) THEN
    RAISE EXCEPTION 'CP205_LEGACY_RESOLUTION_NOT_RECORDED: %', v;
  END IF;

  -- The version rows are byte-for-byte as before; the resolved version computes like the equivalent
  -- 205 version (X7 in the database) and is reported as resolved.
  IF (SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
        SELECT to_jsonb(x)::text AS t FROM wardah_internal.mfg_cost_policy_versions x WHERE id = v_legacy
        UNION ALL SELECT to_jsonb(x)::text FROM wardah_internal.mfg_cost_policy_pools x WHERE policy_version_id = v_legacy
        UNION ALL SELECT to_jsonb(x)::text FROM wardah_internal.mfg_cost_policy_wc_rules x WHERE policy_version_id = v_legacy
        UNION ALL SELECT to_jsonb(x)::text FROM wardah_internal.mfg_cost_policy_wc_pool_rules x WHERE policy_version_id = v_legacy) s)
     <> v_before THEN
    RAISE EXCEPTION 'CP205_LEGACY_VERSION_CHANGED';
  END IF;
  v := pg_temp.cp_call('approver', pg_temp.preview(v_legacy, '52050205-0000-0000-0000-0000000000d1', h));
  IF v->'cents' <> wardah_internal.mfg_cost_policy_compute_205_v(
        (wardah_internal.mfg_cost_policy_version_v_205(v_legacy) - 'budgets' - 'setup_acks')
          || jsonb_build_object('pools', (SELECT jsonb_agg(e - 'activity' - 'budgets')
                                          FROM jsonb_array_elements(wardah_internal.mfg_cost_policy_version_v_205(v_legacy)->'pools') e)),
        '52050205-0000-0000-0000-0000000000d1', h, NULL,
        wardah_internal.mfg_cost_policy_resolution_v_205('52050205-0000-0000-0000-0000000000a1', res) - 'exception_request') THEN
    RAISE EXCEPTION 'CP205_LEGACY_COMPUTE_UNEXPECTED: %', v;
  END IF;
  v := pg_temp.cp_call('approver', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$);
  IF (SELECT e->>'policy_205' FROM jsonb_array_elements(v->'versions') e WHERE (e->>'id')::uuid = v_legacy) <> 'legacy_resolved' THEN
    RAISE EXCEPTION 'CP205_LEGACY_STATUS_AFTER';
  END IF;
  PERFORM pg_temp.cp_expect('creator', 'second resolution',
    format('SELECT public.rpc_create_legacy_resolution_draft_205(%L, %L, %L::jsonb, %L, gen_random_uuid())',
           '52050205-0000-0000-0000-0000000000a1', v_legacy, res, 'again'), 'COST_POLICY_LEGACY_NOT_APPLICABLE');
  BEGIN
    UPDATE wardah_internal.mfg_cost_policy_legacy_resolutions_205 SET reason = 'changed' WHERE policy_version_id = v_legacy;
    RAISE EXCEPTION 'CP205_LEGACY_RESOLUTION_MUTABLE';
  EXCEPTION WHEN OTHERS THEN
    IF position('COST_POLICY_IMMUTABLE' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  RAISE NOTICE 'CP205_LEGACY_OK';
END
$legacy$;

-- ---------------------------------------------------------------------
-- 10. Indexes, isolation and the cost-center tenant relation.
-- ---------------------------------------------------------------------
DO $indexes$
DECLARE
  v_ver uuid;
BEGIN
  -- An owner-inserted 204 version without 205 data, to reach the table constraints directly.
  INSERT INTO wardah_internal.mfg_cost_policy_versions
    (org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour, pin_event, idempotency_key, payload_hash)
  VALUES ('52050205-0000-0000-0000-0000000000a1', 99, current_setting('cp.today')::date + 400, 'work_center_rate', 30,
          'mo_created', gen_random_uuid(), 'fixture')
  RETURNING id INTO v_ver;
  INSERT INTO wardah_internal.mfg_cost_policy_budgets_205 (policy_version_id, org_id, budget_code, gl_account_id, setup_related)
  VALUES (v_ver, '52050205-0000-0000-0000-0000000000a1', 'B1', '52050205-0000-0000-0000-0000000005a1', false);
  BEGIN
    INSERT INTO wardah_internal.mfg_cost_policy_budgets_205 (policy_version_id, org_id, budget_code, gl_account_id, setup_related)
    VALUES (v_ver, '52050205-0000-0000-0000-0000000000a1', 'B2', '52050205-0000-0000-0000-0000000005a1', false);
    RAISE EXCEPTION 'CP205_ACCOUNT_SCOPE_INDEX_MISSING';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO wardah_internal.mfg_cost_policy_budgets_205 (policy_version_id, org_id, budget_code, gl_account_id, setup_related)
    VALUES (v_ver, '52050205-0000-0000-0000-0000000000a1', 'B3', '52050205-0000-0000-0000-0000000005b1', false);
    RAISE EXCEPTION 'CP205_FOREIGN_ACCOUNT_STORED';
  EXCEPTION WHEN OTHERS THEN
    IF position('COST_POLICY_GL_ACCOUNT_FOREIGN' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO wardah_internal.mfg_cost_policy_budgets_205
      (policy_version_id, org_id, budget_code, gl_account_id, cost_center_id, setup_related)
    VALUES (v_ver, '52050205-0000-0000-0000-0000000000a1', 'B4', '52050205-0000-0000-0000-0000000005a2',
            '52050205-0000-0000-0000-0000000006a1', false);
    RAISE EXCEPTION 'CP205_COST_CENTER_STORED';
  EXCEPTION WHEN OTHERS THEN
    IF position('COST_POLICY_COST_CENTER_FOREIGN' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'wardah_internal'
                 AND indexname = 'mfg_cost_policy_budgets_205_center_scope'
                 AND indexdef LIKE '%UNIQUE%(policy_version_id, gl_account_id, cost_center_id)%WHERE (cost_center_id IS NOT NULL)%')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'wardah_internal'
                    AND indexname = 'mfg_cost_policy_budgets_205_account_scope'
                    AND indexdef LIKE '%UNIQUE%(policy_version_id, gl_account_id)%WHERE (cost_center_id IS NULL)%') THEN
    RAISE EXCEPTION 'CP205_PARTIAL_INDEXES_UNEXPECTED';
  END IF;
  -- The relation of cost_centers.tenant_id to organizations is not in the schema: no foreign key, so no
  -- center can be proven to belong to the version's organization.
  IF EXISTS (SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = 'public.cost_centers'::regclass AND c.contype = 'f'
               AND c.confrelid = 'public.organizations'::regclass) THEN
    RAISE EXCEPTION 'CP205_COST_CENTER_RELATION_NOW_EXISTS (revisit 205-Q3: centers could be accepted)';
  END IF;
  RAISE NOTICE 'CP205_COST_CENTER_TENANT_RELATION_UNPROVEN (no foreign key from cost_centers to organizations; no center accepted)';
  RAISE NOTICE 'CP205_INDEXES_AND_OWNERSHIP_OK';
END
$indexes$;

DO $isolation$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.cp_expect('b_admin', 'other org reads A', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$,
    'NOT_ORG_MEMBER');
  v := pg_temp.cp_call('b_admin', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000b1')$$);
  IF jsonb_array_length(v->'versions') <> 0 OR jsonb_array_length(v->'drafts') <> 0 OR jsonb_array_length(v->'settings_audit') <> 0
     OR v->'settings' <> '{"self_approval_enabled": false, "unallocated_budget_policy": "block"}'::jsonb THEN
    RAISE EXCEPTION 'CP205_ORG_B_SEES_A: %', v;
  END IF;
  PERFORM pg_temp.cp_expect('b_admin', 'other org preview of A version',
    format('SELECT public.rpc_preview_mfg_cost_absorption_205(%L, %L, %L, %L::jsonb, NULL)', '52050205-0000-0000-0000-0000000000b1',
           pg_temp.id('v1'), '52050205-0000-0000-0000-0000000000e1', pg_temp.hours('1', '1', '1', '1')), 'COST_POLICY_VERSION_UNKNOWN');
  -- The approver's view of A: capabilities follow the checker, settings and audit are A's.
  v := pg_temp.cp_call('approver', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$);
  IF v->'capabilities' <> '{"can_create": false, "can_approve": true, "can_self_approve": false, "can_manage_approval_settings": false, "can_manage_unallocated_policy": false}'::jsonb
     OR jsonb_array_length(v->'settings_audit') <> 4 THEN
    RAISE EXCEPTION 'CP205_APPROVER_VIEW_UNEXPECTED: %', v->'capabilities';
  END IF;
  v := pg_temp.cp_call('q4admin', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$);
  IF NOT (v->'capabilities'->>'can_manage_unallocated_policy')::boolean OR (v->'capabilities'->>'can_manage_approval_settings')::boolean THEN
    RAISE EXCEPTION 'CP205_Q4ADMIN_VIEW_UNEXPECTED: %', v->'capabilities';
  END IF;
  RAISE NOTICE 'CP205_ISOLATION_OK';
END
$isolation$;

-- ---------------------------------------------------------------------
-- 11. Role templates. create_role_from_template expands 'manufacturing.%' to every manufacturing key
--     except an exact-name-only list; 205 (section 1b) adds the three explicit keys to that list. A
--     template that names one of them exactly still grants it; approve (an ordinary key) still expands.
-- ---------------------------------------------------------------------
DO $template$
DECLARE
  v_role uuid;
  v_keys text[];
BEGIN
  INSERT INTO public.role_templates (id, name, name_ar, description_ar, category, permission_keys, is_active) VALUES
    ('52050205-0000-0000-0000-0000000008a1', 'cp205 production manager', 'مدير إنتاج', 'قالب اختبار', 'manufacturing',
     ARRAY['manufacturing.%'], true),
    ('52050205-0000-0000-0000-0000000008a2', 'cp205 cost policy settings', 'إعدادات الاعتماد', 'قالب اختبار', 'manufacturing',
     ARRAY['manufacturing.cost_policy.%', 'manufacturing.cost_policy.approval_settings.manage'], true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.uid('admin')::text, true);
  v_role := public.create_role_from_template('52050205-0000-0000-0000-0000000000a1', '52050205-0000-0000-0000-0000000008a1', 'cp205 from template', NULL);
  SELECT array_agg(p.permission_key ORDER BY p.permission_key) INTO v_keys
  FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = v_role AND p.permission_key LIKE 'manufacturing.cost_policy.%';
  IF v_keys IS DISTINCT FROM ARRAY['manufacturing.cost_policy.approve'] THEN
    RAISE EXCEPTION 'CP205_TEMPLATE_WILDCARD_GRANTS_EXPLICIT_KEY: %', v_keys;
  END IF;
  v_role := public.create_role_from_template('52050205-0000-0000-0000-0000000000a1', '52050205-0000-0000-0000-0000000008a2', 'cp205 named key', NULL);
  SELECT array_agg(p.permission_key ORDER BY p.permission_key) INTO v_keys
  FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = v_role AND p.permission_key LIKE 'manufacturing.cost_policy.%';
  IF v_keys IS DISTINCT FROM ARRAY['manufacturing.cost_policy.approval_settings.manage', 'manufacturing.cost_policy.approve'] THEN
    RAISE EXCEPTION 'CP205_TEMPLATE_NAMED_KEY_UNEXPECTED: %', v_keys;
  END IF;
  RAISE NOTICE 'CP205_TEMPLATE_EXPLICIT_KEYS_OK';
END
$template$;

-- ---------------------------------------------------------------------
-- 12. Approval bound to the reviewed revision; rate precision.
-- ---------------------------------------------------------------------
DO $revision$
DECLARE
  v jsonb;
  v_d uuid;
  v_g uuid;
  v_latest int;
  v_versions int;
  v_seen int;
  v_edit jsonb;
  v_ver uuid;
  v_days int;
BEGIN
  SELECT COALESCE(max(version_no), 0), COALESCE(max(effective_from), current_setting('cp.today')::date) - current_setting('cp.today')::date + 1
  INTO v_latest, v_days FROM wardah_internal.mfg_cost_policy_versions
  WHERE org_id = '52050205-0000-0000-0000-0000000000a1';
  v := pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(v_days), v_latest, gen_random_uuid()));
  v_d := (v->>'draft_id')::uuid;
  IF (v->>'revision')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CP205_REVISION_AT_CREATE: %', v;
  END IF;
  -- The approver reads the draft: revision 1.
  v := pg_temp.cp_call('approver', $$SELECT public.rpc_get_mfg_cost_policy_205('52050205-0000-0000-0000-0000000000a1')$$);
  SELECT (e->>'revision')::int INTO v_seen FROM jsonb_array_elements(v->'drafts') e WHERE (e->>'id')::uuid = v_d;
  IF v_seen IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CP205_REVISION_NOT_SHOWN: %', v_seen;
  END IF;
  -- The creator then changes the machine rate.
  v_edit := jsonb_set(pg_temp.draft(v_days), '{overhead_pools,0,rate}', '47'::jsonb);
  v := pg_temp.cp_call('creator', format('SELECT public.rpc_update_mfg_cost_policy_draft_205(%L, %L, %L::jsonb, %s)',
    '52050205-0000-0000-0000-0000000000a1', v_d, v_edit, v_latest));
  IF (v->>'revision')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CP205_REVISION_AFTER_EDIT: %', v;
  END IF;
  SELECT count(*) INTO v_versions FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '52050205-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.cp_expect('approver', 'approve the revision read before the edit',
    format('SELECT public.rpc_approve_mfg_cost_policy_draft_205(%L, %L, %s)', '52050205-0000-0000-0000-0000000000a1', v_d, v_seen),
    '22023:COST_POLICY_DRAFT_REVISION_CONFLICT: current=2');
  PERFORM pg_temp.cp_expect('approver', 'approve without a revision',
    format('SELECT public.rpc_approve_mfg_cost_policy_draft_205(%L, %L, NULL)', '52050205-0000-0000-0000-0000000000a1', v_d),
    '22023:COST_POLICY_DRAFT_REVISION_CONFLICT: current=2');
  PERFORM pg_temp.cp_expect('approver', 'approve a revision not reached yet',
    format('SELECT public.rpc_approve_mfg_cost_policy_draft_205(%L, %L, 3)', '52050205-0000-0000-0000-0000000000a1', v_d),
    '22023:COST_POLICY_DRAFT_REVISION_CONFLICT: current=2');
  IF (SELECT count(*) FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '52050205-0000-0000-0000-0000000000a1') <> v_versions
     OR (SELECT status FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = v_d) <> 'draft'
     OR (SELECT revision FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = v_d) <> 2
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE draft_id = v_d) THEN
    RAISE EXCEPTION 'CP205_REVISION_REFUSAL_WROTE';
  END IF;
  -- After reading revision 2 the approver approves it: what is stored is the content of revision 2.
  v := pg_temp.cp_call('approver', format('SELECT public.rpc_approve_mfg_cost_policy_draft_205(%L, %L, 2)',
    '52050205-0000-0000-0000-0000000000a1', v_d));
  v_ver := (v->>'policy_version_id')::uuid;
  IF (SELECT draft_revision FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE draft_id = v_d) IS DISTINCT FROM 2
     OR (SELECT rate FROM wardah_internal.mfg_cost_policy_pools WHERE policy_version_id = v_ver AND pool_code = 'MACHINE_OH') <> 47
     OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'manufacturing.cost_policy.approve' AND entity_id = v_ver::text
                    AND (metadata->>'draft_revision')::int = 2) THEN
    RAISE EXCEPTION 'CP205_REVISION_APPROVED_UNEXPECTED';
  END IF;
  -- The revision moves with the content only (table owner, past the RPCs).
  v := pg_temp.cp_call('creator', pg_temp.create_draft(pg_temp.draft(v_days + 1), v_latest + 1, gen_random_uuid()));
  v_g := (v->>'draft_id')::uuid;
  BEGIN
    UPDATE wardah_internal.mfg_cost_policy_drafts_205 SET revision = revision + 1 WHERE id = v_g;
    RAISE EXCEPTION 'CP205_REVISION_MOVED_WITHOUT_CONTENT';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'COST_POLICY_DRAFT_REVISION_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE wardah_internal.mfg_cost_policy_drafts_205 SET payload = payload || '{"note": "changed"}'::jsonb WHERE id = v_g;
    RAISE EXCEPTION 'CP205_CONTENT_CHANGED_WITHOUT_REVISION';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'COST_POLICY_DRAFT_REVISION_INVALID' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE wardah_internal.mfg_cost_policy_drafts_205 SET payload = payload || '{"note": "changed"}'::jsonb, revision = revision + 2
    WHERE id = v_g;
    RAISE EXCEPTION 'CP205_REVISION_SKIPPED';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'COST_POLICY_DRAFT_REVISION_INVALID' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.cp_call('creator', format('SELECT public.rpc_withdraw_mfg_cost_policy_draft_205(%L, %L, %L)',
    '52050205-0000-0000-0000-0000000000a1', v_g, 'revision guard checked'));
  RAISE NOTICE 'CP205_APPROVAL_BOUND_TO_REVISION_OK';
END
$revision$;

DO $precision$
DECLARE
  v jsonb;
  v_latest int;
  v_draft jsonb;
  v_ver uuid;
  h jsonb := pg_temp.hours('2', '1', '3', '0');
  v_days int;
BEGIN
  SELECT COALESCE(max(version_no), 0), COALESCE(max(effective_from), current_setting('cp.today')::date) - current_setting('cp.today')::date + 1
  INTO v_latest, v_days FROM wardah_internal.mfg_cost_policy_versions
  WHERE org_id = '52050205-0000-0000-0000-0000000000a1';
  v_draft := jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.draft(v_days),
    '{default_labor_rate_per_hour}', '1.123456'::jsonb),
    '{overhead_pools,0,rate}', '1.123456'::jsonb),
    '{work_center_rules,0,labor_rate_per_hour}', '2.654321'::jsonb),
    '{work_center_rules,0,pools,0,rate}', '7.000005'::jsonb);
  PERFORM pg_temp.cp_expect('creator', 'seven decimals at the default',
    pg_temp.create_draft(jsonb_set(v_draft, '{default_labor_rate_per_hour}', '1.1234567'::jsonb), v_latest, gen_random_uuid()),
    'COST_POLICY_RATE_INVALID');
  PERFORM pg_temp.cp_expect('creator', 'seven decimals (trailing zero) at a pool',
    pg_temp.create_draft(jsonb_set(v_draft, '{overhead_pools,0,rate}', '1.1234560'::jsonb), v_latest, gen_random_uuid()),
    'COST_POLICY_RATE_INVALID');
  PERFORM pg_temp.cp_expect('creator', 'seven decimals at a work-center override',
    pg_temp.create_draft(jsonb_set(v_draft, '{work_center_rules,0,pools,0,rate}', '0.0000001'::jsonb), v_latest, gen_random_uuid()),
    'COST_POLICY_WC_POOL_RATE_INVALID');
  v := pg_temp.cp_call('creator', pg_temp.create_draft(v_draft, v_latest, gen_random_uuid()));
  v := pg_temp.cp_call('approver', pg_temp.approve((v->>'draft_id')::uuid));
  v_ver := (v->>'policy_version_id')::uuid;
  -- Work center d1 (overrides): labor 3 h x 2.654321 = 7.962963 -> 7.96; MACHINE_OH 3 h x 7.000005 = 21.000015 -> 21.00;
  -- LABOR_OH 2 run h x 12 = 24.00. Work center d2 (policy rates, LABOR_OH off): labor 3 h x 1.123456 = 3.370368 -> 3.37;
  -- MACHINE_OH 3 h x 1.123456 -> 3.37 (a rate first rounded to 1.12 would give 3.36).
  v := pg_temp.cp_call('approver', pg_temp.preview(v_ver, '52050205-0000-0000-0000-0000000000d1', h));
  IF (v->'labor'->>'amount')::numeric <> 7.96 OR (v->>'overhead_total')::numeric <> 45.00 OR (v->>'total')::numeric <> 52.96
     OR (v->'cents'->'pools'->>'MACHINE_OH')::bigint <> 2100 OR (v->'cents'->'pools'->>'LABOR_OH')::bigint <> 2400 THEN
    RAISE EXCEPTION 'CP205_PRECISION_OVERRIDE_UNEXPECTED: %', v;
  END IF;
  v := pg_temp.cp_call('approver', pg_temp.preview(v_ver, '52050205-0000-0000-0000-0000000000d2', h));
  IF (v->'labor'->>'amount')::numeric <> 3.37 OR (v->'cents'->'pools'->>'MACHINE_OH')::bigint <> 337
     OR v->'cents'->'pools' ? 'LABOR_OH' OR (v->>'total')::numeric <> 6.74 THEN
    RAISE EXCEPTION 'CP205_PRECISION_DEFAULT_UNEXPECTED: %', v;
  END IF;
  RAISE NOTICE 'CP205_RATE_PRECISION_OK';
END
$precision$;

DO $done$ BEGIN RAISE NOTICE 'MFG_COST_POLICY_205_ACCEPTANCE_PASS'; END $done$;
ROLLBACK;
