-- Wardah ERP / F2 / M191 review slice 02
-- Objects 3-4 only: wardah_apply_stock_outgoing 8-arg + 9-arg.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority:
--   8-arg <- Migration 186
--   9-arg <- Migration 187
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * take the shared single-product prefix before any bins stock work;
--   * explicitly re-issue the live service_role-only helper ACL.
--
-- Preserved deliberately:
--   * wardah_assert_org_member and parameter-validation ordering;
--   * 9-arg STOCK_SOURCE_LINE_REQUIRED / STOCK_SOURCE_LINE_MISMATCH ordering;
--   * all-bins FOR UPDATE reservation-floor choreography from Migration 186;
--   * target-bin valuation update and SLE-before-bin mutation ordering;
--   * FIFO/LIFO/Weighted Average COGS, queue, rate, and value arithmetic;
--   * outgoing product projection: stock_quantity + stock_value + cost_price;
--   * search_path = public,pg_temp for both overloads;
--   * no Fix A/B retry or incoming-only behavior is introduced here.

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_outgoing(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_method text;
  v_prev_qty numeric;
  v_prev_value numeric;
  v_prev_queue jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_remaining numeric;
  v_take numeric;
  v_batch_qty numeric;
  v_batch_rate numeric;
  v_cogs numeric := 0;
  v_idx integer;
  v_len integer;
  v_prod_qty numeric;
  v_prod_value numeric;
  v_prod_rate numeric;
  v_total_on_hand numeric;
  v_other_mo_reserved numeric;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org);

  IF p_product IS NULL OR p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK_OUT_PARAMETERS';
  END IF;

  SELECT COALESCE(valuation_method::text, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  PERFORM 1
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product
  ORDER BY warehouse_id, id
  FOR UPDATE;

  SELECT COALESCE(SUM(actual_qty), 0)
  INTO v_total_on_hand
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;

  SELECT COALESCE(SUM(GREATEST(
    quantity_reserved - COALESCE(quantity_consumed, 0) - COALESCE(quantity_released, 0),
    0
  )), 0)
  INTO v_other_mo_reserved
  FROM public.material_reservations
  WHERE org_id = p_org
    AND product_id = p_product
    AND status = 'reserved'
    AND NOT (
      lower(COALESCE(p_voucher_type, '')) = 'material consumption'
      AND p_voucher_id IS NOT NULL
      AND mo_id = p_voucher_id
    );

  IF v_total_on_hand - p_qty < v_other_mo_reserved THEN
    RAISE EXCEPTION
      'INSUFFICIENT_UNRESERVED_STOCK: on_hand=%, protected_mo=%, requested=%',
      v_total_on_hand, v_other_mo_reserved, p_qty;
  END IF;

  SELECT COALESCE(actual_qty, 0), COALESCE(stock_value, 0),
         COALESCE(stock_queue, '[]'::jsonb)
  INTO v_prev_qty, v_prev_value, v_prev_queue
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product AND warehouse_id = p_warehouse
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BIN_NOT_FOUND';
  END IF;
  IF v_prev_qty < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: available=%, required=%', v_prev_qty, p_qty;
  END IF;

  v_new_qty := v_prev_qty - p_qty;
  v_new_queue := v_prev_queue;

  IF v_method IN ('FIFO', 'LIFO') AND jsonb_array_length(v_new_queue) > 0 THEN
    v_remaining := p_qty;
    WHILE v_remaining > 0 LOOP
      v_len := jsonb_array_length(v_new_queue);
      IF v_len = 0 THEN
        RAISE EXCEPTION 'STOCK_QUEUE_INSUFFICIENT';
      END IF;
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_batch_qty := COALESCE((v_new_queue -> v_idx ->> 'qty')::numeric, 0);
      v_batch_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
      IF v_batch_qty <= 0 THEN
        v_new_queue := v_new_queue - v_idx;
        CONTINUE;
      END IF;
      v_take := LEAST(v_remaining, v_batch_qty);
      v_cogs := v_cogs + (v_take * v_batch_rate);
      v_remaining := v_remaining - v_take;
      IF v_take = v_batch_qty THEN
        v_new_queue := v_new_queue - v_idx;
      ELSE
        v_new_queue := jsonb_set(
          v_new_queue,
          ARRAY[v_idx::text, 'qty'],
          to_jsonb(v_batch_qty - v_take),
          false
        );
      END IF;
    END LOOP;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    IF v_new_qty = 0 THEN
      v_new_rate := 0;
      v_new_queue := '[]'::jsonb;
    ELSE
      v_len := jsonb_array_length(v_new_queue);
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_new_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
    END IF;
  ELSE
    v_batch_rate := CASE WHEN v_prev_qty > 0 THEN v_prev_value / v_prev_qty ELSE 0 END;
    v_cogs := p_qty * v_batch_rate;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
    v_new_queue := CASE WHEN v_new_qty > 0
      THEN jsonb_build_array(jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate))
      ELSE '[]'::jsonb END;
  END IF;

  INSERT INTO public.stock_ledger_entries (
    voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
    posting_date, actual_qty, qty_after_transaction, outgoing_rate,
    valuation_rate, stock_value, stock_value_difference, stock_queue,
    is_cancelled, docstatus, org_id, created_by
  ) VALUES (
    p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
    COALESCE(p_posting_date, CURRENT_DATE), -p_qty, v_new_qty,
    CASE WHEN p_qty > 0 THEN v_cogs / p_qty ELSE 0 END,
    v_new_rate, v_new_value, -v_cogs, v_new_queue,
    false, 1, p_org, auth.uid()
  );

  UPDATE public.bins
  SET actual_qty = v_new_qty,
      valuation_rate = v_new_rate,
      stock_value = v_new_value,
      stock_queue = v_new_queue,
      updated_at = now()
  WHERE org_id = p_org AND product_id = p_product AND warehouse_id = p_warehouse;

  SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(stock_value), 0)
  INTO v_prod_qty, v_prod_value
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;
  v_prod_rate := CASE WHEN v_prod_qty > 0 THEN v_prod_value / v_prod_qty ELSE 0 END;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      stock_value = v_prod_value,
      cost_price = CASE WHEN v_prod_qty > 0 THEN v_prod_rate ELSE cost_price END,
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'cogs', round(v_cogs, 6),
    'method', v_method
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) TO service_role;

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_outgoing(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date,
  p_source_line_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_method text;
  v_prev_qty numeric;
  v_prev_value numeric;
  v_prev_queue jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_remaining numeric;
  v_take numeric;
  v_batch_qty numeric;
  v_batch_rate numeric;
  v_cogs numeric := 0;
  v_idx integer;
  v_len integer;
  v_prod_qty numeric;
  v_prod_value numeric;
  v_prod_rate numeric;
  v_total_on_hand numeric;
  v_other_mo_reserved numeric;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org);

  IF p_product IS NULL OR p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK_OUT_PARAMETERS';
  END IF;

  IF lower(btrim(COALESCE(p_voucher_type, ''))) = 'stock adjustment' THEN
    IF p_source_line_id IS NULL THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_REQUIRED';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.stock_adjustment_items sai
      JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
      WHERE sai.id = p_source_line_id
        AND sai.adjustment_id = p_voucher_id
        AND sai.organization_id = p_org
        AND sai.product_id = p_product
        AND COALESCE(sai.warehouse_id, sa.warehouse_id) = p_warehouse
        AND COALESCE(sa.org_id, sa.organization_id) = p_org
    ) THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_MISMATCH';
    END IF;
  END IF;

  SELECT COALESCE(valuation_method::text, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  PERFORM 1
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product
  ORDER BY warehouse_id, id
  FOR UPDATE;

  SELECT COALESCE(SUM(actual_qty), 0)
  INTO v_total_on_hand
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;

  SELECT COALESCE(SUM(GREATEST(
    quantity_reserved
      - COALESCE(quantity_consumed, 0)
      - COALESCE(quantity_released, 0),
    0
  )), 0)
  INTO v_other_mo_reserved
  FROM public.material_reservations
  WHERE org_id = p_org
    AND product_id = p_product
    AND status = 'reserved'
    AND NOT (
      lower(COALESCE(p_voucher_type, '')) = 'material consumption'
      AND p_voucher_id IS NOT NULL
      AND mo_id = p_voucher_id
    );

  IF v_total_on_hand - p_qty < v_other_mo_reserved THEN
    RAISE EXCEPTION
      'INSUFFICIENT_UNRESERVED_STOCK: on_hand=%, protected_mo=%, requested=%',
      v_total_on_hand, v_other_mo_reserved, p_qty;
  END IF;

  SELECT COALESCE(actual_qty, 0),
         COALESCE(stock_value, 0),
         COALESCE(stock_queue, '[]'::jsonb)
  INTO v_prev_qty, v_prev_value, v_prev_queue
  FROM public.bins
  WHERE org_id = p_org
    AND product_id = p_product
    AND warehouse_id = p_warehouse
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BIN_NOT_FOUND';
  END IF;
  IF v_prev_qty < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: available=%, required=%', v_prev_qty, p_qty;
  END IF;

  v_new_qty := v_prev_qty - p_qty;
  v_new_queue := v_prev_queue;

  IF v_method IN ('FIFO', 'LIFO') AND jsonb_array_length(v_new_queue) > 0 THEN
    v_remaining := p_qty;
    WHILE v_remaining > 0 LOOP
      v_len := jsonb_array_length(v_new_queue);
      IF v_len = 0 THEN
        RAISE EXCEPTION 'STOCK_QUEUE_INSUFFICIENT';
      END IF;
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_batch_qty := COALESCE((v_new_queue -> v_idx ->> 'qty')::numeric, 0);
      v_batch_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
      IF v_batch_qty <= 0 THEN
        v_new_queue := v_new_queue - v_idx;
        CONTINUE;
      END IF;
      v_take := LEAST(v_remaining, v_batch_qty);
      v_cogs := v_cogs + (v_take * v_batch_rate);
      v_remaining := v_remaining - v_take;
      IF v_take = v_batch_qty THEN
        v_new_queue := v_new_queue - v_idx;
      ELSE
        v_new_queue := jsonb_set(
          v_new_queue,
          ARRAY[v_idx::text, 'qty'],
          to_jsonb(v_batch_qty - v_take),
          false
        );
      END IF;
    END LOOP;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    IF v_new_qty = 0 THEN
      v_new_rate := 0;
      v_new_queue := '[]'::jsonb;
    ELSE
      v_len := jsonb_array_length(v_new_queue);
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_new_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
    END IF;
  ELSE
    v_batch_rate := CASE WHEN v_prev_qty > 0 THEN v_prev_value / v_prev_qty ELSE 0 END;
    v_cogs := p_qty * v_batch_rate;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
    v_new_queue := CASE
      WHEN v_new_qty > 0
        THEN jsonb_build_array(jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate))
      ELSE '[]'::jsonb
    END;
  END IF;

  INSERT INTO public.stock_ledger_entries (
    voucher_type,
    voucher_id,
    voucher_number,
    product_id,
    warehouse_id,
    posting_date,
    actual_qty,
    qty_after_transaction,
    outgoing_rate,
    valuation_rate,
    stock_value,
    stock_value_difference,
    stock_queue,
    is_cancelled,
    docstatus,
    org_id,
    created_by,
    source_line_id
  ) VALUES (
    p_voucher_type,
    p_voucher_id,
    p_voucher_number,
    p_product,
    p_warehouse,
    COALESCE(p_posting_date, CURRENT_DATE),
    -p_qty,
    v_new_qty,
    CASE WHEN p_qty > 0 THEN v_cogs / p_qty ELSE 0 END,
    v_new_rate,
    v_new_value,
    -v_cogs,
    v_new_queue,
    false,
    1,
    p_org,
    auth.uid(),
    p_source_line_id
  );

  UPDATE public.bins
  SET actual_qty = v_new_qty,
      valuation_rate = v_new_rate,
      stock_value = v_new_value,
      stock_queue = v_new_queue,
      updated_at = now()
  WHERE org_id = p_org
    AND product_id = p_product
    AND warehouse_id = p_warehouse;

  SELECT COALESCE(SUM(actual_qty), 0),
         COALESCE(SUM(stock_value), 0)
  INTO v_prod_qty, v_prod_value
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;
  v_prod_rate := CASE WHEN v_prod_qty > 0 THEN v_prod_value / v_prod_qty ELSE 0 END;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      stock_value = v_prod_value,
      cost_price = CASE WHEN v_prod_qty > 0 THEN v_prod_rate ELSE cost_price END,
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'cogs', round(v_cogs, 6),
    'method', v_method,
    'source_line_id', p_source_line_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) TO service_role;
