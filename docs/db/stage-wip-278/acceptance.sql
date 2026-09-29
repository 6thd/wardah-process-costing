-- M194 GREEN on a disposable PG17 database, after the historical fixture.
\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql

DO $green$
DECLARE
  v_mo uuid:=pg_temp.mk_mo('GREEN-278',5,100,'in_progress','IN_PROGRESS');
  v_other_mo uuid; v_wip uuid; v_event uuid:=gen_random_uuid();
  v_original jsonb; v_call jsonb; v_state jsonb; v_close jsonb;
  v_end date; v_state_code text; v_error text;
  v_foreign_org uuid:=gen_random_uuid(); v_foreign_mo uuid:=gen_random_uuid();
  v_foreign_stage uuid:=gen_random_uuid();
BEGIN
  SELECT id INTO STRICT v_wip FROM public.stage_wip_log WHERE mo_id=v_mo;
  v_original:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  IF v_original->>'stage_wip_log_id' IS DISTINCT FROM v_wip::text
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100 THEN
    RAISE EXCEPTION 'GREEN_278_INVALID_POSTED_FIXTURE';
  END IF;
  v_state:=pg_temp.consumption_state(v_mo);

  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'UPDATE public.stage_wip_log SET cost_material=0 WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM 'P0001'
     OR v_call->>'error' IS DISTINCT FROM 'WIP_POSTED_MATERIAL_IMMUTABLE' THEN
    RAISE EXCEPTION 'GREEN_278_COST_WRITE_WRONG_REASON: %',v_call;
  END IF;
  SELECT period_end INTO v_end
    FROM public.stage_wip_log WHERE id=v_wip;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(id,org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::date,%L::date) '
    || 'ON CONFLICT (id) '
    || 'DO UPDATE SET cost_material=0 RETURNING to_jsonb(id)',
    v_wip,pg_temp.org(),v_mo,pg_temp.stage(),v_end+50,v_end+60));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_POSTED_MATERIAL_IMMUTABLE'
     OR v_call->>'sqlstate' IS DISTINCT FROM 'P0001' THEN
    RAISE EXCEPTION 'GREEN_278_UPSERT_OVERWRITE_ALLOWED: %',v_call;
  END IF;
  BEGIN
    UPDATE public.stage_wip_log SET cost_material=0 WHERE id=v_wip;
    RAISE EXCEPTION 'GREEN_278_OWNER_COST_OVERWRITE_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_code=RETURNED_SQLSTATE,v_error=MESSAGE_TEXT;
    IF v_state_code IS DISTINCT FROM 'P0001'
       OR v_error IS DISTINCT FROM 'WIP_POSTED_MATERIAL_IMMUTABLE' THEN
      RAISE EXCEPTION 'GREEN_278_OWNER_COST_WRONG_REASON: %, %',v_state_code,v_error;
    END IF;
  END;

  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'UPDATE public.stage_wip_log SET period_end=period_end+1 WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wip));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_IDENTITY_OR_PERIOD_IMMUTABLE'
     OR v_call->>'sqlstate' IS DISTINCT FROM 'P0001' THEN
    RAISE EXCEPTION 'GREEN_278_PERIOD_WRITE_WRONG_REASON: %',v_call;
  END IF;

  v_other_mo:=pg_temp.mk_mo('GREEN-278-OTHER',5,20,'in_progress','IN_PROGRESS');
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'UPDATE public.stage_wip_log SET mo_id=%L::uuid WHERE id=%L::uuid RETURNING to_jsonb(id)',
    v_other_mo,v_wip));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_IDENTITY_OR_PERIOD_IMMUTABLE' THEN
    RAISE EXCEPTION 'GREEN_278_REKEY_WRONG_REASON: %',v_call;
  END IF;

  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'UPDATE public.stage_wip_log SET cost_material=0,period_end=period_end+1 '
    || 'WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wip));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_IDENTITY_OR_PERIOD_IMMUTABLE' THEN
    RAISE EXCEPTION 'GREEN_278_STALE_FORM_WRONG_REASON: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    'UPDATE public.stage_wip_log SET cost_labor=50 WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wip));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_UPDATE_PERMISSION_DENIED' THEN
    RAISE EXCEPTION 'GREEN_278_READER_WRITE_WRONG_REASON: %',v_call;
  END IF;

  -- A stale bundle including an unchanged protected cost remains usable for
  -- a lawful labor edit; the derived values are recalculated by the DB.
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'UPDATE public.stage_wip_log SET cost_material=100,cost_labor=50 '
    || 'WHERE id=%L::uuid RETURNING to_jsonb(cost_labor)',v_wip));
  IF v_call->>'ok' IS DISTINCT FROM 'true'
     OR (SELECT cost_labor FROM public.stage_wip_log WHERE id=v_wip)<>50
     OR (SELECT cost_material FROM public.stage_wip_log WHERE id=v_wip)<>100 THEN
    RAISE EXCEPTION 'GREEN_278_LAWFUL_EDIT_DENIED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,CURRENT_DATE,CURRENT_DATE+1) '
    || 'RETURNING to_jsonb(id)',pg_temp.org(),v_mo,pg_temp.stage()));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_OPEN_PERIOD_OVERLAP'
     OR v_call->>'sqlstate' IS DISTINCT FROM 'P0001' THEN
    RAISE EXCEPTION 'GREEN_278_OVERLAP_WRONG_REASON: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end,is_closed) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,%L::date,%L::date,NULL) '
    || 'RETURNING to_jsonb(id)',pg_temp.org(),v_mo,pg_temp.stage(),v_end,v_end+2));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_OPEN_PERIOD_OVERLAP' THEN
    RAISE EXCEPTION 'GREEN_278_SHARED_BOUNDARY_OR_NULL_OPEN_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end,is_closed) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,%L::date,%L::date,NULL) '
    || 'RETURNING to_jsonb(id)',pg_temp.org(),v_mo,pg_temp.stage(),v_end+35,v_end+40));
  IF v_call->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'GREEN_278_NON_OVERLAP_NULL_OPEN_DENIED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end,cost_material) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,CURRENT_DATE+35,CURRENT_DATE+40,10) '
    || 'RETURNING to_jsonb(id)',pg_temp.org(),v_mo,pg_temp.stage()));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_CLIENT_POSTED_FIELDS_DENIED' THEN
    RAISE EXCEPTION 'GREEN_278_CLIENT_INSERT_COST_ALLOWED: %',v_call;
  END IF;

  INSERT INTO public.organizations(id,name,code)
    VALUES (v_foreign_org,'Foreign 278','FOREIGN-278');
  INSERT INTO public.manufacturing_stages(id,org_id,code,name,order_sequence)
    VALUES (v_foreign_stage,v_foreign_org,'FOREIGN-278','Foreign stage',1);
  INSERT INTO public.manufacturing_orders(id,org_id,order_number,quantity,status)
    VALUES (v_foreign_mo,v_foreign_org,'FOREIGN-278',5,'draft');
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,CURRENT_DATE+35,CURRENT_DATE+40) '
    || 'RETURNING to_jsonb(id)',pg_temp.org(),v_foreign_mo,pg_temp.stage()));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_PARENT_ORG_MISMATCH' THEN
    RAISE EXCEPTION 'GREEN_278_FOREIGN_MO_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,CURRENT_DATE+35,CURRENT_DATE+40) '
    || 'RETURNING to_jsonb(id)',pg_temp.org(),v_mo,v_foreign_stage));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_PARENT_ORG_MISMATCH' THEN
    RAISE EXCEPTION 'GREEN_278_FOREIGN_STAGE_ALLOWED: %',v_call;
  END IF;

  IF pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_state
     OR (SELECT count(*) FROM wardah_internal.material_issue_events
         WHERE event_id=v_event)<>1 THEN
    RAISE EXCEPTION 'GREEN_278_POSTED_EFFECT_CHANGED';
  END IF;
  v_close:=pg_temp.as_user(pg_temp.admin(),format(
    'SELECT public.rpc_close_stage_wip_194(%L::uuid)',v_wip));
  IF v_close->>'is_closed' IS DISTINCT FROM 'true'
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_logs
       WHERE entity_id=v_wip::text AND action='STAGE_WIP_CLOSED'
         AND user_id=pg_temp.admin()
     ) THEN RAISE EXCEPTION 'GREEN_278_CLOSE_NOT_AUDITED'; END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'UPDATE public.stage_wip_log SET is_closed=false WHERE id=%L::uuid RETURNING to_jsonb(id)',v_wip));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_CLOSE_REQUIRES_RPC' THEN
    RAISE EXCEPTION 'GREEN_278_REOPEN_ALLOWED: %',v_call;
  END IF;
  IF pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event))
     IS DISTINCT FROM v_original THEN
    RAISE EXCEPTION 'GREEN_278_REPLAY_CHANGED';
  END IF;
  RAISE NOTICE 'GREEN_278_POSTED_WIP_BOUNDARY';
END
$green$;

-- The historical pair was committed before M194. The migration must not
-- repair it or permit a third row intersecting either interval.
DO $historical$
DECLARE v_mo uuid; v_stage uuid; v_org uuid; v_call jsonb;
BEGIN
  SELECT m.id,w.stage_id,w.org_id INTO STRICT v_mo,v_stage,v_org
    FROM public.manufacturing_orders m
    JOIN public.stage_wip_log w ON w.mo_id=m.id
    WHERE m.order_number='GREEN-278-HISTORICAL'
    ORDER BY w.id LIMIT 1;
  IF (SELECT count(*) FROM public.stage_wip_log
      WHERE mo_id=v_mo AND cost_material=1000
        AND COALESCE(is_closed,false)=false)<>2 THEN
    RAISE EXCEPTION 'GREEN_278_HISTORICAL_ROWS_CHANGED';
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    'INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end) '
    || 'VALUES (%L::uuid,%L::uuid,%L::uuid,DATE ''2025-11-20'',DATE ''2025-11-26'') '
    || 'RETURNING to_jsonb(id)',v_org,v_mo,v_stage));
  IF v_call->>'error' IS DISTINCT FROM 'WIP_OPEN_PERIOD_OVERLAP' THEN
    RAISE EXCEPTION 'GREEN_278_HISTORICAL_OVERLAP_IGNORED: %',v_call;
  END IF;
  RAISE NOTICE 'GREEN_278_HISTORICAL_OVERLAP_PRESERVED';
END
$historical$;

DO $ambiguous$
DECLARE v_mo uuid; v_event uuid:=gen_random_uuid(); v_call jsonb;
  v_before jsonb;
BEGIN
  SELECT id INTO STRICT v_mo FROM public.manufacturing_orders
    WHERE order_number='GREEN-278-AMBIGUOUS';
  IF (SELECT count(*) FROM public.stage_wip_log
      WHERE mo_id=v_mo AND CURRENT_DATE BETWEEN period_start AND period_end
        AND COALESCE(is_closed,false)=false)<>2 THEN
    RAISE EXCEPTION 'GREEN_278_AMBIGUOUS_FIXTURE_MISSING';
  END IF;
  v_before:=pg_temp.consumption_state(v_mo);
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_193(v_mo,v_event));
  IF v_call->>'error' IS DISTINCT FROM 'AMBIGUOUS_OPEN_STAGE_WIP_LOG'
     OR v_call->>'sqlstate' IS DISTINCT FROM 'P0001'
     OR pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_before
     OR EXISTS (SELECT 1 FROM wardah_internal.material_issue_events WHERE event_id=v_event) THEN
    RAISE EXCEPTION 'GREEN_278_AMBIGUOUS_ISSUE_ALLOWED: %',v_call;
  END IF;
  RAISE NOTICE 'GREEN_278_AMBIGUOUS_ISSUE_REJECTED';
END
$ambiguous$;
ROLLBACK;
