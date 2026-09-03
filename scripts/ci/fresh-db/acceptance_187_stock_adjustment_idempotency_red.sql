-- Red proof for Migration 187. This runs after cutoff 186 and before 187.
\set ON_ERROR_STOP on

BEGIN;

DO $red_shape$
BEGIN
  IF to_regclass(
       'public.uq_sle_stock_adjustment_voucher_product_warehouse_v187'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.wardah_187_require_stock_source_line()'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'public.stock_ledger_entries'::regclass
         AND tgname = 'trg_sle_stock_adjustment_source_line_v187'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'STOCK_187_RED_CONTRACT_ALREADY_PRESENT';
  END IF;

  RAISE NOTICE 'STOCK_187_RED_CONTRACT_ABSENT_OK';
END
$red_shape$;

SELECT public.wardah_apply_stock_incoming(
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000002',
  '51856187-1000-0000-0000-000000000003',
  1,
  1,
  'Stock Adjustment',
  '51856187-1000-0000-0000-000000000009',
  'STK187-RED-DUP',
  CURRENT_DATE
);

SELECT public.wardah_apply_stock_incoming(
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000002',
  '51856187-1000-0000-0000-000000000003',
  1,
  1,
  'Stock Adjustment',
  '51856187-1000-0000-0000-000000000009',
  'STK187-RED-DUP',
  CURRENT_DATE
);

DO $red_duplicate$
DECLARE
  v_rows integer;
  v_bin_qty numeric;
BEGIN
  SELECT count(*)
  INTO v_rows
  FROM public.stock_ledger_entries
  WHERE voucher_type = 'Stock Adjustment'
    AND voucher_id = '51856187-1000-0000-0000-000000000009'
    AND product_id = '51856187-1000-0000-0000-000000000002'
    AND warehouse_id = '51856187-1000-0000-0000-000000000003';

  SELECT actual_qty
  INTO v_bin_qty
  FROM public.bins
  WHERE id = '51856187-1000-0000-0000-000000000004';

  IF v_rows <> 2 OR v_bin_qty IS DISTINCT FROM 12::numeric THEN
    RAISE EXCEPTION
      'STOCK_187_RED_DUPLICATE_NOT_REPRODUCED: rows=% bin=%',
      v_rows,
      v_bin_qty;
  END IF;

  RAISE NOTICE 'STOCK_187_RED_DUPLICATE_REPRODUCED_OK';
END
$red_duplicate$;

ROLLBACK;

SELECT 'STOCK_187_RED_PROOF_PASS' AS result;
