\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL expected [%], got [%]', p_needle, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL expected error [%] but statement succeeded', p_needle;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '53f00000-0000-0000-0000-000000000001', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claims', '{"sub":"53f00000-0000-0000-0000-000000000001","role":"authenticated","org_id":"53111111-1111-1111-1111-111111111111"}', false);

SELECT public.rpc_post_customer_receipt('53r00000-0000-0000-0000-000000000001');
SELECT public.rpc_post_supplier_payment('53s00000-0000-0000-0000-000000000001');

DO $$
DECLARE v_count bigint; v_receipt_entry uuid; v_payment_entry uuid;
BEGIN
  SELECT gl_entry_id INTO v_receipt_entry FROM public.customer_collections WHERE id='53r00000-0000-0000-0000-000000000001';
  SELECT gl_entry_id INTO v_payment_entry FROM public.supplier_payments WHERE id='53s00000-0000-0000-0000-000000000001';
  IF v_receipt_entry IS NULL OR v_payment_entry IS NULL THEN RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL missing GL links'; END IF;
  IF (SELECT status FROM public.customer_collections WHERE id='53r00000-0000-0000-0000-000000000001') <> 'posted'
     OR (SELECT paid_amount FROM public.sales_invoices WHERE id='53i00000-0000-0000-0000-000000000001') <> 100
     OR (SELECT payment_status FROM public.sales_invoices WHERE id='53i00000-0000-0000-0000-000000000001') <> 'paid' THEN
    RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL customer state';
  END IF;
  IF (SELECT status FROM public.supplier_payments WHERE id='53s00000-0000-0000-0000-000000000001') <> 'posted'
     OR (SELECT paid_amount FROM public.supplier_invoices WHERE id='53p00000-0000-0000-0000-000000000001') <> 120
     OR (SELECT status FROM public.supplier_invoices WHERE id='53p00000-0000-0000-0000-000000000001') <> 'paid' THEN
    RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL supplier state';
  END IF;
  SELECT count(*) INTO v_count FROM public.gl_entries WHERE id IN (v_receipt_entry,v_payment_entry) AND status='posted';
  IF v_count <> 2 THEN RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL GL headers=%', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.gl_entry_lines
  WHERE entry_id IN (v_receipt_entry,v_payment_entry)
    AND account_id IS NOT NULL AND ((debit>0 AND credit=0) OR (credit>0 AND debit=0))
    AND debit_amount=debit AND credit_amount=credit AND tenant_id=org_id;
  IF v_count <> 4 THEN RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL legal lines=%', v_count; END IF;
END $$;

-- Retry is idempotent: no duplicate GL and no doubled invoice paid amount.
SELECT public.rpc_post_customer_receipt('53r00000-0000-0000-0000-000000000001');
SELECT public.rpc_post_supplier_payment('53s00000-0000-0000-0000-000000000001');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.gl_entries WHERE idempotency_key IN (
      'CUSTOMER_RECEIPT:53r00000-0000-0000-0000-000000000001',
      'SUPPLIER_PAYMENT:53s00000-0000-0000-0000-000000000001')) <> 2
     OR (SELECT paid_amount FROM public.sales_invoices WHERE id='53i00000-0000-0000-0000-000000000001') <> 100
     OR (SELECT paid_amount FROM public.supplier_invoices WHERE id='53p00000-0000-0000-0000-000000000001') <> 120 THEN
    RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL idempotency';
  END IF;
END $$;

-- Over-allocation rolls back voucher, invoice and GL together.
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_post_customer_receipt('53r00000-0000-0000-0000-000000000002')$$,
  'CUSTOMER_RECEIPT_OVER_ALLOCATION');
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_post_supplier_payment('53s00000-0000-0000-0000-000000000002')$$,
  'SUPPLIER_PAYMENT_OVER_ALLOCATION');
DO $$
BEGIN
  IF (SELECT status FROM public.customer_collections WHERE id='53r00000-0000-0000-0000-000000000002') <> 'draft'
     OR (SELECT paid_amount FROM public.sales_invoices WHERE id='53i00000-0000-0000-0000-000000000002') <> 0
     OR EXISTS (SELECT 1 FROM public.gl_entries WHERE idempotency_key='CUSTOMER_RECEIPT:53r00000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL customer rollback';
  END IF;
  IF (SELECT status FROM public.supplier_payments WHERE id='53s00000-0000-0000-0000-000000000002') <> 'draft'
     OR (SELECT paid_amount FROM public.supplier_invoices WHERE id='53p00000-0000-0000-0000-000000000002') <> 0
     OR EXISTS (SELECT 1 FROM public.gl_entries WHERE idempotency_key='SUPPLIER_PAYMENT:53s00000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL supplier rollback';
  END IF;
END $$;

-- Current tenant cannot post another organization's voucher.
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_post_customer_receipt('53r00000-0000-0000-0000-000000000003')$$,
  'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG');
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_post_supplier_payment('53s00000-0000-0000-0000-000000000003')$$,
  'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG');

RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon','public.rpc_post_customer_receipt(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.rpc_post_supplier_payment(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ATOMIC_VOUCHER_FAIL function grants';
  END IF;
END $$;

SELECT 'ACCEPTANCE_153_ATOMIC_VOUCHERS_PASS' AS result;
