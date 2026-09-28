-- Run only after M193 on a disposable PG17 database. All fixtures roll back.
\set ON_ERROR_STOP on
BEGIN;
\ir _fixture.sql
DO $green$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('GREEN-273-WO-DELETE',5,20,'in_progress','IN_PROGRESS');
  v_wo uuid; v_wip uuid; v_mc uuid; v_event uuid:=gen_random_uuid();
  v_call jsonb; v_before jsonb; v_receipt uuid[]; v_before_gl bigint;
  v_done jsonb; v_sqlstate text; v_error text;
BEGIN
  SELECT id INTO STRICT v_wo FROM public.work_orders WHERE mo_id=v_mo;
  SELECT id INTO STRICT v_wip FROM public.stage_wip_log WHERE mo_id=v_mo;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  SELECT id INTO STRICT v_mc FROM public.material_consumption WHERE mo_id=v_mo;
  SELECT consumption_ids INTO STRICT v_receipt
    FROM wardah_internal.material_issue_events WHERE event_id=v_event;
  v_before:=pg_temp.consumption_state(v_mo);
  SELECT count(*) INTO v_before_gl FROM public.gl_entries WHERE reference_id=v_mo;
  IF (v_before->>'mc_rows')::int<>1
     OR (v_before->>'wip_material_cost')::numeric<>100
     OR cardinality(v_receipt)<>1
     OR v_receipt[1] IS DISTINCT FROM v_mc THEN
    RAISE EXCEPTION 'GREEN_273_INVALID_POSTED_FIXTURE: %',v_before;
  END IF;

  -- A privileged caller reaches the named row guard. The ordinary reader
  -- that deleted this WO in RED must now be stopped by the revoked grant.
  BEGIN
    DELETE FROM public.work_orders WHERE id=v_wo;
    RAISE EXCEPTION 'GREEN_273_OWNER_WO_DELETE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE,v_error=MESSAGE_TEXT;
    IF v_sqlstate IS DISTINCT FROM 'P0001'
       OR v_error IS DISTINCT FROM 'M193_POSTED_WORK_ORDER_DELETE_DENIED' THEN
      RAISE EXCEPTION 'GREEN_273_WO_GUARD_WRONG_REASON: %, %',v_sqlstate,v_error;
    END IF;
  END;
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'DELETE FROM public.work_orders WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wo));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_273_CLIENT_WO_DELETE_NOT_CLOSED: %',v_call;
  END IF;
  -- An immediate second MO deletion may fail on its own FK; the first
  -- named guard must already have stopped the WO->MO two-step route.
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'DELETE FROM public.manufacturing_orders WHERE id=%L::uuid RETURNING to_jsonb(id)',v_mo));
  IF v_call->>'ok' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'GREEN_273_WO_THEN_MO_ALLOWED: %',v_call;
  END IF;
  IF pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_before
     OR NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id=v_wo)
     OR (SELECT consumption_ids FROM wardah_internal.material_issue_events
          WHERE event_id=v_event) IS DISTINCT FROM v_receipt
     OR (SELECT count(*) FROM public.stock_ledger_entries
          WHERE source_line_id=v_mc)<>1
     OR (SELECT count(*) FROM public.gl_entries WHERE reference_id=v_mo)<>v_before_gl THEN
    RAISE EXCEPTION 'GREEN_273_DELETE_CHANGED_POSTED_EFFECTS';
  END IF;

  -- A client whose SELECT sees this populated same-org WIP row must be
  -- denied by the revoked DELETE grant, not by a zero-row RLS predicate.
  IF (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100 THEN
    RAISE EXCEPTION 'GREEN_273_WIP_POSTED_COST_MISSING';
  END IF;
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'SELECT to_jsonb(cost_material) FROM public.stage_wip_log WHERE id=%L::uuid',v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR v_call->'result' IS DISTINCT FROM '100'::jsonb THEN
    RAISE EXCEPTION 'GREEN_273_CLIENT_CANNOT_SEE_WIP_FIXTURE: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'DELETE FROM public.stage_wip_log WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501'
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100 THEN
    RAISE EXCEPTION 'GREEN_273_WIP_CLIENT_DELETE_NOT_CLOSED: %',v_call;
  END IF;

  BEGIN
    DELETE FROM public.material_consumption WHERE id=v_mc;
    RAISE EXCEPTION 'GREEN_273_OWNER_CONSUMPTION_DELETE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE,v_error=MESSAGE_TEXT;
    IF v_sqlstate IS DISTINCT FROM 'P0001'
       OR v_error IS DISTINCT FROM 'M193_POSTED_CONSUMPTION_DELETE_DENIED' THEN
      RAISE EXCEPTION 'GREEN_273_OWNER_CONSUMPTION_WRONG_REASON: %, %',v_sqlstate,v_error;
    END IF;
  END;
  BEGIN
    DELETE FROM public.stage_wip_log WHERE id=v_wip;
    RAISE EXCEPTION 'GREEN_273_OWNER_WIP_DELETE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE,v_error=MESSAGE_TEXT;
    IF v_sqlstate IS DISTINCT FROM 'P0001'
       OR v_error IS DISTINCT FROM 'M193_POSTED_WIP_DELETE_DENIED' THEN
      RAISE EXCEPTION 'GREEN_273_OWNER_WIP_WRONG_REASON: %, %',v_sqlstate,v_error;
    END IF;
  END;

  v_call:=pg_temp.try_as(pg_temp.reader(),'SELECT pg_temp.truncate_wip_193()');
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501'
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100 THEN
    RAISE EXCEPTION 'GREEN_273_WIP_TRUNCATE_NOT_CLOSED: %',v_call;
  END IF;
  BEGIN
    TRUNCATE public.stage_wip_log;
    RAISE EXCEPTION 'GREEN_273_OWNER_TRUNCATE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate=RETURNED_SQLSTATE,v_error=MESSAGE_TEXT;
    IF v_sqlstate IS DISTINCT FROM 'P0001'
       OR v_error IS DISTINCT FROM 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED' THEN
      RAISE EXCEPTION 'GREEN_273_OWNER_TRUNCATE_WRONG_REASON: %, %',v_sqlstate,v_error;
    END IF;
  END;
  IF pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'GREEN_273_DENIED_WRITES_CHANGED_BALANCES';
  END IF;

  -- The retained posted consumption must still determine completion cost.
  v_done:=pg_temp.as_user(pg_temp.admin(),format(
    $q$SELECT public.rpc_complete_manufacturing_order(
      jsonb_build_object('mo_id',%L,'tenant_id',%L,'completed_quantity',5))$q$,
    v_mo,pg_temp.org()));
  IF (v_done->>'total_cost')::numeric IS DISTINCT FROM 100
     OR (v_done->>'success')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GREEN_273_COMPLETION_LOST_POSTED_COST: %',v_done;
  END IF;
  RAISE NOTICE 'GREEN_273_POSTED_HISTORY_PRESERVED';
END
$green$;
ROLLBACK;
