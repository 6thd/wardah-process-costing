-- migration_number: 186
-- description: Remove the absent stock_moves relation from every live routine,
--              rewire supported inventory contracts to stock_ledger_entries/bins,
--              and retire the unsupported material-variance mirror explicitly.
-- safety: replace-only functions and comments. No table/data mutation, backfill,
--         destructive DDL, or Production execution is part of this migration.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.stock_moves') IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_186_UNEXPECTED_LEGACY_RELATION_PRESENT';
  END IF;

  IF to_regclass('public.stock_ledger_entries') IS NULL
     OR to_regclass('public.bins') IS NULL
     OR to_regclass('public.material_reservations') IS NULL THEN
    RAISE EXCEPTION 'STOCK_186_CANONICAL_RELATIONS_MISSING';
  END IF;

  IF to_regprocedure('public.rpc_consume_reserved_materials(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.wardah_resolve_product_id(uuid,uuid,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'STOCK_186_CANONICAL_HELPERS_MISSING';
  END IF;
END
$preflight$;

-- The client contract still names material identifiers item_id. Resolve each
-- identifier through the legal item/product bridge, lock the canonical bins in
-- deterministic order, and reserve only the quantity that remains after both
-- bin-level and manufacturing reservations. Duplicate material lines are
-- aggregated before the availability decision.
CREATE OR REPLACE FUNCTION public.rpc_create_mo_with_reservation(
  p_order jsonb,
  p_materials jsonb DEFAULT '[]'::jsonb,
  p_tenant uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_mo_id uuid;
  v_mo_number text;
  v_mat jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_uom_id uuid;
  v_qty numeric;
  v_on_hand numeric;
  v_bin_reserved numeric;
  v_mo_reserved numeric;
  v_avail numeric;
  v_insufficient jsonb := '[]'::jsonb;
  v_reserved integer := 0;
  v_init_status text;
BEGIN
  v_org := public.wardah_org_id(
    COALESCE(NULLIF(p_order ->> 'org_id', '')::uuid, p_tenant)
  );
  PERFORM public.wardah_assert_org_member(v_org);

  IF jsonb_typeof(COALESCE(p_materials, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_MATERIALS: p_materials must be a JSON array';
  END IF;

  -- Validate casts separately so malformed payloads fail before taking locks.
  FOR v_mat IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    BEGIN
      v_item_id := NULLIF(v_mat ->> 'item_id', '')::uuid;
      v_qty := NULLIF(v_mat ->> 'quantity', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_MATERIAL: item_id and quantity must be valid values';
    END;

    IF jsonb_typeof(v_mat) <> 'object' OR v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_MATERIAL: item_id and a positive quantity are required';
    END IF;
  END LOOP;

  FOR v_item_id, v_qty IN
    SELECT (entry ->> 'item_id')::uuid, SUM((entry ->> 'quantity')::numeric)
    FROM jsonb_array_elements(p_materials) AS materials(entry)
    GROUP BY (entry ->> 'item_id')::uuid
    ORDER BY (entry ->> 'item_id')::uuid
  LOOP
    v_product_id := public.wardah_resolve_product_id(v_org, v_item_id, now());

    -- The canonical stock writers lock bins before updating them. Taking the
    -- same locks and order here serializes reservation-vs-stock and concurrent
    -- reservation decisions without introducing the opposite lock order.
    PERFORM 1
    FROM public.bins
    WHERE org_id = v_org AND product_id = v_product_id
    ORDER BY warehouse_id, id
    FOR UPDATE;

    SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(reserved_qty), 0)
    INTO v_on_hand, v_bin_reserved
    FROM public.bins
    WHERE org_id = v_org AND product_id = v_product_id;

    SELECT COALESCE(SUM(
      GREATEST(
        quantity_reserved - COALESCE(quantity_consumed, 0) - COALESCE(quantity_released, 0),
        0
      )
    ), 0)
    INTO v_mo_reserved
    FROM public.material_reservations
    WHERE org_id = v_org
      AND product_id = v_product_id
      AND status = 'reserved';

    v_avail := v_on_hand - v_bin_reserved - v_mo_reserved;
    IF v_avail < v_qty THEN
      v_insufficient := v_insufficient || jsonb_build_object(
        'item_id', v_item_id,
        'product_id', v_product_id,
        'required', v_qty,
        'available', v_avail
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_insufficient) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: مواد غير كافية: %', v_insufficient::text;
  END IF;

  v_init_status := public.normalize_mo_status(COALESCE(p_order ->> 'status', 'draft'));
  v_mo_number := COALESCE(
    NULLIF(p_order ->> 'order_number', ''),
    'MO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.mo_seq')::text, 4, '0')
  );

  INSERT INTO public.manufacturing_orders (
    org_id, order_number, product_id, item_id, quantity,
    status, notes, start_date, due_date
  )
  VALUES (
    v_org,
    v_mo_number,
    NULLIF(p_order ->> 'product_id', '')::uuid,
    NULLIF(p_order ->> 'item_id', '')::uuid,
    COALESCE(NULLIF(p_order ->> 'quantity', '')::numeric, 0),
    v_init_status,
    NULLIF(p_order ->> 'notes', ''),
    NULLIF(p_order ->> 'start_date', '')::date,
    NULLIF(p_order ->> 'due_date', '')::date
  )
  RETURNING id INTO v_mo_id;

  FOR v_mat IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_item_id := (v_mat ->> 'item_id')::uuid;
    v_qty := (v_mat ->> 'quantity')::numeric;
    v_product_id := public.wardah_resolve_product_id(v_org, v_item_id, now());
    SELECT base_uom_id INTO v_uom_id
    FROM public.products
    WHERE id = v_product_id AND org_id = v_org;

    INSERT INTO public.material_reservations (
      org_id, mo_id, item_id, product_id,
      quantity_reserved, status, expires_at,
      uom_id, qty_entered, conversion_factor_snapshot
    )
    VALUES (
      v_org, v_mo_id, v_item_id, v_product_id,
      v_qty, 'reserved', NULLIF(v_mat ->> 'expires_at', '')::timestamptz,
      v_uom_id, v_qty, 1
    );
    v_reserved := v_reserved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mo_id', v_mo_id,
    'mo_number', v_mo_number,
    'status', v_init_status,
    'materials_reserved', v_reserved
  );
END;
$function$;

COMMENT ON FUNCTION public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid) IS
  'Atomically creates a manufacturing order and reserves canonical product stock from bins after tenant-scoped item/product resolution and row locking.';

-- Compatibility entry point: preserve the published signature and ACL from
-- Migration 185, but route execution through the canonical, valued and atomic
-- material-consumption RPC. Errors now propagate instead of being converted
-- into a misleading success=false JSON after partial legacy work.
CREATE OR REPLACE FUNCTION public.consume_materials_for_mo(
  p_org_id uuid,
  p_mo_id uuid,
  p_consumptions jsonb[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actual_org uuid;
  v_payload jsonb;
BEGIN
  SELECT org_id INTO v_actual_org
  FROM public.manufacturing_orders
  WHERE id = p_mo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND';
  END IF;
  IF p_org_id IS NULL OR v_actual_org IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'MANUFACTURING_ORDER_ORG_MISMATCH';
  END IF;

  v_payload := to_jsonb(p_consumptions);
  IF jsonb_typeof(COALESCE(v_payload, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(v_payload) = 0 THEN
    RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED';
  END IF;

  RETURN public.rpc_consume_reserved_materials(p_mo_id, v_payload);
END;
$function$;

COMMENT ON FUNCTION public.consume_materials_for_mo(uuid,uuid,jsonb[]) IS
  'Compatibility wrapper for rpc_consume_reserved_materials; preserves the historical signature while using the canonical ledger/bin consumption path.';

-- Preserve the historical output names for the dormant validator consumer.
-- item_id now means product_id and location_id means warehouse_id. The
-- calculated side is the posted, non-cancelled legal ledger; the actual side
-- is the canonical bin projection.
CREATE OR REPLACE FUNCTION public.validate_stock_balance(p_org_id uuid)
RETURNS TABLE(
  item_id uuid,
  location_id uuid,
  calculated_quantity numeric,
  actual_quantity numeric,
  difference numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ledger_balance AS (
    SELECT product_id, warehouse_id, COALESCE(SUM(actual_qty), 0) AS quantity
    FROM public.stock_ledger_entries
    WHERE org_id = p_org_id
      AND docstatus = 1
      AND COALESCE(is_cancelled, false) = false
    GROUP BY product_id, warehouse_id
  ),
  bin_balance AS (
    SELECT product_id, warehouse_id, COALESCE(SUM(actual_qty), 0) AS quantity
    FROM public.bins
    WHERE org_id = p_org_id
    GROUP BY product_id, warehouse_id
  )
  SELECT
    COALESCE(ledger_balance.product_id, bin_balance.product_id),
    COALESCE(ledger_balance.warehouse_id, bin_balance.warehouse_id),
    COALESCE(ledger_balance.quantity, 0),
    COALESCE(bin_balance.quantity, 0),
    COALESCE(ledger_balance.quantity, 0) - COALESCE(bin_balance.quantity, 0)
  FROM ledger_balance
  FULL OUTER JOIN bin_balance USING (product_id, warehouse_id)
  WHERE ABS(COALESCE(ledger_balance.quantity, 0) - COALESCE(bin_balance.quantity, 0)) > 0.01;
$function$;

COMMENT ON FUNCTION public.validate_stock_balance(uuid) IS
  'Reports quantity mismatches between posted non-cancelled stock_ledger_entries and bins. Compatibility output aliases map item/location to product/warehouse.';

-- comprehensive_data_integrity_check also depends on this validator. Its
-- historical source used the equally absent stock_quants relation, so move the
-- reservation side to the same canonical bin/product model. The output keeps
-- item_id for compatibility while all availability math is grouped by the
-- resolved product identifier.
CREATE OR REPLACE FUNCTION public.validate_reservations(p_org_id uuid)
RETURNS TABLE(
  item_id uuid,
  mo_id uuid,
  reserved numeric,
  available numeric,
  on_hand numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH reservation_by_mo AS (
    SELECT
      COALESCE(product_id, item_id) AS product_id,
      item_id AS compatibility_item_id,
      mo_id,
      SUM(GREATEST(
        quantity_reserved - COALESCE(quantity_consumed, 0) - COALESCE(quantity_released, 0),
        0
      )) AS reserved
    FROM public.material_reservations
    WHERE org_id = p_org_id AND status = 'reserved'
    GROUP BY COALESCE(product_id, item_id), item_id, mo_id
  ),
  reservation_total AS (
    SELECT product_id, SUM(reserved) AS reserved
    FROM reservation_by_mo
    GROUP BY product_id
  ),
  bin_available AS (
    SELECT
      product_id,
      COALESCE(SUM(actual_qty), 0) - COALESCE(SUM(reserved_qty), 0) AS on_hand
    FROM public.bins
    WHERE org_id = p_org_id
    GROUP BY product_id
  )
  SELECT
    reservation_by_mo.compatibility_item_id,
    reservation_by_mo.mo_id,
    reservation_by_mo.reserved,
    COALESCE(bin_available.on_hand, 0) - reservation_total.reserved,
    COALESCE(bin_available.on_hand, 0)
  FROM reservation_by_mo
  JOIN reservation_total USING (product_id)
  LEFT JOIN bin_available USING (product_id)
  WHERE COALESCE(bin_available.on_hand, 0) < reservation_total.reserved;
$function$;

COMMENT ON FUNCTION public.validate_reservations(uuid) IS
  'Reports aggregate manufacturing reservations that exceed canonical bin availability. Compatibility output retains the historical item_id field.';

-- Keep the broad legacy integrity wrapper callable, but point its inventory
-- catalog checks at relations that actually exist. Its separate RBAC and wider
-- legacy-table cleanup remain tracked independently.
CREATE OR REPLACE FUNCTION public.comprehensive_data_integrity_check(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb := jsonb_build_object(
    'valid', true,
    'checks', jsonb_build_array(),
    'errors', jsonb_build_array(),
    'warnings', jsonb_build_array()
  );
  v_check_result jsonb;
  v_table_name text;
  v_tables text[] := ARRAY[
    'manufacturing_orders',
    'products',
    'stock_ledger_entries',
    'gl_accounts',
    'journal_entries',
    'sales_orders',
    'purchase_orders'
  ];
BEGIN
  FOREACH v_table_name IN ARRAY v_tables
  LOOP
    SELECT jsonb_build_object(
      'table', v_table_name,
      'check', 'org_id_presence',
      'valid', NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = v_table_name
          AND column_name = 'org_id'
      ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public'
          AND t.table_name = v_table_name
          AND EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = v_table_name
              AND n.nspname = 'public'
              AND EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = v_table_name
                  AND column_name = 'org_id'
                  AND is_nullable = 'NO'
              )
          )
      )
    ) INTO v_check_result;

    v_result := jsonb_set(
      v_result,
      '{checks}',
      (v_result -> 'checks') || jsonb_build_array(v_check_result)
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.validate_stock_balance(p_org_id)) THEN
    v_result := jsonb_set(v_result, '{valid}', 'false'::jsonb);
    v_result := jsonb_set(
      v_result,
      '{errors}',
      (v_result -> 'errors') || jsonb_build_array('Stock balance mismatches found')
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.validate_reservations(p_org_id)) THEN
    v_result := jsonb_set(v_result, '{valid}', 'false'::jsonb);
    v_result := jsonb_set(
      v_result,
      '{warnings}',
      (v_result -> 'warnings') || jsonb_build_array('Reservation issues found')
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- This compatibility report previously returned an empty success whenever its
-- undeployed source relation was absent. The legal schema has actual material
-- consumption but no component-level standard-price snapshot, so calculating
-- price variance would fabricate accounting meaning. Fail explicitly until a
-- dedicated standard-cost snapshot contract is implemented.
CREATE OR REPLACE FUNCTION public.calculate_material_variances(
  p_mo_id uuid,
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date
)
RETURNS TABLE(
  product_code character varying,
  product_name character varying,
  standard_qty numeric,
  actual_qty numeric,
  standard_cost numeric,
  actual_cost numeric,
  qty_variance numeric,
  price_variance numeric,
  efficiency_variance numeric,
  total_variance numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'MATERIAL_VARIANCE_SOURCE_RETIRED: canonical standard-cost snapshot is not implemented'
    USING ERRCODE = '0A000',
          HINT = 'Use material_consumption for actual quantities/costs; add a separately reviewed standard-cost snapshot before computing variances.';
END;
$function$;

COMMENT ON FUNCTION public.calculate_material_variances(uuid,date,date) IS
  'Explicitly retired legacy material-variance contract. The absent stock_moves mirror is not a legal source; a canonical standard-cost snapshot is required before reimplementation.';

-- Preserve all completion semantics from Migration 96 except the conditional
-- write to the absent legacy mirror. Finished-goods bin semantics remain a
-- separate Round 3 decision; this migration does not invent a warehouse.
CREATE OR REPLACE FUNCTION public.rpc_complete_manufacturing_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_uid uuid;
  v_mo_id uuid;
  v_mo record;
  v_prod record;
  v_done_qty numeric;
  v_wip_cost numeric;
  v_unit_cost numeric;
  v_new_qty numeric;
  v_new_rate numeric;
  v_allow_zero boolean;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  v_org := public.wardah_org_id(NULLIF(p_payload ->> 'tenant_id', '')::uuid);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORG_NOT_RESOLVED: تعذر تحديد هوية المؤسسة';
  END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_organizations
    WHERE user_id = v_uid AND org_id = v_org
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN_ORG: المستخدم ليس عضواً في المؤسسة المطلوبة';
  END IF;

  v_mo_id := (p_payload ->> 'mo_id')::uuid;
  IF v_mo_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: mo_id مطلوب';
  END IF;

  SELECT id, status, quantity, completed_quantity, product_id, total_cost
  INTO v_mo
  FROM public.manufacturing_orders
  WHERE id = v_mo_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MO_NOT_FOUND: أمر التصنيع غير موجود ضمن مؤسستك';
  END IF;

  IF public.normalize_mo_status(v_mo.status) = 'done' THEN
    RETURN jsonb_build_object(
      'success', true,
      'mo_id', v_mo_id,
      'already_done', true,
      'completed_quantity', v_mo.completed_quantity,
      'total_cost', round(COALESCE(v_mo.total_cost, 0), 6)
    );
  END IF;

  IF v_mo.product_id IS NULL THEN
    RAISE EXCEPTION 'MO_NO_PRODUCT: أمر التصنيع بلا منتج تام محدَّد';
  END IF;

  v_done_qty := COALESCE((p_payload ->> 'completed_quantity')::numeric, v_mo.quantity);
  IF v_done_qty IS NULL OR v_done_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: الكمية المنجزة يجب أن تكون موجبة';
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_cost, consumed_quantity * COALESCE(unit_cost, 0))), 0)
  INTO v_wip_cost
  FROM public.material_consumption
  WHERE mo_id = v_mo_id AND org_id = v_org;

  v_allow_zero := COALESCE(p_payload ->> 'allow_zero_cost', 'false') = 'true';
  IF v_allow_zero AND NOT EXISTS (
    SELECT 1 FROM public.user_organizations
    WHERE user_id = v_uid AND org_id = v_org
      AND (COALESCE(is_org_admin, false) OR role IN ('admin', 'owner'))
  ) THEN
    v_allow_zero := false;
  END IF;

  IF v_wip_cost <= 0 AND NOT v_allow_zero THEN
    RAISE EXCEPTION 'ZERO_COST_COMPLETION: لا تكلفة مواد مسجَّلة لأمر التصنيع — '
      'الإتمام بتكلفة صفرية مرفوض (يلوّث متوسط تكلفة المنتج). سجّل استهلاك المواد '
      'أولاً، أو مرّر allow_zero_cost=true بصلاحية مدير للإتمام المصرَّح.';
  END IF;

  v_unit_cost := CASE WHEN v_done_qty > 0 THEN v_wip_cost / v_done_qty ELSE 0 END;

  SELECT id, COALESCE(stock_quantity, 0) AS qty, COALESCE(cost_price, 0) AS cost
  INTO v_prod
  FROM public.products
  WHERE id = v_mo.product_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND: منتج أمر التصنيع غير موجود ضمن مؤسستك';
  END IF;

  v_new_qty := v_prod.qty + v_done_qty;
  v_new_rate := CASE
    WHEN v_new_qty > 0 THEN (v_prod.qty * v_prod.cost + v_wip_cost) / v_new_qty
    ELSE v_unit_cost
  END;

  UPDATE public.products
  SET stock_quantity = v_new_qty,
      cost_price = v_new_rate,
      updated_at = now()
  WHERE id = v_mo.product_id;

  UPDATE public.manufacturing_orders
  SET status = 'done',
      completed_quantity = v_done_qty,
      total_cost = v_wip_cost,
      unit_cost = v_unit_cost
  WHERE id = v_mo_id;

  IF v_wip_cost > 0 THEN
    PERFORM public.rpc_post_event_journal(
      'MATERIAL_ISSUE', v_wip_cost, 'صرف مواد لأمر تصنيع - ' || v_mo_id::text,
      'MANUFACTURING_ORDER', v_mo_id, v_org, 'MATERIAL_ISSUE:' || v_mo_id::text, NULL
    );
    PERFORM public.rpc_post_event_journal(
      'FG_RECEIPT', v_wip_cost, 'إنتاج تام لأمر تصنيع - ' || v_mo_id::text,
      'MANUFACTURING_ORDER', v_mo_id, v_org, 'FG_RECEIPT:' || v_mo_id::text, NULL
    );
  ELSE
    v_warnings := v_warnings || to_jsonb(
      'إتمام بتكلفة صفرية (مصرَّح allow_zero_cost بصلاحية مدير): لا استهلاك مواد، لا قيد.'::text
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'mo_id', v_mo_id,
    'completed_quantity', v_done_qty,
    'total_cost', round(v_wip_cost, 6),
    'unit_cost', round(v_unit_cost, 6),
    'fg_new_stock', v_new_qty,
    'warnings', v_warnings
  );
END;
$function$;

COMMENT ON FUNCTION public.rpc_complete_manufacturing_order(jsonb) IS
  'Atomically completes a manufacturing order and posts costing/GL effects. No legacy stock mirror is written; finished-goods warehouse/bin semantics remain a separate contract.';

REVOKE EXECUTE ON FUNCTION public.rpc_complete_manufacturing_order(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_complete_manufacturing_order(jsonb)
  TO authenticated, service_role;

DO $postflight$
DECLARE
  v_legacy_functions text;
  v_src text;
  v_caught boolean := false;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  INTO v_legacy_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~* '\mstock_moves\M';

  IF v_legacy_functions IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_186_LIVE_LEGACY_ROUTINES_REMAIN: %', v_legacy_functions;
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'::regprocedure;
  IF v_src !~ 'public\.bins' OR v_src !~ 'public\.material_reservations' OR v_src !~ 'FOR UPDATE' THEN
    RAISE EXCEPTION 'STOCK_186_RESERVATION_CONTRACT_NOT_INSTALLED';
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.validate_stock_balance(uuid)'::regprocedure;
  IF v_src !~ 'public\.stock_ledger_entries' OR v_src !~ 'public\.bins' THEN
    RAISE EXCEPTION 'STOCK_186_BALANCE_CONTRACT_NOT_INSTALLED';
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.validate_reservations(uuid)'::regprocedure;
  IF v_src !~ 'public\.bins' OR v_src ~* '\mstock_quants\M' THEN
    RAISE EXCEPTION 'STOCK_186_RESERVATION_VALIDATOR_NOT_INSTALLED';
  END IF;

  SELECT p.prosrc INTO v_src
  FROM pg_proc p
  WHERE p.oid = 'public.consume_materials_for_mo(uuid,uuid,jsonb[])'::regprocedure;
  IF v_src !~ 'rpc_consume_reserved_materials' THEN
    RAISE EXCEPTION 'STOCK_186_CONSUMPTION_WRAPPER_NOT_INSTALLED';
  END IF;

  IF has_function_privilege('anon', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOCK_186_CONSUMPTION_ACL_DRIFT';
  END IF;

  BEGIN
    PERFORM 1 FROM public.calculate_material_variances(gen_random_uuid(), NULL, NULL);
  EXCEPTION WHEN feature_not_supported THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_186_VARIANCE_RETIREMENT_NOT_EXPLICIT';
  END IF;

  RAISE NOTICE 'STOCK_186_POSTFLIGHT_PASS';
END
$postflight$;

COMMIT;
