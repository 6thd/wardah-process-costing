-- =====================================================================
-- 151_ap_helper_security_hardening
-- =====================================================================
-- The repository DEFINER guard caught two helper definitions introduced in 149:
--   * the immutability trigger did not need elevated privileges at all;
--   * the receipt-balance helper accepted only a GRN-line id and could disclose a
--     cross-organization balance to any authenticated caller granted EXECUTE.
--
-- Final contract:
--   * trigger function is SECURITY INVOKER (the default);
--   * balance helper resolves the owning organization, asserts membership, and
--     keeps every aggregate explicitly scoped to that organization.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.wardah_guard_allocation_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION
    'AP_ALLOCATION_IMMUTABLE: دفتر التخصيصات append-only — العكس يكون بصف جديد يشير إلى أصله، لا بتعديل أو حذف (العملية: %)',
    TG_OP;
END $$;

REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM anon;
REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_guard_allocation_immutability() FROM service_role;

CREATE OR REPLACE FUNCTION public.wardah_receipt_line_uninvoiced_base(
  p_goods_receipt_line_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_org             uuid;
  v_accepted_base   numeric(18,6);
  v_allocated_base  numeric(18,6);
BEGIN
  SELECT gr.org_id,
         CASE WHEN grl.quality_status = 'accepted'
              THEN COALESCE(grl.received_quantity,0)
              ELSE 0 END
    INTO v_org, v_accepted_base
  FROM public.goods_receipt_lines grl
  JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
  WHERE grl.id = p_goods_receipt_line_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION
      'AP_GRN_LINE_NOT_FOUND: سطر استلام غير موجود (%)',
      p_goods_receipt_line_id;
  END IF;

  PERFORM public.wardah_assert_org_member(v_org);

  SELECT COALESCE(SUM(
           CASE WHEN a.reversal_of_allocation_id IS NULL
                THEN a.quantity_base
                ELSE -a.quantity_base
           END),0)
    INTO v_allocated_base
  FROM public.supplier_invoice_receipt_allocations a
  WHERE a.org_id = v_org
    AND a.goods_receipt_line_id = p_goods_receipt_line_id;

  RETURN v_accepted_base - v_allocated_base;
END $$;

REVOKE ALL ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_receipt_line_uninvoiced_base(uuid) TO service_role;

COMMIT;
