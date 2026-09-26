-- RED F (#160) — the Stock Transfer screen's submit path writes
-- stock_ledger_entries directly from the browser, a surface Migration 185
-- deliberately closed. No canonical transfer RPC exists. The header status is
-- still a plain membership-scoped table column.
--
-- This probe documents the CLOSED path; it must NOT be "fixed" by restoring
-- INSERT on stock_ledger_entries.
--
-- PASSES only while the state reproduces on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_f$
DECLARE
  v_call jsonb;
  v_transfer uuid;
  v_rpcs text[];
  v_w1 numeric;
  v_w2 numeric;
BEGIN
  -- F0. No canonical transfer mutation boundary exists.
  SELECT coalesce(array_agg(p.oid::regprocedure::text), '{}') INTO v_rpcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname ILIKE '%transfer%' AND p.prorettype <> 'trigger'::regtype;
  RAISE NOTICE 'F0 non-trigger public functions matching %%transfer%%: %', v_rpcs;
  IF cardinality(v_rpcs) <> 0 THEN
    RAISE EXCEPTION 'MFG_RED_F0_TRANSFER_RPC_NOW_EXISTS: % (re-review #160 state)', v_rpcs;
  END IF;

  -- F1. Direct SLE writes are closed to every client role (Migration 185).
  IF has_table_privilege('authenticated', 'public.stock_ledger_entries', 'INSERT')
     OR has_table_privilege('anon', 'public.stock_ledger_entries', 'INSERT') THEN
    RAISE EXCEPTION 'MFG_RED_F1_SLE_INSERT_REOPENED';
  END IF;

  -- F2. Draft header + line as StockTransfer.tsx handleSaveDraft() sends them.
  v_call := pg_temp.as_user(pg_temp.admin(), format(
    $q$INSERT INTO public.stock_transfers (organization_id, transfer_date, reference_number,
         from_warehouse_id, to_warehouse_id, status, total_items, created_by)
       VALUES (%L, CURRENT_DATE, 'STR-RED-F', %L, %L, 'DRAFT', 1, %L)
       RETURNING jsonb_build_object('id', id)$q$,
    pg_temp.org(), pg_temp.w1(), pg_temp.w2(), pg_temp.admin()));
  v_transfer := (v_call ->> 'id')::uuid;
  PERFORM pg_temp.as_user(pg_temp.admin(), format(
    $q$INSERT INTO public.stock_transfer_items (transfer_id, organization_id, product_id, quantity, available_qty_at_transfer)
       VALUES (%L, %L, %L, 5, 20) RETURNING jsonb_build_object('ok', true)$q$,
    v_transfer, pg_temp.org(), pg_temp.xfr()));

  -- F3. handleSubmitTransfer(): the two browser-built SLE rows, verbatim shape,
  -- sent by an org admin (the strongest ordinary actor).
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.stock_ledger_entries
         (org_id, posting_date, posting_time, voucher_type, voucher_id, voucher_number,
          product_id, is_cancelled, created_by, warehouse_id, actual_qty,
          incoming_rate, outgoing_rate, valuation_rate, stock_value_difference)
       VALUES
         (%1$L, CURRENT_DATE, '12:00:00', 'Stock Transfer', %2$L, 'STR-RED-F', %3$L, false, %4$L, %5$L, -5, 0, 7, 7, -35),
         (%1$L, CURRENT_DATE, '12:00:00', 'Stock Transfer', %2$L, 'STR-RED-F', %3$L, false, %4$L, %6$L,  5, 7, 0, 7,  35)
       RETURNING jsonb_build_object('id', id)$q$,
    pg_temp.org(), v_transfer, pg_temp.xfr(), pg_temp.admin(), pg_temp.w1(), pg_temp.w2()));
  RAISE NOTICE 'F3 browser-built SLE INSERT (org admin) -> %', v_call;
  IF (v_call ->> 'ok')::boolean OR v_call ->> 'sqlstate' <> '42501' THEN
    RAISE EXCEPTION 'MFG_RED_F3_DIRECT_SLE_PATH_NOT_CLOSED: %', v_call;
  END IF;

  -- F4. The header status is not bound to any stock effect: a read-only member
  -- can mark the transfer SUBMITTED directly while stock never moved.
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$UPDATE public.stock_transfers SET status = 'SUBMITTED', submitted_at = now(), submitted_by = auth.uid()
       WHERE id = %L RETURNING jsonb_build_object('status', status)$q$, v_transfer));
  SELECT actual_qty INTO v_w1 FROM public.bins WHERE product_id = pg_temp.xfr() AND warehouse_id = pg_temp.w1();
  SELECT COALESCE(sum(actual_qty), 0) INTO v_w2 FROM public.bins WHERE product_id = pg_temp.xfr() AND warehouse_id = pg_temp.w2();
  RAISE NOTICE 'F4 reader direct UPDATE status=SUBMITTED -> % | XFR W1=% W2=% (unchanged)', v_call, v_w1, v_w2;
  IF (v_call ->> 'ok') IS DISTINCT FROM 'true'
     OR jsonb_typeof(v_call -> 'result') IS DISTINCT FROM 'object'
     OR (v_call -> 'result' ->> 'status') IS DISTINCT FROM 'SUBMITTED'
     OR v_w1 IS DISTINCT FROM 20 OR v_w2 IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'MFG_RED_F4_HEADER_STATUS_DECOUPLING_NOT_REPRODUCED: %', v_call;
  END IF;

  RAISE NOTICE 'MFG_RED_F_REPRODUCED: no transfer RPC exists; the UI submit path is rejected with 42501 at stock_ledger_entries; the SUBMITTED header status is writable by any member with no stock effect';
END
$red_f$;

ROLLBACK;
SELECT 'MFG_RED_F_REPRODUCED' AS result;
