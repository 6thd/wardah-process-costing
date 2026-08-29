-- Red proof for Migration 183 / SEC-172.
--
-- Run only on a database built through 182 with 183 omitted. It succeeds only
-- when an active non-admin member with no role/permission can still call every
-- target — the exact Production gap 183 must close.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('99183183-dead-dead-dead-000000000001', 'p183-red@example.test');

INSERT INTO public.organizations (id, name, code)
VALUES ('99183183-dead-dead-dead-000000000002', 'P183 Red Org', 'P183-RED');

INSERT INTO public.user_organizations
  (user_id, org_id, is_active, is_org_admin)
VALUES
  ('99183183-dead-dead-dead-000000000001',
   '99183183-dead-dead-dead-000000000002', true, false);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, name_ar, category, subtype, normal_balance,
   allow_posting, is_active)
VALUES
  ('99183183-dead-dead-dead-000000000003',
   '99183183-dead-dead-dead-000000000002',
   '131100', 'Red Proof Account', 'حساب إثبات الاحمرار',
   'ASSET', 'CURRENT_ASSET', 'DEBIT', true, true);

SELECT set_config(
  'request.jwt.claim.sub',
  '99183183-dead-dead-dead-000000000001',
  false
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    PERFORM 1
    FROM public.rpc_get_trial_balance(
      '99183183-dead-dead-dead-000000000002', DATE '2026-08-31');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_RED_PROOF_FAILED[trial_balance]: %', SQLERRM;
  END;

  BEGIN
    PERFORM 1
    FROM public.get_account_statement(
      '131100', DATE '2026-01-01', DATE '2026-08-31');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_RED_PROOF_FAILED[account_statement]: %', SQLERRM;
  END;

  BEGIN
    PERFORM public.rpc_subledger_gl_reconciliation(
      DATE '2026-08-31',
      '99183183-dead-dead-dead-000000000002'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_RED_PROOF_FAILED[reconciliation]: %', SQLERRM;
  END;

  BEGIN
    PERFORM 1
    FROM public.get_gl_accounts_by_category(
      '99183183-dead-dead-dead-000000000002', 'ASSET');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'FINANCIAL_REPORT_RBAC_183_RED_PROOF_FAILED[account_lookup]: %', SQLERRM;
  END;
END;
$$;

\echo 'FINANCIAL_REPORT_RBAC_183_RED_PROOF_OK: membership-only access reproduced'
ROLLBACK;

