-- Acceptance for Migration 183 / SEC-172.
--
-- Proves the server boundary, not the UI:
--   * active membership with no grant is denied;
--   * a different reports.* key is denied (exact-key proof);
--   * exact active grants are allowed;
--   * expired/inactive roles and revoked grants are denied;
--   * cross-org requests still fail at membership isolation;
--   * Org Admin semantics from the central helper are preserved;
--   * every hardened function has the intended exact key and ACL.
--
-- The workflow also runs a separate pre-183 red database proving these same
-- calls were membership-only before this migration.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('99183183-0001-0001-0001-000000000001', 'p183-none@example.test'),
  ('99183183-0002-0002-0002-000000000002', 'p183-report@example.test'),
  ('99183183-0003-0003-0003-000000000003', 'p183-statement@example.test'),
  ('99183183-0004-0004-0004-000000000004', 'p183-accounts@example.test'),
  ('99183183-0005-0005-0005-000000000005', 'p183-same-module@example.test'),
  ('99183183-0006-0006-0006-000000000006', 'p183-expired@example.test'),
  ('99183183-0007-0007-0007-000000000007', 'p183-inactive-role@example.test'),
  ('99183183-0008-0008-0008-000000000008', 'p183-revoked@example.test'),
  ('99183183-0009-0009-0009-000000000009', 'p183-admin@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99183183-a000-a000-a000-00000000000a', 'Financial RBAC 183 A', 'P183-A'),
  ('99183183-b000-b000-b000-00000000000b', 'Financial RBAC 183 B', 'P183-B');

INSERT INTO public.user_organizations
  (user_id, org_id, is_active, is_org_admin)
VALUES
  ('99183183-0001-0001-0001-000000000001', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0002-0002-0002-000000000002', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0003-0003-0003-000000000003', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0004-0004-0004-000000000004', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0005-0005-0005-000000000005', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0006-0006-0006-000000000006', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0007-0007-0007-000000000007', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0008-0008-0008-000000000008', '99183183-a000-a000-a000-00000000000a', true, false),
  ('99183183-0009-0009-0009-000000000009', '99183183-a000-a000-a000-00000000000a', true, true);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('99183183-1001-1001-1001-000000000001', '99183183-a000-a000-a000-00000000000a', 'P183 Report', 'تقرير مالي', true),
  ('99183183-1002-1002-1002-000000000002', '99183183-a000-a000-a000-00000000000a', 'P183 Statement', 'كشف حساب', true),
  ('99183183-1003-1003-1003-000000000003', '99183183-a000-a000-a000-00000000000a', 'P183 Accounts', 'حسابات', true),
  ('99183183-1004-1004-1004-000000000004', '99183183-a000-a000-a000-00000000000a', 'P183 Same Module', 'تقرير آخر', true),
  ('99183183-1005-1005-1005-000000000005', '99183183-a000-a000-a000-00000000000a', 'P183 Expired', 'منتهي', true),
  ('99183183-1006-1006-1006-000000000006', '99183183-a000-a000-a000-00000000000a', 'P183 Inactive', 'دور معطل', false),
  ('99183183-1007-1007-1007-000000000007', '99183183-a000-a000-a000-00000000000a', 'P183 Revoked', 'ملغى', true);

INSERT INTO public.role_permissions (role_id, permission_id) VALUES
  ('99183183-1001-1001-1001-000000000001',
    (SELECT id FROM public.permissions WHERE permission_key='reports.financial.read')),
  ('99183183-1002-1002-1002-000000000002',
    (SELECT id FROM public.permissions WHERE permission_key='general_ledger.account_statement.view')),
  ('99183183-1003-1003-1003-000000000003',
    (SELECT id FROM public.permissions WHERE permission_key='accounting.accounts.read')),
  ('99183183-1004-1004-1004-000000000004',
    (SELECT id FROM public.permissions WHERE permission_key='reports.inventory.read')),
  ('99183183-1005-1005-1005-000000000005',
    (SELECT id FROM public.permissions WHERE permission_key='reports.financial.read')),
  ('99183183-1006-1006-1006-000000000006',
    (SELECT id FROM public.permissions WHERE permission_key='reports.financial.read')),
  ('99183183-1007-1007-1007-000000000007',
    (SELECT id FROM public.permissions WHERE permission_key='reports.financial.read'));

INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  ('99183183-0002-0002-0002-000000000002', '99183183-1001-1001-1001-000000000001', '99183183-a000-a000-a000-00000000000a', NULL),
  ('99183183-0003-0003-0003-000000000003', '99183183-1002-1002-1002-000000000002', '99183183-a000-a000-a000-00000000000a', NULL),
  ('99183183-0004-0004-0004-000000000004', '99183183-1003-1003-1003-000000000003', '99183183-a000-a000-a000-00000000000a', NULL),
  ('99183183-0005-0005-0005-000000000005', '99183183-1004-1004-1004-000000000004', '99183183-a000-a000-a000-00000000000a', NULL),
  ('99183183-0006-0006-0006-000000000006', '99183183-1005-1005-1005-000000000005', '99183183-a000-a000-a000-00000000000a', '2020-01-01T00:00:00Z'),
  ('99183183-0007-0007-0007-000000000007', '99183183-1006-1006-1006-000000000006', '99183183-a000-a000-a000-00000000000a', NULL),
  ('99183183-0008-0008-0008-000000000008', '99183183-1007-1007-1007-000000000007', '99183183-a000-a000-a000-00000000000a', NULL);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, name_ar, category, subtype, normal_balance,
   allow_posting, is_active)
VALUES
  ('99183183-2001-2001-2001-000000000001', '99183183-a000-a000-a000-00000000000a',
   '131100', 'Raw Materials', 'مواد خام', 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, true),
  ('99183183-2002-2002-2002-000000000002', '99183183-a000-a000-a000-00000000000a',
   '410100', 'Revenue', 'الإيرادات', 'REVENUE', 'OPERATING', 'CREDIT', true, true);

INSERT INTO public.gl_entries
  (id, org_id, entry_number, entry_date, entry_type, description,
   total_debit, total_credit, status, journal_origin)
VALUES
  ('99183183-3001-3001-3001-000000000001', '99183183-a000-a000-a000-00000000000a',
   'P183-0001', DATE '2026-08-01', 'manual', 'P183 fixture',
   100.00, 100.00, 'posted', 'system');

INSERT INTO public.gl_entry_lines
  (org_id, entry_id, line_number, account_id, debit, credit, currency_code)
VALUES
  ('99183183-a000-a000-a000-00000000000a', '99183183-3001-3001-3001-000000000001',
   1, '99183183-2001-2001-2001-000000000001', 100.00, 0, 'SAR'),
  ('99183183-a000-a000-a000-00000000000a', '99183183-3001-3001-3001-000000000001',
   2, '99183183-2002-2002-2002-000000000002', 0, 100.00, 'SAR');

CREATE OR REPLACE FUNCTION pg_temp.expect_183_error(
  p_user uuid, p_sql text, p_fragment text, p_label text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_caught boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, false);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_fragment || '%' THEN
      RAISE EXCEPTION 'FINANCIAL_REPORT_RBAC_183_UNEXPECTED_ERROR[%]: expected [%], got [%]',
        p_label, p_fragment, SQLERRM;
    END IF;
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'FINANCIAL_REPORT_RBAC_183_DENIAL_MISSING[%]', p_label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_183_success(
  p_user uuid, p_sql text, p_label text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, false);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FINANCIAL_REPORT_RBAC_183_ALLOWED_CALL_FAILED[%]: %',
      p_label, SQLERRM;
  END;
END;
$$;

SET LOCAL ROLE authenticated;

-- Membership alone and same-module-but-wrong permission are both denied.
SELECT pg_temp.expect_183_error(
  '99183183-0001-0001-0001-000000000001',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: reports.financial.read', 'member-only trial balance');

SELECT pg_temp.expect_183_error(
  '99183183-0005-0005-0005-000000000005',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: reports.financial.read', 'same-module key');

-- Exact report permission opens both financial-report RPCs.
SELECT pg_temp.expect_183_success(
  '99183183-0002-0002-0002-000000000002',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'exact report trial balance');

SELECT pg_temp.expect_183_success(
  '99183183-0002-0002-0002-000000000002',
  $$SELECT public.rpc_subledger_gl_reconciliation(
      DATE '2026-08-31', '99183183-a000-a000-a000-00000000000a')$$,
  'exact report reconciliation');

-- Resource-specific keys do not bleed into one another.
SELECT pg_temp.expect_183_success(
  '99183183-0003-0003-0003-000000000003',
  $$SELECT * FROM public.get_account_statement(
      '131100', DATE '2026-01-01', DATE '2026-08-31')$$,
  'exact statement');

SELECT pg_temp.expect_183_error(
  '99183183-0003-0003-0003-000000000003',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: reports.financial.read', 'statement cannot read trial balance');

SELECT pg_temp.expect_183_success(
  '99183183-0004-0004-0004-000000000004',
  $$SELECT * FROM public.get_gl_accounts_by_category(
      '99183183-a000-a000-a000-00000000000a', 'ASSET')$$,
  'exact account lookup');

SELECT pg_temp.expect_183_error(
  '99183183-0004-0004-0004-000000000004',
  $$SELECT * FROM public.get_account_statement(
      '131100', DATE '2026-01-01', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: general_ledger.account_statement.view',
  'account lookup cannot read statement');

-- Expiry and role activation are enforced by wardah_has_exact_permission.
SELECT pg_temp.expect_183_error(
  '99183183-0006-0006-0006-000000000006',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: reports.financial.read', 'expired role');

SELECT pg_temp.expect_183_error(
  '99183183-0007-0007-0007-000000000007',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: reports.financial.read', 'inactive role');

-- Org Admin override remains the central RBAC contract for ordinary keys.
SELECT pg_temp.expect_183_success(
  '99183183-0009-0009-0009-000000000009',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'org-admin report override');

-- Cross-org isolation runs before authorization and remains fail-closed.
SELECT pg_temp.expect_183_error(
  '99183183-0002-0002-0002-000000000002',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-b000-b000-b000-00000000000b', DATE '2026-08-31')$$,
  'NOT_ORG_MEMBER', 'cross-org trial balance');

-- A real grant works, then revocation is immediately observed.
SELECT pg_temp.expect_183_success(
  '99183183-0008-0008-0008-000000000008',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'pre-revocation report');

RESET ROLE;
DELETE FROM public.role_permissions
WHERE role_id = '99183183-1007-1007-1007-000000000007';
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_183_error(
  '99183183-0008-0008-0008-000000000008',
  $$SELECT * FROM public.rpc_get_trial_balance(
      '99183183-a000-a000-a000-00000000000a', DATE '2026-08-31')$$,
  'PERMISSION_DENIED: reports.financial.read', 'revoked role');

RESET ROLE;

DO $$
DECLARE
  v_def text;
BEGIN
  IF has_function_privilege(
       'anon', 'public.get_account_statement(text,date,date)', 'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.rpc_get_trial_balance(uuid,date)', 'EXECUTE')
     OR has_function_privilege(
       'anon',
       'public.rpc_subledger_gl_reconciliation(date,uuid,text[],text[])',
       'EXECUTE')
     OR has_function_privilege(
       'anon', 'public.get_gl_accounts_by_category(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FINANCIAL_REPORT_RBAC_183_ANON_EXECUTE_LEAK';
  END IF;

  SELECT pg_get_functiondef(
    'public.rpc_get_trial_balance(uuid,date)'::regprocedure)
  INTO v_def;
  IF v_def NOT LIKE '%gl_entry_lines%'
     OR v_def LIKE '%FROM journal_lines%'
     OR v_def NOT LIKE '%fiscal_year_start%'
     OR v_def NOT LIKE '%account_id IS NULL%' THEN
    RAISE EXCEPTION 'FINANCIAL_REPORT_RBAC_183_182_LAYER_REGRESSED';
  END IF;

  IF has_table_privilege('anon', 'public.v_trial_balance', 'SELECT')
     OR has_table_privilege(
          'authenticated', 'public.v_trial_balance', 'SELECT')
     OR NOT has_table_privilege(
          'service_role', 'public.v_trial_balance', 'SELECT') THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_TRIAL_BALANCE_VIEW_BYPASS_OPEN';
  END IF;
END;
$$;

\echo 'FINANCIAL_REPORT_RBAC_183_ACCEPTANCE_PASS'
ROLLBACK;
