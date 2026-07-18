-- migration_number: 126
-- description: Allow stock-adjustment drafts before account selection, enforce
--              accounts only at submit, and never treat location_id as warehouse_id.
-- safety: replace-only; no schema object or data is deleted.

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

  -- Accounts may be selected after draft creation. rpc_submit_stock_adjustment
  -- remains fail-closed and refuses posting until all required accounts exist.
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

    -- location_id and warehouse_id are different domain concepts. Only an
    -- explicit warehouse_id is accepted; otherwise resolve exactly one stocked bin.
    v_warehouse := NULLIF(v_row ->> 'warehouse_id', '')::uuid;
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
        consumed_at = now(), updated_at = now()
    WHERE id = v_res.id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'mo_id', p_mo_id,
                            'consumption_count', jsonb_array_length(p_consumptions));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid, jsonb) TO authenticated;
