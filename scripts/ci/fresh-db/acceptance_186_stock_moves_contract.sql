-- Green acceptance for Migration 186. Runs on a fresh database through the
-- latest migration and rolls back every fixture.
\set ON_ERROR_STOP on

BEGIN;

DO $contract_shape$
DECLARE
  v_legacy_functions text;
  v_caught boolean := false;
BEGIN
  IF to_regclass('public.stock_moves') IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_LEGACY_RELATION_PRESENT';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  INTO v_legacy_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~* '\mstock_moves\M';

  IF v_legacy_functions IS NOT NULL THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_LIVE_LEGACY_ROUTINES_REMAIN: %', v_legacy_functions;
  END IF;

  IF has_function_privilege('anon', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_COMPATIBILITY_ACL_DRIFT';
  END IF;

  BEGIN
    PERFORM 1 FROM public.calculate_material_variances(gen_random_uuid(), NULL, NULL);
  EXCEPTION WHEN feature_not_supported THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_VARIANCE_RETIREMENT_NOT_EXPLICIT';
  END IF;

  RAISE NOTICE 'STOCK_186_GREEN_CONTRACT_SHAPE_OK';
END
$contract_shape$;

INSERT INTO public.organizations (id, name, code)
VALUES ('51856186-1000-0000-0000-000000000001', 'Stock 186 Green', 'STK186-GREEN');

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT
  '51856186-1000-0000-0000-000000000002',
  '51856186-1000-0000-0000-000000000001',
  'STK186-MAT',
  'Stock 186 Material',
  true,
  u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT
  '51856186-1000-0000-0000-000000000003',
  '51856186-1000-0000-0000-000000000001',
  'STK186-FG',
  'Stock 186 Finished Good',
  true,
  u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

DO $seed_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = '51856186-1000-0000-0000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = '51856186-1000-0000-0000-000000000003'
  ) THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_NO_SYSTEM_UOM_SEEDED';
  END IF;
END
$seed_check$;

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES (
  '51856186-1000-0000-0000-000000000004',
  '51856186-1000-0000-0000-000000000001',
  'STK186-WH',
  'Stock 186 Warehouse'
);

INSERT INTO public.bins (
  id, org_id, product_id, warehouse_id, actual_qty, reserved_qty,
  valuation_rate, stock_value, stock_queue
)
VALUES (
  '51856186-1000-0000-0000-000000000005',
  '51856186-1000-0000-0000-000000000001',
  '51856186-1000-0000-0000-000000000002',
  '51856186-1000-0000-0000-000000000004',
  8, 1, 2, 16, '[{"qty":8,"rate":2}]'::jsonb
);

INSERT INTO public.stock_ledger_entries (
  voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
  posting_date, actual_qty, qty_after_transaction, incoming_rate,
  valuation_rate, stock_value, stock_value_difference, stock_queue,
  is_cancelled, docstatus, org_id
)
VALUES (
  'Stock Adjustment',
  '51856186-1000-0000-0000-000000000006',
  'STK186-OPEN',
  '51856186-1000-0000-0000-000000000002',
  '51856186-1000-0000-0000-000000000004',
  CURRENT_DATE, 10, 10, 2, 2, 20, 20,
  '[{"qty":10,"rate":2}]'::jsonb,
  false, 1,
  '51856186-1000-0000-0000-000000000001'
);

DO $balance_mismatch$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
  FROM public.validate_stock_balance('51856186-1000-0000-0000-000000000001');

  IF NOT FOUND
     OR v_row.item_id IS DISTINCT FROM '51856186-1000-0000-0000-000000000002'::uuid
     OR v_row.location_id IS DISTINCT FROM '51856186-1000-0000-0000-000000000004'::uuid
     OR v_row.calculated_quantity IS DISTINCT FROM 10::numeric
     OR v_row.actual_quantity IS DISTINCT FROM 8::numeric
     OR v_row.difference IS DISTINCT FROM 2::numeric THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_BALANCE_MISMATCH_WRONG: %', row_to_json(v_row);
  END IF;

  RAISE NOTICE 'STOCK_186_GREEN_BALANCE_MISMATCH_OK';
END
$balance_mismatch$;

UPDATE public.bins
SET actual_qty = 10, stock_value = 20, stock_queue = '[{"qty":10,"rate":2}]'::jsonb
WHERE id = '51856186-1000-0000-0000-000000000005';

DO $balance_match$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.validate_stock_balance('51856186-1000-0000-0000-000000000001')
  ) THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_BALANCE_MATCH_REPORTED_AS_MISMATCH';
  END IF;
  RAISE NOTICE 'STOCK_186_GREEN_BALANCE_MATCH_OK';
END
$balance_match$;

INSERT INTO public.manufacturing_orders (
  id, org_id, order_number, product_id, quantity, status
)
VALUES (
  '51856186-1000-0000-0000-000000000007',
  '51856186-1000-0000-0000-000000000001',
  'STK186-EXISTING-MO',
  '51856186-1000-0000-0000-000000000003',
  1,
  'draft'
);

INSERT INTO public.material_reservations (
  id, org_id, mo_id, item_id, quantity_reserved, status
)
VALUES (
  '51856186-1000-0000-0000-000000000008',
  '51856186-1000-0000-0000-000000000001',
  '51856186-1000-0000-0000-000000000007',
  '51856186-1000-0000-0000-000000000002',
  2,
  'reserved'
);

INSERT INTO auth.users (id, email)
VALUES ('51856186-1000-0000-0000-000000000009', 'stock186-green@example.test');

INSERT INTO public.user_organizations (user_id, org_id, is_active)
VALUES (
  '51856186-1000-0000-0000-000000000009',
  '51856186-1000-0000-0000-000000000001',
  true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51856186-1000-0000-0000-000000000009', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856186-1000-0000-0000-000000000009","role":"authenticated"}',
  true
);

DO $reservation_contract$
DECLARE
  v_result jsonb;
  v_caught boolean := false;
  v_count integer;
  v_qty numeric;
  v_product uuid;
BEGIN
  -- On-hand 10 - bin reserved 1 - existing MO reservation 2 = 7.
  -- Two duplicate lines totalling 8 must be assessed as one demand and fail.
  BEGIN
    PERFORM public.rpc_create_mo_with_reservation(
      jsonb_build_object(
        'org_id', '51856186-1000-0000-0000-000000000001',
        'order_number', 'STK186-DUPLICATE-FAIL',
        'product_id', '51856186-1000-0000-0000-000000000003',
        'quantity', 1
      ),
      jsonb_build_array(
        jsonb_build_object('item_id', '51856186-1000-0000-0000-000000000002', 'quantity', 4),
        jsonb_build_object('item_id', '51856186-1000-0000-0000-000000000002', 'quantity', 4)
      ),
      NULL
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'INSUFFICIENT_STOCK:%' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_DUPLICATE_DEMAND_NOT_AGGREGATED';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.manufacturing_orders
  WHERE order_number = 'STK186-DUPLICATE-FAIL';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_FAILED_RESERVATION_CREATED_MO';
  END IF;

  v_result := public.rpc_create_mo_with_reservation(
    jsonb_build_object(
      'org_id', '51856186-1000-0000-0000-000000000001',
      'order_number', 'STK186-RESERVE-OK',
      'product_id', '51856186-1000-0000-0000-000000000003',
      'quantity', 1
    ),
    jsonb_build_array(jsonb_build_object(
      'item_id', '51856186-1000-0000-0000-000000000002',
      'quantity', 7
    )),
    NULL
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) IS DISTINCT FROM true
     OR (v_result ->> 'materials_reserved')::integer <> 1 THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_RESERVATION_RPC_FAILED: %', v_result;
  END IF;

  SELECT quantity_reserved, product_id
  INTO v_qty, v_product
  FROM public.material_reservations
  WHERE mo_id = (v_result ->> 'mo_id')::uuid;

  IF v_qty IS DISTINCT FROM 7::numeric
     OR v_product IS DISTINCT FROM '51856186-1000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_CANONICAL_RESERVATION_WRONG: qty=% product=%', v_qty, v_product;
  END IF;

  RAISE NOTICE 'STOCK_186_GREEN_RESERVATION_CONTRACT_OK';
END
$reservation_contract$;

RESET ROLE;

DO $compatibility_wrapper$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.consume_materials_for_mo(
      '51856186-1000-0000-0000-000000000010',
      '51856186-1000-0000-0000-000000000007',
      ARRAY[jsonb_build_object(
        'item_id', '51856186-1000-0000-0000-000000000002',
        'quantity', 1
      )]::jsonb[]
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'MANUFACTURING_ORDER_ORG_MISMATCH' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_186_GREEN_COMPATIBILITY_ORG_GUARD_MISSING';
  END IF;

  -- The comprehensive wrapper must no longer inherit a missing-relation error.
  PERFORM public.comprehensive_data_integrity_check(
    '51856186-1000-0000-0000-000000000001'
  );
  RAISE NOTICE 'STOCK_186_GREEN_COMPATIBILITY_WRAPPER_OK';
END
$compatibility_wrapper$;

\echo 'STOCK_186_GREEN_ACCEPTANCE_PASS'
ROLLBACK;
