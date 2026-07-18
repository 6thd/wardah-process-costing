-- migration_number: 125
-- description: Add the canonical inventory GL account to stock adjustments and
--              correct journal mapping for gains and losses.
-- safety: additive/replace-only; no historical field or data is removed.

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS inventory_account_id uuid REFERENCES public.gl_accounts(id);

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

  IF v_count = 0 THEN RAISE EXCEPTION 'ADJUSTMENT_REQUIRES_ITEMS'; END IF;
  IF NULLIF(p_payload ->> 'inventory_account_id', '') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_ACCOUNT_REQUIRED';
  END IF;
  IF v_total_value > 0 AND NULLIF(p_payload ->> 'increase_account_id', '') IS NULL THEN
    RAISE EXCEPTION 'INCREASE_ACCOUNT_REQUIRED';
  END IF;
  IF v_total_value < 0 AND NULLIF(p_payload ->> 'decrease_account_id', '') IS NULL THEN
    RAISE EXCEPTION 'DECREASE_ACCOUNT_REQUIRED';
  END IF;

  INSERT INTO public.stock_adjustments (
    id, organization_id, org_id, adjustment_number, adjustment_date, posting_date,
    adjustment_type, reason, reference_number, warehouse_id, status,
    requires_approval, total_items, total_qty_difference, total_value_difference,
    created_by, inventory_account_id, increase_account_id, decrease_account_id
  ) VALUES (
    v_id, v_org, v_org, v_number, v_date,
    COALESCE(NULLIF(p_payload ->> 'posting_date', '')::date, v_date),
    p_payload ->> 'adjustment_type', p_payload ->> 'reason',
    NULLIF(p_payload ->> 'reference_number', ''),
    NULLIF(p_payload ->> 'warehouse_id', '')::uuid,
    'DRAFT',
    COALESCE((p_payload ->> 'requires_approval')::boolean, abs(v_total_value) > 10000),
    v_count, v_total_qty, v_total_value, auth.uid(),
    NULLIF(p_payload ->> 'inventory_account_id', '')::uuid,
    NULLIF(p_payload ->> 'increase_account_id', '')::uuid,
    NULLIF(p_payload ->> 'decrease_account_id', '')::uuid
  );

  INSERT INTO public.stock_adjustment_items (
    adjustment_id, organization_id, product_id, warehouse_id,
    current_qty, new_qty, difference_qty, current_rate, new_rate,
    value_difference, reason, serial_numbers, batch_numbers
  )
  SELECT
    v_id, v_org, (x ->> 'product_id')::uuid,
    NULLIF(x ->> 'warehouse_id', '')::uuid,
    COALESCE((x ->> 'current_qty')::numeric, 0),
    (x ->> 'new_qty')::numeric, (x ->> 'difference_qty')::numeric,
    COALESCE((x ->> 'current_rate')::numeric, 0),
    NULLIF(x ->> 'new_rate', '')::numeric,
    (x ->> 'value_difference')::numeric, NULLIF(x ->> 'reason', ''),
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
  v_item_count integer;
BEGIN
  SELECT * INTO v_adj
  FROM public.stock_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND'; END IF;

  v_adj.org_id := COALESCE(v_adj.org_id, v_adj.organization_id);
  PERFORM public.wardah_assert_org_admin(v_adj.org_id);

  IF v_adj.status = 'SUBMITTED' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'adjustment_id', v_adj.id,
                              'gl_entry_id', v_adj.canonical_gl_entry_id);
  END IF;
  IF v_adj.status <> 'DRAFT' THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_DRAFT'; END IF;
  IF COALESCE(v_adj.requires_approval, false) AND v_adj.approved_by IS NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_APPROVAL_REQUIRED';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.stock_adjustment_items
  WHERE adjustment_id = v_adj.id;
  IF v_item_count = 0 THEN RAISE EXCEPTION 'ADJUSTMENT_REQUIRES_ITEMS'; END IF;

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
    IF v_adj.inventory_account_id IS NULL THEN RAISE EXCEPTION 'INVENTORY_ACCOUNT_REQUIRED'; END IF;
    IF v_adj.total_value_difference > 0 THEN
      IF v_adj.increase_account_id IS NULL THEN RAISE EXCEPTION 'INCREASE_ACCOUNT_REQUIRED'; END IF;
      v_debit := v_adj.inventory_account_id;
      v_credit := v_adj.increase_account_id;
    ELSE
      IF v_adj.decrease_account_id IS NULL THEN RAISE EXCEPTION 'DECREASE_ACCOUNT_REQUIRED'; END IF;
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
        jsonb_build_object('line_number', 1, 'account_id', v_debit,
                           'debit', v_amount, 'credit', 0, 'description', v_adj.reason),
        jsonb_build_object('line_number', 2, 'account_id', v_credit,
                           'debit', 0, 'credit', v_amount, 'description', v_adj.reason)
      )
    ));
  END IF;

  UPDATE public.stock_adjustments
  SET status = 'SUBMITTED', submitted_by = auth.uid(), submitted_at = now(),
      canonical_gl_entry_id = NULLIF(v_gl ->> 'entry_id', '')::uuid,
      updated_by = auth.uid(), updated_at = now()
  WHERE id = v_adj.id;

  RETURN jsonb_build_object('success', true, 'adjustment_id', v_adj.id,
                            'gl_entry_id', NULLIF(v_gl ->> 'entry_id', '')::uuid);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_stock_adjustment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_stock_adjustment(uuid) TO authenticated;
