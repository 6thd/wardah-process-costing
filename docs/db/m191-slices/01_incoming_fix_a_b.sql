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
--   * explicit re-issue of the live service_role-only helper ACL.
--
-- Preserved deliberately:
--   * incoming bin footprint remains target-bin-only;
--   * FIFO/LIFO/Weighted Average queue/rate behavior;
--   * incoming projection asymmetry: stock_quantity + cost_price only;
--   * 10-arg source_line_id validation/storage contract;
--   * no new wardah_assert_org_member inside incoming helpers.

-- ============================================================================
-- Object 1 — incoming base 9-arg (predecessor: Migration 97)
-- ============================================================================
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
-- Preserve the 9-arg predecessor's current proconfig; do not silently turn
-- lock-order work into an unrelated search_path change.
SET search_path TO 'public'
AS $function$
DECLARE
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
BEGIN
  -- Preserve predecessor early-return semantics.
  IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NO_WAREHOUSE_OR_QTY');
  END IF;

  -- M191 fail-closed tightening explicitly allowed by the design. The shared
  -- helper drops NULLs while normalizing a multi-product set, so a single-line
  -- caller must not pass ARRAY[NULL] and mistake the empty set for success.
  IF p_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  -- Universal product prefix. This is the first stock lock in the function.
  -- It serializes same-product writers across warehouses and closes RED-B even
  -- when the target bin does not exist yet.
  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  SELECT COALESCE(valuation_method, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  v_method := COALESCE(v_method, 'Weighted Average');

  -- Fix A. Existing target row: lock/update it. Missing target row: insert the
  -- first row directly from the empty snapshot. Never carry the predecessor's
  -- ON CONFLICT ... actual_qty = EXCLUDED.actual_qty absolute-overwrite path.
  -- A unique conflict should be unreachable between canonical M191 writers
  -- because the product prefix serializes them; if a noncanonical/direct writer
  -- creates the same target anyway, retry from the locked current row.
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
      INSERT INTO public.bins (
        org_id,
        product_id,
        warehouse_id,
        actual_qty,
        valuation_rate,
        stock_value,
        stock_queue,
        updated_at
      ) VALUES (
        p_org,
        p_product,
        p_warehouse,
        v_new_qty,
        v_new_rate,
        v_new_value,
        v_new_queue,
        now()
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        -- Only retry if the target row now exists. A unique violation on any
        -- unrelated key is not a concurrency signal and remains fail-closed.
        IF NOT EXISTS (
          SELECT 1
          FROM public.bins
          WHERE product_id = p_product
            AND warehouse_id = p_warehouse
        ) THEN
          RAISE;
        END IF;
        -- The failed INSERT subtransaction is rolled back. Re-read/lock the
        -- committed winner and re-derive qty/value/queue from that snapshot.
    END;
  END LOOP;

  -- Ledger stays in the same outer transaction. If this insert fails, the bin
  -- mutation above rolls back with the function call; no partial committed
  -- stock state is possible.
  INSERT INTO public.stock_ledger_entries (
    voucher_type,
    voucher_id,
    voucher_number,
    product_id,
    warehouse_id,
    posting_date,
    actual_qty,
    qty_after_transaction,
    incoming_rate,
    valuation_rate,
    stock_value,
    stock_value_difference,
    stock_queue,
    docstatus,
    org_id,
    created_by
  ) VALUES (
    p_voucher_type,
    p_voucher_id,
    p_voucher_number,
    p_product,
    p_warehouse,
    COALESCE(p_posting_date, CURRENT_DATE),
    p_qty,
    v_new_qty,
    p_rate,
    v_new_rate,
    v_new_value,
    p_qty * p_rate,
    v_new_queue,
    1,
    p_org,
    auth.uid()
  );

  -- Fix B. This fresh aggregate runs only after the target-bin mutation, while
  -- the same product prefix is still held. A competing first-bin writer on a
  -- different warehouse cannot interleave a stale partial product projection.
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

-- Explicit ACL re-proof: current effective contract is service_role-only.
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM authenticated;
GRANT ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) TO service_role;

-- ============================================================================
-- Object 2 — incoming source-line 10-arg (predecessor: Migration 187)
-- ============================================================================
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
BEGIN
  IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NO_WAREHOUSE_OR_QTY');
  END IF;

  -- Preserve Migration 187 source-line validation and its error ordering before
  -- introducing the product prefix.
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
      INSERT INTO public.bins (
        org_id,
        product_id,
        warehouse_id,
        actual_qty,
        valuation_rate,
        stock_value,
        stock_queue,
        updated_at
      ) VALUES (
        p_org,
        p_product,
        p_warehouse,
        v_new_qty,
        v_new_rate,
        v_new_value,
        v_new_queue,
        now()
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.bins
          WHERE product_id = p_product
            AND warehouse_id = p_warehouse
        ) THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  INSERT INTO public.stock_ledger_entries (
    voucher_type,
    voucher_id,
    voucher_number,
    product_id,
    warehouse_id,
    posting_date,
    actual_qty,
    qty_after_transaction,
    incoming_rate,
    valuation_rate,
    stock_value,
    stock_value_difference,
    stock_queue,
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
    p_qty,
    v_new_qty,
    p_rate,
    v_new_rate,
    v_new_value,
    p_qty * p_rate,
    v_new_queue,
    1,
    p_org,
    auth.uid(),
    p_source_line_id
  );

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
GRANT ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) TO service_role;

-- ============================================================================
-- Slice-local review assertions (for the eventual executable M191 postflight)
-- ============================================================================
-- These are intentionally comments in the review fragment. The final migration
-- will turn them into executable DO-block assertions together with the other
-- eleven objects so ACL/source-shape evidence is captured in one postflight.
--
-- Required review invariants for both overloads:
--   1. helper call occurs before the first public.bins reference;
--   2. no "ON CONFLICT ... actual_qty = EXCLUDED.actual_qty" remains;
--   3. target-bin footprint only: no all-bins FOR UPDATE scan was introduced;
--   4. product aggregate is read after target-bin mutation under held prefix;
--   5. incoming does NOT write products.stock_value;
--   6. 10-arg still raises STOCK_SOURCE_LINE_REQUIRED/MISMATCH and persists
--      source_line_id into stock_ledger_entries;
--   7. PUBLIC/anon/authenticated EXECUTE=false, service_role EXECUTE=true by
--      exact signature.
