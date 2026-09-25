-- RED D (#154 / #158 / #230) — terminal MO completion has no server-side
-- business authorization boundary. An active same-org member whose only grant
-- is manufacturing.orders.read reaches `done` three different ways.
--
-- PASSES only while the defect reproduces on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_d$
DECLARE
  v_mo uuid;
  v_call jsonb;
  v_wo uuid;
  v_map jsonb := '{}'::jsonb;
  r record;
BEGIN
  -- Precondition: the actor really lacks every manufacturing mutation key.
  -- has_permission() binds to the caller identity (Migration 170), so it is
  -- evaluated as the reader itself.
  v_call := pg_temp.as_user(pg_temp.reader(), format(
    $q$SELECT jsonb_build_object(
         'orders.read',    public.has_permission(auth.uid(), %1$L::uuid, 'manufacturing.orders.read'),
         'orders.update',  public.has_permission(auth.uid(), %1$L::uuid, 'manufacturing.orders.update'),
         'orders.approve', public.has_permission(auth.uid(), %1$L::uuid, 'manufacturing.orders.approve'),
         'consume',        public.has_permission(auth.uid(), %1$L::uuid, 'manufacturing.material_consumption.consume'))$q$,
    pg_temp.org()));
  RAISE NOTICE 'D0 reader effective permissions: %', v_call;
  IF (v_call ->> 'orders.update')::boolean OR (v_call ->> 'orders.approve')::boolean
     OR (v_call ->> 'consume')::boolean OR NOT (v_call ->> 'orders.read')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_D_FIXTURE_WRONG: reader permissions are not read-only: %', v_call;
  END IF;

  -- D1. Direct table UPDATE to a terminal state (PostgREST .update()).
  v_mo := pg_temp.mk_mo('RED-D1', 5, 20);
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$UPDATE public.manufacturing_orders
       SET status = 'done', completed_quantity = 5, total_cost = 0, unit_cost = 0
       WHERE id = %L RETURNING jsonb_build_object('status', status, 'completed_quantity', completed_quantity)$q$, v_mo));
  RAISE NOTICE 'D1 reader direct UPDATE status=done -> %', v_call;
  v_map := v_map || jsonb_build_object('direct_update_done',
    (v_call ->> 'ok')::boolean AND (v_call -> 'result' ->> 'status') = 'done');

  -- D2. Transition RPC to done.
  v_mo := pg_temp.mk_mo('RED-D2', 5, 20);
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$SELECT public.rpc_transition_mo_status(%L::uuid, 'done', NULL, %L::uuid)$q$, v_mo, pg_temp.org()));
  RAISE NOTICE 'D2 reader rpc_transition_mo_status(done) -> %', v_call;
  v_map := v_map || jsonb_build_object('transition_rpc_done', (v_call ->> 'ok')::boolean);
  RAISE NOTICE 'D2 FG after transition-only done: stock_quantity=% (no FG, no cost, no GL on this path)',
    (SELECT stock_quantity FROM public.products WHERE id = pg_temp.fg());

  -- D3. Completion RPC (moves the FG projection and writes Draft GL).
  v_mo := pg_temp.mk_mo('RED-D3', 5, 20);
  PERFORM pg_temp.as_user(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 10));
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$SELECT public.rpc_complete_manufacturing_order(
         jsonb_build_object('mo_id', %L, 'tenant_id', %L, 'completed_quantity', 5))$q$,
    v_mo, pg_temp.org()));
  RAISE NOTICE 'D3 reader rpc_complete_manufacturing_order -> %', v_call;
  v_map := v_map || jsonb_build_object('completion_rpc', (v_call ->> 'ok')::boolean);

  -- D4. MES operation RPCs are membership-only as well. complete_operation on
  -- the only work order currently aborts inside the work_orders -> MO status
  -- trigger, so it is NOT a working completion bypass today (it is broken).
  v_mo := pg_temp.mk_mo('RED-D4', 5, 20);
  SELECT id INTO v_wo FROM public.work_orders WHERE mo_id = v_mo;
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$SELECT to_jsonb(public.start_operation(%L::uuid, NULL::uuid, false))$q$, v_wo));
  RAISE NOTICE 'D4 reader start_operation -> ok=% err=%', v_call ->> 'ok', v_call ->> 'error';
  v_map := v_map || jsonb_build_object('start_operation', (v_call ->> 'ok')::boolean,
                                       'start_operation_error', v_call ->> 'error');
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$SELECT to_jsonb(public.complete_operation(%L::uuid, 5, 0, NULL))$q$, v_wo));
  RAISE NOTICE 'D4 reader complete_operation(all 5) -> ok=% err=%', v_call ->> 'ok', v_call ->> 'error';
  v_map := v_map || jsonb_build_object('complete_operation', (v_call ->> 'ok')::boolean,
                                       'complete_operation_error', v_call ->> 'error');

  -- D5. Definer search_path posture of the reviewed boundaries.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig
    FROM pg_proc p
    WHERE p.oid IN ('public.rpc_complete_manufacturing_order(jsonb)'::regprocedure,
                    'public.rpc_transition_mo_status(uuid,text,text,uuid)'::regprocedure,
                    'public.complete_operation(uuid,numeric,numeric,text)'::regprocedure,
                    'public.start_operation(uuid,uuid,boolean)'::regprocedure)
    ORDER BY 1
  LOOP
    RAISE NOTICE 'D5 % security_definer=% proconfig=%', r.sig, r.prosecdef, r.proconfig;
  END LOOP;

  RAISE NOTICE 'D authorization map (true = read-only member succeeded): %', v_map;
  IF NOT ((v_map ->> 'direct_update_done')::boolean
          AND (v_map ->> 'transition_rpc_done')::boolean
          AND (v_map ->> 'completion_rpc')::boolean) THEN
    RAISE EXCEPTION 'MFG_RED_D_AUTHORIZATION_BYPASS_NOT_REPRODUCED: %', v_map;
  END IF;

  RAISE NOTICE 'MFG_RED_D_REPRODUCED: a manufacturing.orders.read-only member reaches done by direct UPDATE, by rpc_transition_mo_status, and by rpc_complete_manufacturing_order';
END
$red_d$;

ROLLBACK;
SELECT 'MFG_RED_D_REPRODUCED' AS result;
