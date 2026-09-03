-- Migration 187: prospective stock-adjustment ledger idempotency.
--
-- The originally proposed global key
--   (voucher_type, voucher_id, product_id, warehouse_id)
-- is not a legal invariant for every stock movement. Goods receipts and
-- delivery notes may contain separate source lines for the same product and
-- warehouse, and material consumption may be posted partially more than once
-- against one manufacturing order. Stock adjustments are different: the live
-- RPC already rejects duplicate product/warehouse lines in one adjustment.
--
-- Production also contains historical stock-adjustment rows without
-- source_line_id, including the known ADJ-000001 duplicate. This migration does
-- not delete, rewrite, or guess provenance for those rows. It enforces the
-- invariant prospectively on INSERT while leaving historical rows updateable
-- (notably by the legal cancellation workflow).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('public.stock_ledger_entries') IS NULL
     OR to_regclass('public.stock_adjustments') IS NULL
     OR to_regclass('public.stock_adjustment_items') IS NULL THEN
    RAISE EXCEPTION 'STOCK_187_REQUIRED_RELATION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stock_ledger_entries'
      AND column_name = 'source_line_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'STOCK_187_SOURCE_LINE_COLUMN_MISSING';
  END IF;

  IF to_regprocedure(
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)'
     ) IS NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)'
     ) IS NULL
     OR to_regprocedure('public.rpc_submit_stock_adjustment(uuid)') IS NULL THEN
    RAISE EXCEPTION 'STOCK_187_REQUIRED_FUNCTION_MISSING';
  END IF;

  IF to_regclass(
       'public.uq_sle_stock_adjustment_voucher_product_warehouse_v187'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.wardah_187_require_stock_source_line()'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_187_OBJECT_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.stock_ledger_entries'::regclass
      AND tgname = 'trg_sle_stock_adjustment_source_line_v187'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'STOCK_187_TRIGGER_ALREADY_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stock_ledger_entries
    WHERE lower(btrim(voucher_type::text)) = 'stock adjustment'
      AND source_line_id IS NOT NULL
    GROUP BY org_id, voucher_id, product_id, warehouse_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'STOCK_187_PROSPECTIVE_DUPLICATE_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stock_ledger_entries sle
    WHERE lower(btrim(sle.voucher_type::text)) = 'stock adjustment'
      AND sle.source_line_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.stock_adjustment_items sai
        JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
        WHERE sai.id = sle.source_line_id
          AND sai.adjustment_id = sle.voucher_id
          AND sai.organization_id = sle.org_id
          AND sai.product_id = sle.product_id
          AND COALESCE(sai.warehouse_id, sa.warehouse_id) = sle.warehouse_id
          AND COALESCE(sa.org_id, sa.organization_id) = sle.org_id
      )
  ) THEN
    RAISE EXCEPTION 'STOCK_187_SOURCE_RELATION_DRIFT';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX uq_sle_stock_adjustment_voucher_product_warehouse_v187
  ON public.stock_ledger_entries (
    org_id,
    voucher_id,
    product_id,
    warehouse_id
  )
  WHERE source_line_id IS NOT NULL
    AND lower(btrim(voucher_type::text)) = 'stock adjustment';

CREATE OR REPLACE FUNCTION public.wardah_187_require_stock_source_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF lower(btrim(NEW.voucher_type::text)) = 'stock adjustment' THEN
    IF NEW.source_line_id IS NULL THEN
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'STOCK_SOURCE_LINE_REQUIRED';
      END IF;

      IF OLD.source_line_id IS NOT NULL
         OR NEW.voucher_type IS DISTINCT FROM OLD.voucher_type
         OR NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
         OR NEW.product_id IS DISTINCT FROM OLD.product_id
         OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
         OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
        RAISE EXCEPTION 'STOCK_SOURCE_LINE_REQUIRED';
      END IF;

      -- Historical NULL-source rows remain updateable for cancellation and
      -- provenance-neutral maintenance.
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.stock_adjustment_items sai
      JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
      WHERE sai.id = NEW.source_line_id
        AND sai.adjustment_id = NEW.voucher_id
        AND sai.organization_id = NEW.org_id
        AND sai.product_id = NEW.product_id
        AND COALESCE(sai.warehouse_id, sa.warehouse_id) = NEW.warehouse_id
        AND COALESCE(sa.org_id, sa.organization_id) = NEW.org_id
    ) THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_187_require_stock_source_line() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_187_require_stock_source_line() FROM anon;
REVOKE ALL ON FUNCTION public.wardah_187_require_stock_source_line() FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_187_require_stock_source_line() FROM service_role;

CREATE TRIGGER trg_sle_stock_adjustment_source_line_v187
BEFORE INSERT OR UPDATE OF
  voucher_type,
  voucher_id,
  product_id,
  warehouse_id,
  org_id,
  source_line_id
ON public.stock_ledger_entries
FOR EACH ROW
EXECUTE FUNCTION public.wardah_187_require_stock_source_line();

-- Source-aware incoming overload. The historical nine-argument helper remains
-- intact for receipt/delivery compatibility, but the trigger above makes it
-- fail closed if any caller tries to use it for a new Stock Adjustment row.
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
) RETURNS jsonb
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

  SELECT COALESCE(valuation_method, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  v_method := COALESCE(v_method, 'Weighted Average');

  SELECT actual_qty, stock_value, stock_queue
  INTO v_prev_qty, v_prev_value, v_prev_queue
  FROM public.bins
  WHERE product_id = p_product AND warehouse_id = p_warehouse
  FOR UPDATE;

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
  )
  ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
    actual_qty = EXCLUDED.actual_qty,
    valuation_rate = EXCLUDED.valuation_rate,
    stock_value = EXCLUDED.stock_value,
    stock_queue = EXCLUDED.stock_queue,
    updated_at = now();

  SELECT COALESCE(SUM(actual_qty), 0),
         CASE
           WHEN COALESCE(SUM(actual_qty), 0) > 0
             THEN SUM(stock_value) / SUM(actual_qty)
           ELSE NULL
         END
  INTO v_prod_qty, v_prod_rate
  FROM public.bins
  WHERE product_id = p_product AND org_id = p_org;

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

-- Keep the service-only ACL adjacent to the DEFINER body so repository guards
-- can prove the helper is not client-callable before inspecting later objects.
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

-- Source-aware outgoing overload. Its valuation, reservation-floor, bin, and
-- product-projection behavior is the exact Migration 186 contract; only source
-- validation/storage is added.
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
      v_total_on_hand,
      v_other_mo_reserved,
      p_qty;
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

-- Carry forward the complete live stock-adjustment submission contract from
-- Migration 125, changing only the two helper calls to pass v_item.id.
CREATE OR REPLACE FUNCTION public.rpc_submit_stock_adjustment(
  p_adjustment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_adj public.stock_adjustments%rowtype;
  v_item record;
  v_warehouse uuid;
  v_result jsonb;
  v_gl jsonb;
  v_debit uuid;
  v_credit uuid;
  v_amount numeric;
  v_signed_value numeric;
  v_actual_qty numeric;
  v_item_count integer;
  v_distinct_count integer;
BEGIN
  SELECT * INTO v_adj
  FROM public.stock_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND'; END IF;

  v_adj.org_id := COALESCE(v_adj.org_id, v_adj.organization_id);
  PERFORM public.wardah_assert_org_admin(v_adj.org_id);

  IF v_adj.status = 'SUBMITTED' THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'adjustment_id', v_adj.id,
      'gl_entry_id', v_adj.canonical_gl_entry_id
    );
  END IF;
  IF v_adj.status <> 'DRAFT' THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_DRAFT'; END IF;
  IF COALESCE(v_adj.requires_approval, false) AND v_adj.approved_by IS NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_APPROVAL_REQUIRED';
  END IF;

  SELECT count(*),
         count(DISTINCT ROW(product_id, COALESCE(warehouse_id, v_adj.warehouse_id)))
  INTO v_item_count, v_distinct_count
  FROM public.stock_adjustment_items
  WHERE adjustment_id = v_adj.id;

  IF v_item_count = 0 THEN RAISE EXCEPTION 'ADJUSTMENT_REQUIRES_ITEMS'; END IF;
  IF v_item_count <> v_distinct_count THEN
    RAISE EXCEPTION 'DUPLICATE_PRODUCT_WAREHOUSE_LINES';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.stock_adjustment_items
    WHERE adjustment_id = v_adj.id
    ORDER BY id
  LOOP
    v_warehouse := COALESCE(v_item.warehouse_id, v_adj.warehouse_id);
    IF v_warehouse IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;

    IF v_item.difference_qty > 0 THEN
      v_result := public.wardah_apply_stock_incoming(
        v_adj.org_id,
        v_item.product_id,
        v_warehouse,
        v_item.difference_qty,
        COALESCE(v_item.new_rate, v_item.current_rate, 0),
        'Stock Adjustment',
        v_adj.id,
        v_adj.adjustment_number,
        v_adj.posting_date,
        v_item.id
      );
      IF NOT COALESCE((v_result ->> 'applied')::boolean, false) THEN
        RAISE EXCEPTION 'STOCK_IN_NOT_APPLIED: %', v_result;
      END IF;
    ELSIF v_item.difference_qty < 0 THEN
      PERFORM public.wardah_apply_stock_outgoing(
        v_adj.org_id,
        v_item.product_id,
        v_warehouse,
        abs(v_item.difference_qty),
        'Stock Adjustment',
        v_adj.id,
        v_adj.adjustment_number,
        v_adj.posting_date,
        v_item.id
      );
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(actual_qty), 0),
         COALESCE(SUM(stock_value_difference), 0)
  INTO v_actual_qty, v_signed_value
  FROM public.stock_ledger_entries
  WHERE org_id = v_adj.org_id
    AND voucher_type = 'Stock Adjustment'
    AND voucher_id = v_adj.id
    AND COALESCE(is_cancelled, false) = false;

  v_amount := abs(v_signed_value);
  IF v_amount > 0 THEN
    IF v_adj.inventory_account_id IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_ACCOUNT_REQUIRED';
    END IF;
    IF v_signed_value > 0 THEN
      IF v_adj.increase_account_id IS NULL THEN
        RAISE EXCEPTION 'INCREASE_ACCOUNT_REQUIRED';
      END IF;
      v_debit := v_adj.inventory_account_id;
      v_credit := v_adj.increase_account_id;
    ELSE
      IF v_adj.decrease_account_id IS NULL THEN
        RAISE EXCEPTION 'DECREASE_ACCOUNT_REQUIRED';
      END IF;
      v_debit := v_adj.decrease_account_id;
      v_credit := v_adj.inventory_account_id;
    END IF;

    v_gl := public.rpc_create_journal_entry(jsonb_build_object(
      'org_id', v_adj.org_id,
      'entry_date', v_adj.posting_date,
      'reference_type', 'Stock Adjustment',
      'reference_number', v_adj.adjustment_number,
      'description', v_adj.reason,
      'idempotency_key', 'stock-adjustment:' || v_adj.id::text,
      'auto_post', true,
      'lines', jsonb_build_array(
        jsonb_build_object(
          'line_number', 1,
          'account_id', v_debit,
          'debit', v_amount,
          'credit', 0,
          'description', v_adj.reason
        ),
        jsonb_build_object(
          'line_number', 2,
          'account_id', v_credit,
          'debit', 0,
          'credit', v_amount,
          'description', v_adj.reason
        )
      )
    ));
  END IF;

  UPDATE public.stock_adjustments
  SET status = 'SUBMITTED',
      total_qty_difference = v_actual_qty,
      total_value_difference = v_signed_value,
      submitted_by = auth.uid(),
      submitted_at = now(),
      canonical_gl_entry_id = NULLIF(v_gl ->> 'entry_id', '')::uuid,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_adj.id;

  RETURN jsonb_build_object(
    'success', true,
    'adjustment_id', v_adj.id,
    'actual_qty_difference', v_actual_qty,
    'actual_value_difference', v_signed_value,
    'gl_entry_id', NULLIF(v_gl ->> 'entry_id', '')::uuid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_submit_stock_adjustment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_submit_stock_adjustment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_stock_adjustment(uuid) TO authenticated;

COMMENT ON INDEX public.uq_sle_stock_adjustment_voucher_product_warehouse_v187 IS
  'Migration 187: one prospective Stock Adjustment movement per org/voucher/product/warehouse; historical rows with unknown source_line_id remain outside the predicate.';

COMMENT ON FUNCTION public.wardah_187_require_stock_source_line() IS
  'Migration 187 source guard: new Stock Adjustment SLE rows and later identity changes require a legal source_line_id; provenance-neutral historical updates remain possible.';

COMMENT ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) IS
  'Migration 187 source-aware incoming stock helper. Stock Adjustment sources must match stock_adjustment_items.';

COMMENT ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) IS
  'Migration 187 source-aware outgoing stock helper preserving the complete Migration 186 valuation and reservation-floor contract.';

DO $postflight$
DECLARE
  v_submit_definition text;
  v_index_definition text;
  v_trigger_definition text;
BEGIN
  SELECT pg_get_indexdef('public.uq_sle_stock_adjustment_voucher_product_warehouse_v187'::regclass)
  INTO v_index_definition;

  IF v_index_definition IS NULL
     OR v_index_definition NOT LIKE 'CREATE UNIQUE INDEX%'
     OR v_index_definition NOT LIKE '%source_line_id IS NOT NULL%'
     OR v_index_definition NOT LIKE '%stock adjustment%' THEN
    RAISE EXCEPTION 'STOCK_187_INDEX_DEFINITION_DRIFT: %', v_index_definition;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid =
      'public.uq_sle_stock_adjustment_voucher_product_warehouse_v187'::regclass
      AND indisunique
      AND indisvalid
      AND indisready
  ) THEN
    RAISE EXCEPTION 'STOCK_187_INDEX_NOT_READY';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.stock_ledger_entries'::regclass
      AND tgname = 'trg_sle_stock_adjustment_source_line_v187'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'STOCK_187_TRIGGER_NOT_ENABLED';
  END IF;

  SELECT pg_get_triggerdef(oid)
  INTO v_trigger_definition
  FROM pg_trigger
  WHERE tgrelid = 'public.stock_ledger_entries'::regclass
    AND tgname = 'trg_sle_stock_adjustment_source_line_v187'
    AND NOT tgisinternal;

  IF v_trigger_definition NOT LIKE '%BEFORE INSERT OR UPDATE OF%'
     OR v_trigger_definition NOT LIKE '%source_line_id%' THEN
    RAISE EXCEPTION 'STOCK_187_TRIGGER_DEFINITION_DRIFT: %', v_trigger_definition;
  END IF;

  IF to_regprocedure(
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'STOCK_187_SOURCE_AWARE_HELPER_MISSING';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STOCK_187_HELPER_ACL_DRIFT';
  END IF;

  SELECT pg_get_functiondef('public.rpc_submit_stock_adjustment(uuid)'::regprocedure)
  INTO v_submit_definition;
  IF v_submit_definition NOT LIKE '%v_item.id%'
     OR v_submit_definition NOT LIKE '%wardah_apply_stock_incoming%'
     OR v_submit_definition NOT LIKE '%wardah_apply_stock_outgoing%' THEN
    RAISE EXCEPTION 'STOCK_187_SUBMIT_SOURCE_PROPAGATION_MISSING';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.rpc_submit_stock_adjustment(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.rpc_submit_stock_adjustment(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STOCK_187_SUBMIT_ACL_DRIFT';
  END IF;
END
$postflight$;

COMMIT;
