-- =====================================================================
-- 165_voucher_payment_account_method_consistency
-- =====================================================================
-- Prevent new or edited voucher drafts from pairing a payment method with an
-- incompatible legal cash/bank account. Existing historical rows are not
-- rewritten; the guard applies on future INSERT/UPDATE only.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.customer_collections') IS NULL
     OR to_regclass('public.supplier_payments') IS NULL
     OR to_regclass('public.gl_accounts') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_165_REQUIRED_TABLE_MISSING';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.wardah_validate_voucher_payment_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_subtype text;
  v_expected text[];
BEGIN
  IF NEW.org_id IS NULL OR NEW.payment_account_id IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_PAYMENT_ACCOUNT_REQUIRED';
  END IF;

  SELECT a.subtype
  INTO v_subtype
  FROM public.gl_accounts a
  WHERE a.id = NEW.payment_account_id
    AND a.org_id = NEW.org_id
    AND coalesce(a.is_active, true)
    AND coalesce(a.allow_posting, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_PAYMENT_ACCOUNT_INVALID_OR_CROSS_ORG';
  END IF;

  IF TG_TABLE_NAME = 'customer_collections' THEN
    v_expected := CASE
      WHEN NEW.payment_method IN ('cash', 'check') THEN ARRAY['CASH']::text[]
      WHEN NEW.payment_method = 'other' THEN ARRAY['CASH', 'BANK']::text[]
      ELSE ARRAY['BANK']::text[]
    END;
  ELSE
    v_expected := CASE
      WHEN NEW.payment_method = 'cash' THEN ARRAY['CASH']::text[]
      WHEN NEW.payment_method = 'other' THEN ARRAY['CASH', 'BANK']::text[]
      ELSE ARRAY['BANK']::text[]
    END;
  END IF;

  IF NOT (v_subtype = ANY(v_expected)) THEN
    RAISE EXCEPTION 'VOUCHER_PAYMENT_ACCOUNT_METHOD_MISMATCH: method=% account_subtype=% expected=%',
      NEW.payment_method, v_subtype, array_to_string(v_expected, ',');
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_validate_voucher_payment_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_validate_voucher_payment_account() FROM anon;
REVOKE ALL ON FUNCTION public.wardah_validate_voucher_payment_account() FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_validate_voucher_payment_account() FROM service_role;

DROP TRIGGER IF EXISTS trg_customer_collection_payment_account_consistency
  ON public.customer_collections;
CREATE TRIGGER trg_customer_collection_payment_account_consistency
BEFORE INSERT OR UPDATE OF org_id, payment_method, payment_account_id
ON public.customer_collections
FOR EACH ROW
EXECUTE FUNCTION public.wardah_validate_voucher_payment_account();

DROP TRIGGER IF EXISTS trg_supplier_payment_account_consistency
  ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payment_account_consistency
BEFORE INSERT OR UPDATE OF org_id, payment_method, payment_account_id
ON public.supplier_payments
FOR EACH ROW
EXECUTE FUNCTION public.wardah_validate_voucher_payment_account();

DO $verify$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_trigger t
  WHERE t.tgname IN (
      'trg_customer_collection_payment_account_consistency',
      'trg_supplier_payment_account_consistency'
    )
    AND t.tgenabled = 'O'
    AND NOT t.tgisinternal;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VOUCHER_165_TRIGGER_VERIFY_FAILED: count=%', v_count;
  END IF;

  IF has_function_privilege('anon', 'public.wardah_validate_voucher_payment_account()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_validate_voucher_payment_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VOUCHER_165_TRIGGER_FUNCTION_EXECUTE_EXPOSED';
  END IF;
END
$verify$;

COMMIT;
