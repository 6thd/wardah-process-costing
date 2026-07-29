-- =====================================================================
-- 150_ap_matched_invoice_idempotency_and_grn_gate
-- =====================================================================
-- Hardening discovered while building the executable acceptance matrix for 149.
--
-- 149 used the normalized supplier invoice number itself as its idempotency key.
-- That made an exact retry indistinguishable from a changed request carrying the
-- same supplier document number. It also validated the receipt line and quality,
-- but not the legal state of the goods-receipt header.
--
-- This migration keeps the tested 149 implementation intact as an internal core,
-- and places the missing client contract in a narrow wrapper:
--   * explicit idempotency_key is mandatory;
--   * canonical jsonb request hash is persisted and compared on replay;
--   * changed payload under the same key fails closed;
--   * duplicate supplier invoice number is distinct from idempotent replay;
--   * every referenced GRN header must be confirmed/posted;
--   * the v149 core is no longer client executable.
-- =====================================================================

BEGIN;

ALTER FUNCTION public.rpc_create_matched_supplier_invoice(jsonb)
  RENAME TO rpc_create_matched_supplier_invoice_v149;

REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice_v149(jsonb) FROM service_role;

CREATE OR REPLACE FUNCTION public.rpc_create_matched_supplier_invoice(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org            uuid;
  v_vendor         uuid;
  v_invoice_number text;
  v_idem           text;
  v_hash           text;
  v_existing       record;
  v_bad_grn        record;
  v_result         jsonb;
  v_invoice_id     uuid;
BEGIN
  v_org            := NULLIF(p_payload ->> 'org_id', '')::uuid;
  v_vendor         := NULLIF(p_payload ->> 'vendor_id', '')::uuid;
  v_invoice_number := btrim(COALESCE(p_payload ->> 'invoice_number', ''));
  v_idem           := NULLIF(btrim(COALESCE(p_payload ->> 'idempotency_key', '')), '');

  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT public.has_permission(auth.uid(), v_org, 'purchasing.purchase_invoices.approve') THEN
    RAISE EXCEPTION
      'AP_POST_PERMISSION_DENIED: هذا المسار ينشئ الفاتورة ويرحّل قيدها معًا، ويتطلب صلاحية purchasing.purchase_invoices.approve';
  END IF;

  IF v_idem IS NULL THEN
    RAISE EXCEPTION 'AP_IDEMPOTENCY_KEY_REQUIRED: مفتاح إعادة المحاولة مطلوب للمطابقة الذرية';
  END IF;

  -- jsonb::text has deterministic key ordering, so semantically identical object
  -- key order produces the same digest. The idempotency key is intentionally part
  -- of the request identity; changing it is a new request, not a replay.
  v_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  SELECT id, request_hash, journal_entry_id, subtotal, tax_amount, total_amount
    INTO v_existing
  FROM public.supplier_invoices
  WHERE org_id = v_org AND idempotency_key = v_idem;

  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION
        'AP_IDEMPOTENCY_KEY_REUSED: المفتاح استُخدم سابقًا مع حمولة مختلفة';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'invoice_id', v_existing.id,
      'invoice_status', 'approved',
      'journal_entry_id', v_existing.journal_entry_id,
      'journal_status', 'posted',
      'subtotal', v_existing.subtotal,
      'tax_amount', v_existing.tax_amount,
      'total_amount', v_existing.total_amount
    );
  END IF;

  -- A supplier document number is a business uniqueness rule, not an idempotency
  -- mechanism. The same number under a different request key must be rejected.
  IF EXISTS (
    SELECT 1
    FROM public.supplier_invoices si
    WHERE si.org_id = v_org
      AND si.vendor_id = v_vendor
      AND si.match_status = 'matched'
      AND upper(btrim(si.invoice_number)) = upper(v_invoice_number)
  ) THEN
    RAISE EXCEPTION
      'AP_DUPLICATE_VENDOR_INVOICE_NUMBER: رقم فاتورة المورد مستخدم مسبقًا داخل المؤسسة والمورد';
  END IF;

  IF jsonb_typeof(p_payload -> 'lines') <> 'array'
     OR jsonb_array_length(p_payload -> 'lines') = 0 THEN
    RAISE EXCEPTION 'AP_LINES_REQUIRED: الفاتورة تحتاج سطرًا واحدًا على الأقل';
  END IF;

  SELECT gr.id, gr.status
    INTO v_bad_grn
  FROM jsonb_array_elements(p_payload -> 'lines') l
  JOIN public.goods_receipt_lines grl
    ON grl.id = NULLIF(l ->> 'goods_receipt_line_id', '')::uuid
  JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
  WHERE gr.org_id <> v_org
     OR gr.status NOT IN ('confirmed', 'posted')
  ORDER BY gr.id
  LIMIT 1;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.goods_receipts gr
      WHERE gr.id = v_bad_grn.id AND gr.org_id <> v_org
    ) THEN
      RAISE EXCEPTION 'AP_CROSS_ORG_REFERENCE: سند الاستلام خارج المؤسسة';
    END IF;
    RAISE EXCEPTION
      'AP_GRN_NOT_INVOICEABLE: حالة سند الاستلام % لا تسمح بالفوترة',
      v_bad_grn.status;
  END IF;

  v_result := public.rpc_create_matched_supplier_invoice_v149(p_payload);
  v_invoice_id := NULLIF(v_result ->> 'invoice_id', '')::uuid;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'AP_MATCHED_INVOICE_ID_MISSING: تنفيذ 149 لم يُعد معرّف الفاتورة — %', v_result;
  END IF;

  UPDATE public.supplier_invoices
  SET idempotency_key = v_idem,
      request_hash = v_hash,
      updated_at = now()
  WHERE id = v_invoice_id;

  RETURN v_result || jsonb_build_object('idempotency_key', v_idem);
EXCEPTION
  WHEN unique_violation THEN
    -- Covers a concurrent request that passed the pre-check and lost at the
    -- partial unique supplier-number index or the org/idempotency index.
    IF EXISTS (
      SELECT 1 FROM public.supplier_invoices si
      WHERE si.org_id = v_org
        AND si.idempotency_key = v_idem
        AND si.request_hash = v_hash
    ) THEN
      SELECT id, request_hash, journal_entry_id, subtotal, tax_amount, total_amount
        INTO v_existing
      FROM public.supplier_invoices
      WHERE org_id = v_org AND idempotency_key = v_idem;
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'invoice_id', v_existing.id,
        'invoice_status', 'approved',
        'journal_entry_id', v_existing.journal_entry_id,
        'journal_status', 'posted',
        'subtotal', v_existing.subtotal,
        'tax_amount', v_existing.tax_amount,
        'total_amount', v_existing.total_amount
      );
    END IF;
    RAISE EXCEPTION
      'AP_DUPLICATE_VENDOR_INVOICE_NUMBER: رقم فاتورة المورد أو مفتاح إعادة المحاولة مستخدم مسبقًا';
END $$;

REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_matched_supplier_invoice(jsonb) TO service_role;

COMMIT;
