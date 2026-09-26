-- RED B (#230 / #229) — completion cost aggregates every material_consumption
-- row, including direct client inserts that never moved stock, and the direct
-- insert surface also accepts status='POSTED'. A status filter alone is
-- therefore NOT a sufficient cost-source contract.
--
-- PASSES only while the defect reproduces on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_b$
DECLARE
  v_mo uuid;
  v_call jsonb;
  v_done jsonb;
  v_canonical_sle_value numeric;
  v_wip numeric;
  v_bin_before numeric;
  v_bin_after numeric;
  v_gl jsonb;
  -- Exactly the row shape src/services/manufacturing/mesService.ts
  -- consumeMaterial() sends through PostgREST (client-derived unit/total cost).
  c_direct CONSTANT text := $q$
    INSERT INTO public.material_consumption
      (org_id, work_order_id, mo_id, item_id, consumed_quantity, consumption_type,
       unit_cost, total_cost, status, consumption_date, notes)
    SELECT %L, wo.id, %L, %L, 1, 'MANUAL', 40, 40, %L, now(), 'RED direct client insert'
    FROM public.work_orders wo WHERE wo.mo_id = %L
    RETURNING to_jsonb(material_consumption.*)$q$;
BEGIN
  v_mo := pg_temp.mk_mo('RED-B', 5, 20);

  -- B1. One canonical POSTED consumption worth 10 (1 unit @ 10).
  PERFORM pg_temp.as_user(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 1));
  SELECT actual_qty INTO v_bin_before FROM public.bins
  WHERE product_id = pg_temp.raw() AND warehouse_id = pg_temp.w1();

  -- B2. A member WITHOUT the consume permission cannot direct-insert (RLS).
  v_call := pg_temp.try_as(pg_temp.reader(), format(c_direct,
    pg_temp.org(), v_mo, pg_temp.raw_item(), 'PENDING', v_mo));
  RAISE NOTICE 'B2 reader direct INSERT (no consume permission) -> %', v_call;
  IF (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_B2_READER_INSERT_UNEXPECTEDLY_ALLOWED';
  END IF;

  -- B3. The consume-permitted member direct-inserts a PENDING row worth 40.
  v_call := pg_temp.try_as(pg_temp.consumer(), format(c_direct,
    pg_temp.org(), v_mo, pg_temp.raw_item(), 'PENDING', v_mo));
  RAISE NOTICE 'B3 consumer direct INSERT status=PENDING total_cost=40 -> ok=%', v_call ->> 'ok';
  IF NOT (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_B3_PENDING_DIRECT_INSERT_NOT_REPRODUCED: %', v_call;
  END IF;

  -- B4. The same surface also accepts a fabricated status='POSTED' row: the
  -- insert policy checks the permission only, not the status or the cost.
  v_call := pg_temp.try_as(pg_temp.consumer(), format(c_direct,
    pg_temp.org(), v_mo, pg_temp.raw_item(), 'POSTED', v_mo));
  RAISE NOTICE 'B4 consumer direct INSERT status=POSTED total_cost=40 (no stock movement) -> ok=%', v_call ->> 'ok';
  IF NOT (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_B4_FABRICATED_POSTED_INSERT_NOT_REPRODUCED: %', v_call;
  END IF;
  -- Remove the B4 row again so B5 isolates the PENDING case (10 + 40 = 50).
  DELETE FROM public.material_consumption
  WHERE mo_id = v_mo AND status = 'POSTED' AND notes = 'RED direct client insert';

  SELECT actual_qty INTO v_bin_after FROM public.bins
  WHERE product_id = pg_temp.raw() AND warehouse_id = pg_temp.w1();
  IF v_bin_after <> v_bin_before THEN
    RAISE EXCEPTION 'MFG_RED_B_DIRECT_ROW_MOVED_STOCK_UNEXPECTEDLY';
  END IF;

  -- B5. Complete the MO (qty 5).
  v_done := pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_complete_manufacturing_order(
         jsonb_build_object('mo_id', %L, 'tenant_id', %L, 'completed_quantity', 5))$q$,
    v_mo, pg_temp.org()));

  SELECT -COALESCE(sum(stock_value_difference), 0) INTO v_canonical_sle_value
  FROM public.stock_ledger_entries
  WHERE voucher_type = 'Material Consumption' AND voucher_id = v_mo;
  SELECT COALESCE(sum(cost_material), 0) INTO v_wip FROM public.stage_wip_log WHERE mo_id = v_mo;
  SELECT jsonb_agg(jsonb_build_object('description', e.description, 'status', e.status,
                                      'total_debit', e.total_debit))
  INTO v_gl FROM public.gl_entries e
  WHERE e.org_id = pg_temp.org() AND e.reference_number = v_mo::text;

  RAISE NOTICE 'B5 completion -> %', v_done;
  RAISE NOTICE 'B5 canonical issue value (SLE)=% | stage WIP material=% | completion total_cost=% unit_cost=% | GL=%',
    v_canonical_sle_value, v_wip, v_done ->> 'total_cost', v_done ->> 'unit_cost', v_gl;

  IF NOT pg_temp.completion_gl_matches(v_mo, 50) THEN
    RAISE EXCEPTION 'MFG_RED_B_DRAFT_GL_NOT_REPRODUCED: %', v_gl;
  END IF;

  IF (v_done ->> 'total_cost')::numeric <> 50 OR v_canonical_sle_value <> 10 OR v_wip <> 10 THEN
    RAISE EXCEPTION 'MFG_RED_B5_COST_CONTAMINATION_NOT_REPRODUCED: done=% sle=% wip=%',
      v_done, v_canonical_sle_value, v_wip;
  END IF;

  RAISE NOTICE 'MFG_RED_B_REPRODUCED: completion accepted 50 (10 canonical + 40 PENDING client row) while canonical issue valuation and stage WIP are 10; the direct surface also accepts status=POSTED, so a status filter alone is not a sufficient fix';
END
$red_b$;

ROLLBACK;
SELECT 'MFG_RED_B_REPRODUCED' AS result;
