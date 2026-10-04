-- Wardah ERP / F2 / M191 review slice 03
-- Object 5 only: rpc_cancel_stock_adjustment(uuid,text) — Fix C.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 124, confirmed as the live body.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized change in this slice only:
--   * before the existing per-line reversal loop, collect the complete distinct
--     product_id set from the same non-cancelled Stock Adjustment SLE rows the
--     loop is about to reverse, then acquire the shared deterministic product
--     prefix once for the whole call.
--
-- Preserved deliberately:
--   * stock_adjustments header FOR UPDATE placement;
--   * wardah_assert_org_admin and all validation/error ordering;
--   * LATER_STOCK_MOVEMENT_EXISTS fail-closed check;
--   * prior surviving SLE lookup and restoration semantics;
--   * original SLE cancellation, reversal SLE shape, bins restoration, and
--     per-product SUM/projection behavior;
--   * GL reversal and final stock_adjustments cancellation behavior;
--   * SECURITY DEFINER and search_path = public;
--   * existing client-facing ACL is not changed or restated in this fragment;
--     CREATE OR REPLACE preserves it and final M191 postflight must prove exact
--     pre/post ACL equivalence by signature.
--
-- No RED-A/RED-B logic, valuation formula, source-line rule, or authorization
-- change belongs in Fix C.

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

  PERFORM public.wardah_lock_products_for_stock_write(
    v_adj.org_id,
    ARRAY(
      SELECT DISTINCT sle.product_id
      FROM public.stock_ledger_entries sle
      WHERE sle.voucher_type = 'Stock Adjustment'
        AND sle.voucher_id = v_adj.id
        AND COALESCE(sle.is_cancelled, false) = false
      ORDER BY sle.product_id
    )
  );

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
