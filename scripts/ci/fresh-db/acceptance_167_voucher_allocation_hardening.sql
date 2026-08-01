-- Acceptance for Migration 167.
-- Proves the legacy draft creation flow remains usable while direct mutation,
-- inactive membership, anon access, cross-org allocation, NULL invoice links,
-- and service-role bypass attempts are rejected. Also proves enriched reset
-- audit evidence on the real Migration 166 RPCs.
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
-- 1. Fixtures: two organizations, active/inactive users, exact unpost role,
-- accounting accounts, invoices and brand-new draft vouchers.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'voucher167-admin@example.test'),
  ('77bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'voucher167-inactive@example.test'),
  ('77cccccc-cccc-cccc-cccc-cccccccccccc', 'voucher167-orgb@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('77111111-1111-1111-1111-111111111111', 'V167A', 'Voucher 167 Org A'),
  ('77222222-2222-2222-2222-222222222222', 'V167B', 'Voucher 167 Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, role, is_active, is_org_admin) VALUES
  ('77000000-0000-0000-0000-000000000001',
   '77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '77111111-1111-1111-1111-111111111111', 'admin', true, true),
  ('77000000-0000-0000-0000-000000000002',
   '77bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '77111111-1111-1111-1111-111111111111', 'user', false, false),
  ('77000000-0000-0000-0000-000000000003',
   '77cccccc-cccc-cccc-cccc-cccccccccccc',
   '77222222-2222-2222-2222-222222222222', 'admin', true, true);

INSERT INTO public.customers (id, org_id, code, name, is_active) VALUES
  ('77d00000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-CUST-A', 'Voucher 167 Customer A', true),
  ('77d00000-0000-0000-0000-000000000002',
   '77222222-2222-2222-2222-222222222222', 'V167-CUST-B', 'Voucher 167 Customer B', true);

INSERT INTO public.vendors (id, org_id, code, name, is_active) VALUES
  ('77e00000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-VEND-A', 'Voucher 167 Vendor A', true),
  ('77e00000-0000-0000-0000-000000000002',
   '77222222-2222-2222-2222-222222222222', 'V167-VEND-B', 'Voucher 167 Vendor B', true);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance, allow_posting, is_active)
VALUES
  ('77a10000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', '170101', 'Voucher 167 Cash A',
   'ASSET', 'CASH', 'DEBIT', true, true),
  ('77a10000-0000-0000-0000-000000000002',
   '77111111-1111-1111-1111-111111111111', '170102', 'Voucher 167 Bank A',
   'ASSET', 'BANK', 'DEBIT', true, true),
  ('77a10000-0000-0000-0000-000000000003',
   '77111111-1111-1111-1111-111111111111', '170300', 'Voucher 167 AR A',
   'ASSET', 'AR', 'DEBIT', true, true),
  ('77a10000-0000-0000-0000-000000000004',
   '77111111-1111-1111-1111-111111111111', '270100', 'Voucher 167 AP A',
   'LIABILITY', 'AP', 'CREDIT', true, true);

INSERT INTO public.journals
  (id, org_id, code, name, journal_type, is_active) VALUES
  ('77f00000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-JRN-A',
   'Voucher 167 Journal A', 'cash', true);

INSERT INTO public.accounting_periods
  (id, org_id, period_code, period_name, period_type,
   start_date, end_date, fiscal_year, status) VALUES
  ('77d10000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-2026-08',
   'Voucher 167 August 2026', 'month',
   DATE '2026-08-01', DATE '2026-08-31', 2026, 'open');

INSERT INTO public.sales_invoices
  (id, org_id, invoice_number, customer_id, invoice_date,
   subtotal, discount_amount, tax_amount, total_amount, paid_amount,
   payment_status, status)
VALUES
  ('77b10000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-SI-A1',
   '77d00000-0000-0000-0000-000000000001', DATE '2026-08-06',
   1000, 0, 0, 1000, 0, 'unpaid', 'POSTED'),
  ('77b10000-0000-0000-0000-000000000002',
   '77222222-2222-2222-2222-222222222222', 'V167-SI-B1',
   '77d00000-0000-0000-0000-000000000002', DATE '2026-08-06',
   1000, 0, 0, 1000, 0, 'unpaid', 'POSTED');

INSERT INTO public.supplier_invoices
  (id, org_id, invoice_number, vendor_id, invoice_date, due_date,
   subtotal, discount_amount, tax_amount, total_amount, paid_amount, status)
VALUES
  ('77b20000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-PI-A1',
   '77e00000-0000-0000-0000-000000000001', DATE '2026-08-06', NULL,
   1000, 0, 0, 1000, 0, 'approved'),
  ('77b20000-0000-0000-0000-000000000002',
   '77222222-2222-2222-2222-222222222222', 'V167-PI-B1',
   '77e00000-0000-0000-0000-000000000002', DATE '2026-08-06', NULL,
   1000, 0, 0, 1000, 0, 'approved');

INSERT INTO public.customer_collections
  (id, org_id, collection_number, customer_id, collection_date,
   amount, payment_method, payment_account_id, status, created_by)
VALUES
  ('77c10000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-CR-A1',
   '77d00000-0000-0000-0000-000000000001', DATE '2026-08-06',
   400, 'cash', '77a10000-0000-0000-0000-000000000001', 'draft',
   '77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.supplier_payments
  (id, org_id, payment_number, vendor_id, payment_date,
   amount, payment_method, payment_account_id, status, created_by)
VALUES
  ('77c20000-0000-0000-0000-000000000001',
   '77111111-1111-1111-1111-111111111111', 'V167-SP-A1',
   '77e00000-0000-0000-0000-000000000001', DATE '2026-08-06',
   300, 'bank_transfer', '77a10000-0000-0000-0000-000000000002', 'draft',
   '77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ---------------------------------------------------------------------------
-- 2. Current UI creation path remains valid for active authenticated users.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"77111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

INSERT INTO public.customer_collection_lines
  (id, collection_id, invoice_id, allocated_amount, discount_amount)
VALUES
  ('77c11000-0000-0000-0000-000000000001',
   '77c10000-0000-0000-0000-000000000001',
   '77b10000-0000-0000-0000-000000000001', 400, 0);

INSERT INTO public.supplier_payment_lines
  (id, payment_id, invoice_id, allocated_amount, discount_amount)
VALUES
  ('77c21000-0000-0000-0000-000000000001',
   '77c20000-0000-0000-0000-000000000001',
   '77b20000-0000-0000-0000-000000000001', 300, 0);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.customer_collection_lines
      WHERE collection_id='77c10000-0000-0000-0000-000000000001') <> 1
     OR (SELECT count(*) FROM public.supplier_payment_lines
         WHERE payment_id='77c20000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: active draft line creation failed';
  END IF;
END;
$$;

-- No direct update/delete privileges remain.
SELECT pg_temp.expect_error(
  $$UPDATE public.customer_collection_lines
    SET allocated_amount=399
    WHERE id='77c11000-0000-0000-0000-000000000001'$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$DELETE FROM public.customer_collection_lines
    WHERE id='77c11000-0000-0000-0000-000000000001'$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$UPDATE public.supplier_payment_lines
    SET allocated_amount=299
    WHERE id='77c21000-0000-0000-0000-000000000001'$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$DELETE FROM public.supplier_payment_lines
    WHERE id='77c21000-0000-0000-0000-000000000001'$$,
  'permission denied');

-- NULL invoice IDs are rejected explicitly by the allocation trigger, while
-- NOT NULL remains the storage-level invariant behind it.
SELECT pg_temp.expect_error(
  $$INSERT INTO public.customer_collection_lines
      (collection_id,invoice_id,allocated_amount)
    VALUES ('77c10000-0000-0000-0000-000000000001',NULL,1)$$,
  'CUSTOMER_ALLOCATION_INSERT_SCOPE_INVALID');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.supplier_payment_lines
      (payment_id,invoice_id,allocated_amount)
    VALUES ('77c20000-0000-0000-0000-000000000001',NULL,1)$$,
  'SUPPLIER_ALLOCATION_INSERT_SCOPE_INVALID');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.customer_collection_lines
      (collection_id,invoice_id,allocated_amount)
    VALUES ('77c10000-0000-0000-0000-000000000001',
            '77b10000-0000-0000-0000-000000000002',1)$$,
  'CUSTOMER_ALLOCATION_INSERT_SCOPE_INVALID');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.supplier_payment_lines
      (payment_id,invoice_id,allocated_amount)
    VALUES ('77c20000-0000-0000-0000-000000000001',
            '77b20000-0000-0000-0000-000000000002',1)$$,
  'SUPPLIER_ALLOCATION_INSERT_SCOPE_INVALID');

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. Inactive membership and anon have no usable line access.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '77bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"77111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.customer_collection_lines) <> 0
     OR (SELECT count(*) FROM public.supplier_payment_lines) <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: inactive member could read allocation lines';
  END IF;
END;
$$;

SELECT pg_temp.expect_error(
  $$INSERT INTO public.customer_collection_lines
      (collection_id,invoice_id,allocated_amount)
    VALUES ('77c10000-0000-0000-0000-000000000001',
            '77b10000-0000-0000-0000-000000000001',1)$$,
  'CUSTOMER_ALLOCATION_INSERT_SCOPE_INVALID');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','', false);
SELECT set_config('request.jwt.claims','{}', false);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error(
  $$SELECT * FROM public.customer_collection_lines$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.supplier_payment_lines
      (payment_id,invoice_id,allocated_amount)
    VALUES ('77c20000-0000-0000-0000-000000000001',
            '77b20000-0000-0000-0000-000000000001',1)$$,
  'permission denied');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. Post through real RPCs, then prove direct mutations remain blocked.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '77aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"77111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_post_customer_receipt(
  '77c10000-0000-0000-0000-000000000001');
SELECT public.rpc_post_supplier_payment(
  '77c20000-0000-0000-0000-000000000001');
RESET ROLE;

-- service_role bypasses RLS and retains table privileges, so the trigger must
-- be the only effective guard when the internal GUC is off.
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error(
  $$UPDATE public.customer_collection_lines
    SET allocated_amount=398
    WHERE id='77c11000-0000-0000-0000-000000000001'$$,
  'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN');
SELECT pg_temp.expect_error(
  $$DELETE FROM public.supplier_payment_lines
    WHERE id='77c21000-0000-0000-0000-000000000001'$$,
  'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Reset through real RPCs, verify enriched immutable audit evidence, then
-- prove corrected drafts cannot receive direct client line inserts.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT public.rpc_reset_customer_receipt_to_draft(
  '77c10000-0000-0000-0000-000000000001', 'acceptance 167 receipt');
SELECT public.rpc_reset_supplier_payment_to_draft(
  '77c20000-0000-0000-0000-000000000001', 'acceptance 167 payment');
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action='voucher_reset_to_draft'
      AND entity_id='77c10000-0000-0000-0000-000000000001'
      AND old_data ? 'entry_number'
      AND old_data ? 'gl_posted_at'
      AND old_data ? 'allocations'
      AND jsonb_array_length(old_data->'allocations')=1
      AND metadata->>'audit_contract'='167'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action='voucher_reset_to_draft'
      AND entity_id='77c20000-0000-0000-0000-000000000001'
      AND old_data ? 'entry_number'
      AND old_data ? 'gl_posted_at'
      AND old_data ? 'allocations'
      AND jsonb_array_length(old_data->'allocations')=1
      AND metadata->>'audit_contract'='167'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: enriched reset audit evidence missing';
  END IF;

  IF coalesce(current_setting('wardah.voucher_unpost',true),'') <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: voucher_unpost GUC leaked';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$INSERT INTO public.customer_collection_lines
      (collection_id,invoice_id,allocated_amount)
    VALUES ('77c10000-0000-0000-0000-000000000001',
            '77b10000-0000-0000-0000-000000000001',1)$$,
  'CUSTOMER_ALLOCATION_INSERT_SCOPE_INVALID');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.supplier_payment_lines
      (payment_id,invoice_id,allocated_amount)
    VALUES ('77c20000-0000-0000-0000-000000000001',
            '77b20000-0000-0000-0000-000000000001',1)$$,
  'SUPPLIER_ALLOCATION_INSERT_SCOPE_INVALID');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. Future RPC contract: internal local GUC permits a complete mutation and
-- can be turned off immediately. This does not grant clients any capability.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT set_config('wardah.voucher_lines_write','on',true);
UPDATE public.customer_collection_lines
SET notes='internal acceptance update'
WHERE id='77c11000-0000-0000-0000-000000000001';
SELECT set_config('wardah.voucher_lines_write','off',true);
RESET ROLE;

DO $$
BEGIN
  IF coalesce(current_setting('wardah.voucher_lines_write',true),'') <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: voucher_lines_write GUC leaked';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collection_lines
    WHERE id='77c11000-0000-0000-0000-000000000001'
      AND notes='internal acceptance update'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: internal GUC contract did not permit mutation';
  END IF;
END;
$$;

COMMIT;

SELECT 'VOUCHER_ALLOCATION_167_ACCEPTANCE_PASS' AS result;
