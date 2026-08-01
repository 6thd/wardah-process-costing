-- =====================================================================
-- 166_voucher_reset_to_draft_workflow
-- =====================================================================
-- Controlled correction cycle for posted customer receipts and supplier
-- payments without creating reversal entries:
--
--   posted -> draft -> corrected -> posted
--
-- The same GL entry identity is retained. Invoice paid/balance state, voucher
-- state and GL state move atomically. Closed periods remain fail-closed.
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
     OR to_regclass('public.gl_entry_lines') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_166_REQUIRED_OBJECT_MISSING';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. Sensitive permission: not automatically assigned to ordinary roles.
-- Org admins and super admins already receive all active permissions through
-- the existing RBAC functions; other users require an explicit role grant.
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (
  module_id, resource, resource_ar, action, action_ar,
  permission_key, description, description_ar
)
SELECT
  m.id,
  'vouchers',
  'السندات المالية',
  'unpost',
  'إلغاء الترحيل',
  'accounting.vouchers.unpost',
  'Reset a posted payment voucher and its linked GL entry to draft.',
  'إعادة سند مالي مرحل وقيده المرتبط إلى مسودة للتصحيح.'
FROM public.modules m
WHERE m.name = 'accounting'
ON CONFLICT (permission_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Preserve posted-entry immutability while allowing exactly one internal
-- transition: voucher-linked posted -> draft under a transaction-local GUC.
-- Direct client updates remain blocked by the same trigger.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_posted_gl_entries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_controlled_unpost boolean :=
    coalesce(current_setting('wardah.voucher_unpost', true), '') = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: لا يمكن حذف قيد مرحّل (%) — استخدم العكس', OLD.entry_number;
    END IF;
    RETURN OLD;
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
-- 3. Reuse an existing voucher GL entry when it is draft. Its lines are
-- rebuilt from the corrected voucher and the same entry is posted again.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_create_posted_voucher_gl(
  p_org uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_entry_date date,
  p_description text,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount numeric,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_journal_id uuid;
  v_existing_status text;
  v_idempotency_key text := p_reference_type || ':' || p_reference_id::text;
BEGIN
  IF p_org IS NULL OR p_reference_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_GL_SCOPE_REQUIRED: org, reference and actor are required';
  END IF;
  IF p_reference_type NOT IN ('CUSTOMER_RECEIPT', 'SUPPLIER_PAYMENT') THEN
    RAISE EXCEPTION 'VOUCHER_GL_REFERENCE_TYPE_INVALID';
  END IF;
  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'VOUCHER_AMOUNT_INVALID: amount must be positive';
  END IF;
  IF p_debit_account_id = p_credit_account_id THEN
    RAISE EXCEPTION 'VOUCHER_GL_SAME_ACCOUNT_FORBIDDEN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.id = p_debit_account_id AND a.org_id = p_org
      AND coalesce(a.is_active, true) AND coalesce(a.allow_posting, true)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.id = p_credit_account_id AND a.org_id = p_org
      AND coalesce(a.is_active, true) AND coalesce(a.allow_posting, true)
  ) THEN
    RAISE EXCEPTION 'VOUCHER_GL_ACCOUNT_INVALID: legal posting accounts must belong to the voucher organization';
  END IF;

  PERFORM public.assert_period_open(p_org, coalesce(p_entry_date, current_date));

  SELECT e.id, e.status
  INTO v_entry_id, v_existing_status
  FROM public.gl_entries e
  WHERE e.org_id = p_org AND e.idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF v_entry_id IS NOT NULL AND v_existing_status = 'posted' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.gl_entries e
      WHERE e.id = v_entry_id
        AND e.org_id = p_org
        AND e.reference_type = p_reference_type
        AND e.reference_id = p_reference_id
        AND e.reference_number IS NOT DISTINCT FROM p_reference_number
        AND e.entry_date = coalesce(p_entry_date, current_date)
        AND round(e.total_debit, 2) = round(p_amount, 2)
        AND round(e.total_credit, 2) = round(p_amount, 2)
        AND (
          SELECT count(*)
          FROM public.gl_entry_lines l
          WHERE l.entry_id = e.id AND l.org_id = p_org
            AND (
              (l.account_id = p_debit_account_id AND round(l.debit,2) = round(p_amount,2) AND l.credit = 0)
              OR
              (l.account_id = p_credit_account_id AND l.debit = 0 AND round(l.credit,2) = round(p_amount,2))
            )
        ) = 2
    ) THEN
      RAISE EXCEPTION 'VOUCHER_GL_IDEMPOTENCY_CONFLICT: existing posted entry does not match voucher contract';
    END IF;
    RETURN v_entry_id;
  END IF;

  IF v_entry_id IS NOT NULL AND v_existing_status <> 'draft' THEN
    RAISE EXCEPTION 'VOUCHER_GL_STATE_CONFLICT: existing entry status=%', v_existing_status;
  END IF;

  IF v_entry_id IS NULL THEN
    SELECT j.id INTO v_journal_id
    FROM public.journals j
    WHERE j.org_id = p_org AND coalesce(j.is_active, true)
    ORDER BY CASE WHEN j.journal_type IN ('cash','bank') THEN 0 ELSE 1 END,
             j.created_at NULLS LAST, j.id
    LIMIT 1;
    IF v_journal_id IS NULL THEN
      RAISE EXCEPTION 'VOUCHER_JOURNAL_REQUIRED: an active journal is required';
    END IF;

    v_entry_number := 'PV-' || to_char(coalesce(p_entry_date, current_date), 'YYYYMMDD') || '-' ||
                      substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

    INSERT INTO public.gl_entries (
      org_id, journal_id, entry_number, entry_date, entry_type,
      reference_type, reference_id, reference_number,
      description, description_ar, status, total_debit, total_credit,
      idempotency_key, created_by
    ) VALUES (
      p_org, v_journal_id, v_entry_number, coalesce(p_entry_date, current_date), 'manual',
      p_reference_type, p_reference_id, p_reference_number,
      p_description, p_description, 'draft', round(p_amount,2), round(p_amount,2),
      v_idempotency_key, p_actor
    ) RETURNING id INTO v_entry_id;
  ELSE
    DELETE FROM public.gl_entry_lines
    WHERE entry_id = v_entry_id AND org_id = p_org;

    UPDATE public.gl_entries
    SET entry_date = coalesce(p_entry_date, current_date),
        reference_type = p_reference_type,
        reference_id = p_reference_id,
        reference_number = p_reference_number,
        description = p_description,
        description_ar = p_description,
        total_debit = round(p_amount,2),
        total_credit = round(p_amount,2),
        posted_at = NULL,
        posted_by = NULL,
        updated_at = now()
    WHERE id = v_entry_id AND org_id = p_org AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_GL_DRAFT_CHANGED'; END IF;
  END IF;

  INSERT INTO public.gl_entry_lines (
    org_id, tenant_id, entry_id, line_number, account_id,
    debit, credit, currency_code, description, description_ar
  ) VALUES
    (p_org, p_org, v_entry_id, 1, p_debit_account_id,
     round(p_amount,2), 0, 'SAR', p_description, p_description),
    (p_org, p_org, v_entry_id, 2, p_credit_account_id,
     0, round(p_amount,2), 'SAR', p_description, p_description);

  UPDATE public.gl_entries
  SET status = 'posted', posted_at = now(), posted_by = p_actor, updated_at = now()
  WHERE id = v_entry_id AND org_id = p_org AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_GL_POST_STATE_CHANGED'; END IF;

  RETURN v_entry_id;
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM service_role;

-- ---------------------------------------------------------------------
-- 4. Reset customer receipt to draft.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reset_customer_receipt_to_draft(
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
  v_line record;
  v_new_paid numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 5 THEN
    RAISE EXCEPTION 'VOUCHER_UNPOST_REASON_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.has_permission(v_actor, v_org, 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'VOUCHER_UNPOST_PERMISSION_REQUIRED';
  END IF;

  SELECT * INTO v_receipt
  FROM public.customer_collections
  WHERE id = p_receipt_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG'; END IF;

  IF v_receipt.status = 'draft' THEN
    IF v_receipt.gl_entry_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.gl_entries e
      WHERE e.id=v_receipt.gl_entry_id AND e.org_id=v_org AND e.status='draft'
    ) THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_DRAFT_GL_INVALID';
    END IF;
    RETURN jsonb_build_object('success',true,'duplicate',true,'receipt_id',v_receipt.id,
      'entry_id',v_receipt.gl_entry_id,'status','draft');
  END IF;
  IF v_receipt.status <> 'posted' OR v_receipt.gl_entry_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_POSTED';
  END IF;

  SELECT * INTO v_entry
  FROM public.gl_entries
  WHERE id=v_receipt.gl_entry_id AND org_id=v_org
  FOR UPDATE;
  IF NOT FOUND
     OR v_entry.status <> 'posted'
     OR v_entry.reference_type <> 'CUSTOMER_RECEIPT'
     OR v_entry.reference_id <> v_receipt.id THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_POSTED_GL_INVALID';
  END IF;

  PERFORM public.assert_period_open(v_org, v_entry.entry_date);

  FOR v_line IN
    SELECT l.invoice_id, round(l.allocated_amount,2) AS allocated_amount,
           i.total_amount, coalesce(i.paid_amount,0) AS paid_amount
    FROM public.customer_collection_lines l
    JOIN public.sales_invoices i ON i.id=l.invoice_id
    WHERE l.collection_id=v_receipt.id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    IF round(v_line.paid_amount,2) < v_line.allocated_amount THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_UNPOST_INVOICE_DRIFT: invoice=% paid=% allocated=%',
        v_line.invoice_id, v_line.paid_amount, v_line.allocated_amount;
    END IF;
    v_new_paid := round(v_line.paid_amount - v_line.allocated_amount,2);
    UPDATE public.sales_invoices
    SET paid_amount=v_new_paid,
        balance=round(total_amount-v_new_paid,2),
        payment_status=CASE
          WHEN v_new_paid <= 0 THEN 'unpaid'
          WHEN v_new_paid >= round(total_amount,2) THEN 'paid'
          ELSE 'partially_paid'
        END,
        updated_at=now()
    WHERE id=v_line.invoice_id AND org_id=v_org;
  END LOOP;

  PERFORM set_config('wardah.voucher_unpost','on',true);
  UPDATE public.gl_entries
  SET status='draft', posted_at=NULL, posted_by=NULL, updated_at=now()
  WHERE id=v_entry.id AND org_id=v_org AND status='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_GL_STATE_CHANGED'; END IF;

  UPDATE public.customer_collections
  SET status='draft', posted_at=NULL, posted_by=NULL, updated_at=now()
  WHERE id=v_receipt.id AND org_id=v_org AND status='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_STATE_CHANGED'; END IF;

  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data,changes,metadata
  ) VALUES (
    v_org,v_actor,'voucher_reset_to_draft','customer_receipt',v_receipt.id::text,
    jsonb_build_object('status','posted','gl_status','posted','gl_entry_id',v_entry.id),
    jsonb_build_object('status','draft','gl_status','draft','gl_entry_id',v_entry.id),
    jsonb_build_object('reason',trim(p_reason)),
    jsonb_build_object('source','rpc_reset_customer_receipt_to_draft')
  );

  RETURN jsonb_build_object('success',true,'duplicate',false,'receipt_id',v_receipt.id,
    'entry_id',v_entry.id,'status','draft');
END
$function$;

-- ---------------------------------------------------------------------
-- 5. Reset supplier payment to draft.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reset_supplier_payment_to_draft(
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
  v_line record;
  v_new_paid numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 5 THEN
    RAISE EXCEPTION 'VOUCHER_UNPOST_REASON_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.has_permission(v_actor, v_org, 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'VOUCHER_UNPOST_PERMISSION_REQUIRED';
  END IF;

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id=p_payment_id AND org_id=v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG'; END IF;

  IF v_payment.status='draft' THEN
    IF v_payment.gl_entry_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.gl_entries e
      WHERE e.id=v_payment.gl_entry_id AND e.org_id=v_org AND e.status='draft'
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_DRAFT_GL_INVALID';
    END IF;
    RETURN jsonb_build_object('success',true,'duplicate',true,'payment_id',v_payment.id,
      'entry_id',v_payment.gl_entry_id,'status','draft');
  END IF;
  IF v_payment.status <> 'posted' OR v_payment.gl_entry_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_POSTED';
  END IF;

  SELECT * INTO v_entry
  FROM public.gl_entries
  WHERE id=v_payment.gl_entry_id AND org_id=v_org
  FOR UPDATE;
  IF NOT FOUND
     OR v_entry.status <> 'posted'
     OR v_entry.reference_type <> 'SUPPLIER_PAYMENT'
     OR v_entry.reference_id <> v_payment.id THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_POSTED_GL_INVALID';
  END IF;

  PERFORM public.assert_period_open(v_org, v_entry.entry_date);

  FOR v_line IN
    SELECT l.invoice_id, round(l.allocated_amount,2) AS allocated_amount,
           i.total_amount, coalesce(i.paid_amount,0) AS paid_amount, i.due_date
    FROM public.supplier_payment_lines l
    JOIN public.supplier_invoices i ON i.id=l.invoice_id
    WHERE l.payment_id=v_payment.id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    IF round(v_line.paid_amount,2) < v_line.allocated_amount THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_UNPOST_INVOICE_DRIFT: invoice=% paid=% allocated=%',
        v_line.invoice_id, v_line.paid_amount, v_line.allocated_amount;
    END IF;
    v_new_paid := round(v_line.paid_amount-v_line.allocated_amount,2);
    UPDATE public.supplier_invoices
    SET paid_amount=v_new_paid,
        balance=round(total_amount-v_new_paid,2),
        status=CASE
          WHEN v_new_paid >= round(total_amount,2) THEN 'paid'
          WHEN v_new_paid > 0 THEN 'partially_paid'
          WHEN due_date IS NOT NULL AND due_date < current_date THEN 'overdue'
          ELSE 'approved'
        END,
        updated_at=now()
    WHERE id=v_line.invoice_id AND org_id=v_org;
  END LOOP;

  PERFORM set_config('wardah.voucher_unpost','on',true);
  UPDATE public.gl_entries
  SET status='draft', posted_at=NULL, posted_by=NULL, updated_at=now()
  WHERE id=v_entry.id AND org_id=v_org AND status='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_GL_STATE_CHANGED'; END IF;

  UPDATE public.supplier_payments
  SET status='draft', posted_at=NULL, posted_by=NULL, updated_at=now()
  WHERE id=v_payment.id AND org_id=v_org AND status='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_STATE_CHANGED'; END IF;

  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data,changes,metadata
  ) VALUES (
    v_org,v_actor,'voucher_reset_to_draft','supplier_payment',v_payment.id::text,
    jsonb_build_object('status','posted','gl_status','posted','gl_entry_id',v_entry.id),
    jsonb_build_object('status','draft','gl_status','draft','gl_entry_id',v_entry.id),
    jsonb_build_object('reason',trim(p_reason)),
    jsonb_build_object('source','rpc_reset_supplier_payment_to_draft')
  );

  RETURN jsonb_build_object('success',true,'duplicate',false,'payment_id',v_payment.id,
    'entry_id',v_entry.id,'status','draft');
END
$function$;

REVOKE ALL ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Keep invoice balance synchronized during normal posting too.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_post_customer_receipt(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_org uuid;
  v_receipt public.customer_collections%ROWTYPE;
  v_payment_account uuid; v_ar_account uuid; v_entry_id uuid;
  v_line record; v_allocation_total numeric:=0; v_open numeric;
  v_new_paid numeric; v_line_count integer:=0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org:=public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED'; END IF;
  SELECT * INTO v_receipt FROM public.customer_collections WHERE id=p_receipt_id AND org_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG'; END IF;
  IF v_receipt.status='posted' AND v_receipt.gl_entry_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.gl_entries e WHERE e.id=v_receipt.gl_entry_id AND e.org_id=v_org AND e.status='posted') THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_POSTED_GL_INVALID'; END IF;
    RETURN jsonb_build_object('success',true,'duplicate',true,'receipt_id',v_receipt.id,'entry_id',v_receipt.gl_entry_id,'status','posted');
  END IF;
  IF v_receipt.status<>'draft' THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_DRAFT: status=%',v_receipt.status; END IF;
  v_payment_account:=v_receipt.payment_account_id;
  IF v_payment_account IS NULL THEN SELECT a.id INTO v_payment_account FROM public.gl_accounts a WHERE a.org_id=v_org AND a.subtype=CASE WHEN v_receipt.payment_method IN ('cash','check') THEN 'CASH' ELSE 'BANK' END AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true) ORDER BY a.code,a.id LIMIT 1; END IF;
  SELECT a.id INTO v_ar_account FROM public.gl_accounts a WHERE a.org_id=v_org AND a.subtype IN ('ACCOUNTS_RECEIVABLE','AR') AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true) ORDER BY a.code,a.id LIMIT 1;
  IF v_payment_account IS NULL OR v_ar_account IS NULL THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_GL_ACCOUNTS_MISSING'; END IF;
  FOR v_line IN SELECT l.invoice_id,l.allocated_amount,coalesce(l.discount_amount,0) discount_amount,i.org_id,i.customer_id,i.total_amount,coalesce(i.paid_amount,0) paid_amount FROM public.customer_collection_lines l JOIN public.sales_invoices i ON i.id=l.invoice_id WHERE l.collection_id=v_receipt.id ORDER BY i.id FOR UPDATE OF i LOOP
    v_line_count:=v_line_count+1;
    IF v_line.org_id<>v_org OR v_line.customer_id<>v_receipt.customer_id THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_CROSS_SCOPE'; END IF;
    IF v_line.discount_amount<>0 THEN RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required'; END IF;
    v_open:=round(v_line.total_amount-v_line.paid_amount,2);
    IF round(v_line.allocated_amount,2)>v_open THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_OVER_ALLOCATION: invoice=% open=% allocated=%',v_line.invoice_id,v_open,v_line.allocated_amount; END IF;
    v_allocation_total:=v_allocation_total+round(v_line.allocated_amount,2);
  END LOOP;
  IF v_line_count>0 AND round(v_allocation_total,2)<>round(v_receipt.amount,2) THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH: allocations=% receipt=%',v_allocation_total,v_receipt.amount; END IF;
  v_entry_id:=public.wardah_create_posted_voucher_gl(v_org,'CUSTOMER_RECEIPT',v_receipt.id,v_receipt.collection_number,v_receipt.collection_date,'سند قبض '||v_receipt.collection_number,v_payment_account,v_ar_account,v_receipt.amount,v_actor);
  FOR v_line IN SELECT l.invoice_id,l.allocated_amount,i.total_amount,coalesce(i.paid_amount,0) paid_amount FROM public.customer_collection_lines l JOIN public.sales_invoices i ON i.id=l.invoice_id WHERE l.collection_id=v_receipt.id ORDER BY i.id FOR UPDATE OF i LOOP
    v_new_paid:=round(v_line.paid_amount+v_line.allocated_amount,2);
    UPDATE public.sales_invoices SET paid_amount=v_new_paid,balance=round(total_amount-v_new_paid,2),payment_status=CASE WHEN v_new_paid>=round(total_amount,2) THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=v_line.invoice_id AND org_id=v_org;
  END LOOP;
  UPDATE public.customer_collections SET status='posted',gl_entry_id=v_entry_id,posted_at=now(),posted_by=v_actor,updated_at=now() WHERE id=v_receipt.id AND org_id=v_org AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_STATE_CHANGED'; END IF;
  RETURN jsonb_build_object('success',true,'duplicate',false,'receipt_id',v_receipt.id,'entry_id',v_entry_id,'status','posted');
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_post_supplier_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_org uuid;
  v_payment public.supplier_payments%ROWTYPE;
  v_payment_account uuid; v_ap_account uuid; v_entry_id uuid;
  v_line record; v_allocation_total numeric:=0; v_open numeric;
  v_new_paid numeric; v_line_count integer:=0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org:=public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED'; END IF;
  SELECT * INTO v_payment FROM public.supplier_payments WHERE id=p_payment_id AND org_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG'; END IF;
  IF v_payment.status='posted' AND v_payment.gl_entry_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.gl_entries e WHERE e.id=v_payment.gl_entry_id AND e.org_id=v_org AND e.status='posted') THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_POSTED_GL_INVALID'; END IF;
    RETURN jsonb_build_object('success',true,'duplicate',true,'payment_id',v_payment.id,'entry_id',v_payment.gl_entry_id,'status','posted');
  END IF;
  IF v_payment.status<>'draft' THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_DRAFT: status=%',v_payment.status; END IF;
  v_payment_account:=v_payment.payment_account_id;
  IF v_payment_account IS NULL THEN SELECT a.id INTO v_payment_account FROM public.gl_accounts a WHERE a.org_id=v_org AND a.subtype=CASE WHEN v_payment.payment_method='cash' THEN 'CASH' ELSE 'BANK' END AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true) ORDER BY a.code,a.id LIMIT 1; END IF;
  SELECT a.id INTO v_ap_account FROM public.gl_accounts a WHERE a.org_id=v_org AND a.subtype IN ('ACCOUNTS_PAYABLE','AP') AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true) ORDER BY a.code,a.id LIMIT 1;
  IF v_payment_account IS NULL OR v_ap_account IS NULL THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_GL_ACCOUNTS_MISSING'; END IF;
  FOR v_line IN SELECT l.invoice_id,l.allocated_amount,coalesce(l.discount_amount,0) discount_amount,i.org_id,i.vendor_id,i.total_amount,coalesce(i.paid_amount,0) paid_amount,i.status FROM public.supplier_payment_lines l JOIN public.supplier_invoices i ON i.id=l.invoice_id WHERE l.payment_id=v_payment.id ORDER BY i.id FOR UPDATE OF i LOOP
    v_line_count:=v_line_count+1;
    IF v_line.org_id<>v_org OR v_line.vendor_id<>v_payment.vendor_id THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_CROSS_SCOPE'; END IF;
    IF v_line.status NOT IN ('approved','partially_paid','overdue') THEN RAISE EXCEPTION 'SUPPLIER_INVOICE_NOT_PAYABLE: invoice=% status=%',v_line.invoice_id,v_line.status; END IF;
    IF v_line.discount_amount<>0 THEN RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required'; END IF;
    v_open:=round(v_line.total_amount-v_line.paid_amount,2);
    IF round(v_line.allocated_amount,2)>v_open THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_OVER_ALLOCATION: invoice=% open=% allocated=%',v_line.invoice_id,v_open,v_line.allocated_amount; END IF;
    v_allocation_total:=v_allocation_total+round(v_line.allocated_amount,2);
  END LOOP;
  IF v_line_count>0 AND round(v_allocation_total,2)<>round(v_payment.amount,2) THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH: allocations=% payment=%',v_allocation_total,v_payment.amount; END IF;
  v_entry_id:=public.wardah_create_posted_voucher_gl(v_org,'SUPPLIER_PAYMENT',v_payment.id,v_payment.payment_number,v_payment.payment_date,'سند صرف '||v_payment.payment_number,v_ap_account,v_payment_account,v_payment.amount,v_actor);
  FOR v_line IN SELECT l.invoice_id,l.allocated_amount,i.total_amount,coalesce(i.paid_amount,0) paid_amount FROM public.supplier_payment_lines l JOIN public.supplier_invoices i ON i.id=l.invoice_id WHERE l.payment_id=v_payment.id ORDER BY i.id FOR UPDATE OF i LOOP
    v_new_paid:=round(v_line.paid_amount+v_line.allocated_amount,2);
    UPDATE public.supplier_invoices SET paid_amount=v_new_paid,balance=round(total_amount-v_new_paid,2),status=CASE WHEN v_new_paid>=round(total_amount,2) THEN 'paid' ELSE 'partially_paid' END,updated_at=now() WHERE id=v_line.invoice_id AND org_id=v_org;
  END LOOP;
  UPDATE public.supplier_payments SET status='posted',gl_entry_id=v_entry_id,posted_at=now(),posted_by=v_actor,updated_at=now() WHERE id=v_payment.id AND org_id=v_org AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_STATE_CHANGED'; END IF;
  RETURN jsonb_build_object('success',true,'duplicate',false,'payment_id',v_payment.id,'entry_id',v_entry_id,'status','posted');
END
$function$;

REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_customer_receipt(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_supplier_payment(uuid) TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.permissions WHERE permission_key='accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'VOUCHER_166_PERMISSION_MISSING';
  END IF;
  IF has_function_privilege('anon','public.rpc_reset_customer_receipt_to_draft(uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.rpc_reset_supplier_payment_to_draft(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rpc_reset_customer_receipt_to_draft(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rpc_reset_supplier_payment_to_draft(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'VOUCHER_166_RPC_GRANT_VERIFY_FAILED';
  END IF;
END
$verify$;

COMMIT;
