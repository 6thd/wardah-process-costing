-- migration_number: 124
-- description: Add canonical atomic inventory RPCs for adjustments, manual movements,
--              cancellation, and reserved-material consumption.
-- safety: additive/replace-only. No table, column, function, trigger, policy, or data is deleted.

-- Canonical GL references are additive because the legacy journal_entry_id columns
-- point to the historical journal_entries table, while current accounting writes gl_entries.
ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS canonical_gl_entry_id uuid REFERENCES public.gl_entries(id),
  ADD COLUMN IF NOT EXISTS canonical_reversal_gl_entry_id uuid REFERENCES public.gl_entries(id);

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
SET search_path TO 'public'
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

REVOKE EXECUTE ON FUNCTION public.wardah_apply_stock_outgoing(uuid, uuid, uuid, numeric, text, uuid, text, date)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_create_stock_adjustment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_id uuid := gen_random_uuid();
  v_number text;
  v_date date;
  v_total_value numeric;
  v_total_qty numeric;
  v_count integer;
BEGIN
  v_org := public.wardah_org_id(NULLIF(p_payload ->> 'org_id', '')::uuid);
  PERFORM public.wardah_assert_org_member(v_org);

  v_date := COALESCE(NULLIF(p_payload ->> 'adjustment_date', '')::date, CURRENT_DATE);
  v_number := COALESCE(
    NULLIF(p_payload ->> 'adjustment_number', ''),
    'ADJ-' || to_char(v_date, 'YYYYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 8))
  );

  SELECT COUNT(*),
         COALESCE(SUM((x ->> 'difference_qty')::numeric), 0),
         COALESCE(SUM((x ->> 'value_difference')::numeric), 0)
  INTO v_count, v_total_qty, v_total_value
  FROM jsonb_array_elements(COALESCE(p_payload -> 'items', '[]'::jsonb)) x;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'ADJUSTMENT_REQUIRES_ITEMS';
  END IF;

  INSERT INTO public.stock_adjustments (
    id, organization_id, org_id, adjustment_number, adjustment_date, posting_date,
    adjustment_type, reason, reference_number, warehouse_id, status,
    requires_approval, total_items, total_qty_difference, total_value_difference,
    created_by, increase_account_id, decrease_account_id
  ) VALUES (
    v_id, v_org, v_org, v_number, v_date,
    COALESCE(NULLIF(p_payload ->> 'posting_date', '')::date, v_date),
    p_payload ->> 'adjustment_type',
    p_payload ->> 'reason',
    NULLIF(p_payload ->> 'reference_number', ''),
    NULLIF(p_payload ->> 'warehouse_id', '')::uuid,
    'DRAFT',
    COALESCE((p_payload ->> 'requires_approval')::boolean, abs(v_total_value) > 10000),
    v_count, v_total_qty, v_total_value, auth.uid(),
    NULLIF(p_payload ->> 'increase_account_id', '')::uuid,
    NULLIF(p_payload ->> 'decrease_account_id', '')::uuid
  );

  INSERT INTO public.stock_adjustment_items (
    adjustment_id, organization_id, product_id, warehouse_id,
    current_qty, new_qty, difference_qty, current_rate, new_rate,
    value_difference, reason, serial_numbers, batch_numbers
  )
  SELECT
    v_id, v_org,
    (x ->> 'product_id')::uuid,
    NULLIF(x ->> 'warehouse_id', '')::uuid,
    COALESCE((x ->> 'current_qty')::numeric, 0),
    (x ->> 'new_qty')::numeric,
    (x ->> 'difference_qty')::numeric,
    COALESCE((x ->> 'current_rate')::numeric, 0),
    NULLIF(x ->> 'new_rate', '')::numeric,
    (x ->> 'value_difference')::numeric,
    NULLIF(x ->> 'reason', ''),
    CASE WHEN jsonb_typeof(x -> 'serial_nos') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(x -> 'serial_nos')) ELSE NULL END,
    CASE WHEN NULLIF(x ->> 'batch_no', '') IS NOT NULL
      THEN ARRAY[x ->> 'batch_no'] ELSE NULL END
  FROM jsonb_array_elements(p_payload -> 'items') x;

  RETURN jsonb_build_object('success', true, 'adjustment_id', v_id, 'adjustment_number', v_number);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_stock_adjustment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_stock_adjustment(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_submit_stock_adjustment(p_adjustment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
BEGIN
  SELECT * INTO v_adj
  FROM public.stock_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND'; END IF;

  v_adj.org_id := COALESCE(v_adj.org_id, v_adj.organization_id);
  PERFORM public.wardah_assert_org_admin(v_adj.org_id);

  IF v_adj.status = 'SUBMITTED' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'adjustment_id', v_adj.id);
  END IF;
  IF v_adj.status <> 'DRAFT' THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_DRAFT'; END IF;
  IF COALESCE(v_adj.requires_approval, false) AND v_adj.approved_by IS NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_APPROVAL_REQUIRED';
  END IF;

  FOR v_item IN
    SELECT * FROM public.stock_adjustment_items WHERE adjustment_id = v_adj.id ORDER BY id
  LOOP
    v_warehouse := COALESCE(v_item.warehouse_id, v_adj.warehouse_id);
    IF v_warehouse IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;

    IF v_item.difference_qty > 0 THEN
      v_result := public.wardah_apply_stock_incoming(
        v_adj.org_id, v_item.product_id, v_warehouse, v_item.difference_qty,
        COALESCE(v_item.new_rate, v_item.current_rate, 0),
        'Stock Adjustment', v_adj.id, v_adj.adjustment_number, v_adj.posting_date
      );
      IF NOT COALESCE((v_result ->> 'applied')::boolean, false) THEN
        RAISE EXCEPTION 'STOCK_IN_NOT_APPLIED: %', v_result;
      END IF;
    ELSIF v_item.difference_qty < 0 THEN
      PERFORM public.wardah_apply_stock_outgoing(
        v_adj.org_id, v_item.product_id, v_warehouse, abs(v_item.difference_qty),
        'Stock Adjustment', v_adj.id, v_adj.adjustment_number, v_adj.posting_date
      );
    END IF;
  END LOOP;

  v_amount := abs(COALESCE(v_adj.total_value_difference, 0));
  IF v_amount > 0 THEN
    IF v_adj.increase_account_id IS NULL OR v_adj.decrease_account_id IS NULL THEN
      RAISE EXCEPTION 'ADJUSTMENT_ACCOUNTS_REQUIRED';
    END IF;
    IF v_adj.total_value_difference > 0 THEN
      v_debit := v_adj.increase_account_id;
      v_credit := v_adj.decrease_account_id;
    ELSE
      v_debit := v_adj.decrease_account_id;
      v_credit := v_adj.increase_account_id;
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
        jsonb_build_object('line_number', 1, 'account_id', v_debit, 'debit', v_amount, 'credit', 0,
                           'description', v_adj.reason),
        jsonb_build_object('line_number', 2, 'account_id', v_credit, 'debit', 0, 'credit', v_amount,
                           'description', v_adj.reason)
      )
    ));
  END IF;

  UPDATE public.stock_adjustments
  SET status = 'SUBMITTED',
      submitted_by = auth.uid(),
      submitted_at = now(),
      canonical_gl_entry_id = NULLIF(v_gl ->> 'entry_id', '')::uuid,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_adj.id;

  RETURN jsonb_build_object(
    'success', true,
    'adjustment_id', v_adj.id,
    'gl_entry_id', NULLIF(v_gl ->> 'entry_id', '')::uuid
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_stock_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_stock_adjustment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_cancel_stock_adjustment(p_adjustment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_adj public.stock_adjustments%rowtype;
  v_sle record;
  v_prev record;
  v_prod_qty numeric;
  v_prod_value numeric;
  v_gl jsonb;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_adj
  FROM public.stock_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND'; END IF;

  v_adj.org_id := COALESCE(v_adj.org_id, v_adj.organization_id);
  PERFORM public.wardah_assert_org_admin(v_adj.org_id);

  IF v_adj.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'adjustment_id', v_adj.id);
  END IF;
  IF v_adj.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_SUBMITTED'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED'; END IF;

  -- Fail closed if a later active movement exists; exact restoration is then unsafe.
  FOR v_sle IN
    SELECT * FROM public.stock_ledger_entries
    WHERE voucher_type = 'Stock Adjustment'
      AND voucher_id = v_adj.id
      AND COALESCE(is_cancelled, false) = false
    ORDER BY posting_datetime DESC, id DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.stock_ledger_entries later
      WHERE later.org_id = v_adj.org_id
        AND later.product_id = v_sle.product_id
        AND later.warehouse_id = v_sle.warehouse_id
        AND COALESCE(later.is_cancelled, false) = false
        AND later.voucher_id <> v_adj.id
        AND (later.posting_datetime, later.id) > (v_sle.posting_datetime, v_sle.id)
    ) THEN
      RAISE EXCEPTION 'LATER_STOCK_MOVEMENT_EXISTS: product=% warehouse=%',
        v_sle.product_id, v_sle.warehouse_id;
    END IF;

    SELECT qty_after_transaction, valuation_rate, stock_value, stock_queue
    INTO v_prev
    FROM public.stock_ledger_entries prev
    WHERE prev.org_id = v_adj.org_id
      AND prev.product_id = v_sle.product_id
      AND prev.warehouse_id = v_sle.warehouse_id
      AND COALESCE(prev.is_cancelled, false) = false
      AND prev.voucher_id <> v_adj.id
      AND (prev.posting_datetime, prev.id) < (v_sle.posting_datetime, v_sle.id)
    ORDER BY prev.posting_datetime DESC, prev.id DESC
    LIMIT 1;

    UPDATE public.stock_ledger_entries
    SET is_cancelled = true, modified_at = now(), modified_by = auth.uid()
    WHERE id = v_sle.id;

    UPDATE public.bins
    SET actual_qty = COALESCE(v_prev.qty_after_transaction, 0),
        valuation_rate = COALESCE(v_prev.valuation_rate, 0),
        stock_value = COALESCE(v_prev.stock_value, 0),
        stock_queue = COALESCE(v_prev.stock_queue, '[]'::jsonb),
        updated_at = now()
    WHERE org_id = v_adj.org_id
      AND product_id = v_sle.product_id
      AND warehouse_id = v_sle.warehouse_id;

    INSERT INTO public.stock_ledger_entries (
      voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
      posting_date, actual_qty, qty_after_transaction, incoming_rate, outgoing_rate,
      valuation_rate, stock_value, stock_value_difference, stock_queue,
      batch_no, serial_nos, is_cancelled, docstatus, org_id, created_by
    ) VALUES (
      'Stock Adjustment Reversal', v_adj.id, 'CANCEL-' || v_adj.adjustment_number,
      v_sle.product_id, v_sle.warehouse_id, CURRENT_DATE,
      -v_sle.actual_qty, COALESCE(v_prev.qty_after_transaction, 0),
      v_sle.outgoing_rate, v_sle.incoming_rate,
      COALESCE(v_prev.valuation_rate, 0), COALESCE(v_prev.stock_value, 0),
      -v_sle.stock_value_difference, COALESCE(v_prev.stock_queue, '[]'::jsonb),
      v_sle.batch_no, v_sle.serial_nos, false, 1, v_adj.org_id, auth.uid()
    );

    SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(stock_value), 0)
    INTO v_prod_qty, v_prod_value
    FROM public.bins
    WHERE org_id = v_adj.org_id AND product_id = v_sle.product_id;

    UPDATE public.products
    SET stock_quantity = v_prod_qty,
        stock_value = v_prod_value,
        cost_price = CASE WHEN v_prod_qty > 0 THEN v_prod_value / v_prod_qty ELSE cost_price END,
        updated_at = now()
    WHERE id = v_sle.product_id AND org_id = v_adj.org_id;
  END LOOP;

  IF v_adj.canonical_gl_entry_id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
      'line_number', line_number,
      'account_id', account_id,
      'debit', credit,
      'credit', debit,
      'currency_code', COALESCE(currency_code, 'SAR'),
      'description', 'Reversal: ' || COALESCE(description, '')
    ) ORDER BY line_number)
    INTO v_lines
    FROM public.gl_entry_lines
    WHERE entry_id = v_adj.canonical_gl_entry_id;

    IF jsonb_array_length(COALESCE(v_lines, '[]'::jsonb)) >= 2 THEN
      v_gl := public.rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_adj.org_id,
        'entry_date', CURRENT_DATE,
        'reference_type', 'Stock Adjustment Reversal',
        'reference_number', 'CANCEL-' || v_adj.adjustment_number,
        'description', 'Reversal: ' || p_reason,
        'idempotency_key', 'stock-adjustment-reversal:' || v_adj.id::text,
        'auto_post', true,
        'lines', v_lines
      ));
    END IF;
  END IF;

  UPDATE public.stock_adjustments
  SET status = 'CANCELLED',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancellation_reason = p_reason,
      canonical_reversal_gl_entry_id = NULLIF(v_gl ->> 'entry_id', '')::uuid,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_adj.id;

  RETURN jsonb_build_object(
    'success', true,
    'adjustment_id', v_adj.id,
    'reversal_gl_entry_id', NULLIF(v_gl ->> 'entry_id', '')::uuid
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_cancel_stock_adjustment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_stock_adjustment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_manual_stock_movement(
  p_product_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_warehouse_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_warehouse uuid := p_warehouse_id;
  v_current numeric;
  v_delta numeric;
  v_rate numeric;
  v_voucher uuid := gen_random_uuid();
  v_count integer;
BEGIN
  SELECT org_id, COALESCE(cost_price, 0)
  INTO v_org, v_rate
  FROM public.products
  WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);

  IF v_warehouse IS NULL THEN
    SELECT COUNT(*), MIN(warehouse_id)
    INTO v_count, v_warehouse
    FROM public.bins
    WHERE org_id = v_org AND product_id = p_product_id;
    IF v_count <> 1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  END IF;

  SELECT COALESCE(actual_qty, 0) INTO v_current
  FROM public.bins
  WHERE org_id = v_org AND product_id = p_product_id AND warehouse_id = v_warehouse;
  v_current := COALESCE(v_current, 0);

  CASE lower(p_movement_type)
    WHEN 'in' THEN v_delta := p_quantity;
    WHEN 'out' THEN v_delta := -p_quantity;
    WHEN 'adjustment' THEN v_delta := p_quantity - v_current;
    ELSE RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE';
  END CASE;

  IF v_delta > 0 THEN
    RETURN public.wardah_apply_stock_incoming(
      v_org, p_product_id, v_warehouse, v_delta, v_rate,
      'Manual Stock Movement', v_voucher, 'MAN-' || substr(v_voucher::text, 1, 8), CURRENT_DATE
    ) || jsonb_build_object('notes', p_notes);
  ELSIF v_delta < 0 THEN
    RETURN public.wardah_apply_stock_outgoing(
      v_org, p_product_id, v_warehouse, abs(v_delta),
      'Manual Stock Movement', v_voucher, 'MAN-' || substr(v_voucher::text, 1, 8), CURRENT_DATE
    ) || jsonb_build_object('notes', p_notes);
  END IF;

  RETURN jsonb_build_object('applied', false, 'reason', 'NO_CHANGE');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_manual_stock_movement(uuid, numeric, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_manual_stock_movement(uuid, numeric, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials(p_mo_id uuid, p_consumptions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_mo_number text;
  v_row jsonb;
  v_res public.material_reservations%rowtype;
  v_qty numeric;
  v_warehouse uuid;
  v_count integer;
  v_remaining numeric;
BEGIN
  SELECT org_id, order_number INTO v_org, v_mo_number
  FROM public.manufacturing_orders
  WHERE id = p_mo_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);

  IF jsonb_typeof(p_consumptions) <> 'array' OR jsonb_array_length(p_consumptions) = 0 THEN
    RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_consumptions)
  LOOP
    v_qty := (v_row ->> 'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'INVALID_CONSUMPTION_QUANTITY'; END IF;

    SELECT * INTO v_res
    FROM public.material_reservations
    WHERE org_id = v_org
      AND mo_id = p_mo_id
      AND item_id = (v_row ->> 'item_id')::uuid
      AND status = 'reserved'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_RESERVATION_NOT_FOUND'; END IF;

    v_remaining := v_res.quantity_reserved - COALESCE(v_res.quantity_consumed, 0)
                   - COALESCE(v_res.quantity_released, 0);
    IF v_qty > v_remaining THEN
      RAISE EXCEPTION 'CONSUMPTION_EXCEEDS_RESERVATION: remaining=%, requested=%', v_remaining, v_qty;
    END IF;

    v_warehouse := NULLIF(COALESCE(v_row ->> 'warehouse_id', v_row ->> 'location_id'), '')::uuid;
    IF v_warehouse IS NULL THEN
      SELECT COUNT(*), MIN(warehouse_id)
      INTO v_count, v_warehouse
      FROM public.bins
      WHERE org_id = v_org AND product_id = v_res.item_id AND actual_qty > 0;
      IF v_count <> 1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_CONSUMPTION'; END IF;
    END IF;

    PERFORM public.wardah_apply_stock_outgoing(
      v_org, v_res.item_id, v_warehouse, v_qty,
      'Material Consumption', p_mo_id, v_mo_number, CURRENT_DATE
    );

    UPDATE public.material_reservations
    SET quantity_consumed = COALESCE(quantity_consumed, 0) + v_qty,
        status = CASE WHEN COALESCE(quantity_consumed, 0) + v_qty
                           + COALESCE(quantity_released, 0) >= quantity_reserved
                      THEN 'consumed' ELSE 'reserved' END,
        consumed_at = now(),
        updated_at = now()
    WHERE id = v_res.id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'mo_id', p_mo_id,
                            'consumption_count', jsonb_array_length(p_consumptions));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid, jsonb) TO authenticated;
