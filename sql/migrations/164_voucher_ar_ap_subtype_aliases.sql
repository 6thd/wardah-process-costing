-- =====================================================================
-- 164_voucher_ar_ap_subtype_aliases
-- =====================================================================
-- Migration 153 expected long-form control-account subtypes, while Wardah's
-- live legal chart uses the established canonical aliases AR and AP.
-- Patch only the account-resolution predicates in the two atomic posting RPCs.
-- No voucher, invoice, account, or GL data is changed by this migration.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $patch$
DECLARE
  v_receipt_oid regprocedure := to_regprocedure('public.rpc_post_customer_receipt(uuid)');
  v_payment_oid regprocedure := to_regprocedure('public.rpc_post_supplier_payment(uuid)');
  v_definition text;
  v_patched text;
BEGIN
  IF v_receipt_oid IS NULL OR v_payment_oid IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_164_POSTING_RPC_MISSING';
  END IF;

  v_definition := pg_get_functiondef(v_receipt_oid::oid);
  IF position('a.subtype = ''ACCOUNTS_RECEIVABLE''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'VOUCHER_164_RECEIPT_CONTRACT_DRIFT';
  END IF;

  v_patched := replace(
    v_definition,
    'a.subtype = ''ACCOUNTS_RECEIVABLE''',
    'a.subtype IN (''ACCOUNTS_RECEIVABLE'', ''AR'')'
  );
  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'VOUCHER_164_RECEIPT_PATCH_NOT_APPLIED';
  END IF;
  EXECUTE v_patched;

  v_definition := pg_get_functiondef(v_payment_oid::oid);
  IF position('a.subtype = ''ACCOUNTS_PAYABLE''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'VOUCHER_164_PAYMENT_CONTRACT_DRIFT';
  END IF;

  v_patched := replace(
    v_definition,
    'a.subtype = ''ACCOUNTS_PAYABLE''',
    'a.subtype IN (''ACCOUNTS_PAYABLE'', ''AP'')'
  );
  IF v_patched = v_definition THEN
    RAISE EXCEPTION 'VOUCHER_164_PAYMENT_PATCH_NOT_APPLIED';
  END IF;
  EXECUTE v_patched;
END
$patch$;

-- CREATE OR REPLACE preserves existing EXECUTE privileges, but restate the
-- intended boundary explicitly so future grant drift remains fail-closed.
REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_customer_receipt(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_supplier_payment(uuid) TO authenticated;

DO $verify$
DECLARE
  v_receipt_definition text;
  v_payment_definition text;
BEGIN
  SELECT pg_get_functiondef('public.rpc_post_customer_receipt(uuid)'::regprocedure::oid)
  INTO v_receipt_definition;

  SELECT pg_get_functiondef('public.rpc_post_supplier_payment(uuid)'::regprocedure::oid)
  INTO v_payment_definition;

  IF position('a.subtype IN (''ACCOUNTS_RECEIVABLE'', ''AR'')' IN v_receipt_definition) = 0 THEN
    RAISE EXCEPTION 'VOUCHER_164_RECEIPT_VERIFY_FAILED';
  END IF;

  IF position('a.subtype IN (''ACCOUNTS_PAYABLE'', ''AP'')' IN v_payment_definition) = 0 THEN
    RAISE EXCEPTION 'VOUCHER_164_PAYMENT_VERIFY_FAILED';
  END IF;

  IF has_function_privilege('anon', 'public.rpc_post_customer_receipt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_post_supplier_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VOUCHER_164_ANON_EXECUTE_NOT_REVOKED';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.rpc_post_customer_receipt(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_post_supplier_payment(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VOUCHER_164_AUTH_EXECUTE_MISSING';
  END IF;
END
$verify$;

COMMIT;
