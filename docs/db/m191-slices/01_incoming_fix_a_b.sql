-- Wardah ERP / F2 / M191 review slice 01
-- Objects 1-2 only: wardah_apply_stock_incoming 9-arg + 10-arg.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority:
--   9-arg  <- Migration 97 + current ACL closure
--   10-arg <- Migration 187
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * complete single-product prefix before any bins work;
--   * Fix A: no stale absolute ON CONFLICT overwrite on first-bin creation;
--   * Fix B: fresh product projection while the product prefix is still held;
--   * bounded, target-index-specific retry for the defensive first-bin conflict;
--   * explicit re-issue of the live service_role-only helper ACL.
--
-- Preserved deliberately:
--   * incoming bin footprint remains target-bin-only;
--   * FIFO/LIFO/Weighted Average queue/rate behavior;
--   * incoming projection asymmetry: stock_quantity + cost_price only;
--   * SLE INSERT remains before the bin mutation, preserving predecessor trigger
--     evaluation order for mapped-UoM and source-line guards;
--   * 10-arg source_line_id validation/storage contract;
--   * no new wardah_assert_org_member inside incoming helpers.

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_incoming(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_rate numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_bin_retry_limit CONSTANT integer := 3;
  v_method text;
  v_prev_qty numeric := 0;
  v_prev_value numeric := 0;
  v_prev_queue jsonb := '[]'::jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_len integer;
  v_prod_qty numeric;
  v_prod_rate numeric;
  v_bin_exists boolean;
  v_bin_retry_count integer := 0;
  v_constraint_name text;
BEGIN
  IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NO_WAREHOUSE_OR_QTY');
  END IF;

  IF p_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  SELECT COALESCE(valuation_method, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  v_method := COALESCE(v_method, 'Weighted Average');

  LOOP
    v_prev_qty := 0;
    v_prev_value := 0;
    v_prev_queue := '[]'::jsonb;

    SELECT actual_qty, stock_value, stock_queue
    INTO v_prev_qty, v_prev_value, v_prev_queue
    FROM public.bins
    WHERE product_id = p_product
      AND warehouse_id = p_warehouse
    FOR UPDATE;

    v_bin_exists := FOUND;
    v_prev_qty := COALESCE(v_prev_qty, 0);
    v_prev_value := COALESCE(v_prev_value, 0);
    v_prev_queue := COALESCE(v_prev_queue, '[]'::jsonb);

    v_new_qty := v_prev_qty + p_qty;
    v_new_value := v_prev_value + (p_qty * p_rate);
    v_new_queue := v_prev_queue
      || jsonb_build_array(jsonb_build_object('qty', p_qty, 'rate', p_rate));

    IF v_method = 'FIFO' THEN
      v_new_rate := COALESCE((v_new_queue -> 0 ->> 'rate')::numeric, p_rate);
    ELSIF v_method = 'LIFO' THEN
      v_len := jsonb_array_length(v_new_queue);
      v_new_rate := COALESCE((v_new_queue -> (v_len - 1) ->> 'rate')::numeric, p_rate);
    ELSE
      v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
      v_new_queue := jsonb_build_array(
        jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate)
      );
    END IF;

    IF v_bin_exists THEN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid()
      );

      UPDATE public.bins
      SET actual_qty = v_new_qty,
          valuation_rate = v_new_rate,
          stock_value = v_new_value,
          stock_queue = v_new_queue,
          updated_at = now()
      WHERE product_id = p_product
        AND warehouse_id = p_warehouse;
      EXIT;
    END IF;

    BEGIN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid()
      );

      INSERT INTO public.bins (
        org_id, product_id, warehouse_id, actual_qty, valuation_rate,
        stock_value, stock_queue, updated_at
      ) VALUES (
        p_org, p_product, p_warehouse, v_new_qty, v_new_rate,
        v_new_value, v_new_queue, now()
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IS DISTINCT FROM 'idx_bins_product_warehouse' THEN
          RAISE;
        END IF;
        v_bin_retry_count := v_bin_retry_count + 1;
        IF v_bin_retry_count >= c_bin_retry_limit THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  SELECT COALESCE(SUM(actual_qty), 0),
         CASE
           WHEN COALESCE(SUM(actual_qty), 0) > 0
             THEN SUM(stock_value) / SUM(actual_qty)
           ELSE NULL
         END
  INTO v_prod_qty, v_prod_rate
  FROM public.bins
  WHERE product_id = p_product
    AND org_id = p_org;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      cost_price = COALESCE(v_prod_rate, cost_price),
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'method', v_method,
    'product_synced', jsonb_build_object(
      'stock_quantity', v_prod_qty,
      'cost_price', round(COALESCE(v_prod_rate, 0), 6)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) TO service_role;

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_incoming(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_rate numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date,
  p_source_line_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_bin_retry_limit CONSTANT integer := 3;
  v_method text;
  v_prev_qty numeric := 0;
  v_prev_value numeric := 0;
  v_prev_queue jsonb := '[]'::jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_len integer;
  v_prod_qty numeric;
  v_prod_rate numeric;
  v_bin_exists boolean;
  v_bin_retry_count integer := 0;
  v_constraint_name text;
BEGIN
  IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NO_WAREHOUSE_OR_QTY');
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

  IF p_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  SELECT COALESCE(valuation_method, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  v_method := COALESCE(v_method, 'Weighted Average');

  LOOP
    v_prev_qty := 0;
    v_prev_value := 0;
    v_prev_queue := '[]'::jsonb;

    SELECT actual_qty, stock_value, stock_queue
    INTO v_prev_qty, v_prev_value, v_prev_queue
    FROM public.bins
    WHERE product_id = p_product
      AND warehouse_id = p_warehouse
    FOR UPDATE;

    v_bin_exists := FOUND;
    v_prev_qty := COALESCE(v_prev_qty, 0);
    v_prev_value := COALESCE(v_prev_value, 0);
    v_prev_queue := COALESCE(v_prev_queue, '[]'::jsonb);

    v_new_qty := v_prev_qty + p_qty;
    v_new_value := v_prev_value + (p_qty * p_rate);
    v_new_queue := v_prev_queue
      || jsonb_build_array(jsonb_build_object('qty', p_qty, 'rate', p_rate));

    IF v_method = 'FIFO' THEN
      v_new_rate := COALESCE((v_new_queue -> 0 ->> 'rate')::numeric, p_rate);
    ELSIF v_method = 'LIFO' THEN
      v_len := jsonb_array_length(v_new_queue);
      v_new_rate := COALESCE((v_new_queue -> (v_len - 1) ->> 'rate')::numeric, p_rate);
    ELSE
      v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
      v_new_queue := jsonb_build_array(
        jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate)
      );
    END IF;

    IF v_bin_exists THEN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by, source_line_id
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid(), p_source_line_id
      );

      UPDATE public.bins
      SET actual_qty = v_new_qty,
          valuation_rate = v_new_rate,
          stock_value = v_new_value,
          stock_queue = v_new_queue,
          updated_at = now()
      WHERE product_id = p_product
        AND warehouse_id = p_warehouse;
      EXIT;
    END IF;

    BEGIN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by, source_line_id
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid(), p_source_line_id
      );

      INSERT INTO public.bins (
        org_id, product_id, warehouse_id, actual_qty, valuation_rate,
        stock_value, stock_queue, updated_at
      ) VALUES (
        p_org, p_product, p_warehouse, v_new_qty, v_new_rate,
        v_new_value, v_new_queue, now()
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IS DISTINCT FROM 'idx_bins_product_warehouse' THEN
          RAISE;
        END IF;
        v_bin_retry_count := v_bin_retry_count + 1;
        IF v_bin_retry_count >= c_bin_retry_limit THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  SELECT COALESCE(SUM(actual_qty), 0),
         CASE
           WHEN COALESCE(SUM(actual_qty), 0) > 0
             THEN SUM(stock_value) / SUM(actual_qty)
           ELSE NULL
         END
  INTO v_prod_qty, v_prod_rate
  FROM public.bins
  WHERE product_id = p_product
    AND org_id = p_org;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      cost_price = COALESCE(v_prod_rate, cost_price),
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'method', v_method,
    'source_line_id', p_source_line_id,
    'product_synced', jsonb_build_object(
      'stock_quantity', v_prod_qty,
      'cost_price', round(COALESCE(v_prod_rate, 0), 6)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) TO service_role;

-- Slice-local review assertions for the eventual executable M191 postflight:
-- 1. helper call before first public.bins reference;
-- 2. no stale absolute ON CONFLICT overwrite;
-- 3. target-bin-only footprint;
-- 4. SLE INSERT remains before bin mutation; defensive conflict rollback removes
--    the attempted SLE before retry;
-- 5. only idx_bins_product_warehouse may trigger retry, and retry is bounded;
-- 6. fresh product aggregate after bin mutation under held prefix;
-- 7. no incoming products.stock_value write;
-- 8. 10-arg source-line errors/storage preserved;
-- 9. PUBLIC/anon/authenticated EXECUTE=false, service_role EXECUTE=true by exact
--    signature using GRANT EXECUTE.
