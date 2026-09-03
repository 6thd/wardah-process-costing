-- Green acceptance for Migration 187. Runs on an upgraded cutoff-186 database
-- that carries a historical duplicate with source_line_id NULL.
\set ON_ERROR_STOP on

BEGIN;

DO $contract_shape$
DECLARE
  v_index_definition text;
  v_trigger_definition text;
  v_historical_count integer;
BEGIN
  SELECT pg_get_indexdef(
    'public.uq_sle_stock_adjustment_voucher_product_warehouse_v187'::regclass
  ) INTO v_index_definition;

  IF v_index_definition IS NULL
     OR v_index_definition NOT LIKE 'CREATE UNIQUE INDEX%'
     OR v_index_definition NOT LIKE '%source_line_id IS NOT NULL%'
     OR v_index_definition NOT LIKE '%stock adjustment%' THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_INDEX_DRIFT: %', v_index_definition;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.stock_ledger_entries'::regclass
      AND tgname = 'trg_sle_stock_adjustment_source_line_v187'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_TRIGGER_MISSING';
  END IF;

  SELECT pg_get_triggerdef(oid)
  INTO v_trigger_definition
  FROM pg_trigger
  WHERE tgrelid = 'public.stock_ledger_entries'::regclass
    AND tgname = 'trg_sle_stock_adjustment_source_line_v187'
    AND NOT tgisinternal;

  IF v_trigger_definition NOT LIKE '%BEFORE INSERT OR UPDATE OF%'
     OR v_trigger_definition NOT LIKE '%source_line_id%' THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_TRIGGER_DRIFT: %', v_trigger_definition;
  END IF;

  IF to_regprocedure(
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)'
     ) IS NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_HELPER_OVERLOAD_MISSING';
  END IF;

  SELECT count(*)
  INTO v_historical_count
  FROM public.stock_ledger_entries
  WHERE voucher_id = '51856187-1000-0000-0000-000000000006'
    AND source_line_id IS NULL;

  IF v_historical_count <> 2 THEN
    RAISE EXCEPTION
      'STOCK_187_GREEN_HISTORICAL_ROWS_CHANGED: count=%',
      v_historical_count;
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_CONTRACT_SHAPE_OK';
  RAISE NOTICE 'STOCK_187_GREEN_HISTORY_PRESERVED_OK';
END
$contract_shape$;

-- The guard is INSERT-only: historical rows remain updateable by the legal
-- cancellation workflow even though their source provenance is unknown.
UPDATE public.stock_ledger_entries
SET modified_at = now()
WHERE id = '51856187-1000-0000-0000-000000000007';

DO $new_null_rejected$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.wardah_apply_stock_incoming(
      '51856187-1000-0000-0000-000000000001',
      '51856187-1000-0000-0000-000000000002',
      '51856187-1000-0000-0000-000000000003',
      1,
      1,
      'Stock Adjustment',
      '51856187-1000-0000-0000-000000000010',
      'STK187-NULL-REJECT',
      CURRENT_DATE
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'STOCK_SOURCE_LINE_REQUIRED' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_NULL_SOURCE_ACCEPTED';
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_NULL_SOURCE_REJECTED_OK';
END
$new_null_rejected$;

-- Two distinct Goods Receipt lines may legally share voucher/product/warehouse.
-- This proves Migration 187 did not install the invalid global four-column key.
SELECT public.wardah_apply_stock_incoming(
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000002',
  '51856187-1000-0000-0000-000000000003',
  1,
  1,
  'Goods Receipt',
  '51856187-1000-0000-0000-000000000011',
  'STK187-GR-TWO-LINES',
  CURRENT_DATE
);

SELECT public.wardah_apply_stock_incoming(
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000002',
  '51856187-1000-0000-0000-000000000003',
  1,
  1,
  'Goods Receipt',
  '51856187-1000-0000-0000-000000000011',
  'STK187-GR-TWO-LINES',
  CURRENT_DATE
);

DO $goods_receipt_compatibility$
BEGIN
  IF (
    SELECT count(*)
    FROM public.stock_ledger_entries
    WHERE voucher_type = 'Goods Receipt'
      AND voucher_id = '51856187-1000-0000-0000-000000000011'
      AND product_id = '51856187-1000-0000-0000-000000000002'
      AND warehouse_id = '51856187-1000-0000-0000-000000000003'
  ) <> 2 THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_VALID_RECEIPT_LINES_REJECTED';
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_VALID_RECEIPT_LINES_OK';
END
$goods_receipt_compatibility$;

INSERT INTO public.products (
  id, org_id, code, name, is_stockable, base_uom_id
)
SELECT
  '51856187-1000-0000-0000-000000000012',
  '51856187-1000-0000-0000-000000000001',
  'STK187-ADJ',
  'Stock 187 Adjustment Product',
  true,
  u.id
FROM public.uoms u
WHERE u.org_id IS NULL
  AND u.is_active
  AND NOT u.is_product_specific
LIMIT 1;

INSERT INTO public.stock_adjustments (
  id,
  organization_id,
  org_id,
  adjustment_number,
  adjustment_date,
  posting_date,
  adjustment_type,
  reason,
  warehouse_id,
  status,
  created_by
)
VALUES (
  '51856187-1000-0000-0000-000000000013',
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000001',
  'STK187-ADJ-001',
  CURRENT_DATE,
  CURRENT_DATE,
  'OTHER',
  'Migration 187 acceptance',
  '51856187-1000-0000-0000-000000000003',
  'DRAFT',
  '51856187-1000-0000-0000-000000000005'
);

INSERT INTO public.stock_adjustment_items (
  id,
  adjustment_id,
  organization_id,
  product_id,
  warehouse_id,
  current_qty,
  new_qty,
  difference_qty,
  current_rate,
  new_rate,
  value_difference
)
VALUES (
  '51856187-1000-0000-0000-000000000014',
  '51856187-1000-0000-0000-000000000013',
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000012',
  '51856187-1000-0000-0000-000000000003',
  0,
  1,
  1,
  0,
  0,
  0
);

DO $source_relation_guard$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.wardah_apply_stock_incoming(
      '51856187-1000-0000-0000-000000000001',
      '51856187-1000-0000-0000-000000000012',
      '51856187-1000-0000-0000-000000000003',
      1,
      0,
      'Stock Adjustment',
      '51856187-1000-0000-0000-000000000016',
      'STK187-WRONG-SOURCE',
      CURRENT_DATE,
      '51856187-1000-0000-0000-000000000014'
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'STOCK_SOURCE_LINE_MISMATCH' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_SOURCE_RELATION_ACCEPTED';
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_SOURCE_RELATION_REJECTED_OK';
END
$source_relation_guard$;

DO $table_source_relation_guard$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
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
      source_line_id
    ) VALUES (
      'Stock Adjustment',
      '51856187-1000-0000-0000-000000000016',
      'STK187-WRONG-SOURCE-DIRECT',
      '51856187-1000-0000-0000-000000000012',
      '51856187-1000-0000-0000-000000000003',
      CURRENT_DATE,
      1,
      1,
      0,
      0,
      0,
      0,
      '[]'::jsonb,
      1,
      '51856187-1000-0000-0000-000000000001',
      '51856187-1000-0000-0000-000000000014'
    );
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'STOCK_SOURCE_LINE_MISMATCH' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_187_GREEN_TABLE_SOURCE_RELATION_ACCEPTED';
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_TABLE_SOURCE_REJECTED_OK';
END
$table_source_relation_guard$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '51856187-1000-0000-0000-000000000005',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856187-1000-0000-0000-000000000005","role":"authenticated"}',
  true
);

DO $submit_and_replay$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.rpc_submit_stock_adjustment(
    '51856187-1000-0000-0000-000000000013'
  );
  v_second := public.rpc_submit_stock_adjustment(
    '51856187-1000-0000-0000-000000000013'
  );

  IF NOT COALESCE((v_first ->> 'success')::boolean, false)
     OR COALESCE((v_first ->> 'duplicate')::boolean, false)
     OR NOT COALESCE((v_second ->> 'duplicate')::boolean, false) THEN
    RAISE EXCEPTION
      'STOCK_187_GREEN_SUBMIT_REPLAY_WRONG: first=% second=%',
      v_first,
      v_second;
  END IF;
END
$submit_and_replay$;

RESET ROLE;

DO $source_propagated$
DECLARE
  v_rows integer;
  v_source uuid;
  v_status text;
BEGIN
  SELECT count(*), (array_agg(source_line_id ORDER BY id))[1]
  INTO v_rows, v_source
  FROM public.stock_ledger_entries
  WHERE voucher_type = 'Stock Adjustment'
    AND voucher_id = '51856187-1000-0000-0000-000000000013';

  SELECT status
  INTO v_status
  FROM public.stock_adjustments
  WHERE id = '51856187-1000-0000-0000-000000000013';

  IF v_rows <> 1
     OR v_source IS DISTINCT FROM
       '51856187-1000-0000-0000-000000000014'::uuid
     OR v_status IS DISTINCT FROM 'SUBMITTED' THEN
    RAISE EXCEPTION
      'STOCK_187_GREEN_SOURCE_NOT_PROPAGATED: rows=% source=% status=%',
      v_rows,
      v_source,
      v_status;
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_RPC_REPLAY_OK';
  RAISE NOTICE 'STOCK_187_GREEN_SOURCE_PROPAGATED_OK';
END
$source_propagated$;

-- A second source item for the same adjustment/product/warehouse is invalid.
-- The helper verifies the source relation, then the unique index remains the
-- final race-safe boundary even if a future caller misses the RPC pre-check.
INSERT INTO public.stock_adjustment_items (
  id,
  adjustment_id,
  organization_id,
  product_id,
  warehouse_id,
  current_qty,
  new_qty,
  difference_qty,
  current_rate,
  new_rate,
  value_difference
)
VALUES (
  '51856187-1000-0000-0000-000000000015',
  '51856187-1000-0000-0000-000000000013',
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000012',
  '51856187-1000-0000-0000-000000000003',
  1,
  2,
  1,
  0,
  0,
  0
);

DO $unique_boundary$
DECLARE
  v_caught boolean := false;
  v_bin_before numeric;
  v_bin_after numeric;
BEGIN
  SELECT actual_qty
  INTO v_bin_before
  FROM public.bins
  WHERE product_id = '51856187-1000-0000-0000-000000000012'
    AND warehouse_id = '51856187-1000-0000-0000-000000000003';

  BEGIN
    PERFORM public.wardah_apply_stock_incoming(
      '51856187-1000-0000-0000-000000000001',
      '51856187-1000-0000-0000-000000000012',
      '51856187-1000-0000-0000-000000000003',
      1,
      0,
      'Stock Adjustment',
      '51856187-1000-0000-0000-000000000013',
      'STK187-ADJ-001',
      CURRENT_DATE,
      '51856187-1000-0000-0000-000000000015'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE
       '%uq_sle_stock_adjustment_voucher_product_warehouse_v187%' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;

  SELECT actual_qty
  INTO v_bin_after
  FROM public.bins
  WHERE product_id = '51856187-1000-0000-0000-000000000012'
    AND warehouse_id = '51856187-1000-0000-0000-000000000003';

  IF NOT v_caught
     OR v_bin_after IS DISTINCT FROM v_bin_before
     OR (
       SELECT count(*)
       FROM public.stock_ledger_entries
       WHERE voucher_type = 'Stock Adjustment'
         AND voucher_id = '51856187-1000-0000-0000-000000000013'
     ) <> 1 THEN
    RAISE EXCEPTION
      'STOCK_187_GREEN_UNIQUE_BOUNDARY_FAILED: caught=% before=% after=%',
      v_caught,
      v_bin_before,
      v_bin_after;
  END IF;

  RAISE NOTICE 'STOCK_187_GREEN_UNIQUE_BOUNDARY_OK';
END
$unique_boundary$;

ROLLBACK;

SELECT 'STOCK_187_GREEN_ACCEPTANCE_PASS' AS result;
