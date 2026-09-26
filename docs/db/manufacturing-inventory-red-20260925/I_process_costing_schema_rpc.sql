-- RED I (MFG-P1) — the live Process Costing write path and the SQL costing
-- engine are not schema-compatible with the Production-derived baseline.
--
--   I1  process-costing-service.ts upsertStageCost() row shape vs stage_costs;
--   I2  applyLaborTime()/applyOverhead() target tables;
--   I3  the real upsert_stage_cost(...) signature (EUP/FIFO/Scrap core);
--   I4  src/ui/events.ts 'stage-recalc' / 'mo-finish' named-argument calls;
--   I5  rpc_cost_of_production_report on a canonical stage_costs row.
--
-- PASSES only while the incompatibilities reproduce on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_i$
DECLARE
  v_mo uuid;
  v_call jsonb;
  v_errors jsonb := '{}'::jsonb;
BEGIN
  v_mo := pg_temp.mk_mo('RED-I', 5, 20);

  -- I1. The exact row upsertStageCost() builds (stageId branch and stageNo branch).
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.stage_costs (org_id, manufacturing_order_id, work_center_id, good_quantity,
         defective_quantity, material_cost, labor_cost, overhead_cost, total_cost, unit_cost, status,
         updated_at, stage_id)
       VALUES (%L, %L, %L, 5, 0, 100, 0, 0, 100, 20, 'actual', now(), %L)
       ON CONFLICT (manufacturing_order_id, stage_id, org_id) DO UPDATE SET total_cost = EXCLUDED.total_cost
       RETURNING to_jsonb(stage_costs.*)$q$,
    pg_temp.org(), v_mo, pg_temp.wc(), pg_temp.stage()));
  RAISE NOTICE 'I1a service upsert (stageId branch) -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I1a', v_call ->> 'error');

  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.stage_costs (org_id, manufacturing_order_id, work_center_id, good_quantity,
         defective_quantity, material_cost, labor_cost, overhead_cost, total_cost, unit_cost, status,
         updated_at, stage_number)
       VALUES (%L, %L, %L, 5, 0, 100, 0, 0, 100, 20, 'actual', now(), 1)
       ON CONFLICT (manufacturing_order_id, stage_number, org_id) DO UPDATE SET total_cost = EXCLUDED.total_cost
       RETURNING to_jsonb(stage_costs.*)$q$,
    pg_temp.org(), v_mo, pg_temp.wc()));
  RAISE NOTICE 'I1b service upsert (stageNo branch) -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I1b', v_call ->> 'error');

  -- I2. Cost-input tables written by applyLaborTime()/applyOverhead().
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.labor_time_logs (tenant_id, mo_id, stage_no, wc_id, hours, hourly_rate, employee_name)
       VALUES (%L, %L, 1, %L, 2, 50, 'RED') RETURNING jsonb_build_object('ok', true)$q$,
    pg_temp.org(), v_mo, pg_temp.wc()));
  RAISE NOTICE 'I2a labor_time_logs insert -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I2a', v_call ->> 'error');
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$INSERT INTO public.moh_applied (tenant_id, mo_id, stage_no, wc_id, allocation_base, base_qty, overhead_rate)
       VALUES (%L, %L, 1, %L, 'labor_cost', 100, 0.15) RETURNING jsonb_build_object('ok', true)$q$,
    pg_temp.org(), v_mo, pg_temp.wc()));
  RAISE NOTICE 'I2b moh_applied insert -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I2b', v_call ->> 'error');

  -- I3. The real SQL engine entry point with its real signature.
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$SELECT to_jsonb(r) FROM public.upsert_stage_cost(
         p_tenant := %L::uuid, p_mo := %L::uuid, p_stage := 1, p_wc := %L::uuid,
         p_good_qty := 5, p_dm := 100, p_mode := 'actual') r$q$,
    pg_temp.org(), v_mo, pg_temp.wc()));
  RAISE NOTICE 'I3 upsert_stage_cost(real signature) -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I3', v_call ->> 'error');

  -- I4. src/ui/events.ts registered actions, as createSecureRPC would name them.
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$SELECT to_jsonb(public.upsert_stage_cost(p_mo_id := %L::uuid, p_stage_no := 1,
         p_work_center_id := %L::uuid, p_good_qty := 5, p_scrap_qty := 0, p_dm_cost := 100))$q$,
    v_mo, pg_temp.wc()));
  RAISE NOTICE 'I4a events.ts stage-recalc -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I4a', v_call ->> 'error');
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$SELECT to_jsonb(public.complete_manufacturing_order(p_mo_id := %L::uuid, p_completed_qty := 5, p_scrap_qty := 0))$q$,
    v_mo));
  RAISE NOTICE 'I4b events.ts mo-finish -> %', v_call;
  v_errors := v_errors || jsonb_build_object('I4b', v_call ->> 'error');

  -- I5. The report RPC against a canonical-column stage_costs row (harness write).
  INSERT INTO public.stage_costs (org_id, manufacturing_order_id, stage_number, work_center_id,
                                  input_qty, good_qty, dm_cost, dl_cost, moh_cost, total_cost, unit_cost, mode)
  VALUES (pg_temp.org(), v_mo, 1, pg_temp.wc(), 5, 5, 100, 20, 10, 130, 26, 'actual');
  v_call := pg_temp.try_as(pg_temp.admin(), format(
    $q$SELECT public.rpc_cost_of_production_report(%L::uuid, NULL, %L::uuid)$q$, v_mo, pg_temp.org()));
  RAISE NOTICE 'I5 rpc_cost_of_production_report on canonical row -> ok=% %', v_call ->> 'ok',
    left(coalesce(v_call ->> 'error', (v_call -> 'result')::text), 700);
  v_errors := v_errors || jsonb_build_object('I5_ok', v_call ->> 'ok', 'I5_error', v_call ->> 'error');

  RAISE NOTICE 'I summary: %', v_errors;
  IF v_errors ->> 'I1a' IS NULL OR v_errors ->> 'I1b' IS NULL
     OR v_errors ->> 'I2a' IS NULL OR v_errors ->> 'I2b' IS NULL
     OR v_errors ->> 'I3' IS NULL OR v_errors ->> 'I4a' IS NULL
     OR v_errors ->> 'I4b' IS NULL OR v_errors ->> 'I5_error' IS NULL
     OR v_errors ->> 'I5_ok' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'MFG_RED_I_SCHEMA_MISMATCH_NOT_REPRODUCED: %', v_errors;
  END IF;

  RAISE NOTICE 'MFG_RED_I_REPRODUCED: live service writes non-existent stage_costs columns and non-existent labor/overhead tables; the real upsert_stage_cost core aborts (42702 costing_method ambiguous) before reaching its own missing labor_time_logs/moh_applied reads; rpc_cost_of_production_report aborts on a canonical row; events.ts calls non-matching signatures';
END
$red_i$;

ROLLBACK;
SELECT 'MFG_RED_I_REPRODUCED' AS result;
