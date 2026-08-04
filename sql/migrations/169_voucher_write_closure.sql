-- =====================================================================
-- 169_voucher_write_closure
-- =====================================================================
-- Withdraw the temporary browser write surface left open while the voucher
-- UI moved to the atomic lifecycle RPCs.  Protected writes now require both
-- a transaction-local capability and the trusted SECURITY DEFINER owner.
-- A client-set GUC alone is never authority.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE public.customer_collections,
           public.customer_collection_lines,
           public.supplier_payments,
           public.supplier_payment_lines,
           public.sales_invoices,
           public.supplier_invoices
IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
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
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'VOUCHER_169_REQUIRED_RPC_MISSING: %', v_signature;
    END IF;
  END LOOP;

  IF to_regprocedure('public.wardah_protect_voucher_allocation_lines()') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_169_ALLOCATION_GUARD_MISSING';
  END IF;
END
$preflight$;

-- Keep the original implementations private.  Stable public wrappers below
-- establish the dual-factor write context and preserve every RPC signature.
ALTER FUNCTION public.rpc_create_customer_receipt(jsonb)
  RENAME TO wardah_169_internal_create_customer_receipt;
ALTER FUNCTION public.rpc_create_supplier_payment(jsonb)
  RENAME TO wardah_169_internal_create_supplier_payment;
ALTER FUNCTION public.rpc_update_customer_receipt_draft(uuid,jsonb)
  RENAME TO wardah_169_internal_update_customer_receipt_draft;
ALTER FUNCTION public.rpc_update_supplier_payment_draft(uuid,jsonb)
  RENAME TO wardah_169_internal_update_supplier_payment_draft;
ALTER FUNCTION public.rpc_cancel_customer_receipt(uuid,text)
  RENAME TO wardah_169_internal_cancel_customer_receipt;
ALTER FUNCTION public.rpc_cancel_supplier_payment(uuid,text)
  RENAME TO wardah_169_internal_cancel_supplier_payment;
ALTER FUNCTION public.rpc_post_customer_receipt(uuid)
  RENAME TO wardah_169_internal_post_customer_receipt;
ALTER FUNCTION public.rpc_post_supplier_payment(uuid)
  RENAME TO wardah_169_internal_post_supplier_payment;
ALTER FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text)
  RENAME TO wardah_169_internal_reset_customer_receipt_to_draft;
ALTER FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text)
  RENAME TO wardah_169_internal_reset_supplier_payment_to_draft;

REVOKE ALL ON FUNCTION public.wardah_169_internal_create_customer_receipt(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_create_supplier_payment(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_update_customer_receipt_draft(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_update_supplier_payment_draft(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_cancel_customer_receipt(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_cancel_supplier_payment(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_post_customer_receipt(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_post_supplier_payment(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_reset_customer_receipt_to_draft(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_internal_reset_supplier_payment_to_draft(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wardah_voucher_write_is_trusted(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT current_user = pg_get_userbyid(
       (SELECT p.proowner
        FROM pg_proc p
        WHERE p.oid = 'public.wardah_voucher_write_is_trusted(text)'::regprocedure)
     )
     AND (
       coalesce(current_setting(p_capability, true), '') = 'on'
       OR session_user = current_user
     );
$function$;

REVOKE ALL ON FUNCTION public.wardah_voucher_write_is_trusted(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wardah_169_enter_write_context()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM set_config('wardah.voucher_header_write', 'on', true);
  PERFORM set_config('wardah.voucher_lines_write', 'on', true);
  PERFORM set_config('wardah.voucher_invoice_payment_write', 'on', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.wardah_169_leave_write_context()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM set_config('wardah.voucher_header_write', 'off', true);
  PERFORM set_config('wardah.voucher_lines_write', 'off', true);
  PERFORM set_config('wardah.voucher_invoice_payment_write', 'off', true);
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_169_enter_write_context() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_169_leave_write_context() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_create_customer_receipt(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_create_customer_receipt(p_payload);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_create_supplier_payment(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_create_supplier_payment(p_payload);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_update_customer_receipt_draft(p_receipt_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_update_customer_receipt_draft(p_receipt_id, p_payload);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_update_supplier_payment_draft(p_payment_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_update_supplier_payment_draft(p_payment_id, p_payload);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_cancel_customer_receipt(p_receipt_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_cancel_customer_receipt(p_receipt_id, p_reason);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_cancel_supplier_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_cancel_supplier_payment(p_payment_id, p_reason);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_post_customer_receipt(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_post_customer_receipt(p_receipt_id);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_post_supplier_payment(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_post_supplier_payment(p_payment_id);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_reset_customer_receipt_to_draft(p_receipt_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_reset_customer_receipt_to_draft(p_receipt_id, p_reason);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.rpc_reset_supplier_payment_to_draft(p_payment_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.wardah_169_enter_write_context();
  v_result := public.wardah_169_internal_reset_supplier_payment_to_draft(p_payment_id, p_reason);
  PERFORM public.wardah_169_leave_write_context();
  RETURN v_result;
END $function$;

-- Header and allocation ownership are now RPC-only, including for
-- service_role.  The trigger is defense in depth beyond table grants/RLS.
CREATE OR REPLACE FUNCTION public.wardah_protect_voucher_headers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.wardah_voucher_write_is_trusted('wardah.voucher_header_write') THEN
    RAISE EXCEPTION 'VOUCHER_HEADER_WRITE_FORBIDDEN: operation=% table=%', TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

DROP TRIGGER IF EXISTS trg_protect_customer_collections ON public.customer_collections;
CREATE TRIGGER trg_protect_customer_collections
BEFORE INSERT OR UPDATE OR DELETE ON public.customer_collections
FOR EACH ROW EXECUTE FUNCTION public.wardah_protect_voucher_headers();

DROP TRIGGER IF EXISTS trg_protect_supplier_payments ON public.supplier_payments;
CREATE TRIGGER trg_protect_supplier_payments
BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.wardah_protect_voucher_headers();

CREATE OR REPLACE FUNCTION public.wardah_protect_voucher_allocation_lines()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF NOT public.wardah_voucher_write_is_trusted('wardah.voucher_lines_write') THEN
    RAISE EXCEPTION 'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN: operation=% table=%',
      TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

CREATE OR REPLACE FUNCTION public.wardah_protect_invoice_payment_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
DECLARE v_payment_change boolean;
BEGIN
  IF TG_TABLE_NAME = 'sales_invoices' THEN
    v_payment_change := NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
      OR NEW.payment_status IS DISTINCT FROM OLD.payment_status;
  ELSE
    v_payment_change := NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('partially_paid', 'paid'));
  END IF;

  IF v_payment_change
     AND NOT public.wardah_voucher_write_is_trusted('wardah.voucher_invoice_payment_write') THEN
    RAISE EXCEPTION 'VOUCHER_DERIVED_PAYMENT_FIELDS_WRITE_FORBIDDEN: table=%', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_protect_sales_invoice_payment_fields ON public.sales_invoices;
CREATE TRIGGER trg_protect_sales_invoice_payment_fields
BEFORE UPDATE ON public.sales_invoices
FOR EACH ROW EXECUTE FUNCTION public.wardah_protect_invoice_payment_fields();

DROP TRIGGER IF EXISTS trg_protect_supplier_invoice_payment_fields ON public.supplier_invoices;
CREATE TRIGGER trg_protect_supplier_invoice_payment_fields
BEFORE UPDATE ON public.supplier_invoices
FOR EACH ROW EXECUTE FUNCTION public.wardah_protect_invoice_payment_fields();

DROP POLICY IF EXISTS customer_collections_org_insert_draft ON public.customer_collections;
DROP POLICY IF EXISTS supplier_payments_org_insert_draft ON public.supplier_payments;
DROP POLICY IF EXISTS customer_collection_lines_org_insert_new_draft ON public.customer_collection_lines;
DROP POLICY IF EXISTS supplier_payment_lines_org_insert_new_draft ON public.supplier_payment_lines;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_collections FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_collection_lines FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.supplier_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.supplier_payment_lines FROM authenticated;

GRANT SELECT ON TABLE public.customer_collections, public.customer_collection_lines,
  public.supplier_payments, public.supplier_payment_lines TO authenticated;

DO $grants$
DECLARE v_signature text;
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
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
  END LOOP;
END
$grants$;

DO $verify$
DECLARE
  v_table text;
  v_signature text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customer_collections', 'customer_collection_lines',
    'supplier_payments', 'supplier_payment_lines'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
       OR NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'VOUCHER_169_TABLE_GRANT_VERIFY_FAILED: %', v_table;
    END IF;
  END LOOP;

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
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'VOUCHER_169_RPC_GRANT_VERIFY_FAILED: %', v_signature;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_trigger
      WHERE tgname IN ('trg_protect_customer_collections',
                       'trg_protect_supplier_payments',
                       'trg_protect_customer_collection_lines',
                       'trg_protect_supplier_payment_lines',
                       'trg_protect_sales_invoice_payment_fields',
                       'trg_protect_supplier_invoice_payment_fields')
        AND NOT tgisinternal) <> 6 THEN
    RAISE EXCEPTION 'VOUCHER_169_TRIGGER_VERIFY_FAILED';
  END IF;
END
$verify$;

COMMIT;
