-- Acceptance contract for Migration 169 (review revision 1.4).
--
-- Revision 1.4 extends the reviewed v1.3 closure contract with reverse
-- payment-status drift checks and failed-RPC write-context restoration. It runs
-- after the 168 lifecycle acceptance has committed its fixtures.
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

-- 1. Catalog closure: authenticated keeps SELECT, loses every direct write,
-- and the four temporary INSERT policies cease to exist.
DO $$
DECLARE
  v_table text;
  v_policy text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customer_collections', 'customer_collection_lines',
    'supplier_payments', 'supplier_payment_lines'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: authenticated retains direct write on %', v_table;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: authenticated lost required SELECT on %', v_table;
    END IF;
  END LOOP;

  FOREACH v_policy IN ARRAY ARRAY[
    'customer_collections_org_insert_draft',
    'supplier_payments_org_insert_draft',
    'customer_collection_lines_org_insert_new_draft',
    'supplier_payment_lines_org_insert_new_draft'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname=v_policy) THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: obsolete policy remains: %', v_policy;
    END IF;
  END LOOP;
END;
$$;

-- 2. The ordinary client cannot reconstruct either voucher path directly.
SELECT set_config('request.jwt.claim.sub',
                  '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"88111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.customer_collections
    (org_id, collection_number, customer_id, collection_date, amount,
     payment_method, payment_account_id, status, created_by)
  VALUES
    ('88111111-1111-1111-1111-111111111111', 'CR-169-DIRECT',
     '88d00000-0000-0000-0000-000000000001', DATE '2026-08-10', 1,
     'cash', '88a10000-0000-0000-0000-000000000001', 'draft',
     '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
$sql$, 'permission denied');

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.supplier_payments
    (org_id, payment_number, vendor_id, payment_date, amount,
     payment_method, payment_account_id, status, created_by)
  VALUES
    ('88111111-1111-1111-1111-111111111111', 'SP-169-DIRECT',
     '88e00000-0000-0000-0000-000000000001', DATE '2026-08-10', 1,
     'cash', '88a10000-0000-0000-0000-000000000001', 'draft',
     '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
$sql$, 'permission denied');

RESET ROLE;

-- 3. RLS-bypassing application authority still cannot mutate derived invoice
-- payment state directly. The guard error is a stable machine contract.
SET LOCAL ROLE service_role;

-- A capability GUC is deliberately client-settable. The guards must also
-- verify the trusted SECURITY DEFINER owner, so spoofing every capability as
-- service_role cannot authorize any protected write.
SELECT set_config('wardah.voucher_header_write', 'on', true);
SELECT set_config('wardah.voucher_lines_write', 'on', true);
SELECT set_config('wardah.voucher_invoice_payment_write', 'on', true);

-- Resolve real voucher headers committed by acceptance 168. Missing fixtures
-- are a setup failure, never a valid red proof for the allocation guards.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_collections
    WHERE org_id = '88111111-1111-1111-1111-111111111111'
      AND customer_id = '88d00000-0000-0000-0000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_payments
    WHERE org_id = '88111111-1111-1111-1111-111111111111'
      AND vendor_id = '88e00000-0000-0000-0000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.sales_invoices
    WHERE id = '88b10000-0000-0000-0000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id = '88b20000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FIXTURE_MISSING: acceptance 168 voucher headers are required';
  END IF;
END;
$$;

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.customer_collections
    (org_id, collection_number, customer_id, collection_date, amount,
     payment_method, payment_account_id, status, created_by)
  VALUES
    ('88111111-1111-1111-1111-111111111111', 'CR-169-SERVICE-BYPASS',
     '88d00000-0000-0000-0000-000000000001', DATE '2026-08-10', 1,
     'cash', '88a10000-0000-0000-0000-000000000001', 'draft',
     '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
$sql$, 'VOUCHER_HEADER_WRITE_FORBIDDEN');

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.supplier_payments
    (org_id, payment_number, vendor_id, payment_date, amount,
     payment_method, payment_account_id, status, created_by)
  VALUES
    ('88111111-1111-1111-1111-111111111111', 'SP-169-SERVICE-BYPASS',
     '88e00000-0000-0000-0000-000000000001', DATE '2026-08-10', 1,
     'cash', '88a10000-0000-0000-0000-000000000001', 'draft',
     '88aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
$sql$, 'VOUCHER_HEADER_WRITE_FORBIDDEN');

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.customer_collection_lines
    (collection_id, invoice_id, allocated_amount)
  VALUES
    ((SELECT id FROM public.customer_collections
      WHERE org_id = '88111111-1111-1111-1111-111111111111'
        AND customer_id = '88d00000-0000-0000-0000-000000000001'
      ORDER BY id LIMIT 1),
     '88b10000-0000-0000-0000-000000000002', 1)
$sql$, 'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN');

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.supplier_payment_lines
    (payment_id, invoice_id, allocated_amount)
  VALUES
    ((SELECT id FROM public.supplier_payments
      WHERE org_id = '88111111-1111-1111-1111-111111111111'
        AND vendor_id = '88e00000-0000-0000-0000-000000000001'
      ORDER BY id LIMIT 1),
     '88b20000-0000-0000-0000-000000000002', 1)
$sql$, 'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN');

SELECT pg_temp.expect_error($sql$
  UPDATE public.sales_invoices
  SET paid_amount = paid_amount + 1, payment_status = 'partially_paid'
  WHERE id = '88b10000-0000-0000-0000-000000000001'
$sql$, 'VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN');

SELECT pg_temp.expect_error($sql$
  UPDATE public.supplier_invoices
  SET paid_amount = paid_amount + 1, status = 'partially_paid'
  WHERE id = '88b20000-0000-0000-0000-000000000001'
$sql$, 'VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN');

-- Payment-derived supplier status is protected in both directions. Prepare the
-- otherwise-unused invoice 0002 as the migration owner, then prove service_role
-- cannot hide a paid/partially-paid state while leaving paid_amount untouched.
RESET ROLE;
UPDATE public.supplier_invoices
SET status = 'paid'
WHERE id = '88b20000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;

SELECT pg_temp.expect_error($sql$
  UPDATE public.supplier_invoices
  SET status = 'approved'
  WHERE id = '88b20000-0000-0000-0000-000000000002'
$sql$, 'VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN');

DO $
BEGIN
  IF (SELECT status FROM public.supplier_invoices
      WHERE id = '88b20000-0000-0000-0000-000000000002') IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: rejected paid status drift changed the invoice';
  END IF;
END;
$;

RESET ROLE;
UPDATE public.supplier_invoices
SET status = 'partially_paid'
WHERE id = '88b20000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;

SELECT pg_temp.expect_error($sql$
  UPDATE public.supplier_invoices
  SET status = 'approved'
  WHERE id = '88b20000-0000-0000-0000-000000000002'
$sql$, 'VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN');

DO $
BEGIN
  IF (SELECT status FROM public.supplier_invoices
      WHERE id = '88b20000-0000-0000-0000-000000000002') IS DISTINCT FROM 'partially_paid' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: rejected partially-paid status drift changed the invoice';
  END IF;
END;
$;

-- Normalize the 168 fixture to the start of the approval workflow, then prove
-- the real forward path. These writes do not mutate payment state and must
-- remain legal. Matching uses match_status and must likewise remain untouched.
UPDATE public.supplier_invoices
SET status = 'draft', match_status = NULL
WHERE id = '88b20000-0000-0000-0000-000000000001';

UPDATE public.supplier_invoices
SET status = 'submitted'
WHERE id = '88b20000-0000-0000-0000-000000000001';

UPDATE public.supplier_invoices
SET status = 'approved', match_status = 'matched'
WHERE id = '88b20000-0000-0000-0000-000000000001';

SELECT set_config('wardah.voucher_header_write', 'off', true);
SELECT set_config('wardah.voucher_lines_write', 'off', true);
SELECT set_config('wardah.voucher_invoice_payment_write', 'off', true);

RESET ROLE;

-- A failing internal RPC must not leave any trusted write capability enabled
-- for subsequent statements in the same outer transaction.
SET LOCAL ROLE authenticated;
DO $
DECLARE
  v_failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.rpc_update_customer_receipt_draft(
      '00000000-0000-0000-0000-000000000169', '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: failed-RPC fixture unexpectedly succeeded';
  END IF;

  IF coalesce(current_setting('wardah.voucher_header_write', true), 'off') <> 'off'
     OR coalesce(current_setting('wardah.voucher_lines_write', true), 'off') <> 'off'
     OR coalesce(current_setting('wardah.voucher_invoice_payment_write', true), 'off') <> 'off' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: failed RPC leaked voucher write context';
  END IF;
END;
$;
RESET ROLE;

-- 4. All ten RPC grants remain exactly available to authenticated and denied
-- to anon/service_role. Existing 166/168 behavioral suites prove execution.
DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.rpc_create_customer_receipt(jsonb)',
    'public.rpc_create_supplier_payment(jsonb)',
    'public.rpc_update_customer_receipt_draft(uuid,jsonb)',
    'public.rpc_update_supplier_payment_draft(uuid,jsonb)',
    'public.rpc_cancel_customer_receipt(uuid,text)',
    'public.rpc_cancel_supplier_payment(uuid,text)',
    'public.rpc_post_customer_receipt(uuid)',
    'public.rpc_post_supplier_payment(uuid)',
    'public.rpc_reset_customer_receipt_to_draft(uuid,text)',
    'public.rpc_reset_supplier_payment_to_draft(uuid,text)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: authenticated lost EXECUTE on %', v_signature;
    END IF;
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: forbidden role can EXECUTE %', v_signature;
    END IF;
  END LOOP;
END;
$$;

ROLLBACK;

SELECT 'VOUCHER_WRITE_CLOSURE_169_ACCEPTANCE_PASS';
