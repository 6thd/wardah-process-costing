-- RED C (#229) — partial-consumption retry duplication + lifecycle bypass.
--
-- PASSES (exit 0, prints MFG_RED_C_REPRODUCED) only while current main still
-- has the defect. It raises *_NOT_REPRODUCED the moment any part stops
-- reproducing, so the #229 implementation PR must flip every section to GREEN
-- rather than silently drop it.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_c$
DECLARE
  v_mo uuid;
  v_before jsonb;
  v_after1 jsonb;
  v_after2 jsonb;
  v_call jsonb;
  v_wo uuid;
  v_status text;
  v_lifecycle jsonb := '{}'::jsonb;
BEGIN
  --------------------------------------------------------------------------
  -- C1. Lost response -> identical replay creates a second legal effect.
  --------------------------------------------------------------------------
  v_mo := pg_temp.mk_mo('RED-C1', 5, 100);
  v_before := pg_temp.consumption_state(v_mo);

  -- Business event: consume 10 from a 100 reservation.
  PERFORM pg_temp.as_user(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 10));
  v_after1 := pg_temp.consumption_state(v_mo);

  -- The client never saw the response and replays EXACTLY the same request.
  PERFORM pg_temp.as_user(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 10));
  v_after2 := pg_temp.consumption_state(v_mo);

  RAISE NOTICE 'C1 before  : %', v_before;
  RAISE NOTICE 'C1 after #1: %', v_after1;
  RAISE NOTICE 'C1 after #2: %', v_after2;

  IF (v_after2 ->> 'sle_rows')::int <> 2
     OR (v_before ->> 'bin_raw_w1_qty')::numeric - (v_after2 ->> 'bin_raw_w1_qty')::numeric <> 20
     OR (v_before ->> 'bin_raw_w1_value')::numeric - (v_after2 ->> 'bin_raw_w1_value')::numeric <> 200
     OR (v_after2 ->> 'mc_rows')::int <> 2
     OR (v_after2 ->> 'reservation_consumed')::numeric <> 20
     OR (v_after2 ->> 'wip_material_cost')::numeric <> 200 THEN
    RAISE EXCEPTION 'MFG_RED_C1_RETRY_DUPLICATION_NOT_REPRODUCED: %', v_after2;
  END IF;

  -- C1b. There is no event identity to bind to: a client-supplied event key is
  -- silently ignored and the replay still duplicates.
  PERFORM pg_temp.as_user(pg_temp.consumer(), format(
    $q$SELECT public.rpc_consume_reserved_materials_v2(%L::uuid, %L::uuid,
         jsonb_build_array(jsonb_build_object('item_id', %L, 'quantity', 10,
           'warehouse_id', %L, 'event_id', 'evt-C1b', 'idempotency_key', 'evt-C1b')))$q$,
    v_mo, pg_temp.stage(), pg_temp.raw_item(), pg_temp.w1()));
  PERFORM pg_temp.as_user(pg_temp.consumer(), format(
    $q$SELECT public.rpc_consume_reserved_materials_v2(%L::uuid, %L::uuid,
         jsonb_build_array(jsonb_build_object('item_id', %L, 'quantity', 10,
           'warehouse_id', %L, 'event_id', 'evt-C1b', 'idempotency_key', 'evt-C1b')))$q$,
    v_mo, pg_temp.stage(), pg_temp.raw_item(), pg_temp.w1()));
  IF (pg_temp.consumption_state(v_mo) ->> 'sle_rows')::int <> 4 THEN
    RAISE EXCEPTION 'MFG_RED_C1B_EVENT_KEY_IGNORED_NOT_REPRODUCED: %', pg_temp.consumption_state(v_mo);
  END IF;
  RAISE NOTICE 'C1b same client event key twice -> %', pg_temp.consumption_state(v_mo);

  --------------------------------------------------------------------------
  -- C2. Lifecycle: new consumption accepted on MOs in states the canonical
  --     contract forbids (cancelled, done) or has not approved (draft, on_hold).
  --------------------------------------------------------------------------
  -- cancelled
  v_mo := pg_temp.mk_mo('RED-C2-CANCEL', 5, 20);
  PERFORM pg_temp.transition(v_mo, 'cancelled');
  v_call := pg_temp.try_as(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 5));
  v_lifecycle := v_lifecycle || jsonb_build_object('cancelled', v_call ->> 'ok');
  RAISE NOTICE 'C2 cancelled MO consume -> % | state=%', v_call, pg_temp.consumption_state(v_mo);

  -- done (completed through the current completion RPC)
  v_mo := pg_temp.mk_mo('RED-C2-DONE', 5, 20);
  PERFORM pg_temp.as_user(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 5));
  PERFORM pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_complete_manufacturing_order(jsonb_build_object('mo_id', %L, 'tenant_id', %L))$q$,
    v_mo, pg_temp.org()));
  v_call := pg_temp.try_as(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 5));
  v_lifecycle := v_lifecycle || jsonb_build_object('done', v_call ->> 'ok');
  RAISE NOTICE 'C2 done MO consume -> % | state=%', v_call, pg_temp.consumption_state(v_mo);

  -- draft (never released)
  v_mo := pg_temp.mk_mo('RED-C2-DRAFT', 5, 20, 'draft');
  v_call := pg_temp.try_as(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 5));
  v_lifecycle := v_lifecycle || jsonb_build_object('draft', v_call ->> 'ok');
  RAISE NOTICE 'C2 draft MO consume -> % | state=%', v_call, pg_temp.consumption_state(v_mo);

  -- on_hold
  v_mo := pg_temp.mk_mo('RED-C2-HOLD', 5, 20, 'on_hold');
  v_call := pg_temp.try_as(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 5));
  v_lifecycle := v_lifecycle || jsonb_build_object('on_hold', v_call ->> 'ok');
  RAISE NOTICE 'C2 on_hold MO consume -> % | state=%', v_call, pg_temp.consumption_state(v_mo);

  RAISE NOTICE 'C2 lifecycle acceptance map (true = consumption accepted): %', v_lifecycle;
  IF NOT ((v_lifecycle ->> 'cancelled')::boolean AND (v_lifecycle ->> 'done')::boolean) THEN
    RAISE EXCEPTION 'MFG_RED_C2_LIFECYCLE_BYPASS_NOT_REPRODUCED: %', v_lifecycle;
  END IF;

  --------------------------------------------------------------------------
  -- C3. Work-order branch asymmetry: auto-resolution excludes COMPLETED /
  --     CANCELLED work orders, an explicitly supplied work_order_id does not.
  --------------------------------------------------------------------------
  -- The only work order of this MO is CANCELLED (seeded at INSERT; see helper).
  v_mo := pg_temp.mk_mo('RED-C3', 5, 20, 'in_progress', 'CANCELLED');
  SELECT id INTO v_wo FROM public.work_orders WHERE mo_id = v_mo;

  v_call := pg_temp.try_as(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 5));
  RAISE NOTICE 'C3 auto-resolved WO (only WO is CANCELLED) -> %', v_call;
  IF (v_call ->> 'ok')::boolean
     OR position('WORK_ORDER_REQUIRED_FOR_CONSUMPTION' in v_call ->> 'error') = 0 THEN
    RAISE EXCEPTION 'MFG_RED_C3_AUTO_BRANCH_UNEXPECTED: %', v_call;
  END IF;

  v_call := pg_temp.try_as(pg_temp.consumer(), format(
    $q$SELECT public.rpc_consume_reserved_materials_v2(%L::uuid, %L::uuid,
         jsonb_build_array(jsonb_build_object('item_id', %L, 'quantity', 5,
           'warehouse_id', %L, 'work_order_id', %L)))$q$,
    v_mo, pg_temp.stage(), pg_temp.raw_item(), pg_temp.w1(), v_wo));
  SELECT status INTO v_status FROM public.work_orders WHERE id = v_wo;
  RAISE NOTICE 'C3 explicit CANCELLED work_order_id -> % (wo.status=%) | state=%',
    v_call, v_status, pg_temp.consumption_state(v_mo);
  IF NOT (v_call ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_C3_EXPLICIT_WO_BYPASS_NOT_REPRODUCED: %', v_call;
  END IF;

  RAISE NOTICE 'MFG_RED_C_REPRODUCED: replay duplicates every legal effect; cancelled/done MOs accept new consumption; explicit work_order_id skips the WO status filter';
END
$red_c$;

ROLLBACK;
SELECT 'MFG_RED_C_REPRODUCED' AS result;
