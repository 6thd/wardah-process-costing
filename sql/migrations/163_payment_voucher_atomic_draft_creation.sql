-- =====================================================================
-- 163_payment_voucher_atomic_draft_creation
-- =====================================================================
-- Restores draft customer-receipt and supplier-payment creation after the
-- fail-closed financial RLS hardening. Parent financial tables remain
-- read-only to browser clients; authenticated writes pass through these
-- SECURITY DEFINER RPCs and are committed atomically with allocation lines.
-- Migrations 154-162 remain reserved for the reporting-engine programme.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.customer_collections') IS NULL
     OR to_regclass('public.customer_collection_lines') IS NULL
     OR to_regclass('public.supplier_payments') IS NULL
     OR to_regclass('public.supplier_payment_lines') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_163_SCHEMA_MISSING';
  END IF;

  IF to_regprocedure('public.get_current_tenant_id()') IS NULL
     OR to_regprocedure('public.wardah_is_org_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_163_TENANT_GUARDS_MISSING';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.rpc_create_customer_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_customer_id uuid;
  v_receipt_date date;
  v_amount numeric;
  v_payment_method text;
  v_payment_account_id uuid;
  v_check_number text;
  v_check_date date;
  v_reference_number text;
  v_notes text;
  v_lines jsonb := coalesce(p_payload -> 'lines', '[]'::jsonb);
  v_line record;
  v_line_count integer := 0;
  v_allocation_total numeric := 0;
  v_open numeric;
  v_prefix text;
  v_sequence bigint;
  v_receipt_number text;
  v_receipt_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_PAYLOAD_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;

  v_customer_id := nullif(p_payload ->> 'customer_id', '')::uuid;
  v_receipt_date := coalesce(nullif(p_payload ->> 'receipt_date', '')::date, current_date);
  v_amount := nullif(p_payload ->> 'amount', '')::numeric;
  v_payment_method := coalesce(nullif(p_payload ->> 'payment_method', ''), 'cash');
  v_payment_account_id := nullif(p_payload ->> 'payment_account_id', '')::uuid;
  v_check_number := nullif(p_payload ->> 'check_number', '');
  v_check_date := nullif(p_payload ->> 'check_date', '')::date;
  v_reference_number := nullif(p_payload ->> 'reference_number', '');
  v_notes := nullif(p_payload ->> 'notes', '');

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_CUSTOMER_REQUIRED';
  END IF;
  IF v_amount IS NULL OR round(v_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_AMOUNT_INVALID';
  END IF;
  IF v_payment_method NOT IN (
    'cash', 'bank_transfer', 'check', 'credit_card', 'debit_card',
    'online_payment', 'mobile_payment', 'other'
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_PAYMENT_METHOD_INVALID';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_LINES_MUST_BE_ARRAY';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_customer_id AND c.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_CUSTOMER_NOT_FOUND_OR_CROSS_ORG';
  END IF;

  IF v_payment_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.id = v_payment_account_id
      AND a.org_id = v_org
      AND coalesce(a.is_active, true)
      AND coalesce(a.allow_posting, true)
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_PAYMENT_ACCOUNT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_lines)
      AS x(invoice_id uuid, allocated_amount numeric, discount_amount numeric, notes text)
    GROUP BY x.invoice_id
    HAVING x.invoice_id IS NULL OR count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_DUPLICATE_OR_MISSING_INVOICE';
  END IF;

  FOR v_line IN
    SELECT x.invoice_id,
           x.allocated_amount,
           coalesce(x.discount_amount, 0) AS discount_amount,
           x.notes,
           i.org_id,
           i.customer_id,
           i.total_amount,
           coalesce(i.paid_amount, 0) AS paid_amount
    FROM jsonb_to_recordset(v_lines)
      AS x(invoice_id uuid, allocated_amount numeric, discount_amount numeric, notes text)
    LEFT JOIN public.sales_invoices i ON i.id = x.invoice_id
    ORDER BY x.invoice_id
  LOOP
    v_line_count := v_line_count + 1;

    IF v_line.invoice_id IS NULL
       OR v_line.org_id IS NULL
       OR v_line.org_id <> v_org
       OR v_line.customer_id <> v_customer_id THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_INVOICE_NOT_FOUND_OR_CROSS_SCOPE';
    END IF;
    IF v_line.allocated_amount IS NULL OR round(v_line.allocated_amount, 2) <= 0 THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_INVALID: invoice=%', v_line.invoice_id;
    END IF;
    IF round(v_line.discount_amount, 2) <> 0 THEN
      RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required';
    END IF;

    v_open := round(v_line.total_amount - v_line.paid_amount, 2);
    IF round(v_line.allocated_amount, 2) > v_open THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_line.invoice_id, v_open, v_line.allocated_amount;
    END IF;

    v_allocation_total := v_allocation_total + round(v_line.allocated_amount, 2);
  END LOOP;

  IF v_line_count > 0 AND round(v_allocation_total, 2) <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH: allocations=% receipt=%',
      v_allocation_total, v_amount;
  END IF;

  -- Serialize sequence allocation per organization/month without opening a
  -- writable sequence table or trusting a browser-generated document number.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('wardah:customer_receipt:' || v_org::text, 0)
  );
  v_prefix := 'CR-' || to_char(v_receipt_date, 'YYYYMM') || '-';

  SELECT coalesce(max((regexp_match(c.collection_number, '([0-9]+)$'))[1]::bigint), 0) + 1
  INTO v_sequence
  FROM public.customer_collections c
  WHERE c.org_id = v_org
    AND c.collection_number LIKE v_prefix || '%';

  v_receipt_number := v_prefix ||
    CASE WHEN v_sequence <= 99999
         THEN lpad(v_sequence::text, 5, '0')
         ELSE v_sequence::text
    END;

  INSERT INTO public.customer_collections (
    org_id, collection_number, customer_id, collection_date, amount,
    payment_method, payment_account_id, check_number, check_date,
    reference_number, notes, status, created_by
  ) VALUES (
    v_org, v_receipt_number, v_customer_id, v_receipt_date, round(v_amount, 2),
    v_payment_method, v_payment_account_id, v_check_number, v_check_date,
    v_reference_number, v_notes, 'draft', v_actor
  )
  RETURNING id INTO v_receipt_id;

  INSERT INTO public.customer_collection_lines (
    collection_id, invoice_id, allocated_amount, discount_amount, notes
  )
  SELECT v_receipt_id,
         x.invoice_id,
         round(x.allocated_amount, 2),
         0,
         nullif(x.notes, '')
  FROM jsonb_to_recordset(v_lines)
    AS x(invoice_id uuid, allocated_amount numeric, discount_amount numeric, notes text);

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'status', 'draft'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.rpc_create_customer_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_customer_receipt(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_receipt(jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_create_customer_receipt(jsonb) IS
  'Migration 163: atomically creates a tenant-scoped draft customer receipt and allocation lines while parent financial tables remain read-only under RLS.';

CREATE OR REPLACE FUNCTION public.rpc_create_supplier_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_vendor_id uuid;
  v_payment_date date;
  v_amount numeric;
  v_payment_method text;
  v_payment_account_id uuid;
  v_check_number text;
  v_check_date date;
  v_check_bank text;
  v_reference_number text;
  v_notes text;
  v_lines jsonb := coalesce(p_payload -> 'lines', '[]'::jsonb);
  v_line record;
  v_line_count integer := 0;
  v_allocation_total numeric := 0;
  v_open numeric;
  v_prefix text;
  v_sequence bigint;
  v_payment_number text;
  v_payment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_PAYLOAD_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;

  v_vendor_id := nullif(p_payload ->> 'vendor_id', '')::uuid;
  v_payment_date := coalesce(nullif(p_payload ->> 'payment_date', '')::date, current_date);
  v_amount := nullif(p_payload ->> 'amount', '')::numeric;
  v_payment_method := coalesce(nullif(p_payload ->> 'payment_method', ''), 'bank_transfer');
  v_payment_account_id := nullif(p_payload ->> 'payment_account_id', '')::uuid;
  v_check_number := nullif(p_payload ->> 'check_number', '');
  v_check_date := nullif(p_payload ->> 'check_date', '')::date;
  v_check_bank := nullif(p_payload ->> 'check_bank', '');
  v_reference_number := nullif(p_payload ->> 'reference_number', '');
  v_notes := nullif(p_payload ->> 'notes', '');

  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_VENDOR_REQUIRED';
  END IF;
  IF v_amount IS NULL OR round(v_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_AMOUNT_INVALID';
  END IF;
  IF v_payment_method NOT IN (
    'cash', 'bank_transfer', 'check', 'credit_card', 'debit_card',
    'online_payment', 'mobile_payment', 'other'
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_METHOD_INVALID';
  END IF;
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_LINES_MUST_BE_ARRAY';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = v_vendor_id AND v.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_VENDOR_NOT_FOUND_OR_CROSS_ORG';
  END IF;

  IF v_payment_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.id = v_payment_account_id
      AND a.org_id = v_org
      AND coalesce(a.is_active, true)
      AND coalesce(a.allow_posting, true)
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ACCOUNT_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_lines)
      AS x(invoice_id uuid, allocated_amount numeric, discount_amount numeric, notes text)
    GROUP BY x.invoice_id
    HAVING x.invoice_id IS NULL OR count(*) > 1
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_DUPLICATE_OR_MISSING_INVOICE';
  END IF;

  FOR v_line IN
    SELECT x.invoice_id,
           x.allocated_amount,
           coalesce(x.discount_amount, 0) AS discount_amount,
           x.notes,
           i.org_id,
           i.vendor_id,
           i.total_amount,
           coalesce(i.paid_amount, 0) AS paid_amount
    FROM jsonb_to_recordset(v_lines)
      AS x(invoice_id uuid, allocated_amount numeric, discount_amount numeric, notes text)
    LEFT JOIN public.supplier_invoices i ON i.id = x.invoice_id
    ORDER BY x.invoice_id
  LOOP
    v_line_count := v_line_count + 1;

    IF v_line.invoice_id IS NULL
       OR v_line.org_id IS NULL
       OR v_line.org_id <> v_org
       OR v_line.vendor_id <> v_vendor_id THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_INVOICE_NOT_FOUND_OR_CROSS_SCOPE';
    END IF;
    IF v_line.allocated_amount IS NULL OR round(v_line.allocated_amount, 2) <= 0 THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_INVALID: invoice=%', v_line.invoice_id;
    END IF;
    IF round(v_line.discount_amount, 2) <> 0 THEN
      RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required';
    END IF;

    v_open := round(v_line.total_amount - v_line.paid_amount, 2);
    IF round(v_line.allocated_amount, 2) > v_open THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_line.invoice_id, v_open, v_line.allocated_amount;
    END IF;

    v_allocation_total := v_allocation_total + round(v_line.allocated_amount, 2);
  END LOOP;

  IF v_line_count > 0 AND round(v_allocation_total, 2) <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH: allocations=% payment=%',
      v_allocation_total, v_amount;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('wardah:supplier_payment:' || v_org::text, 0)
  );
  v_prefix := 'SP-' || to_char(v_payment_date, 'YYYYMM') || '-';

  SELECT coalesce(max((regexp_match(p.payment_number, '([0-9]+)$'))[1]::bigint), 0) + 1
  INTO v_sequence
  FROM public.supplier_payments p
  WHERE p.org_id = v_org
    AND p.payment_number LIKE v_prefix || '%';

  v_payment_number := v_prefix ||
    CASE WHEN v_sequence <= 99999
         THEN lpad(v_sequence::text, 5, '0')
         ELSE v_sequence::text
    END;

  INSERT INTO public.supplier_payments (
    org_id, payment_number, vendor_id, payment_date, amount,
    payment_method, payment_account_id, check_number, check_date, check_bank,
    reference_number, notes, status, created_by
  ) VALUES (
    v_org, v_payment_number, v_vendor_id, v_payment_date, round(v_amount, 2),
    v_payment_method, v_payment_account_id, v_check_number, v_check_date, v_check_bank,
    v_reference_number, v_notes, 'draft', v_actor
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.supplier_payment_lines (
    payment_id, invoice_id, allocated_amount, discount_amount, notes
  )
  SELECT v_payment_id,
         x.invoice_id,
         round(x.allocated_amount, 2),
         0,
         nullif(x.notes, '')
  FROM jsonb_to_recordset(v_lines)
    AS x(invoice_id uuid, allocated_amount numeric, discount_amount numeric, notes text);

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_number', v_payment_number,
    'status', 'draft'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.rpc_create_supplier_payment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_supplier_payment(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_supplier_payment(jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_create_supplier_payment(jsonb) IS
  'Migration 163: atomically creates a tenant-scoped draft supplier payment and allocation lines while parent financial tables remain read-only under RLS.';

COMMIT;
