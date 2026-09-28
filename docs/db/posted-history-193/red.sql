-- Unmodified M192 must allow the exact destructive route #273 closes.
\set ON_ERROR_STOP on
BEGIN;
\ir _fixture.sql
DO $red$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('RED-273-WO-DELETE',5,20,'in_progress','IN_PROGRESS');
  v_wo uuid; v_wip uuid; v_event uuid:=gen_random_uuid();
  v_call jsonb; v_before jsonb; v_receipt uuid[];
BEGIN
  SELECT id INTO STRICT v_wo FROM public.work_orders WHERE mo_id=v_mo;
  SELECT id INTO STRICT v_wip FROM public.stage_wip_log WHERE mo_id=v_mo;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  v_before:=pg_temp.consumption_state(v_mo);
  SELECT consumption_ids INTO STRICT v_receipt
    FROM wardah_internal.material_issue_events WHERE event_id=v_event;
  IF (v_before->>'mc_rows')::int<>1
     OR (v_before->>'wip_material_cost')::numeric<>100
     OR cardinality(v_receipt)<>1 THEN
    RAISE EXCEPTION 'RED_273_INVALID_POSTED_FIXTURE: %',v_before;
  END IF;

  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'DELETE FROM public.work_orders WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wo));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM public.material_consumption WHERE mo_id=v_mo)<>0
     OR (SELECT count(*) FROM public.stock_ledger_entries
          WHERE source_line_id=ANY(v_receipt))<>1
     OR (SELECT consumption_ids FROM wardah_internal.material_issue_events
          WHERE event_id=v_event) IS DISTINCT FROM v_receipt
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100 THEN
    RAISE EXCEPTION 'RED_273_WO_CASCADE_NOT_REPRODUCED: %',v_call;
  END IF;
  RAISE NOTICE 'RED_273_WO_CASCADE_REPRODUCED';

  v_call:=pg_temp.try_as(pg_temp.reader(),'SELECT pg_temp.truncate_wip_193()');
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR EXISTS (SELECT 1 FROM public.stage_wip_log WHERE id=v_wip) THEN
    RAISE EXCEPTION 'RED_273_WIP_TRUNCATE_NOT_REPRODUCED: %',v_call;
  END IF;
  RAISE NOTICE 'RED_273_WIP_TRUNCATE_REPRODUCED';
END
$red$;
ROLLBACK;
