-- Additional acceptance for Migration 166.
-- Runs after acceptance_166_voucher_reset.sql on the same fresh database.
-- Proves cross-organization fail-closed behavior and idempotent duplicate reset.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION
        'ACCEPTANCE_FAIL: expected [%] for [%], got [%]',
        p_needle, p_sql, SQLERRM;
    END IF;
  END;

  IF v_succeeded THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: expected error [%] for [%], but it succeeded',
      p_needle, p_sql;
  END IF;
END;
$$;

BEGIN;

-- The primary acceptance leaves both vouchers posted after correction/repost.
CREATE TEMP TABLE v166_isolation_entries AS
SELECT
  (SELECT gl_entry_id
   FROM public.customer_collections
   WHERE id='66c10000-0000-0000-0000-000000000001') AS receipt_entry_id,
  (SELECT gl_entry_id
   FROM public.supplier_payments
   WHERE id='66c20000-0000-0000-0000-000000000001') AS payment_entry_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id='66c10000-0000-0000-0000-000000000001'
      AND status='posted'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE id='66c20000-0000-0000-0000-000000000001'
      AND status='posted'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: primary acceptance did not leave vouchers posted';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. A fully privileged admin of another organization cannot address Org A's
-- voucher IDs. PostgreSQL superuser bypasses RLS in this fixture, so this
-- explicitly executes the org_id predicates inside the SECURITY DEFINER RPCs.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('66dddddd-dddd-dddd-dddd-dddddddddddd', 'voucher166-orgb-admin@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('66222222-2222-2222-2222-222222222222', 'V166B', 'Voucher Reset 166 Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, role, is_active, is_org_admin) VALUES
  ('66000000-0000-0000-0000-000000000004',
   '66dddddd-dddd-dddd-dddd-dddddddddddd',
   '66222222-2222-2222-2222-222222222222', 'admin', true, true);

SELECT set_config('request.jwt.claim.sub',
                  '66dddddd-dddd-dddd-dddd-dddddddddddd', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"66222222-2222-2222-2222-222222222222"}', false);

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_reset_customer_receipt_to_draft(
      '66c10000-0000-0000-0000-000000000001', 'cross org receipt')$$,
  'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_reset_supplier_payment_to_draft(
      '66c20000-0000-0000-0000-000000000001', 'cross org payment')$$,
  'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections c, v166_isolation_entries x
    WHERE c.id='66c10000-0000-0000-0000-000000000001'
      AND c.status='posted' AND c.gl_entry_id=x.receipt_entry_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments p, v166_isolation_entries x
    WHERE p.id='66c20000-0000-0000-0000-000000000001'
      AND p.status='posted' AND p.gl_entry_id=x.payment_entry_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id='66b10000-0000-0000-0000-000000000001'
      AND paid_amount=250 AND balance=750
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id='66b20000-0000-0000-0000-000000000001'
      AND paid_amount=200 AND balance=800
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: cross-org rejection changed financial state';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The explicitly authorized corrector resets both vouchers. A repeated
-- call must return duplicate=true, preserve the same draft GL identities,
-- avoid a second allocation reversal, and avoid extra audit rows.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '66cccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"66111111-1111-1111-1111-111111111111"}', false);

DO $$
DECLARE
  v_receipt jsonb;
  v_payment jsonb;
BEGIN
  v_receipt := public.rpc_reset_customer_receipt_to_draft(
    '66c10000-0000-0000-0000-000000000001',
    'second correction cycle');
  v_payment := public.rpc_reset_supplier_payment_to_draft(
    '66c20000-0000-0000-0000-000000000001',
    'second correction cycle');

  IF v_receipt->>'duplicate' <> 'false'
     OR v_payment->>'duplicate' <> 'false' THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: first reset in second cycle was marked duplicate';
  END IF;
END;
$$;

DO $$
DECLARE
  v_receipt jsonb;
  v_payment jsonb;
BEGIN
  v_receipt := public.rpc_reset_customer_receipt_to_draft(
    '66c10000-0000-0000-0000-000000000001',
    'duplicate receipt reset');
  v_payment := public.rpc_reset_supplier_payment_to_draft(
    '66c20000-0000-0000-0000-000000000001',
    'duplicate payment reset');

  IF v_receipt->>'duplicate' <> 'true'
     OR v_payment->>'duplicate' <> 'true'
     OR v_receipt->>'status' <> 'draft'
     OR v_payment->>'status' <> 'draft' THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: repeated reset did not return the duplicate draft contract';
  END IF;
END;
$$;

DO $$
DECLARE
  v_guc text := coalesce(current_setting('wardah.voucher_unpost', true), '');
BEGIN
  IF v_guc <> 'off' THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: voucher_unpost GUC leaked after duplicate reset: [%]', v_guc;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections c, v166_isolation_entries x
    WHERE c.id='66c10000-0000-0000-0000-000000000001'
      AND c.status='draft' AND c.gl_entry_id=x.receipt_entry_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments p, v166_isolation_entries x
    WHERE p.id='66c20000-0000-0000-0000-000000000001'
      AND p.status='draft' AND p.gl_entry_id=x.payment_entry_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_entries e, v166_isolation_entries x
    WHERE e.id=x.receipt_entry_id AND e.status='draft'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_entries e, v166_isolation_entries x
    WHERE e.id=x.payment_entry_id AND e.status='draft'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: duplicate reset changed or detached draft GL identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id='66b10000-0000-0000-0000-000000000001'
      AND paid_amount=0 AND balance=1000 AND payment_status='unpaid'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id='66b20000-0000-0000-0000-000000000001'
      AND paid_amount=0 AND balance=1000 AND status='approved'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: duplicate reset reversed allocations more than once';
  END IF;

  IF (SELECT count(*)
      FROM public.audit_logs
      WHERE action='voucher_reset_to_draft'
        AND entity_id='66c10000-0000-0000-0000-000000000001') <> 2
     OR (SELECT count(*)
         FROM public.audit_logs
         WHERE action='voucher_reset_to_draft'
           AND entity_id='66c20000-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: duplicate reset inserted an extra audit event';
  END IF;
END;
$$;

COMMIT;

SELECT 'VOUCHER_RESET_166_ISOLATION_IDEMPOTENCY_PASS' AS result;
