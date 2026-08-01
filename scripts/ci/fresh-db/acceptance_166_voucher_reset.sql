-- Acceptance for Migration 166.
-- Executes the real customer-receipt and supplier-payment RPCs on a fresh DB.
-- Proves exact permission enforcement, posted-entry immutability, closed-period
-- fail-closed behavior, generated invoice balances, and stable GL identity
-- across post -> reset -> correct -> repost.
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

-- ---------------------------------------------------------------------------
-- 1. Minimal tenant, users, RBAC, accounting map, invoices, and vouchers.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('66aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'voucher166-admin@example.test'),
  ('66bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'voucher166-reader@example.test'),
  ('66cccccc-cccc-cccc-cccc-cccccccccccc', 'voucher166-corrector@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('66111111-1111-1111-1111-111111111111', 'V166', 'Voucher Reset 166 Org');

INSERT INTO public.user_organizations
  (id, user_id, org_id, role, is_active, is_org_admin) VALUES
  ('66000000-0000-0000-0000-000000000001',
   '66aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '66111111-1111-1111-1111-111111111111', 'admin', true, true),
  ('66000000-0000-0000-0000-000000000002',
   '66bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '66111111-1111-1111-1111-111111111111', 'user', true, false),
  ('66000000-0000-0000-0000-000000000003',
   '66cccccc-cccc-cccc-cccc-cccccccccccc',
   '66111111-1111-1111-1111-111111111111', 'user', true, false);

INSERT INTO public.roles
  (id, org_id, name, name_ar, is_system_role, is_active) VALUES
  ('66700000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111',
   'Voucher 166 accounting reader', 'قارئ محاسبة 166', false, true),
  ('66700000-0000-0000-0000-000000000002',
   '66111111-1111-1111-1111-111111111111',
   'Voucher 166 corrector', 'مصحح السندات 166', false, true);

-- The reader receives one ordinary accounting permission. Under the legacy
-- module fallback this is sufficient for any accounting.* key, but it must not
-- satisfy the exact unpost guard.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '66700000-0000-0000-0000-000000000001'::uuid, p.id
FROM public.permissions p
WHERE p.permission_key LIKE 'accounting.%'
  AND p.permission_key <> 'accounting.vouchers.unpost'
ORDER BY p.permission_key
LIMIT 1;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '66700000-0000-0000-0000-000000000002'::uuid, p.id
FROM public.permissions p
WHERE p.permission_key = 'accounting.vouchers.unpost';

INSERT INTO public.user_roles
  (id, user_id, role_id, org_id) VALUES
  ('66800000-0000-0000-0000-000000000001',
   '66bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '66700000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111'),
  ('66800000-0000-0000-0000-000000000002',
   '66cccccc-cccc-cccc-cccc-cccccccccccc',
   '66700000-0000-0000-0000-000000000002',
   '66111111-1111-1111-1111-111111111111');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = '66700000-0000-0000-0000-000000000001'
      AND p.permission_key LIKE 'accounting.%'
      AND p.permission_key <> 'accounting.vouchers.unpost'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: ordinary accounting permission fixture missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = '66700000-0000-0000-0000-000000000002'
      AND p.permission_key = 'accounting.vouchers.unpost'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: exact unpost permission fixture missing';
  END IF;
END;
$$;

INSERT INTO public.customers (id, org_id, code, name, is_active) VALUES
  ('66d00000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-CUST', 'Voucher 166 Customer', true);

INSERT INTO public.vendors (id, org_id, code, name, is_active) VALUES
  ('66e00000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-VEND', 'Voucher 166 Vendor', true);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance, allow_posting, is_active)
VALUES
  ('66a10000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', '110101', 'Voucher 166 Cash',
   'ASSET', 'CASH', 'DEBIT', true, true),
  ('66a10000-0000-0000-0000-000000000002',
   '66111111-1111-1111-1111-111111111111', '110102', 'Voucher 166 Bank',
   'ASSET', 'BANK', 'DEBIT', true, true),
  ('66a10000-0000-0000-0000-000000000003',
   '66111111-1111-1111-1111-111111111111', '110300', 'Voucher 166 AR',
   'ASSET', 'AR', 'DEBIT', true, true),
  ('66a10000-0000-0000-0000-000000000004',
   '66111111-1111-1111-1111-111111111111', '210100', 'Voucher 166 AP',
   'LIABILITY', 'AP', 'CREDIT', true, true);

INSERT INTO public.journals
  (id, org_id, code, name, journal_type, is_active) VALUES
  ('66f00000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-JRN',
   'Voucher 166 Journal', 'cash', true);

INSERT INTO public.accounting_periods
  (id, org_id, period_code, period_name, period_type,
   start_date, end_date, fiscal_year, status) VALUES
  ('66d10000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-2026-08',
   'Voucher 166 August 2026', 'month',
   DATE '2026-08-01', DATE '2026-08-31', 2026, 'open');

INSERT INTO public.sales_invoices
  (id, org_id, invoice_number, customer_id, invoice_date,
   subtotal, discount_amount, tax_amount, total_amount, paid_amount,
   payment_status, status)
VALUES
  ('66b10000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-SI-001',
   '66d00000-0000-0000-0000-000000000001', DATE '2026-08-05',
   1000, 0, 0, 1000, 0, 'unpaid', 'POSTED');

INSERT INTO public.supplier_invoices
  (id, org_id, invoice_number, vendor_id, invoice_date, due_date,
   subtotal, discount_amount, tax_amount, total_amount, paid_amount, status)
VALUES
  ('66b20000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-PI-001',
   '66e00000-0000-0000-0000-000000000001', DATE '2026-08-05', NULL,
   1000, 0, 0, 1000, 0, 'approved');

INSERT INTO public.customer_collections
  (id, org_id, collection_number, customer_id, collection_date,
   amount, payment_method, payment_account_id, status, created_by)
VALUES
  ('66c10000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-CR-001',
   '66d00000-0000-0000-0000-000000000001', DATE '2026-08-05',
   400, 'cash', '66a10000-0000-0000-0000-000000000001', 'draft',
   '66aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.customer_collection_lines
  (id, collection_id, invoice_id, allocated_amount, discount_amount)
VALUES
  ('66c11000-0000-0000-0000-000000000001',
   '66c10000-0000-0000-0000-000000000001',
   '66b10000-0000-0000-0000-000000000001', 400, 0);

INSERT INTO public.supplier_payments
  (id, org_id, payment_number, vendor_id, payment_date,
   amount, payment_method, payment_account_id, status, created_by)
VALUES
  ('66c20000-0000-0000-0000-000000000001',
   '66111111-1111-1111-1111-111111111111', 'V166-SP-001',
   '66e00000-0000-0000-0000-000000000001', DATE '2026-08-05',
   300, 'bank_transfer', '66a10000-0000-0000-0000-000000000002', 'draft',
   '66aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.supplier_payment_lines
  (id, payment_id, invoice_id, allocated_amount, discount_amount)
VALUES
  ('66c21000-0000-0000-0000-000000000001',
   '66c20000-0000-0000-0000-000000000001',
   '66b20000-0000-0000-0000-000000000001', 300, 0);

-- ---------------------------------------------------------------------------
-- 2. Prove the exact guard differs from the legacy module fallback.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT public.has_permission(
    '66bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '66111111-1111-1111-1111-111111111111',
    'accounting.vouchers.unpost'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: reader fixture did not demonstrate legacy accounting fallback';
  END IF;

  IF public.wardah_has_exact_permission(
    '66bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '66111111-1111-1111-1111-111111111111',
    'accounting.vouchers.unpost'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: ordinary accounting permission satisfied exact unpost guard';
  END IF;

  IF NOT public.wardah_has_exact_permission(
    '66cccccc-cccc-cccc-cccc-cccccccccccc',
    '66111111-1111-1111-1111-111111111111',
    'accounting.vouchers.unpost'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: explicitly granted corrector was rejected';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Post both vouchers through the real Migration 166 RPC bodies.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '66aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"66111111-1111-1111-1111-111111111111"}', false);

SELECT public.rpc_post_customer_receipt(
  '66c10000-0000-0000-0000-000000000001');
SELECT public.rpc_post_supplier_payment(
  '66c20000-0000-0000-0000-000000000001');

CREATE TEMP TABLE v166_entries AS
SELECT
  (SELECT gl_entry_id FROM public.customer_collections
   WHERE id='66c10000-0000-0000-0000-000000000001') AS receipt_entry_id,
  (SELECT gl_entry_id FROM public.supplier_payments
   WHERE id='66c20000-0000-0000-0000-000000000001') AS payment_entry_id;

DO $$
DECLARE
  v_receipt_entry uuid;
  v_payment_entry uuid;
BEGIN
  SELECT receipt_entry_id, payment_entry_id
  INTO v_receipt_entry, v_payment_entry
  FROM v166_entries;

  IF v_receipt_entry IS NULL OR v_payment_entry IS NULL
     OR v_receipt_entry = v_payment_entry THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: posting did not create two distinct GL identities';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id='66c10000-0000-0000-0000-000000000001'
      AND status='posted' AND gl_entry_id=v_receipt_entry
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE id='66c20000-0000-0000-0000-000000000001'
      AND status='posted' AND gl_entry_id=v_payment_entry
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: voucher post state mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id='66b10000-0000-0000-0000-000000000001'
      AND paid_amount=400 AND balance=600 AND payment_status='partially_paid'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id='66b20000-0000-0000-0000-000000000001'
      AND paid_amount=300 AND balance=700 AND status='partially_paid'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: invoice paid/generated-balance state mismatch after post';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id=v_receipt_entry AND status='posted'
      AND total_debit=400 AND total_credit=400
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id=v_payment_entry AND status='posted'
      AND total_debit=300 AND total_credit=300
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: GL headers mismatch after post';
  END IF;

  IF (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id=v_receipt_entry) <> 2
     OR (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id=v_payment_entry) <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: posted voucher GL must contain exactly two lines';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Ordinary accounting permission must not authorize unposting.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '66bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_reset_customer_receipt_to_draft(
      '66c10000-0000-0000-0000-000000000001', 'reader denied')$$,
  'VOUCHER_UNPOST_PERMISSION_REQUIRED');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_reset_supplier_payment_to_draft(
      '66c20000-0000-0000-0000-000000000001', 'reader denied')$$,
  'VOUCHER_UNPOST_PERMISSION_REQUIRED');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id='66c10000-0000-0000-0000-000000000001' AND status='posted'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE id='66c20000-0000-0000-0000-000000000001' AND status='posted'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: denied unpost changed voucher state';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Direct posted -> draft remains forbidden outside the controlled RPC.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_error(
  $$UPDATE public.gl_entries
    SET status='draft'
    WHERE id=(SELECT receipt_entry_id FROM v166_entries)$$,
  'POSTED_ENTRY_IMMUTABLE');

SELECT pg_temp.expect_error(
  $$UPDATE public.gl_entries
    SET status='draft'
    WHERE id=(SELECT payment_entry_id FROM v166_entries)$$,
  'POSTED_ENTRY_IMMUTABLE');

-- ---------------------------------------------------------------------------
-- 6. Exact corrector is still blocked while the accounting period is closed.
-- ---------------------------------------------------------------------------
UPDATE public.accounting_periods
SET status='closed'
WHERE id='66d10000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claim.sub',
                  '66cccccc-cccc-cccc-cccc-cccccccccccc', false);

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_reset_customer_receipt_to_draft(
      '66c10000-0000-0000-0000-000000000001', 'closed period')$$,
  'PERIOD_CLOSED');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_reset_supplier_payment_to_draft(
      '66c20000-0000-0000-0000-000000000001', 'closed period')$$,
  'PERIOD_CLOSED');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id=(SELECT receipt_entry_id FROM v166_entries) AND status='posted'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id=(SELECT payment_entry_id FROM v166_entries) AND status='posted'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: closed-period rejection changed GL state';
  END IF;
END;
$$;

UPDATE public.accounting_periods
SET status='open'
WHERE id='66d10000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- 7. Reset both vouchers with the explicit permission.
-- ---------------------------------------------------------------------------
SELECT public.rpc_reset_customer_receipt_to_draft(
  '66c10000-0000-0000-0000-000000000001', 'correct receipt allocation');
SELECT public.rpc_reset_supplier_payment_to_draft(
  '66c20000-0000-0000-0000-000000000001', 'correct payment allocation');

DO $$
DECLARE
  v_guc text := coalesce(current_setting('wardah.voucher_unpost', true), '');
BEGIN
  IF v_guc <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: voucher_unpost GUC leaked after RPC: [%]', v_guc;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections c, v166_entries x
    WHERE c.id='66c10000-0000-0000-0000-000000000001'
      AND c.status='draft' AND c.gl_entry_id=x.receipt_entry_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments p, v166_entries x
    WHERE p.id='66c20000-0000-0000-0000-000000000001'
      AND p.status='draft' AND p.gl_entry_id=x.payment_entry_id
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: reset did not preserve voucher GL identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries e, v166_entries x
    WHERE e.id=x.receipt_entry_id AND e.status='draft'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_entries e, v166_entries x
    WHERE e.id=x.payment_entry_id AND e.status='draft'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: reset did not move linked GL entries to draft';
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
      'ACCEPTANCE_FAIL: reset did not reverse allocations/generated balances';
  END IF;

  IF (SELECT count(*) FROM public.audit_logs
      WHERE action='voucher_reset_to_draft'
        AND entity_id IN (
          '66c10000-0000-0000-0000-000000000001',
          '66c20000-0000-0000-0000-000000000001'
        )) <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: reset audit trail missing';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Correct draft amounts and allocations, then repost.
-- ---------------------------------------------------------------------------
UPDATE public.customer_collections
SET amount=250, notes='corrected by acceptance 166'
WHERE id='66c10000-0000-0000-0000-000000000001' AND status='draft';

UPDATE public.customer_collection_lines
SET allocated_amount=250
WHERE id='66c11000-0000-0000-0000-000000000001';

UPDATE public.supplier_payments
SET amount=200, notes='corrected by acceptance 166'
WHERE id='66c20000-0000-0000-0000-000000000001' AND status='draft';

UPDATE public.supplier_payment_lines
SET allocated_amount=200
WHERE id='66c21000-0000-0000-0000-000000000001';

SELECT public.rpc_post_customer_receipt(
  '66c10000-0000-0000-0000-000000000001');
SELECT public.rpc_post_supplier_payment(
  '66c20000-0000-0000-0000-000000000001');

DO $$
DECLARE
  v_receipt_entry uuid;
  v_payment_entry uuid;
BEGIN
  SELECT receipt_entry_id, payment_entry_id
  INTO v_receipt_entry, v_payment_entry
  FROM v166_entries;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id='66c10000-0000-0000-0000-000000000001'
      AND status='posted' AND gl_entry_id=v_receipt_entry
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE id='66c20000-0000-0000-0000-000000000001'
      AND status='posted' AND gl_entry_id=v_payment_entry
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: repost created or linked a different GL identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id='66b10000-0000-0000-0000-000000000001'
      AND paid_amount=250 AND balance=750 AND payment_status='partially_paid'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id='66b20000-0000-0000-0000-000000000001'
      AND paid_amount=200 AND balance=800 AND status='partially_paid'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: corrected repost invoice/generated-balance mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id=v_receipt_entry AND status='posted'
      AND total_debit=250 AND total_credit=250
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id=v_payment_entry AND status='posted'
      AND total_debit=200 AND total_credit=200
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected repost GL header mismatch';
  END IF;

  IF (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id=v_receipt_entry) <> 2
     OR (SELECT sum(debit) FROM public.gl_entry_lines WHERE entry_id=v_receipt_entry) <> 250
     OR (SELECT sum(credit) FROM public.gl_entry_lines WHERE entry_id=v_receipt_entry) <> 250
     OR (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id=v_payment_entry) <> 2
     OR (SELECT sum(debit) FROM public.gl_entry_lines WHERE entry_id=v_payment_entry) <> 200
     OR (SELECT sum(credit) FROM public.gl_entry_lines WHERE entry_id=v_payment_entry) <> 200 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected GL lines were not rebuilt exactly';
  END IF;

  IF (SELECT count(*) FROM public.gl_entries
      WHERE idempotency_key='CUSTOMER_RECEIPT:66c10000-0000-0000-0000-000000000001') <> 1
     OR (SELECT count(*) FROM public.gl_entries
      WHERE idempotency_key='SUPPLIER_PAYMENT:66c20000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: repost duplicated voucher GL entries';
  END IF;
END;
$$;

-- Duplicate post calls remain idempotent and do not alter allocations again.
SELECT public.rpc_post_customer_receipt(
  '66c10000-0000-0000-0000-000000000001');
SELECT public.rpc_post_supplier_payment(
  '66c20000-0000-0000-0000-000000000001');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id='66b10000-0000-0000-0000-000000000001'
      AND paid_amount=250 AND balance=750
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id='66b20000-0000-0000-0000-000000000001'
      AND paid_amount=200 AND balance=800
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: duplicate post changed invoice state';
  END IF;
END;
$$;

COMMIT;

SELECT 'VOUCHER_RESET_166_ACCEPTANCE_PASS' AS result;
