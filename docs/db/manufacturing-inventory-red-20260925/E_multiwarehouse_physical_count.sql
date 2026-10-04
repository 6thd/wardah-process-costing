-- RED E (new focused issue) — physical-count system quantity is not
-- warehouse-local anywhere on the server, and the canonical adjustment boundary
-- trusts the client-declared current/difference quantities.
--
-- Scenario: product CNT has W1=60, W2=40 (aggregate 100). A count session for
-- W1 counts 60. Correct warehouse-local result: no adjustment; W1=60, W2=40,
-- aggregate 100.
--
-- What this probe proves on current main:
--   E1  the repository service's own session/status writes are rejected by the
--       live schema (the flow is not operable end to end);
--   E2  no server object derives physical_count_items.system_qty — the value is
--       whatever the client writes (RLS: membership only);
--   E3  when system_qty is the product aggregate (the only quantity the
--       service reads from products), the service's exact difference
--       arithmetic produces -40 for W1, and rpc_create_stock_adjustment +
--       rpc_submit_stock_adjustment apply it without comparing current_qty to
--       the W1 bin: W1 60 -> 20, aggregate 100 -> 60.
--
-- PASSES only while every part reproduces on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_e$
DECLARE
  v_call jsonb;
  v_session uuid;
  v_system numeric;
  v_counted numeric := 60;
  v_rate numeric;
  v_adj uuid;
  v_w1 numeric; v_w2 numeric; v_agg numeric;
BEGIN
  --------------------------------------------------------------------------
  -- E1. stockAdjustmentService.startPhysicalCount() payload, verbatim.
  --------------------------------------------------------------------------
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.physical_count_sessions (count_date, warehouse_id, counted_by, status)
       VALUES (CURRENT_DATE, %L, %L, 'IN_PROGRESS') RETURNING to_jsonb(physical_count_sessions.*)$q$,
    pg_temp.w1(), pg_temp.admin()));
  RAISE NOTICE 'E1a startPhysicalCount payload -> %', v_call;
  IF (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_E1A_SERVICE_PAYLOAD_UNEXPECTEDLY_ACCEPTED';
  END IF;

  -- Same payload without the non-existent column still violates the status CHECK.
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.physical_count_sessions
         (organization_id, count_date, warehouse_id, count_type, status, counter_user_ids, created_by)
       VALUES (%L, CURRENT_DATE, %L, 'SPOT', 'IN_PROGRESS', ARRAY[%L::uuid], %L)
       RETURNING to_jsonb(physical_count_sessions.*)$q$,
    pg_temp.org(), pg_temp.w1(), pg_temp.admin(), pg_temp.admin()));
  RAISE NOTICE 'E1b status=IN_PROGRESS -> ok=% err=%', v_call ->> 'ok', v_call ->> 'error';
  IF (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_E1B_IN_PROGRESS_UNEXPECTEDLY_ACCEPTED';
  END IF;

  --------------------------------------------------------------------------
  -- E2. A schema-valid W1 session; the client writes system_qty itself.
  --------------------------------------------------------------------------
  v_call := pg_temp.as_user(pg_temp.admin(), format(
    $q$INSERT INTO public.physical_count_sessions
         (organization_id, count_date, warehouse_id, count_type, status, counter_user_ids, created_by)
       VALUES (%L, CURRENT_DATE, %L, 'SPOT', 'OPEN', ARRAY[%L::uuid], %L)
       RETURNING jsonb_build_object('id', id)$q$,
    pg_temp.org(), pg_temp.w1(), pg_temp.admin(), pg_temp.admin()));
  v_session := (v_call ->> 'id')::uuid;

  -- The only quantity the repository service reads from products is the
  -- aggregate projection (products.stock_quantity).
  SELECT stock_quantity, cost_price INTO v_system, v_rate FROM public.products WHERE id = pg_temp.cnt();

  -- A plain member with no inventory grant can write any system_qty.
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$INSERT INTO public.physical_count_items
         (session_id, organization_id, product_id, warehouse_id, system_qty, counted_qty)
       VALUES (%L, %L, %L, %L, %s, %s) RETURNING jsonb_build_object('system_qty', system_qty)$q$,
    v_session, pg_temp.org(), pg_temp.cnt(), pg_temp.w1(), v_system, v_counted));
  RAISE NOTICE 'E2 reader (no inventory grant) writes system_qty=% for W1 -> %', v_system, v_call;
  IF NOT (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_E2_CLIENT_SYSTEM_QTY_NOT_REPRODUCED: %', v_call;
  END IF;

  --------------------------------------------------------------------------
  -- E3. convertCountToAdjustment() arithmetic, verbatim, then the canonical RPCs.
  --------------------------------------------------------------------------
  RAISE NOTICE 'E3 before: W1=% W2=% aggregate=% | count W1: system_qty=% counted=% -> difference=%',
    (SELECT actual_qty FROM public.bins WHERE product_id = pg_temp.cnt() AND warehouse_id = pg_temp.w1()),
    (SELECT actual_qty FROM public.bins WHERE product_id = pg_temp.cnt() AND warehouse_id = pg_temp.w2()),
    v_system, v_system, v_counted, v_counted - v_system;

  v_call := pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_create_stock_adjustment(jsonb_build_object(
         'org_id', %1$L, 'adjustment_date', CURRENT_DATE, 'adjustment_type', 'PHYSICAL_COUNT',
         'reason', 'RED physical count W1', 'reference_number', 'PC-RED-E',
         'warehouse_id', %2$L, 'requires_approval', true,
         'inventory_account_id', %3$L, 'increase_account_id', %3$L, 'decrease_account_id', %4$L,
         'items', jsonb_build_array(jsonb_build_object(
            'product_id', %5$L, 'warehouse_id', %2$L,
            'current_qty', %6$s, 'new_qty', %7$s, 'difference_qty', %8$s,
            'current_rate', %9$s, 'value_difference', %10$s))))$q$,
    pg_temp.org(), pg_temp.w1(),
    'ed000000-0000-4000-8000-000000000091', 'ed000000-0000-4000-8000-000000000093',
    pg_temp.cnt(), v_system, v_counted, v_counted - v_system, v_rate, (v_counted - v_system) * v_rate));
  v_adj := (v_call ->> 'adjustment_id')::uuid;

  -- There is no approval RPC in the schema; the approval stamp is orthogonal to
  -- the quantity defect, so the harness sets it directly.
  UPDATE public.stock_adjustments SET approved_by = pg_temp.admin(), approved_at = now() WHERE id = v_adj;

  v_call := pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_submit_stock_adjustment(%L::uuid)$q$, v_adj));
  RAISE NOTICE 'E3 rpc_submit_stock_adjustment -> %', v_call;

  SELECT actual_qty INTO v_w1 FROM public.bins WHERE product_id = pg_temp.cnt() AND warehouse_id = pg_temp.w1();
  SELECT actual_qty INTO v_w2 FROM public.bins WHERE product_id = pg_temp.cnt() AND warehouse_id = pg_temp.w2();
  SELECT stock_quantity INTO v_agg FROM public.products WHERE id = pg_temp.cnt();
  RAISE NOTICE 'E3 after: W1=% (expected 60) W2=% (expected 40) aggregate=% (expected 100)', v_w1, v_w2, v_agg;

  IF v_w1 <> 20 OR v_w2 <> 40 OR v_agg <> 60 THEN
    RAISE EXCEPTION 'MFG_RED_E3_AGGREGATE_COUNT_NOT_REPRODUCED: W1=% W2=% agg=%', v_w1, v_w2, v_agg;
  END IF;

  RAISE NOTICE 'MFG_RED_E_REPRODUCED: counting W1=60 against the aggregate (100) posted -40 to W1 (60 -> 20, aggregate 100 -> 60); no server object derives or validates a warehouse-local system quantity';
END
$red_e$;

ROLLBACK;
SELECT 'MFG_RED_E_REPRODUCED' AS result;
