-- Acceptance for Migration 168.
-- Executes the real create / edit / cancel RPCs on a fresh 166 -> 167 -> 168
-- chain and proves: atomic creation with no orphan header, the restored
-- correction step, both cancel paths, retention of GL identity and lines,
-- tenant isolation, the exact cancel permission, idempotency, and that the GL
-- cancel guard cannot be reached outside the approved RPC.
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
-- 1. Fixtures: two organizations, four users with distinct authority, and the
-- accounting map the voucher RPCs require.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'voucher168-admin@example.test'),
  ('88bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'voucher168-inactive@example.test'),
  ('88cccccc-cccc-cccc-cccc-cccccccccccc', 'voucher168-canceller@example.test'),
  ('88dddddd-dddd-dddd-dddd-dddddddddddd', 'voucher168-plain@example.test'),
  ('88eeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'voucher168-orgb@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('88111111-1111-1111-1111-111111111111', 'V168A', 'Voucher 168 Org A'),
  ('88222222-2222-2222-2222-222222222222', 'V168B', 'Voucher 168 Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, role, is_active, is_org_admin) VALUES
  ('88000000-0000-0000-0000-000000000001',
   '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '88111111-1111-1111-1111-111111111111', 'admin', true, true),
  ('88000000-0000-0000-0000-000000000002',
   '88bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '88111111-1111-1111-1111-111111111111', 'user', false, false),
  ('88000000-0000-0000-0000-000000000003',
   '88cccccc-cccc-cccc-cccc-cccccccccccc',
   '88111111-1111-1111-1111-111111111111', 'user', true, false),
  ('88000000-0000-0000-0000-000000000004',
   '88dddddd-dddd-dddd-dddd-dddddddddddd',
   '88111111-1111-1111-1111-111111111111', 'user', true, false),
  ('88000000-0000-0000-0000-000000000005',
   '88eeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '88222222-2222-2222-2222-222222222222', 'admin', true, true);

-- The canceller holds the exact cancel key; the plain member holds the unpost
-- key instead, which must not be accepted as authority to cancel.
INSERT INTO public.roles (id, org_id, name, name_ar, is_system_role, is_active) VALUES
  ('88700000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111',
   'Voucher 168 canceller', 'ملغي السندات 168', false, true),
  ('88700000-0000-0000-0000-000000000002',
   '88111111-1111-1111-1111-111111111111',
   'Voucher 168 corrector', 'مصحح السندات 168', false, true);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '88700000-0000-0000-0000-000000000001'::uuid, p.id
FROM public.permissions p WHERE p.permission_key = 'accounting.vouchers.cancel';

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '88700000-0000-0000-0000-000000000002'::uuid, p.id
FROM public.permissions p WHERE p.permission_key = 'accounting.vouchers.unpost';

INSERT INTO public.user_roles (id, user_id, role_id, org_id) VALUES
  ('88800000-0000-0000-0000-000000000001',
   '88cccccc-cccc-cccc-cccc-cccccccccccc',
   '88700000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111'),
  ('88800000-0000-0000-0000-000000000002',
   '88dddddd-dddd-dddd-dddd-dddddddddddd',
   '88700000-0000-0000-0000-000000000002',
   '88111111-1111-1111-1111-111111111111');

INSERT INTO public.customers (id, org_id, code, name, is_active) VALUES
  ('88d00000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', 'V168-CUST-A', 'Voucher 168 Customer A', true),
  ('88d00000-0000-0000-0000-000000000002',
   '88222222-2222-2222-2222-222222222222', 'V168-CUST-B', 'Voucher 168 Customer B', true);

INSERT INTO public.vendors (id, org_id, code, name, is_active) VALUES
  ('88e00000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', 'V168-VEND-A', 'Voucher 168 Vendor A', true),
  ('88e00000-0000-0000-0000-000000000002',
   '88222222-2222-2222-2222-222222222222', 'V168-VEND-B', 'Voucher 168 Vendor B', true);

INSERT INTO public.gl_accounts
  (id, org_id, code, name, category, subtype, normal_balance, allow_posting, is_active)
VALUES
  ('88a10000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', '180101', 'Voucher 168 Cash A',
   'ASSET', 'CASH', 'DEBIT', true, true),
  ('88a10000-0000-0000-0000-000000000002',
   '88111111-1111-1111-1111-111111111111', '180102', 'Voucher 168 Bank A',
   'ASSET', 'BANK', 'DEBIT', true, true),
  ('88a10000-0000-0000-0000-000000000003',
   '88111111-1111-1111-1111-111111111111', '180300', 'Voucher 168 AR A',
   'ASSET', 'AR', 'DEBIT', true, true),
  ('88a10000-0000-0000-0000-000000000004',
   '88111111-1111-1111-1111-111111111111', '280100', 'Voucher 168 AP A',
   'LIABILITY', 'AP', 'CREDIT', true, true);

INSERT INTO public.journals (id, org_id, code, name, journal_type, is_active) VALUES
  ('88f00000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', 'V168-JRN-A',
   'Voucher 168 Journal A', 'cash', true);

INSERT INTO public.accounting_periods
  (id, org_id, period_code, period_name, period_type,
   start_date, end_date, fiscal_year, status) VALUES
  ('88d10000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', 'V168-2026-08',
   'Voucher 168 August 2026', 'month',
   DATE '2026-08-01', DATE '2026-08-31', 2026, 'open');

INSERT INTO public.sales_invoices
  (id, org_id, invoice_number, customer_id, invoice_date,
   subtotal, discount_amount, tax_amount, total_amount, paid_amount,
   payment_status, status)
VALUES
  ('88b10000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', 'V168-SI-A1',
   '88d00000-0000-0000-0000-000000000001', DATE '2026-08-10',
   1000, 0, 0, 1000, 0, 'unpaid', 'POSTED'),
  ('88b10000-0000-0000-0000-000000000002',
   '88222222-2222-2222-2222-222222222222', 'V168-SI-B1',
   '88d00000-0000-0000-0000-000000000002', DATE '2026-08-10',
   1000, 0, 0, 1000, 0, 'unpaid', 'POSTED');

INSERT INTO public.supplier_invoices
  (id, org_id, invoice_number, vendor_id, invoice_date, due_date,
   subtotal, discount_amount, tax_amount, total_amount, paid_amount, status)
VALUES
  ('88b20000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111', 'V168-PI-A1',
   '88e00000-0000-0000-0000-000000000001', DATE '2026-08-10', NULL,
   1000, 0, 0, 1000, 0, 'approved'),
  ('88b20000-0000-0000-0000-000000000002',
   '88222222-2222-2222-2222-222222222222', 'V168-PI-B1',
   '88e00000-0000-0000-0000-000000000002', DATE '2026-08-10', NULL,
   1000, 0, 0, 1000, 0, 'approved');

-- ---------------------------------------------------------------------------
-- 2. Atomic creation through the RPCs, as an ordinary authenticated client.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"88111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE v168 AS
SELECT
  (public.rpc_create_customer_receipt(jsonb_build_object(
     'customer_id','88d00000-0000-0000-0000-000000000001',
     'receipt_date','2026-08-10',
     'amount', 400,
     'payment_method','cash',
     'payment_account_id','88a10000-0000-0000-0000-000000000001',
     'notes','created by acceptance 168',
     'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','88b10000-0000-0000-0000-000000000001',
        'allocated_amount',400))
   ))->>'receipt_id')::uuid AS receipt_id,
  (public.rpc_create_supplier_payment(jsonb_build_object(
     'vendor_id','88e00000-0000-0000-0000-000000000001',
     'payment_date','2026-08-10',
     'amount', 300,
     'payment_method','bank_transfer',
     'payment_account_id','88a10000-0000-0000-0000-000000000002',
     'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','88b20000-0000-0000-0000-000000000001',
        'allocated_amount',300))
   ))->>'payment_id')::uuid AS payment_id;

DO $$
DECLARE
  v_receipt uuid;
  v_payment uuid;
  v_number text;
BEGIN
  SELECT receipt_id, payment_id INTO v_receipt, v_payment FROM v168;
  IF v_receipt IS NULL OR v_payment IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: atomic creation returned no identity';
  END IF;

  SELECT collection_number INTO v_number
  FROM public.customer_collections WHERE id = v_receipt;
  IF v_number !~ '^CR-[0-9]{6}-[0-9]{5}$' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: server-side receipt number malformed: %', v_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id = v_receipt AND status = 'draft' AND gl_entry_id IS NULL
      AND amount = 400 AND created_by = '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ) OR (SELECT count(*) FROM public.customer_collection_lines
        WHERE collection_id = v_receipt) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: receipt header/lines not created atomically';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE id = v_payment AND status = 'draft' AND gl_entry_id IS NULL AND amount = 300
  ) OR (SELECT count(*) FROM public.supplier_payment_lines
        WHERE payment_id = v_payment) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: payment header/lines not created atomically';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rejected creations leave nothing behind. This is the orphan-header hole
-- the browser flow had: header inserted, line rejected, compensating delete
-- silently matching zero rows.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_customer_receipt(jsonb_build_object(
      'customer_id','88d00000-0000-0000-0000-000000000001',
      'amount',100,'payment_method','cash',
      'payment_account_id','88a10000-0000-0000-0000-000000000001',
      'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','88b10000-0000-0000-0000-000000000002','allocated_amount',100))))$$,
  'CUSTOMER_RECEIPT_ALLOCATION_CROSS_SCOPE');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_customer_receipt(jsonb_build_object(
      'customer_id','88d00000-0000-0000-0000-000000000001',
      'amount',200,'payment_method','cash',
      'payment_account_id','88a10000-0000-0000-0000-000000000001',
      'lines', jsonb_build_array(
        jsonb_build_object('invoice_id','88b10000-0000-0000-0000-000000000001','allocated_amount',100),
        jsonb_build_object('invoice_id','88b10000-0000-0000-0000-000000000001','allocated_amount',100))))$$,
  'CUSTOMER_RECEIPT_ALLOCATION_DUPLICATE_INVOICE');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_customer_receipt(jsonb_build_object(
      'customer_id','88d00000-0000-0000-0000-000000000001',
      'amount',150,'payment_method','cash',
      'payment_account_id','88a10000-0000-0000-0000-000000000001',
      'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','88b10000-0000-0000-0000-000000000001','allocated_amount',100))))$$,
  'CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_customer_receipt(jsonb_build_object(
      'customer_id','88d00000-0000-0000-0000-000000000001',
      'amount',100,'payment_method','cash',
      'payment_account_id','88a10000-0000-0000-0000-000000000001',
      'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','88b10000-0000-0000-0000-000000000001',
        'allocated_amount',100,'discount_amount',5))))$$,
  'VOUCHER_DISCOUNT_UNSUPPORTED');

SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_supplier_payment(jsonb_build_object(
      'vendor_id','88e00000-0000-0000-0000-000000000001',
      'amount',5000,'payment_method','bank_transfer',
      'payment_account_id','88a10000-0000-0000-0000-000000000002',
      'lines', jsonb_build_array(jsonb_build_object(
        'invoice_id','88b20000-0000-0000-0000-000000000001','allocated_amount',5000))))$$,
  'SUPPLIER_PAYMENT_OVER_ALLOCATION');

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.customer_collections
      WHERE org_id='88111111-1111-1111-1111-111111111111') <> 1
     OR (SELECT count(*) FROM public.supplier_payments
         WHERE org_id='88111111-1111-1111-1111-111111111111') <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: a rejected creation left an orphan voucher header';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_collection_lines l
    LEFT JOIN public.customer_collections c ON c.id = l.collection_id
    WHERE c.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_payment_lines l
    LEFT JOIN public.supplier_payments p ON p.id = l.payment_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: orphan allocation lines survived a rejected creation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Identity gates: anon, an inactive member, and a member of another
-- organization are all refused on every RPC family.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT set_config('request.jwt.claims', '{}', false);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_customer_receipt('{}'::jsonb)$$, 'permission denied');
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_cancel_customer_receipt(
      '00000000-0000-0000-0000-000000000000','anon attempt')$$, 'permission denied');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '88bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"88111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_create_customer_receipt(jsonb_build_object(
      'customer_id','88d00000-0000-0000-0000-000000000001','amount',10,
      'payment_method','cash',
      'payment_account_id','88a10000-0000-0000-0000-000000000001','lines','[]'::jsonb))$$,
  'TENANT_MEMBERSHIP_REQUIRED');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '88eeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"88222222-2222-2222-2222-222222222222"}', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_update_customer_receipt_draft(%L,'{"lines":[]}'::jsonb)$$,
         (SELECT receipt_id FROM v168)),
  'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG');
-- The organization B admin clears its own permission check, so the tenant
-- boundary — not the permission — is what must stop this call.
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_cancel_customer_receipt(%L,'cross org attempt')$$,
         (SELECT receipt_id FROM v168)),
  'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Editing a draft that was never posted.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"88111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

SELECT public.rpc_update_customer_receipt_draft(
  (SELECT receipt_id FROM v168),
  jsonb_build_object(
    'amount', 350,
    'lines', jsonb_build_array(jsonb_build_object(
      'invoice_id','88b10000-0000-0000-0000-000000000001','allocated_amount',350)))
);

SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_update_customer_receipt_draft(%L, '{"amount":100}'::jsonb)$$,
         (SELECT receipt_id FROM v168)),
  'VOUCHER_UPDATE_LINES_REQUIRED');

SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_update_customer_receipt_draft(%L,
            jsonb_build_object('customer_id','88d00000-0000-0000-0000-000000000002',
                               'lines','[]'::jsonb))$$,
         (SELECT receipt_id FROM v168)),
  'CUSTOMER_RECEIPT_PARTY_IMMUTABLE');

DO $$
DECLARE v_receipt uuid;
BEGIN
  SELECT receipt_id INTO v_receipt FROM v168;
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections WHERE id = v_receipt AND amount = 350
  ) OR (SELECT count(*) FROM public.customer_collection_lines
        WHERE collection_id = v_receipt AND allocated_amount = 350) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: draft edit did not replace the allocation set';
  END IF;
  IF coalesce(current_setting('wardah.voucher_lines_write', true), '') <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: voucher_lines_write GUC leaked after edit';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. The full corrected cycle: post -> reset -> edit -> repost, with the GL
-- identity preserved end to end.
-- ---------------------------------------------------------------------------
SELECT public.rpc_post_customer_receipt((SELECT receipt_id FROM v168));
SELECT public.rpc_post_supplier_payment((SELECT payment_id FROM v168));

CREATE TEMP TABLE v168_entries AS
SELECT
  (SELECT gl_entry_id FROM public.customer_collections
    WHERE id = (SELECT receipt_id FROM v168)) AS receipt_entry_id,
  (SELECT gl_entry_id FROM public.supplier_payments
    WHERE id = (SELECT payment_id FROM v168)) AS payment_entry_id;

-- The temp tables are owned by the authenticated role that created them; the
-- service_role sections below read this one.
GRANT SELECT ON v168_entries TO service_role;

-- A posted voucher can be neither edited nor cancelled directly.
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_update_customer_receipt_draft(%L,'{"lines":[]}'::jsonb)$$,
         (SELECT receipt_id FROM v168)),
  'CUSTOMER_RECEIPT_NOT_DRAFT');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '88cccccc-cccc-cccc-cccc-cccccccccccc', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_cancel_customer_receipt(%L,'cancel a posted voucher')$$,
         (SELECT receipt_id FROM v168)),
  'VOUCHER_CANCEL_REQUIRES_RESET');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_reset_customer_receipt_to_draft(
  (SELECT receipt_id FROM v168), 'acceptance 168 correction');
SELECT public.rpc_reset_supplier_payment_to_draft(
  (SELECT payment_id FROM v168), 'acceptance 168 correction');

SELECT public.rpc_update_customer_receipt_draft(
  (SELECT receipt_id FROM v168),
  jsonb_build_object(
    'amount', 275,
    'lines', jsonb_build_array(jsonb_build_object(
      'invoice_id','88b10000-0000-0000-0000-000000000001','allocated_amount',275)))
);

SELECT public.rpc_post_customer_receipt((SELECT receipt_id FROM v168));

DO $$
DECLARE v_entry uuid;
BEGIN
  SELECT receipt_entry_id INTO v_entry FROM v168_entries;
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections c, v168
    WHERE c.id = v168.receipt_id AND c.status='posted'
      AND c.gl_entry_id = v_entry AND c.amount = 275
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected repost lost or changed the GL identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id = v_entry AND status='posted' AND total_debit = 275 AND total_credit = 275
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected repost GL header mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id='88b10000-0000-0000-0000-000000000001'
      AND paid_amount = 275 AND balance = 725 AND payment_status='partially_paid'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected repost invoice state mismatch';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action='voucher_draft_updated'
        AND entity_id = (SELECT receipt_id::text FROM v168)) <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: draft edit audit trail incomplete';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Cancel path A: a draft that was never posted, cancelled with no GL side
-- effect at all.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE v168_spare AS
SELECT (public.rpc_create_customer_receipt(jsonb_build_object(
    'customer_id','88d00000-0000-0000-0000-000000000001',
    'amount',120,'payment_method','cash',
    'payment_account_id','88a10000-0000-0000-0000-000000000001',
    'lines', jsonb_build_array(jsonb_build_object(
      'invoice_id','88b10000-0000-0000-0000-000000000001','allocated_amount',120))
  ))->>'receipt_id')::uuid AS receipt_id;
RESET ROLE;

-- The plain member holds unpost, not cancel. unpost must not authorize cancel.
SELECT set_config('request.jwt.claim.sub',
                  '88dddddd-dddd-dddd-dddd-dddddddddddd', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_cancel_customer_receipt(%L,'unpost is not cancel')$$,
         (SELECT receipt_id FROM v168_spare)),
  'VOUCHER_CANCEL_PERMISSION_REQUIRED');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '88cccccc-cccc-cccc-cccc-cccccccccccc', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_cancel_customer_receipt(%L,'x')$$,
         (SELECT receipt_id FROM v168_spare)),
  'VOUCHER_CANCEL_REASON_REQUIRED');
SELECT public.rpc_cancel_customer_receipt(
  (SELECT receipt_id FROM v168_spare), 'duplicate voucher entered by mistake');

DO $$
DECLARE v_spare uuid;
BEGIN
  SELECT receipt_id INTO v_spare FROM v168_spare;
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE id = v_spare AND status='cancelled' AND gl_entry_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: never-posted cancel did not close the voucher';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gl_entries WHERE reference_id = v_spare
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: never-posted cancel touched the general ledger';
  END IF;
  IF (SELECT count(*) FROM public.customer_collection_lines
      WHERE collection_id = v_spare) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: cancel deleted allocation history';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action='voucher_cancelled' AND entity_id = v_spare::text
      AND changes->>'path' = 'never_posted'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: never-posted cancel audit missing';
  END IF;
END;
$$;

-- Cancelling twice is idempotent and must not write a second audit record.
SELECT public.rpc_cancel_customer_receipt(
  (SELECT receipt_id FROM v168_spare), 'duplicate voucher entered by mistake');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action='voucher_cancelled'
        AND entity_id = (SELECT receipt_id::text FROM v168_spare)) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: idempotent cancel duplicated the audit record';
  END IF;
END;
$$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8. Cancel path B: posted, reset, then cancelled. The entry is retained with
-- its number and lines; only its status moves.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_reset_supplier_payment_to_draft(
  (SELECT payment_id FROM v168), 'acceptance 168 cancel path');
RESET ROLE;

CREATE TEMP TABLE v168_payment_entry AS
SELECT e.id, e.entry_number,
       (SELECT count(*) FROM public.gl_entry_lines l WHERE l.entry_id = e.id) AS line_count
FROM public.gl_entries e, v168_entries x
WHERE e.id = x.payment_entry_id;

SELECT set_config('request.jwt.claim.sub',
                  '88cccccc-cccc-cccc-cccc-cccccccccccc', false);
SET LOCAL ROLE authenticated;
SELECT public.rpc_cancel_supplier_payment(
  (SELECT payment_id FROM v168), 'vendor withdrew the invoice');
RESET ROLE;

DO $$
DECLARE
  v_payment uuid;
  v_entry uuid;
  v_number text;
  v_lines bigint;
BEGIN
  SELECT payment_id INTO v_payment FROM v168;
  SELECT id, entry_number, line_count INTO v_entry, v_number, v_lines
  FROM v168_payment_entry;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE id = v_payment AND status='cancelled' AND gl_entry_id = v_entry
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected cancel dropped the GL identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries
    WHERE id = v_entry AND status='cancelled' AND entry_number = v_number
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: linked entry was not cancelled or lost its number';
  END IF;

  IF (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id = v_entry) <> v_lines
     OR v_lines < 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: cancel deleted GL lines (% remaining of %)',
      (SELECT count(*) FROM public.gl_entry_lines WHERE entry_id = v_entry), v_lines;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE action='voucher_cancelled' AND entity_id = v_payment::text
      AND changes->>'path' = 'corrected'
      AND (metadata->>'reset_audit_id') IS NOT NULL
      AND old_data->>'entry_number' = v_number
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: corrected cancel audit does not name the reset it closes';
  END IF;

  IF coalesce(current_setting('wardah.voucher_gl_cancel', true), '') <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: voucher_gl_cancel GUC leaked after cancel';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. The GL cancel guard is not reachable outside the approved RPC, and
-- service_role bypasses RLS so the trigger is the only thing standing there.
-- ---------------------------------------------------------------------------
SELECT public.rpc_post_customer_receipt((SELECT receipt_id FROM v168));

-- The receipt is posted again here, so its entry is posted too. Cancelling it
-- is refused with the GUC closed, and still refused with the GUC opened by
-- hand, because a posted voucher can never satisfy the eligibility conjunction.
-- That is what keeps posted -> cancelled closed in practice.
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error(
  format($$UPDATE public.gl_entries SET status='cancelled' WHERE id=%L$$,
         (SELECT receipt_entry_id FROM v168_entries)),
  'VOUCHER_GL_CANCEL_FORBIDDEN');

SELECT set_config('wardah.voucher_gl_cancel', 'on', true);
SELECT pg_temp.expect_error(
  format($$UPDATE public.gl_entries SET status='cancelled' WHERE id=%L$$,
         (SELECT receipt_entry_id FROM v168_entries)),
  'VOUCHER_GL_CANCEL_SCOPE_INVALID');
SELECT set_config('wardah.voucher_gl_cancel', 'off', true);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries e, v168_entries x
    WHERE e.id = x.receipt_entry_id AND e.status = 'posted'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: a refused cancel still changed the posted entry';
  END IF;
END;
$$;

-- A voucher-linked draft entry whose voucher never went through reset is not
-- eligible, even with the GUC opened by hand.
INSERT INTO public.gl_entries
  (id, org_id, journal_id, entry_number, entry_date, entry_type,
   reference_type, reference_id, description, status, total_debit, total_credit)
VALUES
  ('88c90000-0000-0000-0000-000000000001',
   '88111111-1111-1111-1111-111111111111',
   '88f00000-0000-0000-0000-000000000001',
   'V168-UNPROVEN', DATE '2026-08-12', 'manual',
   'CUSTOMER_RECEIPT', (SELECT receipt_id FROM v168),
   'entry not reachable through the reset path', 'draft', 10, 10);

SET LOCAL ROLE service_role;
SELECT set_config('wardah.voucher_gl_cancel', 'on', true);
SELECT pg_temp.expect_error(
  $$UPDATE public.gl_entries SET status='cancelled'
    WHERE id='88c90000-0000-0000-0000-000000000001'$$,
  'VOUCHER_GL_CANCEL_SCOPE_INVALID');
SELECT set_config('wardah.voucher_gl_cancel', 'off', true);
SELECT pg_temp.expect_error(
  $$UPDATE public.gl_entries SET status='cancelled'
    WHERE id='88c90000-0000-0000-0000-000000000001'$$,
  'VOUCHER_GL_CANCEL_FORBIDDEN');
RESET ROLE;

-- A posted entry belonging to no voucher cannot be cancelled at all.
INSERT INTO public.gl_entries
  (id, org_id, journal_id, entry_number, entry_date, entry_type,
   description, status, total_debit, total_credit)
VALUES
  ('88c90000-0000-0000-0000-000000000002',
   '88111111-1111-1111-1111-111111111111',
   '88f00000-0000-0000-0000-000000000001',
   'V168-FOREIGN', DATE '2026-08-12', 'manual',
   'entry owned by another subsystem', 'draft', 20, 20);
UPDATE public.gl_entries SET status='posted'
WHERE id='88c90000-0000-0000-0000-000000000002';

SET LOCAL ROLE service_role;
SELECT set_config('wardah.voucher_gl_cancel', 'on', true);
SELECT pg_temp.expect_error(
  $$UPDATE public.gl_entries SET status='cancelled'
    WHERE id='88c90000-0000-0000-0000-000000000002'$$,
  'POSTED_ENTRY_IMMUTABLE');
SELECT set_config('wardah.voucher_gl_cancel', 'off', true);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 10. A voucher carrying a GL identity without a trusted reset record is
-- refused by both the edit and the cancel path. gl_entry_id alone is never
-- accepted as proof that a voucher reached the correction phase.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE v168_forged AS
SELECT gen_random_uuid() AS receipt_id;
GRANT SELECT ON v168_forged TO authenticated;

INSERT INTO public.customer_collections
  (id, org_id, collection_number, customer_id, collection_date, amount,
   payment_method, payment_account_id, status, gl_entry_id, created_by)
SELECT receipt_id, '88111111-1111-1111-1111-111111111111', 'V168-FORGED',
       '88d00000-0000-0000-0000-000000000001', DATE '2026-08-12', 50,
       'cash', '88a10000-0000-0000-0000-000000000001', 'draft',
       '88c90000-0000-0000-0000-000000000001',
       '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
FROM v168_forged;

SELECT set_config('request.jwt.claim.sub',
                  '88cccccc-cccc-cccc-cccc-cccccccccccc', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_cancel_customer_receipt(%L,'forged correction state')$$,
         (SELECT receipt_id FROM v168_forged)),
  'CUSTOMER_RECEIPT_CANCEL_UNPROVEN');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  format($$SELECT public.rpc_update_customer_receipt_draft(%L,'{"lines":[]}'::jsonb)$$,
         (SELECT receipt_id FROM v168_forged)),
  'CUSTOMER_RECEIPT_CORRECTION_UNPROVEN');
RESET ROLE;

DO $$
BEGIN
  IF coalesce(current_setting('wardah.voucher_lines_write', true), '') <> 'off'
     OR coalesce(current_setting('wardah.voucher_gl_cancel', true), '') <> 'off'
     OR coalesce(current_setting('wardah.voucher_unpost', true), '') <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: an internal GUC was left open at the end of the suite';
  END IF;
END;
$$;

COMMIT;

SELECT 'VOUCHER_ATOMIC_168_ACCEPTANCE_PASS' AS result;
