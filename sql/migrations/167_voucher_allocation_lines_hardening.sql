-- =====================================================================
-- 167_voucher_allocation_lines_hardening
-- =====================================================================
-- Close direct mutation paths on customer receipt and supplier payment
-- allocation lines while preserving the current two-step draft creation flow.
--
-- This migration intentionally keeps direct INSERT for authenticated users
-- only for brand-new draft vouchers whose gl_entry_id is NULL. UPDATE/DELETE
-- are reserved for future SECURITY DEFINER RPCs through a transaction-local
-- GUC. Reset vouchers retain gl_entry_id and therefore cannot receive direct
-- client line inserts.
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
  v_count bigint;
BEGIN
  IF to_regclass('public.customer_collections') IS NULL
     OR to_regclass('public.customer_collection_lines') IS NULL
     OR to_regclass('public.supplier_payments') IS NULL
     OR to_regclass('public.supplier_payment_lines') IS NULL
     OR to_regclass('public.sales_invoices') IS NULL
     OR to_regclass('public.supplier_invoices') IS NULL
     OR to_regclass('public.audit_logs') IS NULL
     OR to_regclass('public.gl_entries') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_167_REQUIRED_OBJECT_MISSING';
  END IF;

  IF to_regprocedure('public.wardah_org_id(uuid)') IS NULL
     OR to_regprocedure('public.wardah_is_org_member(uuid)') IS NULL
     OR to_regprocedure('public.rpc_reset_customer_receipt_to_draft(uuid,text)') IS NULL
     OR to_regprocedure('public.rpc_reset_supplier_payment_to_draft(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_167_REQUIRED_FUNCTION_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_collection_lines
  WHERE invoice_id IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VOUCHER_167_NULL_CUSTOMER_INVOICE_LINES: count=%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.supplier_payment_lines
  WHERE invoice_id IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VOUCHER_167_NULL_SUPPLIER_INVOICE_LINES: count=%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_collection_lines l
  LEFT JOIN public.customer_collections c ON c.id = l.collection_id
  LEFT JOIN public.sales_invoices i ON i.id = l.invoice_id
  WHERE c.id IS NULL
     OR i.id IS NULL
     OR i.org_id <> c.org_id
     OR i.customer_id <> c.customer_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VOUCHER_167_CUSTOMER_LINE_SCOPE_DRIFT: count=%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.supplier_payment_lines l
  LEFT JOIN public.supplier_payments p ON p.id = l.payment_id
  LEFT JOIN public.supplier_invoices i ON i.id = l.invoice_id
  WHERE p.id IS NULL
     OR i.id IS NULL
     OR i.org_id <> p.org_id
     OR i.vendor_id <> p.vendor_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VOUCHER_167_SUPPLIER_LINE_SCOPE_DRIFT: count=%', v_count;
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. Allocation invoice references are mandatory and deletion-restricting.
-- ON DELETE SET NULL is incompatible with the financial allocation contract.
-- ---------------------------------------------------------------------
ALTER TABLE public.customer_collection_lines
  ALTER COLUMN invoice_id SET NOT NULL;

ALTER TABLE public.supplier_payment_lines
  ALTER COLUMN invoice_id SET NOT NULL;

ALTER TABLE public.customer_collection_lines
  DROP CONSTRAINT IF EXISTS customer_collection_lines_invoice_id_fkey;

ALTER TABLE public.customer_collection_lines
  ADD CONSTRAINT customer_collection_lines_invoice_id_fkey
  FOREIGN KEY (invoice_id)
  REFERENCES public.sales_invoices(id)
  ON DELETE RESTRICT;

ALTER TABLE public.supplier_payment_lines
  DROP CONSTRAINT IF EXISTS supplier_payment_lines_invoice_id_fkey;

ALTER TABLE public.supplier_payment_lines
  ADD CONSTRAINT supplier_payment_lines_invoice_id_fkey
  FOREIGN KEY (invoice_id)
  REFERENCES public.supplier_invoices(id)
  ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- 2. Replace misleading FOR ALL / PUBLIC policies with explicit read and
-- narrow insert contracts. Active membership and active tenant must match.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS customer_collection_lines_select_policy
  ON public.customer_collection_lines;
DROP POLICY IF EXISTS supplier_payment_lines_select_policy
  ON public.supplier_payment_lines;
DROP POLICY IF EXISTS customer_collection_lines_org_read
  ON public.customer_collection_lines;
DROP POLICY IF EXISTS customer_collection_lines_org_insert_new_draft
  ON public.customer_collection_lines;
DROP POLICY IF EXISTS supplier_payment_lines_org_read
  ON public.supplier_payment_lines;
DROP POLICY IF EXISTS supplier_payment_lines_org_insert_new_draft
  ON public.supplier_payment_lines;

CREATE POLICY customer_collection_lines_org_read
ON public.customer_collection_lines
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.customer_collections c
    JOIN public.user_organizations uo
      ON uo.org_id = c.org_id
     AND uo.user_id = auth.uid()
     AND uo.is_active IS TRUE
    WHERE c.id = customer_collection_lines.collection_id
      AND c.org_id = public.wardah_org_id(NULL::uuid)
  )
);

CREATE POLICY supplier_payment_lines_org_read
ON public.supplier_payment_lines
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.supplier_payments p
    JOIN public.user_organizations uo
      ON uo.org_id = p.org_id
     AND uo.user_id = auth.uid()
     AND uo.is_active IS TRUE
    WHERE p.id = supplier_payment_lines.payment_id
      AND p.org_id = public.wardah_org_id(NULL::uuid)
  )
);

CREATE POLICY customer_collection_lines_org_insert_new_draft
ON public.customer_collection_lines
FOR INSERT
TO authenticated
WITH CHECK (
  invoice_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.customer_collections c
    JOIN public.user_organizations uo
      ON uo.org_id = c.org_id
     AND uo.user_id = auth.uid()
     AND uo.is_active IS TRUE
    JOIN public.sales_invoices i
      ON i.id = customer_collection_lines.invoice_id
     AND i.org_id = c.org_id
     AND i.customer_id = c.customer_id
    WHERE c.id = customer_collection_lines.collection_id
      AND c.org_id = public.wardah_org_id(NULL::uuid)
      AND c.status = 'draft'
      AND c.gl_entry_id IS NULL
  )
);

CREATE POLICY supplier_payment_lines_org_insert_new_draft
ON public.supplier_payment_lines
FOR INSERT
TO authenticated
WITH CHECK (
  invoice_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.supplier_payments p
    JOIN public.user_organizations uo
      ON uo.org_id = p.org_id
     AND uo.user_id = auth.uid()
     AND uo.is_active IS TRUE
    JOIN public.supplier_invoices i
      ON i.id = supplier_payment_lines.invoice_id
     AND i.org_id = p.org_id
     AND i.vendor_id = p.vendor_id
    WHERE p.id = supplier_payment_lines.payment_id
      AND p.org_id = public.wardah_org_id(NULL::uuid)
      AND p.status = 'draft'
      AND p.gl_entry_id IS NULL
  )
);

-- ---------------------------------------------------------------------
-- 3. Minimize table privileges. service_role intentionally retains its
-- existing privileges for server-side operations, but bypasses RLS and is
-- therefore still constrained by the trigger below unless the local GUC is on.
-- ---------------------------------------------------------------------
REVOKE ALL ON TABLE public.customer_collection_lines FROM anon;
REVOKE ALL ON TABLE public.supplier_payment_lines FROM anon;

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.customer_collection_lines FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.supplier_payment_lines FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.customer_collection_lines TO authenticated;
GRANT SELECT, INSERT ON TABLE public.supplier_payment_lines TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Defense-in-depth trigger. Future atomic edit RPCs may set
-- wardah.voucher_lines_write=on transaction-locally, perform their complete
-- replacement, read ROW_COUNT, and turn it off before raising any error.
-- Direct UPDATE/DELETE are always rejected. Direct INSERT is accepted only for
-- the current legacy creation path: a brand-new draft with no GL identity.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_protect_voucher_allocation_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_internal_write boolean :=
    coalesce(current_setting('wardah.voucher_lines_write', true), '') = 'on';
  v_org uuid;
  v_parent_status text;
  v_parent_gl_entry_id uuid;
BEGIN
  IF v_internal_write THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN: operation=% table=%',
      TG_OP, TG_TABLE_NAME;
  END IF;

  IF TG_TABLE_NAME = 'customer_collection_lines' THEN
    SELECT c.org_id, c.status, c.gl_entry_id
    INTO v_org, v_parent_status, v_parent_gl_entry_id
    FROM public.customer_collections c
    WHERE c.id = NEW.collection_id;

    IF NOT FOUND
       OR NEW.invoice_id IS NULL
       OR v_parent_status <> 'draft'
       OR v_parent_gl_entry_id IS NOT NULL
       OR v_org IS DISTINCT FROM public.wardah_org_id(NULL::uuid)
       OR NOT public.wardah_is_org_member(v_org)
       OR NOT EXISTS (
         SELECT 1
         FROM public.user_organizations uo
         WHERE uo.user_id = auth.uid()
           AND uo.org_id = v_org
           AND uo.is_active IS TRUE
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.sales_invoices i
         JOIN public.customer_collections c ON c.id = NEW.collection_id
         WHERE i.id = NEW.invoice_id
           AND i.org_id = v_org
           AND i.customer_id = c.customer_id
       ) THEN
      RAISE EXCEPTION 'CUSTOMER_ALLOCATION_INSERT_SCOPE_INVALID';
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_payment_lines' THEN
    SELECT p.org_id, p.status, p.gl_entry_id
    INTO v_org, v_parent_status, v_parent_gl_entry_id
    FROM public.supplier_payments p
    WHERE p.id = NEW.payment_id;

    IF NOT FOUND
       OR NEW.invoice_id IS NULL
       OR v_parent_status <> 'draft'
       OR v_parent_gl_entry_id IS NOT NULL
       OR v_org IS DISTINCT FROM public.wardah_org_id(NULL::uuid)
       OR NOT public.wardah_is_org_member(v_org)
       OR NOT EXISTS (
         SELECT 1
         FROM public.user_organizations uo
         WHERE uo.user_id = auth.uid()
           AND uo.org_id = v_org
           AND uo.is_active IS TRUE
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.supplier_invoices i
         JOIN public.supplier_payments p ON p.id = NEW.payment_id
         WHERE i.id = NEW.invoice_id
           AND i.org_id = v_org
           AND i.vendor_id = p.vendor_id
       ) THEN
      RAISE EXCEPTION 'SUPPLIER_ALLOCATION_INSERT_SCOPE_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'VOUCHER_ALLOCATION_TRIGGER_TABLE_INVALID: %', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_protect_voucher_allocation_lines() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_protect_voucher_allocation_lines() FROM anon;
REVOKE ALL ON FUNCTION public.wardah_protect_voucher_allocation_lines() FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_protect_voucher_allocation_lines() FROM service_role;

DROP TRIGGER IF EXISTS trg_protect_customer_collection_lines
  ON public.customer_collection_lines;
CREATE TRIGGER trg_protect_customer_collection_lines
BEFORE INSERT OR UPDATE OR DELETE ON public.customer_collection_lines
FOR EACH ROW EXECUTE FUNCTION public.wardah_protect_voucher_allocation_lines();

DROP TRIGGER IF EXISTS trg_protect_supplier_payment_lines
  ON public.supplier_payment_lines;
CREATE TRIGGER trg_protect_supplier_payment_lines
BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payment_lines
FOR EACH ROW EXECUTE FUNCTION public.wardah_protect_voucher_allocation_lines();

-- ---------------------------------------------------------------------
-- 5. Enrich Migration 166 reset audit before the first Production reset.
-- The financial rollback behavior is unchanged; only the immutable evidence
-- written to audit_logs is expanded.
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
  v_gl_update_count integer;
  v_allocations jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 5 THEN
    RAISE EXCEPTION 'VOUCHER_UNPOST_REASON_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.wardah_has_exact_permission(v_actor, v_org, 'accounting.vouchers.unpost') THEN
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

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_id', l.id,
        'invoice_id', l.invoice_id,
        'allocated_amount', l.allocated_amount,
        'discount_amount', coalesce(l.discount_amount,0),
        'notes', l.notes
      ) ORDER BY l.id
    ),
    '[]'::jsonb
  ) INTO v_allocations
  FROM public.customer_collection_lines l
  WHERE l.collection_id = v_receipt.id;

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
  GET DIAGNOSTICS v_gl_update_count = ROW_COUNT;
  PERFORM set_config('wardah.voucher_unpost','off',true);
  IF v_gl_update_count <> 1 THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_GL_STATE_CHANGED'; END IF;

  UPDATE public.customer_collections
  SET status='draft', posted_at=NULL, posted_by=NULL, updated_at=now()
  WHERE id=v_receipt.id AND org_id=v_org AND status='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_STATE_CHANGED'; END IF;

  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data,changes,metadata
  ) VALUES (
    v_org,v_actor,'voucher_reset_to_draft','customer_receipt',v_receipt.id::text,
    jsonb_build_object(
      'status',v_receipt.status,
      'posted_at',v_receipt.posted_at,
      'posted_by',v_receipt.posted_by,
      'gl_status',v_entry.status,
      'gl_entry_id',v_entry.id,
      'entry_number',v_entry.entry_number,
      'gl_posted_at',v_entry.posted_at,
      'gl_posted_by',v_entry.posted_by,
      'reference_number',v_entry.reference_number,
      'allocations',v_allocations
    ),
    jsonb_build_object(
      'status','draft','posted_at',NULL,'posted_by',NULL,
      'gl_status','draft','gl_entry_id',v_entry.id,
      'entry_number',v_entry.entry_number,
      'allocations',v_allocations
    ),
    jsonb_build_object('reason',trim(p_reason)),
    jsonb_build_object('source','rpc_reset_customer_receipt_to_draft','audit_contract','167')
  );

  RETURN jsonb_build_object('success',true,'duplicate',false,'receipt_id',v_receipt.id,
    'entry_id',v_entry.id,'status','draft');
END
$function$;

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
  v_gl_update_count integer;
  v_allocations jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 5 THEN
    RAISE EXCEPTION 'VOUCHER_UNPOST_REASON_REQUIRED';
  END IF;

  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;
  IF NOT public.wardah_has_exact_permission(v_actor, v_org, 'accounting.vouchers.unpost') THEN
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

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'line_id', l.id,
        'invoice_id', l.invoice_id,
        'allocated_amount', l.allocated_amount,
        'discount_amount', coalesce(l.discount_amount,0),
        'notes', l.notes
      ) ORDER BY l.id
    ),
    '[]'::jsonb
  ) INTO v_allocations
  FROM public.supplier_payment_lines l
  WHERE l.payment_id = v_payment.id;

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
  GET DIAGNOSTICS v_gl_update_count = ROW_COUNT;
  PERFORM set_config('wardah.voucher_unpost','off',true);
  IF v_gl_update_count <> 1 THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_GL_STATE_CHANGED'; END IF;

  UPDATE public.supplier_payments
  SET status='draft', posted_at=NULL, posted_by=NULL, updated_at=now()
  WHERE id=v_payment.id AND org_id=v_org AND status='posted';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_STATE_CHANGED'; END IF;

  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data,changes,metadata
  ) VALUES (
    v_org,v_actor,'voucher_reset_to_draft','supplier_payment',v_payment.id::text,
    jsonb_build_object(
      'status',v_payment.status,
      'posted_at',v_payment.posted_at,
      'posted_by',v_payment.posted_by,
      'gl_status',v_entry.status,
      'gl_entry_id',v_entry.id,
      'entry_number',v_entry.entry_number,
      'gl_posted_at',v_entry.posted_at,
      'gl_posted_by',v_entry.posted_by,
      'reference_number',v_entry.reference_number,
      'allocations',v_allocations
    ),
    jsonb_build_object(
      'status','draft','posted_at',NULL,'posted_by',NULL,
      'gl_status','draft','gl_entry_id',v_entry.id,
      'entry_number',v_entry.entry_number,
      'allocations',v_allocations
    ),
    jsonb_build_object('reason',trim(p_reason)),
    jsonb_build_object('source','rpc_reset_supplier_payment_to_draft','audit_contract','167')
  );

  RETURN jsonb_build_object('success',true,'duplicate',false,'payment_id',v_payment.id,
    'entry_id',v_entry.id,'status','draft');
END
$function$;

-- Preserve Migration 166 RPC grants after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reset_customer_receipt_to_draft(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reset_supplier_payment_to_draft(uuid,text) TO authenticated;

DO $verify$
DECLARE
  v_definition text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('customer_collection_lines','supplier_payment_lines')
      AND column_name='invoice_id'
      AND is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'VOUCHER_167_INVOICE_NOT_NULL_VERIFY_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.customer_collection_lines'::regclass
      AND conname='customer_collection_lines_invoice_id_fkey'
      AND pg_get_constraintdef(oid) LIKE '%ON DELETE RESTRICT%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.supplier_payment_lines'::regclass
      AND conname='supplier_payment_lines_invoice_id_fkey'
      AND pg_get_constraintdef(oid) LIKE '%ON DELETE RESTRICT%'
  ) THEN
    RAISE EXCEPTION 'VOUCHER_167_FK_RESTRICT_VERIFY_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('customer_collection_lines','supplier_payment_lines')
      AND (cmd='ALL' OR 'public'=ANY(roles))
  ) THEN
    RAISE EXCEPTION 'VOUCHER_167_PUBLIC_OR_ALL_POLICY_REMAINS';
  END IF;

  IF has_table_privilege('anon','public.customer_collection_lines','SELECT')
     OR has_table_privilege('anon','public.customer_collection_lines','INSERT')
     OR has_table_privilege('anon','public.customer_collection_lines','UPDATE')
     OR has_table_privilege('anon','public.customer_collection_lines','DELETE')
     OR has_table_privilege('anon','public.supplier_payment_lines','SELECT')
     OR has_table_privilege('anon','public.supplier_payment_lines','INSERT')
     OR has_table_privilege('anon','public.supplier_payment_lines','UPDATE')
     OR has_table_privilege('anon','public.supplier_payment_lines','DELETE') THEN
    RAISE EXCEPTION 'VOUCHER_167_ANON_PRIVILEGE_VERIFY_FAILED';
  END IF;

  IF NOT has_table_privilege('authenticated','public.customer_collection_lines','SELECT')
     OR NOT has_table_privilege('authenticated','public.customer_collection_lines','INSERT')
     OR has_table_privilege('authenticated','public.customer_collection_lines','UPDATE')
     OR has_table_privilege('authenticated','public.customer_collection_lines','DELETE')
     OR NOT has_table_privilege('authenticated','public.supplier_payment_lines','SELECT')
     OR NOT has_table_privilege('authenticated','public.supplier_payment_lines','INSERT')
     OR has_table_privilege('authenticated','public.supplier_payment_lines','UPDATE')
     OR has_table_privilege('authenticated','public.supplier_payment_lines','DELETE') THEN
    RAISE EXCEPTION 'VOUCHER_167_AUTH_PRIVILEGE_VERIFY_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.customer_collection_lines'::regclass
      AND tgname='trg_protect_customer_collection_lines'
      AND tgenabled='O' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.supplier_payment_lines'::regclass
      AND tgname='trg_protect_supplier_payment_lines'
      AND tgenabled='O' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'VOUCHER_167_TRIGGER_VERIFY_FAILED';
  END IF;

  SELECT pg_get_functiondef('public.rpc_reset_customer_receipt_to_draft(uuid,text)'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%entry_number%'
     OR v_definition NOT LIKE '%allocations%'
     OR v_definition NOT LIKE '%audit_contract%167%' THEN
    RAISE EXCEPTION 'VOUCHER_167_RECEIPT_AUDIT_VERIFY_FAILED';
  END IF;

  SELECT pg_get_functiondef('public.rpc_reset_supplier_payment_to_draft(uuid,text)'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%entry_number%'
     OR v_definition NOT LIKE '%allocations%'
     OR v_definition NOT LIKE '%audit_contract%167%' THEN
    RAISE EXCEPTION 'VOUCHER_167_PAYMENT_AUDIT_VERIFY_FAILED';
  END IF;
END
$verify$;

COMMIT;
