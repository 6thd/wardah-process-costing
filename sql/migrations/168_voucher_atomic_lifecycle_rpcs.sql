-- =====================================================================
-- 168_voucher_atomic_lifecycle_rpcs
-- =====================================================================
-- Atomic create, edit and cancel for customer receipts and supplier payments.
--
-- Migration 167 closed the direct write paths on allocation lines and left the
-- `corrected` step of the Migration 166 cycle without any client path. This
-- migration restores it through SECURITY DEFINER RPCs that own the whole
-- operation in one transaction, and adds the cancel path that ends a voucher's
-- life without deleting accounting history.
--
-- Cancel is a different accounting event from reset, so it gets its own
-- permission (accounting.vouchers.cancel), its own transaction-local GUC
-- (wardah.voucher_gl_cancel), and its own guard inside
-- protect_posted_gl_entries. Neither is derived from the unpost contract.
--
-- Direct client INSERT on allocation lines stays open here on purpose. It is
-- withdrawn in Migration 169, after the UI moves onto these RPCs.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.customer_collections') IS NULL
     OR to_regclass('public.customer_collection_lines') IS NULL
     OR to_regclass('public.supplier_payments') IS NULL
     OR to_regclass('public.supplier_payment_lines') IS NULL
     OR to_regclass('public.sales_invoices') IS NULL
     OR to_regclass('public.supplier_invoices') IS NULL
     OR to_regclass('public.gl_entries') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_168_REQUIRED_OBJECT_MISSING';
  END IF;

  IF to_regprocedure('public.wardah_has_exact_permission(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public.wardah_is_org_member(uuid)') IS NULL
     OR to_regprocedure('public.get_current_tenant_id()') IS NULL
     OR to_regprocedure('public.wardah_protect_voucher_allocation_lines()') IS NULL
     OR to_regprocedure('public.rpc_reset_customer_receipt_to_draft(uuid,text)') IS NULL
     OR to_regprocedure('public.rpc_reset_supplier_payment_to_draft(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_168_REQUIRED_FUNCTION_MISSING';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. Cancel is its own sensitive permission. unpost returns a voucher for
-- correction and keeps it repostable; cancel ends its cycle. Neither implies
-- the other, and this key is not granted to any role by this migration.
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (
  module_id, resource, resource_ar, action, action_ar,
  permission_key, description, description_ar
)
SELECT
  m.id,
  'vouchers',
  'السندات المالية',
  'cancel',
  'إلغاء',
  'accounting.vouchers.cancel',
  'Cancel a payment voucher and, for a corrected voucher, its retained GL entry.',
  'إلغاء سند مالي، ومعه قيده المحفوظ إن كان السند قد أُعيد للتصحيح.'
FROM public.modules m
WHERE m.name = 'accounting'
ON CONFLICT (permission_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Close the cancel path on GL entries.
--
-- protect_posted_gl_entries refused posted -> draft but said nothing about
-- posted -> cancelled, so cancelling was an unguarded way around
-- POSTED_ENTRY_IMMUTABLE the moment any UPDATE path opened. Every transition
-- into 'cancelled' on a voucher-linked entry now requires all of:
--
--   * the dedicated transaction-local GUC;
--   * a voucher that exists in the same organization;
--   * a voucher whose gl_entry_id still points at this exact entry;
--   * a voucher still in draft, i.e. inside the correction cycle;
--   * a trusted Migration 166 reset record for that voucher.
--
-- The last condition is the reason gl_entry_id alone is never taken as proof
-- that a voucher went through reset. A posted voucher cannot satisfy the draft
-- condition, so posted -> cancelled stays closed in practice.
--
-- Cancelling a posted entry that belongs to any other subsystem is refused
-- outright; no such path exists today and none may appear by accident.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_posted_gl_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_controlled_unpost boolean :=
    coalesce(current_setting('wardah.voucher_unpost', true), '') = 'on';
  v_controlled_cancel boolean :=
    coalesce(current_setting('wardah.voucher_gl_cancel', true), '') = 'on';
  v_voucher_eligible boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن حذف قيد مرحّل (%) — استخدم العكس', OLD.entry_number;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF OLD.reference_type IN ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT')
       AND OLD.reference_id IS NOT NULL THEN
      IF NOT v_controlled_cancel THEN
        RAISE EXCEPTION
          'VOUCHER_GL_CANCEL_FORBIDDEN: لا يمكن إلغاء قيد سند (%) خارج RPC الإلغاء المعتمد',
          OLD.entry_number;
      END IF;

      IF OLD.reference_type = 'CUSTOMER_RECEIPT' THEN
        SELECT EXISTS (
          SELECT 1
          FROM public.customer_collections c
          WHERE c.id = OLD.reference_id
            AND c.org_id = OLD.org_id
            AND c.gl_entry_id = OLD.id
            AND c.status = 'draft'
            AND EXISTS (
              SELECT 1
              FROM public.audit_logs a
              WHERE a.org_id = OLD.org_id
                AND a.action = 'voucher_reset_to_draft'
                AND a.entity_type = 'customer_receipt'
                AND a.entity_id = c.id::text
            )
        ) INTO v_voucher_eligible;
      ELSE
        SELECT EXISTS (
          SELECT 1
          FROM public.supplier_payments p
          WHERE p.id = OLD.reference_id
            AND p.org_id = OLD.org_id
            AND p.gl_entry_id = OLD.id
            AND p.status = 'draft'
            AND EXISTS (
              SELECT 1
              FROM public.audit_logs a
              WHERE a.org_id = OLD.org_id
                AND a.action = 'voucher_reset_to_draft'
                AND a.entity_type = 'supplier_payment'
                AND a.entity_id = p.id::text
            )
        ) INTO v_voucher_eligible;
      END IF;

      IF NOT v_voucher_eligible THEN
        RAISE EXCEPTION
          'VOUCHER_GL_CANCEL_SCOPE_INVALID: القيد (%) لا يطابق سندًا مؤهلًا لمسار الإلغاء',
          OLD.entry_number;
      END IF;
    ELSIF OLD.status = 'posted' THEN
      RAISE EXCEPTION
        'POSTED_ENTRY_IMMUTABLE: لا يمكن إلغاء قيد مرحّل (%) — استخدم العكس', OLD.entry_number;
    END IF;
  END IF;

  IF OLD.status IN ('posted', 'reversed') THEN
    IF NEW.entry_date IS DISTINCT FROM OLD.entry_date
       OR NEW.total_debit IS DISTINCT FROM OLD.total_debit
       OR NEW.total_credit IS DISTINCT FROM OLD.total_credit
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id THEN
      RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن تعديل الحقول المالية لقيد مرحّل (%) — استخدم العكس', OLD.entry_number;
    END IF;

    IF OLD.status = 'posted' AND NEW.status = 'draft' THEN
      IF NOT v_controlled_unpost
         OR OLD.reference_type NOT IN ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT')
         OR OLD.reference_id IS NULL THEN
        RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن إرجاع قيد مرحّل إلى مسودة (%)', OLD.entry_number;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

-- ---------------------------------------------------------------------
-- 3. Voucher numbering. The browser used to read the current maximum and add
-- one, which two concurrent creations resolve to the same number. The
-- allocation is serialized per organization, kind and period for the rest of
-- the transaction, and the unique constraint remains the final arbiter.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_next_voucher_number(
  p_org uuid,
  p_kind text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_prefix text;
  v_period text := to_char(current_date, 'YYYYMM');
  v_stem text;
  v_seq integer;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_NUMBER_SCOPE_REQUIRED';
  END IF;

  IF p_kind = 'CUSTOMER_RECEIPT' THEN
    v_prefix := 'CR-';
  ELSIF p_kind = 'SUPPLIER_PAYMENT' THEN
    v_prefix := 'SP-';
  ELSE
    RAISE EXCEPTION 'VOUCHER_NUMBER_KIND_INVALID: %', p_kind;
  END IF;

  v_stem := v_prefix || v_period || '-';
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text || ':' || p_kind || ':' || v_period));

  IF p_kind = 'CUSTOMER_RECEIPT' THEN
    SELECT coalesce(max(substr(c.collection_number, length(v_stem) + 1)::integer), 0)
    INTO v_seq
    FROM public.customer_collections c
    WHERE c.org_id = p_org
      AND c.collection_number ~ ('^' || v_stem || '[0-9]+$');
  ELSE
    SELECT coalesce(max(substr(p.payment_number, length(v_stem) + 1)::integer), 0)
    INTO v_seq
    FROM public.supplier_payments p
    WHERE p.org_id = p_org
      AND p.payment_number ~ ('^' || v_stem || '[0-9]+$');
  END IF;

  RETURN v_stem || lpad((v_seq + 1)::text, 5, '0');
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_next_voucher_number(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_next_voucher_number(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_next_voucher_number(uuid,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_next_voucher_number(uuid,text) FROM service_role;

-- ---------------------------------------------------------------------
-- 4. Atomic creation. Header and lines land in one transaction, so a rejected
-- line can no longer leave an orphan header behind a silent compensating
-- delete.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_customer_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_receipt_id uuid := gen_random_uuid();
  v_number text;
  v_customer uuid;
  v_date date;
  v_amount numeric;
  v_method text;
  v_account uuid;
  v_line jsonb;
  v_invoice_id uuid;
  v_allocated numeric;
  v_discount numeric;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_total numeric := 0;
  v_count integer := 0;
  v_open numeric;
  v_invoice record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;

  v_customer := nullif(p_payload->>'customer_id', '')::uuid;
  v_date := coalesce(nullif(p_payload->>'receipt_date', '')::date, current_date);
  v_amount := round(coalesce(nullif(p_payload->>'amount', '')::numeric, 0), 2);
  v_method := coalesce(nullif(p_payload->>'payment_method', ''), 'cash');
  v_account := nullif(p_payload->>'payment_account_id', '')::uuid;

  IF v_customer IS NULL THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_CUSTOMER_REQUIRED'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'VOUCHER_AMOUNT_INVALID: amount must be positive'; END IF;
  IF v_account IS NULL THEN RAISE EXCEPTION 'VOUCHER_PAYMENT_ACCOUNT_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = v_customer AND c.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_CUSTOMER_CROSS_ORG';
  END IF;

  v_number := public.wardah_next_voucher_number(v_org, 'CUSTOMER_RECEIPT');

  INSERT INTO public.customer_collections (
    id, org_id, collection_number, customer_id, collection_date, amount,
    payment_method, payment_account_id, check_number, check_date,
    reference_number, notes, status, created_by
  ) VALUES (
    v_receipt_id, v_org, v_number, v_customer, v_date, v_amount,
    v_method, v_account,
    nullif(p_payload->>'check_number', ''),
    nullif(p_payload->>'check_date', '')::date,
    nullif(p_payload->>'reference_number', ''),
    nullif(p_payload->>'notes', ''),
    'draft', v_actor
  );

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_invoice_id := nullif(v_line->>'invoice_id', '')::uuid;
    v_allocated := round(coalesce(nullif(v_line->>'allocated_amount', '')::numeric, 0), 2);
    v_discount := round(coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0), 2);

    IF v_invoice_id IS NULL THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_INVOICE_REQUIRED';
    END IF;
    IF v_allocated <= 0 THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_AMOUNT_INVALID: invoice=%', v_invoice_id;
    END IF;
    IF v_discount <> 0 THEN
      RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required';
    END IF;
    IF v_invoice_id = ANY (v_seen) THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_DUPLICATE_INVOICE: invoice=%', v_invoice_id;
    END IF;
    v_seen := v_seen || v_invoice_id;

    SELECT i.total_amount, coalesce(i.paid_amount, 0) AS paid_amount
    INTO v_invoice
    FROM public.sales_invoices i
    WHERE i.id = v_invoice_id AND i.org_id = v_org AND i.customer_id = v_customer
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_CROSS_SCOPE: invoice=%', v_invoice_id;
    END IF;

    v_open := round(v_invoice.total_amount - v_invoice.paid_amount, 2);
    IF v_allocated > v_open THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_invoice_id, v_open, v_allocated;
    END IF;

    INSERT INTO public.customer_collection_lines (
      collection_id, invoice_id, allocated_amount, discount_amount, notes
    ) VALUES (
      v_receipt_id, v_invoice_id, v_allocated, 0, nullif(v_line->>'notes', '')
    );

    v_total := v_total + v_allocated;
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 AND round(v_total, 2) <> v_amount THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH: allocations=% receipt=%',
      v_total, v_amount;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'receipt_id', v_receipt_id, 'receipt_number', v_number,
    'status', 'draft', 'line_count', v_count
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_create_supplier_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_payment_id uuid := gen_random_uuid();
  v_number text;
  v_vendor uuid;
  v_date date;
  v_amount numeric;
  v_method text;
  v_account uuid;
  v_line jsonb;
  v_invoice_id uuid;
  v_allocated numeric;
  v_discount numeric;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_total numeric := 0;
  v_count integer := 0;
  v_open numeric;
  v_invoice record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;

  v_vendor := nullif(p_payload->>'vendor_id', '')::uuid;
  v_date := coalesce(nullif(p_payload->>'payment_date', '')::date, current_date);
  v_amount := round(coalesce(nullif(p_payload->>'amount', '')::numeric, 0), 2);
  v_method := coalesce(nullif(p_payload->>'payment_method', ''), 'bank_transfer');
  v_account := nullif(p_payload->>'payment_account_id', '')::uuid;

  IF v_vendor IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_VENDOR_REQUIRED'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'VOUCHER_AMOUNT_INVALID: amount must be positive'; END IF;
  IF v_account IS NULL THEN RAISE EXCEPTION 'VOUCHER_PAYMENT_ACCOUNT_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.id = v_vendor AND v.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_VENDOR_CROSS_ORG';
  END IF;

  v_number := public.wardah_next_voucher_number(v_org, 'SUPPLIER_PAYMENT');

  INSERT INTO public.supplier_payments (
    id, org_id, payment_number, vendor_id, payment_date, amount,
    payment_method, payment_account_id, check_number, check_date, check_bank,
    reference_number, notes, status, created_by
  ) VALUES (
    v_payment_id, v_org, v_number, v_vendor, v_date, v_amount,
    v_method, v_account,
    nullif(p_payload->>'check_number', ''),
    nullif(p_payload->>'check_date', '')::date,
    nullif(p_payload->>'check_bank', ''),
    nullif(p_payload->>'reference_number', ''),
    nullif(p_payload->>'notes', ''),
    'draft', v_actor
  );

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb))
  LOOP
    v_invoice_id := nullif(v_line->>'invoice_id', '')::uuid;
    v_allocated := round(coalesce(nullif(v_line->>'allocated_amount', '')::numeric, 0), 2);
    v_discount := round(coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0), 2);

    IF v_invoice_id IS NULL THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_INVOICE_REQUIRED';
    END IF;
    IF v_allocated <= 0 THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID: invoice=%', v_invoice_id;
    END IF;
    IF v_discount <> 0 THEN
      RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required';
    END IF;
    IF v_invoice_id = ANY (v_seen) THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE_INVOICE: invoice=%', v_invoice_id;
    END IF;
    v_seen := v_seen || v_invoice_id;

    SELECT i.total_amount, coalesce(i.paid_amount, 0) AS paid_amount, i.status
    INTO v_invoice
    FROM public.supplier_invoices i
    WHERE i.id = v_invoice_id AND i.org_id = v_org AND i.vendor_id = v_vendor
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_CROSS_SCOPE: invoice=%', v_invoice_id;
    END IF;
    IF v_invoice.status NOT IN ('approved', 'partially_paid', 'overdue') THEN
      RAISE EXCEPTION 'SUPPLIER_INVOICE_NOT_PAYABLE: invoice=% status=%',
        v_invoice_id, v_invoice.status;
    END IF;

    v_open := round(v_invoice.total_amount - v_invoice.paid_amount, 2);
    IF v_allocated > v_open THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_invoice_id, v_open, v_allocated;
    END IF;

    INSERT INTO public.supplier_payment_lines (
      payment_id, invoice_id, allocated_amount, discount_amount, notes
    ) VALUES (
      v_payment_id, v_invoice_id, v_allocated, 0, nullif(v_line->>'notes', '')
    );

    v_total := v_total + v_allocated;
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 AND round(v_total, 2) <> v_amount THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH: allocations=% payment=%',
      v_total, v_amount;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'payment_id', v_payment_id, 'payment_number', v_number,
    'status', 'draft', 'line_count', v_count
  );
END
$function$;

-- ---------------------------------------------------------------------
-- 5. Atomic edit of a draft voucher — the `corrected` step Migration 167 left
-- without a client path. Lines are replaced wholesale inside the Migration 167
-- internal contract, which is closed again before any deliberate error.
--
-- A voucher that carries a GL identity is only editable when a trusted reset
-- record proves it reached the correction phase legally.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_update_customer_receipt_draft(
  p_receipt_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_receipt public.customer_collections%ROWTYPE;
  v_amount numeric;
  v_date date;
  v_method text;
  v_account uuid;
  v_line jsonb;
  v_invoice_id uuid;
  v_allocated numeric;
  v_discount numeric;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_total numeric := 0;
  v_count integer := 0;
  v_deleted integer;
  v_stored integer;
  v_open numeric;
  v_invoice record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT (p_payload ? 'lines') THEN
    RAISE EXCEPTION 'VOUCHER_UPDATE_LINES_REQUIRED: send the complete allocation set';
  END IF;

  SELECT * INTO v_receipt
  FROM public.customer_collections
  WHERE id = p_receipt_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG'; END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_DRAFT: status=%', v_receipt.status;
  END IF;

  IF v_receipt.gl_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.gl_entries e
      WHERE e.id = v_receipt.gl_entry_id AND e.org_id = v_org AND e.status = 'draft'
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_DRAFT_GL_INVALID';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs a
      WHERE a.org_id = v_org
        AND a.action = 'voucher_reset_to_draft'
        AND a.entity_type = 'customer_receipt'
        AND a.entity_id = v_receipt.id::text
    ) THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_CORRECTION_UNPROVEN: no trusted reset record';
    END IF;
  END IF;

  IF nullif(p_payload->>'customer_id', '') IS NOT NULL
     AND (p_payload->>'customer_id')::uuid <> v_receipt.customer_id THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_PARTY_IMMUTABLE: cancel and create a new voucher';
  END IF;

  v_amount := round(coalesce(nullif(p_payload->>'amount', '')::numeric, v_receipt.amount), 2);
  v_date := coalesce(nullif(p_payload->>'receipt_date', '')::date, v_receipt.collection_date);
  v_method := coalesce(nullif(p_payload->>'payment_method', ''), v_receipt.payment_method);
  v_account := coalesce(nullif(p_payload->>'payment_account_id', '')::uuid,
                        v_receipt.payment_account_id);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'VOUCHER_AMOUNT_INVALID: amount must be positive'; END IF;

  UPDATE public.customer_collections
  SET amount = v_amount,
      collection_date = v_date,
      payment_method = v_method,
      payment_account_id = v_account,
      check_number = coalesce(nullif(p_payload->>'check_number', ''), check_number),
      check_date = coalesce(nullif(p_payload->>'check_date', '')::date, check_date),
      reference_number = coalesce(nullif(p_payload->>'reference_number', ''), reference_number),
      notes = coalesce(nullif(p_payload->>'notes', ''), notes),
      updated_at = now()
  WHERE id = v_receipt.id AND org_id = v_org AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_STATE_CHANGED'; END IF;

  PERFORM set_config('wardah.voucher_lines_write', 'on', true);

  DELETE FROM public.customer_collection_lines WHERE collection_id = v_receipt.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(p_payload->'lines')
  LOOP
    v_invoice_id := nullif(v_line->>'invoice_id', '')::uuid;
    v_allocated := round(coalesce(nullif(v_line->>'allocated_amount', '')::numeric, 0), 2);
    v_discount := round(coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0), 2);

    IF v_invoice_id IS NULL
       OR v_allocated <= 0
       OR v_discount <> 0
       OR v_invoice_id = ANY (v_seen) THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_INVALID: invoice=% allocated=% discount=%',
        v_invoice_id, v_allocated, v_discount;
    END IF;
    v_seen := v_seen || v_invoice_id;

    SELECT i.total_amount, coalesce(i.paid_amount, 0) AS paid_amount
    INTO v_invoice
    FROM public.sales_invoices i
    WHERE i.id = v_invoice_id AND i.org_id = v_org AND i.customer_id = v_receipt.customer_id
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_CROSS_SCOPE: invoice=%', v_invoice_id;
    END IF;

    v_open := round(v_invoice.total_amount - v_invoice.paid_amount, 2);
    IF v_allocated > v_open THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_invoice_id, v_open, v_allocated;
    END IF;

    INSERT INTO public.customer_collection_lines (
      collection_id, invoice_id, allocated_amount, discount_amount, notes
    ) VALUES (
      v_receipt.id, v_invoice_id, v_allocated, 0, nullif(v_line->>'notes', '')
    );

    v_total := v_total + v_allocated;
    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('wardah.voucher_lines_write', 'off', true);

  SELECT count(*) INTO v_stored
  FROM public.customer_collection_lines WHERE collection_id = v_receipt.id;
  IF v_stored <> v_count THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_LINE_REPLACEMENT_MISMATCH: stored=% expected=%',
      v_stored, v_count;
  END IF;
  IF v_count > 0 AND round(v_total, 2) <> v_amount THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH: allocations=% receipt=%',
      v_total, v_amount;
  END IF;

  INSERT INTO public.audit_logs(
    org_id, user_id, action, entity_type, entity_id, old_data, new_data, changes, metadata
  ) VALUES (
    v_org, v_actor, 'voucher_draft_updated', 'customer_receipt', v_receipt.id::text,
    jsonb_build_object('amount', v_receipt.amount, 'collection_date', v_receipt.collection_date,
                       'payment_method', v_receipt.payment_method,
                       'payment_account_id', v_receipt.payment_account_id,
                       'line_count', v_deleted),
    jsonb_build_object('amount', v_amount, 'collection_date', v_date,
                       'payment_method', v_method, 'payment_account_id', v_account,
                       'line_count', v_count),
    jsonb_build_object('lines_replaced', v_deleted || ' -> ' || v_count),
    jsonb_build_object('source', 'rpc_update_customer_receipt_draft',
                       'gl_entry_id', v_receipt.gl_entry_id)
  );

  RETURN jsonb_build_object(
    'success', true, 'receipt_id', v_receipt.id, 'status', 'draft',
    'line_count', v_count, 'lines_removed', v_deleted
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_supplier_payment_draft(
  p_payment_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_payment public.supplier_payments%ROWTYPE;
  v_amount numeric;
  v_date date;
  v_method text;
  v_account uuid;
  v_line jsonb;
  v_invoice_id uuid;
  v_allocated numeric;
  v_discount numeric;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_total numeric := 0;
  v_count integer := 0;
  v_deleted integer;
  v_stored integer;
  v_open numeric;
  v_invoice record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT (p_payload ? 'lines') THEN
    RAISE EXCEPTION 'VOUCHER_UPDATE_LINES_REQUIRED: send the complete allocation set';
  END IF;

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_payment_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG'; END IF;
  IF v_payment.status <> 'draft' THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_DRAFT: status=%', v_payment.status;
  END IF;

  IF v_payment.gl_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.gl_entries e
      WHERE e.id = v_payment.gl_entry_id AND e.org_id = v_org AND e.status = 'draft'
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_DRAFT_GL_INVALID';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs a
      WHERE a.org_id = v_org
        AND a.action = 'voucher_reset_to_draft'
        AND a.entity_type = 'supplier_payment'
        AND a.entity_id = v_payment.id::text
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_CORRECTION_UNPROVEN: no trusted reset record';
    END IF;
  END IF;

  IF nullif(p_payload->>'vendor_id', '') IS NOT NULL
     AND (p_payload->>'vendor_id')::uuid <> v_payment.vendor_id THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_PARTY_IMMUTABLE: cancel and create a new voucher';
  END IF;

  v_amount := round(coalesce(nullif(p_payload->>'amount', '')::numeric, v_payment.amount), 2);
  v_date := coalesce(nullif(p_payload->>'payment_date', '')::date, v_payment.payment_date);
  v_method := coalesce(nullif(p_payload->>'payment_method', ''), v_payment.payment_method);
  v_account := coalesce(nullif(p_payload->>'payment_account_id', '')::uuid,
                        v_payment.payment_account_id);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'VOUCHER_AMOUNT_INVALID: amount must be positive'; END IF;

  UPDATE public.supplier_payments
  SET amount = v_amount,
      payment_date = v_date,
      payment_method = v_method,
      payment_account_id = v_account,
      check_number = coalesce(nullif(p_payload->>'check_number', ''), check_number),
      check_date = coalesce(nullif(p_payload->>'check_date', '')::date, check_date),
      check_bank = coalesce(nullif(p_payload->>'check_bank', ''), check_bank),
      reference_number = coalesce(nullif(p_payload->>'reference_number', ''), reference_number),
      notes = coalesce(nullif(p_payload->>'notes', ''), notes),
      updated_at = now()
  WHERE id = v_payment.id AND org_id = v_org AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_STATE_CHANGED'; END IF;

  PERFORM set_config('wardah.voucher_lines_write', 'on', true);

  DELETE FROM public.supplier_payment_lines WHERE payment_id = v_payment.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(p_payload->'lines')
  LOOP
    v_invoice_id := nullif(v_line->>'invoice_id', '')::uuid;
    v_allocated := round(coalesce(nullif(v_line->>'allocated_amount', '')::numeric, 0), 2);
    v_discount := round(coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0), 2);

    IF v_invoice_id IS NULL
       OR v_allocated <= 0
       OR v_discount <> 0
       OR v_invoice_id = ANY (v_seen) THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_INVALID: invoice=% allocated=% discount=%',
        v_invoice_id, v_allocated, v_discount;
    END IF;
    v_seen := v_seen || v_invoice_id;

    SELECT i.total_amount, coalesce(i.paid_amount, 0) AS paid_amount, i.status
    INTO v_invoice
    FROM public.supplier_invoices i
    WHERE i.id = v_invoice_id AND i.org_id = v_org AND i.vendor_id = v_payment.vendor_id
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_CROSS_SCOPE: invoice=%', v_invoice_id;
    END IF;
    IF v_invoice.status NOT IN ('approved', 'partially_paid', 'overdue') THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'SUPPLIER_INVOICE_NOT_PAYABLE: invoice=% status=%',
        v_invoice_id, v_invoice.status;
    END IF;

    v_open := round(v_invoice.total_amount - v_invoice.paid_amount, 2);
    IF v_allocated > v_open THEN
      PERFORM set_config('wardah.voucher_lines_write', 'off', true);
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_invoice_id, v_open, v_allocated;
    END IF;

    INSERT INTO public.supplier_payment_lines (
      payment_id, invoice_id, allocated_amount, discount_amount, notes
    ) VALUES (
      v_payment.id, v_invoice_id, v_allocated, 0, nullif(v_line->>'notes', '')
    );

    v_total := v_total + v_allocated;
    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('wardah.voucher_lines_write', 'off', true);

  SELECT count(*) INTO v_stored
  FROM public.supplier_payment_lines WHERE payment_id = v_payment.id;
  IF v_stored <> v_count THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_LINE_REPLACEMENT_MISMATCH: stored=% expected=%',
      v_stored, v_count;
  END IF;
  IF v_count > 0 AND round(v_total, 2) <> v_amount THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH: allocations=% payment=%',
      v_total, v_amount;
  END IF;

  INSERT INTO public.audit_logs(
    org_id, user_id, action, entity_type, entity_id, old_data, new_data, changes, metadata
  ) VALUES (
    v_org, v_actor, 'voucher_draft_updated', 'supplier_payment', v_payment.id::text,
    jsonb_build_object('amount', v_payment.amount, 'payment_date', v_payment.payment_date,
                       'payment_method', v_payment.payment_method,
                       'payment_account_id', v_payment.payment_account_id,
                       'line_count', v_deleted),
    jsonb_build_object('amount', v_amount, 'payment_date', v_date,
                       'payment_method', v_method, 'payment_account_id', v_account,
                       'line_count', v_count),
    jsonb_build_object('lines_replaced', v_deleted || ' -> ' || v_count),
    jsonb_build_object('source', 'rpc_update_supplier_payment_draft',
                       'gl_entry_id', v_payment.gl_entry_id)
  );

  RETURN jsonb_build_object(
    'success', true, 'payment_id', v_payment.id, 'status', 'draft',
    'line_count', v_count, 'lines_removed', v_deleted
  );
END
$function$;

-- ---------------------------------------------------------------------
-- 6. Cancellation. Two paths, deliberately separated:
--
--   * a draft that was never posted carries no GL identity and no reset
--     record, so it is cancelled on its own and no GL entry is touched;
--   * a voucher that was posted and then reset for correction keeps its
--     gl_entry_id, entry_number and every GL line. Only the entry's status
--     moves to cancelled, and the audit record names the reset it closes.
--
-- Cancelling a posted voucher is refused: it must go through reset first, so
-- the paid amounts and invoice states are unwound by the Migration 166 RPC
-- rather than by a second implementation of the same reversal here.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_cancel_customer_receipt(
  p_receipt_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_receipt public.customer_collections%ROWTYPE;
  v_entry public.gl_entries%ROWTYPE;
  v_reset_id uuid;
  v_gl_rows integer;
  v_path text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'VOUCHER_CANCEL_REASON_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.wardah_has_exact_permission(v_actor, v_org, 'accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'VOUCHER_CANCEL_PERMISSION_REQUIRED';
  END IF;

  SELECT * INTO v_receipt
  FROM public.customer_collections
  WHERE id = p_receipt_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG'; END IF;

  IF v_receipt.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true,
      'receipt_id', v_receipt.id, 'status', 'cancelled',
      'entry_id', v_receipt.gl_entry_id);
  END IF;
  IF v_receipt.status = 'posted' THEN
    RAISE EXCEPTION 'VOUCHER_CANCEL_REQUIRES_RESET: reset the receipt before cancelling it';
  END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_CANCELLABLE: status=%', v_receipt.status;
  END IF;

  SELECT a.id INTO v_reset_id
  FROM public.audit_logs a
  WHERE a.org_id = v_org
    AND a.action = 'voucher_reset_to_draft'
    AND a.entity_type = 'customer_receipt'
    AND a.entity_id = v_receipt.id::text
  ORDER BY a.created_at DESC NULLS LAST, a.id DESC
  LIMIT 1;

  IF v_receipt.gl_entry_id IS NULL THEN
    IF v_reset_id IS NOT NULL THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_CANCEL_STATE_INCONSISTENT: reset record without GL identity';
    END IF;
    v_path := 'never_posted';
  ELSE
    IF v_reset_id IS NULL THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_CANCEL_UNPROVEN: GL identity without a trusted reset record';
    END IF;
    v_path := 'corrected';

    SELECT * INTO v_entry
    FROM public.gl_entries
    WHERE id = v_receipt.gl_entry_id AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND
       OR v_entry.status <> 'draft'
       OR v_entry.reference_type <> 'CUSTOMER_RECEIPT'
       OR v_entry.reference_id <> v_receipt.id THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_CANCEL_GL_INVALID';
    END IF;

    PERFORM set_config('wardah.voucher_gl_cancel', 'on', true);
    UPDATE public.gl_entries
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_entry.id AND org_id = v_org AND status = 'draft';
    GET DIAGNOSTICS v_gl_rows = ROW_COUNT;
    PERFORM set_config('wardah.voucher_gl_cancel', 'off', true);
    IF v_gl_rows <> 1 THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_CANCEL_GL_STATE_CHANGED'; END IF;
  END IF;

  UPDATE public.customer_collections
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_receipt.id AND org_id = v_org AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_STATE_CHANGED'; END IF;

  INSERT INTO public.audit_logs(
    org_id, user_id, action, entity_type, entity_id, old_data, new_data, changes, metadata
  ) VALUES (
    v_org, v_actor, 'voucher_cancelled', 'customer_receipt', v_receipt.id::text,
    jsonb_build_object('status', 'draft', 'gl_entry_id', v_receipt.gl_entry_id,
                       'gl_status', CASE WHEN v_path = 'corrected' THEN v_entry.status ELSE NULL END,
                       'entry_number', CASE WHEN v_path = 'corrected' THEN v_entry.entry_number ELSE NULL END),
    jsonb_build_object('status', 'cancelled', 'gl_entry_id', v_receipt.gl_entry_id,
                       'gl_status', CASE WHEN v_path = 'corrected' THEN 'cancelled' ELSE NULL END,
                       'entry_number', CASE WHEN v_path = 'corrected' THEN v_entry.entry_number ELSE NULL END),
    jsonb_build_object('reason', trim(p_reason), 'path', v_path),
    jsonb_build_object('source', 'rpc_cancel_customer_receipt',
                       'reset_audit_id', v_reset_id)
  );

  RETURN jsonb_build_object('success', true, 'duplicate', false,
    'receipt_id', v_receipt.id, 'status', 'cancelled',
    'entry_id', v_receipt.gl_entry_id, 'path', v_path);
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_cancel_supplier_payment(
  p_payment_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_payment public.supplier_payments%ROWTYPE;
  v_entry public.gl_entries%ROWTYPE;
  v_reset_id uuid;
  v_gl_rows integer;
  v_path text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'VOUCHER_CANCEL_REASON_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.wardah_has_exact_permission(v_actor, v_org, 'accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'VOUCHER_CANCEL_PERMISSION_REQUIRED';
  END IF;

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_payment_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG'; END IF;

  IF v_payment.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true,
      'payment_id', v_payment.id, 'status', 'cancelled',
      'entry_id', v_payment.gl_entry_id);
  END IF;
  IF v_payment.status = 'posted' THEN
    RAISE EXCEPTION 'VOUCHER_CANCEL_REQUIRES_RESET: reset the payment before cancelling it';
  END IF;
  IF v_payment.status <> 'draft' THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_CANCELLABLE: status=%', v_payment.status;
  END IF;

  SELECT a.id INTO v_reset_id
  FROM public.audit_logs a
  WHERE a.org_id = v_org
    AND a.action = 'voucher_reset_to_draft'
    AND a.entity_type = 'supplier_payment'
    AND a.entity_id = v_payment.id::text
  ORDER BY a.created_at DESC NULLS LAST, a.id DESC
  LIMIT 1;

  IF v_payment.gl_entry_id IS NULL THEN
    IF v_reset_id IS NOT NULL THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_CANCEL_STATE_INCONSISTENT: reset record without GL identity';
    END IF;
    v_path := 'never_posted';
  ELSE
    IF v_reset_id IS NULL THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_CANCEL_UNPROVEN: GL identity without a trusted reset record';
    END IF;
    v_path := 'corrected';

    SELECT * INTO v_entry
    FROM public.gl_entries
    WHERE id = v_payment.gl_entry_id AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND
       OR v_entry.status <> 'draft'
       OR v_entry.reference_type <> 'SUPPLIER_PAYMENT'
       OR v_entry.reference_id <> v_payment.id THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_CANCEL_GL_INVALID';
    END IF;

    PERFORM set_config('wardah.voucher_gl_cancel', 'on', true);
    UPDATE public.gl_entries
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_entry.id AND org_id = v_org AND status = 'draft';
    GET DIAGNOSTICS v_gl_rows = ROW_COUNT;
    PERFORM set_config('wardah.voucher_gl_cancel', 'off', true);
    IF v_gl_rows <> 1 THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_CANCEL_GL_STATE_CHANGED'; END IF;
  END IF;

  UPDATE public.supplier_payments
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_payment.id AND org_id = v_org AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_STATE_CHANGED'; END IF;

  INSERT INTO public.audit_logs(
    org_id, user_id, action, entity_type, entity_id, old_data, new_data, changes, metadata
  ) VALUES (
    v_org, v_actor, 'voucher_cancelled', 'supplier_payment', v_payment.id::text,
    jsonb_build_object('status', 'draft', 'gl_entry_id', v_payment.gl_entry_id,
                       'gl_status', CASE WHEN v_path = 'corrected' THEN v_entry.status ELSE NULL END,
                       'entry_number', CASE WHEN v_path = 'corrected' THEN v_entry.entry_number ELSE NULL END),
    jsonb_build_object('status', 'cancelled', 'gl_entry_id', v_payment.gl_entry_id,
                       'gl_status', CASE WHEN v_path = 'corrected' THEN 'cancelled' ELSE NULL END,
                       'entry_number', CASE WHEN v_path = 'corrected' THEN v_entry.entry_number ELSE NULL END),
    jsonb_build_object('reason', trim(p_reason), 'path', v_path),
    jsonb_build_object('source', 'rpc_cancel_supplier_payment',
                       'reset_audit_id', v_reset_id)
  );

  RETURN jsonb_build_object('success', true, 'duplicate', false,
    'payment_id', v_payment.id, 'status', 'cancelled',
    'entry_id', v_payment.gl_entry_id, 'path', v_path);
END
$function$;

-- ---------------------------------------------------------------------
-- 7. Client execution contract. Nothing is inherited from PUBLIC.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_create_customer_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_customer_receipt(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_create_customer_receipt(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_receipt(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_create_supplier_payment(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_supplier_payment(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_create_supplier_payment(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_supplier_payment(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_update_customer_receipt_draft(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_update_customer_receipt_draft(uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_update_customer_receipt_draft(uuid,jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_update_customer_receipt_draft(uuid,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_update_supplier_payment_draft(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_update_supplier_payment_draft(uuid,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_update_supplier_payment_draft(uuid,jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_update_supplier_payment_draft(uuid,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_cancel_customer_receipt(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancel_customer_receipt(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancel_customer_receipt(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_customer_receipt(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_cancel_supplier_payment(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_cancel_supplier_payment(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_cancel_supplier_payment(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_supplier_payment(uuid,text) TO authenticated;

DO $verify$
DECLARE
  v_definition text;
  v_fn text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.permissions WHERE permission_key = 'accounting.vouchers.cancel'
  ) THEN
    RAISE EXCEPTION 'VOUCHER_168_PERMISSION_MISSING';
  END IF;

  -- The cancel key must not be handed out by this migration; granting it is an
  -- explicit RBAC decision.
  IF EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE p.permission_key = 'accounting.vouchers.cancel'
  ) THEN
    RAISE EXCEPTION 'VOUCHER_168_CANCEL_PERMISSION_AUTOGRANTED';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_create_customer_receipt(jsonb)',
    'public.rpc_create_supplier_payment(jsonb)',
    'public.rpc_update_customer_receipt_draft(uuid,jsonb)',
    'public.rpc_update_supplier_payment_draft(uuid,jsonb)',
    'public.rpc_cancel_customer_receipt(uuid,text)',
    'public.rpc_cancel_supplier_payment(uuid,text)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'VOUCHER_168_RPC_MISSING: %', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VOUCHER_168_RPC_GRANT_VERIFY_FAILED: %', v_fn;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.wardah_next_voucher_number(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_next_voucher_number(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VOUCHER_168_NUMBER_HELPER_EXPOSED';
  END IF;

  SELECT pg_get_functiondef('public.protect_posted_gl_entries()'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%wardah.voucher_gl_cancel%'
     OR v_definition NOT LIKE '%VOUCHER_GL_CANCEL_FORBIDDEN%'
     OR v_definition NOT LIKE '%VOUCHER_GL_CANCEL_SCOPE_INVALID%'
     OR v_definition NOT LIKE '%voucher_reset_to_draft%' THEN
    RAISE EXCEPTION 'VOUCHER_168_GL_CANCEL_GUARD_VERIFY_FAILED';
  END IF;
END
$verify$;

COMMIT;
