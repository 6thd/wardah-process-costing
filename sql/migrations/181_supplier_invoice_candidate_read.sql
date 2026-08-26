-- migration_number: 181
-- description: Add a tenant-scoped, permission-gated read RPC that lists
--              accepted, legally invoiceable GRN lines for the supplier-invoice
--              three-way-match UI without reopening any direct write surface.
-- safety: additive read-only RPC only. No table/column/policy/trigger mutation,
--         no rewrite of migrations 149-152, and no Production application in
--         this repository PR.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_list_supplier_invoice_candidates(
  p_org_id uuid,
  p_vendor_id uuid DEFAULT NULL,
  p_purchase_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  v_org := public.wardah_org_id(p_org_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORG_NOT_RESOLVED';
  END IF;

  PERFORM public.wardah_assert_org_member(v_org);

  -- D4 from the accepted supplier-invoice lifecycle decision record is all-of,
  -- not any-of. There is no purchasing.goods_receipts.* permission namespace in
  -- the current catalog; receipt visibility follows purchase-order read access.
  IF NOT public.has_permission(
       auth.uid(), v_org, 'purchasing.purchase_orders.read'
     )
     OR NOT public.has_permission(
       auth.uid(), v_org, 'purchasing.purchase_invoices.read'
     ) THEN
    RAISE EXCEPTION
      'AP_CANDIDATE_PERMISSION_DENIED: requires purchasing.purchase_orders.read and purchasing.purchase_invoices.read';
  END IF;

  IF p_vendor_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.vendors v
       WHERE v.id = p_vendor_id
         AND v.org_id = v_org
     ) THEN
    RAISE EXCEPTION 'AP_VENDOR_MISMATCH: vendor is outside the selected organization';
  END IF;

  IF p_purchase_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.purchase_orders po
       WHERE po.id = p_purchase_order_id
         AND po.org_id = v_org
     ) THEN
    -- Deliberately indistinguishable from a missing id: do not disclose that a
    -- purchase order exists in another organization.
    RAISE EXCEPTION 'AP_PO_NOT_FOUND: purchase order is not visible in the selected organization';
  END IF;

  IF p_vendor_id IS NOT NULL
     AND p_purchase_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.purchase_orders po
       WHERE po.id = p_purchase_order_id
         AND po.org_id = v_org
         AND po.vendor_id = p_vendor_id
     ) THEN
    RAISE EXCEPTION 'AP_VENDOR_MISMATCH: purchase order belongs to another vendor';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      q.candidate
      ORDER BY q.receipt_date DESC, q.receipt_number DESC, q.goods_receipt_line_id
    )
    FROM (
      SELECT
        gr.receipt_date,
        gr.receipt_number,
        grl.id AS goods_receipt_line_id,
        jsonb_build_object(
          'organization_id', v_org,
          'vendor_id', po.vendor_id,
          'vendor', jsonb_build_object(
            'id', v.id,
            'code', v.code,
            'name', v.name
          ),
          'purchase_order_id', po.id,
          'purchase_order_number', po.order_number,
          'purchase_order_status', po.status,
          'purchase_order_line_id', pol.id,
          'goods_receipt_id', gr.id,
          'goods_receipt_number', gr.receipt_number,
          'goods_receipt_status', gr.status,
          'goods_receipt_line_id', grl.id,
          'quality_status', grl.quality_status,
          'product_id', grl.product_id,
          'product', jsonb_build_object(
            'id', p.id,
            'code', p.code,
            'name', p.name,
            'name_ar', p.name_ar
          ),
          'uom_id', grl.uom_id,
          'uom', jsonb_build_object(
            'id', u.id,
            'code', u.code,
            'name', u.name,
            'name_ar', u.name_ar,
            'symbol', u.symbol,
            'decimal_places', u.decimal_places
          ),
          'conversion_factor_snapshot', grl.conversion_factor_snapshot,
          'accepted_qty_base', grl.received_quantity,
          'accepted_qty_entered', COALESCE(
            grl.qty_entered,
            round(grl.received_quantity / grl.conversion_factor_snapshot, 6)
          ),
          'allocated_qty_base', alloc.allocated_qty_base,
          'allocated_qty_entered', round(
            alloc.allocated_qty_base / grl.conversion_factor_snapshot,
            6
          ),
          'remaining_qty_base', grl.received_quantity - alloc.allocated_qty_base,
          'remaining_qty_entered', round(
            (grl.received_quantity - alloc.allocated_qty_base)
            / grl.conversion_factor_snapshot,
            6
          ),
          'po_unit_price_base', pol.unit_price,
          'po_unit_price_entered', COALESCE(
            pol.unit_price_entered,
            round(pol.unit_price * pol.conversion_factor_snapshot, 6)
          ),
          'discount_percentage', COALESCE(pol.discount_percentage, 0),
          'tax_percentage', COALESCE(pol.tax_percentage, 0)
        ) AS candidate
      FROM public.goods_receipt_lines grl
      JOIN public.goods_receipts gr
        ON gr.id = grl.goods_receipt_id
       AND gr.org_id = v_org
      JOIN public.purchase_order_lines pol
        ON pol.id = grl.purchase_order_line_id
       AND pol.org_id = v_org
      JOIN public.purchase_orders po
        ON po.id = pol.purchase_order_id
       AND po.org_id = v_org
      JOIN public.vendors v
        ON v.id = po.vendor_id
       AND v.org_id = v_org
      JOIN public.products p
        ON p.id = grl.product_id
       AND p.org_id = v_org
      JOIN public.uoms u
        ON u.id = grl.uom_id
       AND (u.org_id IS NULL OR u.org_id = v_org)
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
          CASE
            WHEN a.reversal_of_allocation_id IS NULL THEN a.quantity_base
            ELSE -a.quantity_base
          END
        ), 0)::numeric(18,6) AS allocated_qty_base
        FROM public.supplier_invoice_receipt_allocations a
        WHERE a.org_id = v_org
          AND a.goods_receipt_line_id = grl.id
      ) alloc ON true
      WHERE grl.org_id = v_org
        AND grl.quality_status = 'accepted'
        AND gr.status IN ('confirmed', 'posted')
        AND po.status IN (
          'approved',
          'partially_received',
          'fully_received',
          'received',
          'closed'
        )
        AND gr.vendor_id = po.vendor_id
        AND grl.product_id = pol.product_id
        -- The first UI slice is snapshot-backed only. Legacy/base-unit rows with
        -- incomplete immutable PO/GRN evidence are intentionally not candidates.
        AND grl.uom_id IS NOT NULL
        AND grl.conversion_factor_snapshot IS NOT NULL
        AND grl.conversion_factor_snapshot > 0
        AND pol.uom_id IS NOT NULL
        AND pol.conversion_factor_snapshot IS NOT NULL
        AND pol.conversion_factor_snapshot > 0
        AND pol.uom_id = grl.uom_id
        AND pol.conversion_factor_snapshot = grl.conversion_factor_snapshot
        AND alloc.allocated_qty_base >= 0
        AND alloc.allocated_qty_base < grl.received_quantity
        AND (p_vendor_id IS NULL OR po.vendor_id = p_vendor_id)
        AND (p_purchase_order_id IS NULL OR po.id = p_purchase_order_id)
    ) q
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_list_supplier_invoice_candidates(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_list_supplier_invoice_candidates(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_list_supplier_invoice_candidates(uuid, uuid, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_list_supplier_invoice_candidates(uuid, uuid, uuid) TO authenticated;

COMMIT;
