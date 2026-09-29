-- #278: source-backed RED proof. Run only after M193 in a disposable PG17 DB.
-- Every business write in this file is rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql

DO $red$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('RED-278-STALE',5,100,'in_progress','IN_PROGRESS');
  v_wip uuid; v_event uuid:=gen_random_uuid(); v_call jsonb;
BEGIN
  SELECT id INTO STRICT v_wip FROM public.stage_wip_log WHERE mo_id=v_mo;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  IF (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100
     OR (SELECT result->>'stage_wip_log_id' FROM wardah_internal.material_issue_events
         WHERE event_id=v_event) IS DISTINCT FROM v_wip::text THEN
    RAISE EXCEPTION 'RED_278_INVALID_POSTED_FIXTURE';
  END IF;
  -- Isolate a stale material-cost write from period eligibility changes.
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'UPDATE public.stage_wip_log SET cost_material=0 '
    || 'WHERE id=%L::uuid RETURNING to_jsonb(cost_material)',v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>0
     OR (SELECT count(*) FROM wardah_internal.material_issue_events
         WHERE event_id=v_event)<>1
     OR (pg_temp.consumption_state(v_mo)->>'mc_cost')::numeric<>100 THEN
    RAISE EXCEPTION 'RED_278_STALE_FORM_DID_NOT_ERASE_POSTED_COST: %',v_call;
  END IF;
  RAISE NOTICE 'RED_278_STALE_FORM_ERASED_POSTED_COST';
END
$red$;

DO $red$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('RED-278-PERIOD',5,100,'in_progress','IN_PROGRESS');
  v_wip uuid; v_old_end date; v_event uuid:=gen_random_uuid(); v_call jsonb;
BEGIN
  SELECT id,period_end INTO STRICT v_wip,v_old_end
    FROM public.stage_wip_log WHERE mo_id=v_mo;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'UPDATE public.stage_wip_log SET period_end=period_end+1 '
    || 'WHERE id=%L::uuid RETURNING to_jsonb(period_end)',v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT period_end FROM public.stage_wip_log WHERE id=v_wip)
        IS DISTINCT FROM v_old_end+1
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100
     OR (SELECT count(*) FROM wardah_internal.material_issue_events
         WHERE event_id=v_event)<>1 THEN
    RAISE EXCEPTION 'RED_278_POSTED_PERIOD_CHANGE_NOT_REPRODUCED: %',v_call;
  END IF;
  RAISE NOTICE 'RED_278_POSTED_PERIOD_CHANGED';
END
$red$;

DO $red$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('RED-278-REKEY',5,100,'in_progress','IN_PROGRESS');
  v_other_mo uuid; v_wip uuid; v_event uuid:=gen_random_uuid(); v_call jsonb;
BEGIN
  SELECT id INTO STRICT v_wip FROM public.stage_wip_log WHERE mo_id=v_mo;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  v_other_mo:=pg_temp.mk_mo('RED-278-OTHER',5,20,'in_progress','IN_PROGRESS');
  -- Move the other MO's unposted fixture period out of the way, so changing
  -- only mo_id is FK-valid, unique-key-valid and not an interval conflict.
  UPDATE public.stage_wip_log
    SET period_start=DATE '2020-01-01',period_end=DATE '2020-01-02'
    WHERE mo_id=v_other_mo;
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'UPDATE public.stage_wip_log SET mo_id=%L::uuid '
    || 'WHERE id=%L::uuid RETURNING to_jsonb(id)',
    v_other_mo,v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT mo_id FROM public.stage_wip_log WHERE id=v_wip) IS DISTINCT FROM v_other_mo
     OR (SELECT mo_id FROM wardah_internal.material_issue_events
         WHERE event_id=v_event) IS DISTINCT FROM v_mo THEN
    RAISE EXCEPTION 'RED_278_POSTED_WIP_REKEY_DID_NOT_SUCCEED: %',v_call;
  END IF;
  RAISE NOTICE 'RED_278_POSTED_WIP_REKEYED';
END
$red$;

DO $red$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('RED-278-OVERLAP',5,100,'in_progress','IN_PROGRESS');
  v_first uuid; v_first_end date; v_new uuid:=gen_random_uuid(); v_event uuid:=gen_random_uuid();
  v_second_event uuid:=gen_random_uuid(); v_call jsonb; v_result jsonb;
BEGIN
  SELECT id,period_end INTO STRICT v_first,v_first_end
    FROM public.stage_wip_log WHERE mo_id=v_mo;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'INSERT INTO public.stage_wip_log '
    || '(id,org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,%L::uuid,CURRENT_DATE,%L::date) '
    || 'RETURNING to_jsonb(id)',
    v_new,pg_temp.org(),v_mo,pg_temp.stage(),v_first_end+1));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM public.stage_wip_log
         WHERE mo_id=v_mo AND stage_id=pg_temp.stage()
           AND COALESCE(is_closed,false)=false
           AND CURRENT_DATE BETWEEN period_start AND period_end)<>2 THEN
    RAISE EXCEPTION 'RED_278_OPEN_OVERLAP_DID_NOT_SUCCEED: %',v_call;
  END IF;
  v_result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_second_event));
  IF v_result->>'stage_wip_log_id' IS DISTINCT FROM v_new::text
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_first)<>100
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_new)<>100 THEN
    RAISE EXCEPTION 'RED_278_OVERLAP_ROUTING_NOT_REPRODUCED: %',v_result;
  END IF;
  RAISE NOTICE 'RED_278_OVERLAP_REDIRECTED_NEXT_ISSUE';
END
$red$;
ROLLBACK;
SELECT 'RED_278_WIP_BOUNDARY_REPRODUCED' AS marker;
