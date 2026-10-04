-- Wardah ERP / F2 / M191 review slice 07
-- Object 9 only: rpc_submit_stock_adjustment(uuid) — Fix E (stock adjustment).
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 187, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the existing adjustment header/status/approval gates, lock all
--     stock_adjustment_items rows for the adjustment in deterministic id order;
--   * derive the distinct product set from those already-locked rows;
--   * preserve the existing item-count/duplicate-line errors before invoking
--     the shared product helper, then acquire the complete product prefix once;
--   * inside the unchanged ordered item loop, fail closed if the row's product
--     is outside the prelocked set.
--
-- Preserved deliberately:
--   * adjustment header FOR UPDATE and org-admin authorization;
--   * SUBMITTED replay, status and approval validation/error order;
--   * ADJUSTMENT_REQUIRES_ITEMS and DUPLICATE_PRODUCT_WAREHOUSE_LINES semantics;
--   * ordered item loop, warehouse resolution, difference_qty behavior;
--   * M187 source-line-aware incoming/outgoing calls with v_item.id;
--   * ledger-derived actual/value totals, canonical GL mapping/posting;
--   * final adjustment status/totals/GL fields and return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- DISTINCT is deliberately outside the locking subquery: PostgreSQL rejects a
-- locking clause with DISTINCT in the same query level. The row locks are taken
-- first in ascending sai.id order. The product helper is intentionally delayed
-- until after the predecessor's count/duplicate validations so the new helper
-- cannot preempt those existing errors, while the validations themselves read a
-- row set already frozen by the pre-pass.

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
  v_products uuid[];
  v_locked_products uuid[];
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

  -- M191 Fix E: freeze the complete adjustment-item row set before any later
  -- product-sensitive work. DISTINCT is applied only after individual rows have
  -- been locked in deterministic id order.
  v_products := ARRAY(
    SELECT DISTINCT product_id
    FROM (
      SELECT sai.id, sai.product_id
      FROM public.stock_adjustment_items sai
      WHERE sai.adjustment_id = v_adj.id
      ORDER BY sai.id
      FOR UPDATE
    ) locked
  );

  SELECT count(*),
         count(DISTINCT ROW(product_id, COALESCE(warehouse_id, v_adj.warehouse_id)))
  INTO v_item_count, v_distinct_count
  FROM public.stock_adjustment_items
  WHERE adjustment_id = v_adj.id;

  IF v_item_count = 0 THEN RAISE EXCEPTION 'ADJUSTMENT_REQUIRES_ITEMS'; END IF;
  IF v_item_count <> v_distinct_count THEN
    RAISE EXCEPTION 'DUPLICATE_PRODUCT_WAREHOUSE_LINES';
  END IF;

  v_locked_products :=
    public.wardah_lock_products_for_stock_write(v_adj.org_id, v_products);

  FOR v_item IN
    SELECT *
    FROM public.stock_adjustment_items
    WHERE adjustment_id = v_adj.id
    ORDER BY id
  LOOP
    IF v_item.product_id IS NULL
       OR NOT COALESCE(v_item.product_id = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_item.product_id;
    END IF;

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