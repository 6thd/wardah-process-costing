-- migration_number: 149
-- description: Close the purchase-order approval bypass left by migration 148,
--              and keep unresolved inspection / rejected quantities within the
--              legal open contract balance.
-- safety: replace-only RPC definitions. No data, table, column, policy, or trigger
--         is removed or reinterpreted.

CREATE OR REPLACE FUNCTION public.rpc_list_uom_receivable_purchase_orders(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_enabled boolean := false;
BEGIN
  v_org := public.wardah_org_id(p_org_id);
  PERFORM public.wardah_assert_org_member(v_org);

  SELECT CASE
    WHEN jsonb_typeof(os.value -> 'enabled') = 'boolean'
      THEN (os.value ->> 'enabled')::boolean
    WHEN lower(COALESCE(os.value ->> 'enabled', '')) IN ('true', 'false')
      THEN (os.value ->> 'enabled')::boolean
    ELSE false
  END
  INTO v_enabled
  FROM public.org_settings os
  WHERE os.org_id = v_org
    AND os.key = 'uom_engine_enabled'
  LIMIT 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'UOM_ENGINE_NOT_ENABLED_FOR_ORG';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', po.id,
        'order_number', po.order_number,
        'vendor_id', po.vendor_id,
        'vendor', jsonb_build_object(
          'id', v.id,
          'code', v.code,
          'name', v.name
        ),
        'order_date', po.order_date,
        'expected_delivery_date', po.expected_delivery_date,
        'status', po.status,
        'total_amount', COALESCE(po.total_amount, 0),
        'lines', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', pol.id,
              'line_number', pol.line_number,
              'product_id', pol.product_id,
              'product', jsonb_build_object(
                'code', p.code,
                'name', p.name,
                'name_ar', p.name_ar
              ),
              'uom_id', COALESCE(pol.uom_id, p.base_uom_id),
              'uom', jsonb_build_object(
                'id', u.id,
                'code', u.code,
                'name', u.name,
                'name_ar', u.name_ar,
                'symbol', u.symbol,
                'decimal_places', u.decimal_places
              ),
              'conversion_factor_snapshot',
                COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
              'ordered_qty_entered', COALESCE(
                pol.qty_entered,
                round(pol.quantity / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1), 6)
              ),
              'ordered_qty_base', pol.quantity,
              'received_qty_entered', round(
                COALESCE(pol.received_quantity, 0)
                / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
                6
              ),
              'received_qty_base', COALESCE(pol.received_quantity, 0),
              'accepted_qty_base', COALESCE(pol.accepted_quantity, 0),
              'rejected_qty_base', COALESCE(pol.rejected_quantity, 0),
              'pending_qty_base', GREATEST(
                COALESCE(pol.received_quantity, 0)
                - COALESCE(pol.accepted_quantity, 0)
                - COALESCE(pol.rejected_quantity, 0),
                0
              ),
              'remaining_qty_entered', round(
                GREATEST(
                  pol.quantity
                  - COALESCE(pol.accepted_quantity, 0)
                  - GREATEST(
                      COALESCE(pol.received_quantity, 0)
                      - COALESCE(pol.accepted_quantity, 0)
                      - COALESCE(pol.rejected_quantity, 0),
                      0
                    ),
                  0
                )
                / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
                6
              ),
              'remaining_qty_base', GREATEST(
                pol.quantity
                - COALESCE(pol.accepted_quantity, 0)
                - GREATEST(
                    COALESCE(pol.received_quantity, 0)
                    - COALESCE(pol.accepted_quantity, 0)
                    - COALESCE(pol.rejected_quantity, 0),
                    0
                  ),
                0
              ),
              'unit_cost_entered', COALESCE(
                pol.unit_price_entered,
                round(pol.unit_price * COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1), 6)
              ),
              'unit_cost_base', pol.unit_price
            ) ORDER BY pol.line_number, pol.id
          )
          FROM public.purchase_order_lines pol
          JOIN public.products p
            ON p.id = pol.product_id
           AND p.org_id = v_org
          LEFT JOIN public.uoms u
            ON u.id = COALESCE(pol.uom_id, p.base_uom_id)
           AND (u.org_id IS NULL OR u.org_id = v_org)
          WHERE pol.purchase_order_id = po.id
            AND pol.org_id = v_org
            AND COALESCE(pol.accepted_quantity, 0)
                + GREATEST(
                    COALESCE(pol.received_quantity, 0)
                    - COALESCE(pol.accepted_quantity, 0)
                    - COALESCE(pol.rejected_quantity, 0),
                    0
                  ) < pol.quantity
        ), '[]'::jsonb)
      ) ORDER BY po.order_date DESC, po.order_number DESC, po.id
    )
    FROM public.purchase_orders po
    JOIN public.vendors v
      ON v.id = po.vendor_id
     AND v.org_id = v_org
    WHERE po.org_id = v_org
      AND po.status IN ('approved', 'partially_received')
      AND EXISTS (
        SELECT 1
        FROM public.purchase_order_lines open_line
        WHERE open_line.purchase_order_id = po.id
          AND open_line.org_id = v_org
          AND COALESCE(open_line.accepted_quantity, 0)
              + GREATEST(
                  COALESCE(open_line.received_quantity, 0)
                  - COALESCE(open_line.accepted_quantity, 0)
                  - COALESCE(open_line.rejected_quantity, 0),
                  0
                ) < open_line.quantity
      )
  ), '[]'::jsonb);
END;
$function$;

-- Patch only the authorization / quality guards around the final Migration-148
-- implementation. The complete atomic implementation remains internal.
ALTER FUNCTION public.rpc_post_goods_receipt(jsonb)
  RENAME TO rpc_post_goods_receipt_148_internal;

CREATE OR REPLACE FUNCTION public.rpc_post_goods_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_po_id uuid;
  v_status text;
  v_idem_key text;
  v_line jsonb;
  v_quality text;
  v_pol_id uuid;
  v_qty_entered numeric;
  v_qty_base numeric;
  v_factor numeric;
  v_remaining numeric;
  v_pol record;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GR_PAYLOAD_OBJECT_REQUIRED';
  END IF;

  v_org := public.wardah_org_id(NULLIF(p_payload ->> 'tenant_id', '')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);

  v_po_id := NULLIF(p_payload ->> 'purchase_order_id', '')::uuid;
  IF v_po_id IS NOT NULL THEN
    SELECT po.status
    INTO v_status
    FROM public.purchase_orders po
    WHERE po.id = v_po_id
      AND po.org_id = v_org
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
    IF v_status NOT IN ('approved', 'partially_received') THEN
      RAISE EXCEPTION 'PO_NOT_RECEIVABLE: %', v_status;
    END IF;
  END IF;

  -- A replay must reach the immutable implementation first: current open balance
  -- may be lower because the original request already succeeded. The internal RPC
  -- compares request_hash and returns the original document without duplicating it.
  v_idem_key := NULLIF(p_payload ->> 'idempotency_key', '');
  IF v_idem_key IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.goods_receipts gr
    WHERE gr.org_id = v_org
      AND gr.idempotency_key = v_idem_key
  ) THEN
    RETURN public.rpc_post_goods_receipt_148_internal(p_payload);
  END IF;

  IF v_po_id IS NOT NULL THEN
    FOR v_line IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_payload -> 'lines', '[]'::jsonb))
    LOOP
      v_quality := COALESCE(NULLIF(v_line ->> 'quality_status', ''), 'accepted');
      v_pol_id := NULLIF(v_line ->> 'purchase_order_line_id', '')::uuid;

      IF v_quality = 'pending_inspection' THEN
        RAISE EXCEPTION 'PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW';
      END IF;

      -- Accepted quantities are guarded by the internal atomic implementation.
      -- Rejected quantities release the balance after posting, but a single rejected
      -- delivery still cannot exceed the balance that was open when it arrived.
      IF v_quality = 'rejected' AND v_pol_id IS NOT NULL THEN
        SELECT
          pol.purchase_order_id,
          pol.quantity,
          COALESCE(pol.received_quantity, 0) AS received,
          COALESCE(pol.accepted_quantity, 0) AS accepted,
          COALESCE(pol.rejected_quantity, 0) AS rejected,
          pol.conversion_factor_snapshot,
          pol.uom_id,
          p.base_uom_id
        INTO v_pol
        FROM public.purchase_order_lines pol
        JOIN public.products p
          ON p.id = pol.product_id
         AND p.org_id = v_org
        WHERE pol.id = v_pol_id
          AND pol.org_id = v_org
        FOR UPDATE OF pol;

        IF NOT FOUND OR v_pol.purchase_order_id <> v_po_id THEN
          RAISE EXCEPTION 'INVALID_PO_LINE';
        END IF;

        IF v_pol.conversion_factor_snapshot IS NULL
           OR v_pol.conversion_factor_snapshot <= 0 THEN
          IF v_pol.uom_id IS DISTINCT FROM v_pol.base_uom_id THEN
            RAISE EXCEPTION 'PO_LINE_SNAPSHOT_MISSING';
          END IF;
          v_factor := 1;
        ELSE
          v_factor := v_pol.conversion_factor_snapshot;
        END IF;

        v_qty_entered := NULLIF(v_line ->> 'qty_entered', '')::numeric;
        IF v_qty_entered IS NULL THEN
          IF v_factor <> 1 THEN
            RAISE EXCEPTION 'RECEIPT_SNAPSHOT_CONTRACT_REQUIRED';
          END IF;
          v_qty_entered := NULLIF(v_line ->> 'received_quantity', '')::numeric;
        END IF;
        IF v_qty_entered IS NULL OR v_qty_entered <= 0 THEN
          RAISE EXCEPTION 'RECEIPT_QUANTITY_MUST_BE_POSITIVE';
        END IF;

        v_qty_base := round(v_qty_entered * v_factor, 6);
        v_remaining := GREATEST(
          v_pol.quantity
          - v_pol.accepted
          - GREATEST(v_pol.received - v_pol.accepted - v_pol.rejected, 0),
          0
        );

        IF v_qty_base > v_remaining THEN
          RAISE EXCEPTION 'REJECTED_QUANTITY_EXCEEDS_OPEN_BALANCE: remaining=%, requested_base=%',
            v_remaining, v_qty_base;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN public.rpc_post_goods_receipt_148_internal(p_payload);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt_148_internal(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt_148_internal(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt_148_internal(jsonb) FROM authenticated;

REVOKE ALL ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(jsonb) TO authenticated;
