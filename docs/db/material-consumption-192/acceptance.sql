-- Disposable DB only. Load the existing RED fixture first, then run this
-- file on baseline 189 + M190 + M191 + M192. Every data change rolls back.
\set ON_ERROR_STOP on
BEGIN;
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.issue_sql(
  p_mo uuid,p_event uuid,p_qty numeric
) RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_res uuid; v_wo uuid; v_uom uuid;
BEGIN
  SELECT id INTO v_res FROM public.material_reservations
    WHERE mo_id=p_mo ORDER BY id LIMIT 1;
  SELECT id INTO v_wo FROM public.work_orders WHERE mo_id=p_mo ORDER BY id LIMIT 1;
  SELECT base_uom_id INTO v_uom FROM public.products WHERE id=pg_temp.raw();
  RETURN format(
    $sql$SELECT public.rpc_consume_material_event(
      %L::uuid,%L::uuid,%L::uuid,
      jsonb_build_array(jsonb_build_object(
        'item_id',%L::uuid,'reservation_id',%L::uuid,
        'warehouse_id',%L::uuid,'work_order_id',%L::uuid,
        'uom_id',%L::uuid,'quantity',%s,'consumption_type','MANUAL'
      )))$sql$,
    p_mo,pg_temp.stage(),p_event,pg_temp.raw_item(),v_res,
    pg_temp.w1(),v_wo,v_uom,p_qty
  );
END
$fn$;

DO $check$
DECLARE
  v_mo uuid; v_other_mo uuid; v_ready uuid; v_null uuid; v_draft uuid; v_event uuid:=gen_random_uuid();
  v_ready_event uuid:=gen_random_uuid(); v_bad_event uuid:=gen_random_uuid();
  v_res uuid; v_res2 uuid; v_uom uuid; v_payload jsonb; v_sql text;
  v_result jsonb; v_replay jsonb; v_state jsonb; v_call jsonb;
  v_initial jsonb; v_wo uuid; v_grant uuid; v_field text; v_change jsonb;
BEGIN
  IF (SELECT allowed_statuses FROM wardah_internal.material_issue_wo_policies
      WHERE org_id=pg_temp.org()) IS DISTINCT FROM ARRAY['IN_PROGRESS']::text[] THEN
    RAISE EXCEPTION 'GREEN_192_DEFAULT_POLICY_WRONG';
  END IF;
  v_mo:=pg_temp.mk_mo('GREEN-192-1',5,100,'in_progress','IN_PROGRESS');
  v_result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_sql(v_mo,v_event,10));
  v_state:=pg_temp.consumption_state(v_mo);
  v_replay:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_sql(v_mo,v_event,10));
  IF v_result IS DISTINCT FROM v_replay
     OR (pg_temp.consumption_state(v_mo)) IS DISTINCT FROM v_state
     OR (v_state->>'sle_rows')::int<>1
     OR (v_state->>'mc_rows')::int<>1
     OR (v_state->>'reservation_consumed')::numeric<>10
     OR (v_state->>'wip_material_cost')::numeric<>100
     OR (SELECT cardinality(consumption_ids)
         FROM wardah_internal.material_issue_events
         WHERE org_id=pg_temp.org() AND event_id=v_event)<>1
     OR NOT EXISTS (
       SELECT 1 FROM public.stock_ledger_entries s
       JOIN public.material_consumption c ON c.id=s.source_line_id
       WHERE c.mo_id=v_mo AND s.org_id=pg_temp.org()
     ) THEN RAISE EXCEPTION 'GREEN_192_REPLAY_OR_LINKAGE_FAILED: %',v_state; END IF;

  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_mo,v_event,11));
  IF v_call->>'ok'<>'false'
     OR position('MATERIAL_ISSUE_EVENT_CONFLICT' in v_call->>'error')=0
     OR pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_state THEN
    RAISE EXCEPTION 'GREEN_192_CHANGED_REQUEST_NOT_REJECTED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.reader(),pg_temp.issue_sql(v_mo,v_event,10));
  IF v_call->>'ok'<>'false' OR v_call->>'error' IS DISTINCT FROM
     'MATERIAL_CONSUMPTION_PERMISSION_DENIED' THEN
    RAISE EXCEPTION 'GREEN_192_UNGRANTED_REPLAY_WRONG_REASON: %',v_call;
  END IF;
  -- The SAME actor and fingerprint must be denied if its grant is revoked.
  SELECT rp.permission_id INTO STRICT v_grant FROM public.role_permissions rp
    JOIN public.permissions p ON p.id=rp.permission_id
    WHERE rp.role_id='ed000000-0000-4000-8000-0000000000b1'::uuid
      AND p.permission_key='manufacturing.material_consumption.consume';
  DELETE FROM public.role_permissions
    WHERE role_id='ed000000-0000-4000-8000-0000000000b1'::uuid
      AND permission_id=v_grant;
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_mo,v_event,10));
  IF v_call->>'ok'<>'false' OR v_call->>'error' IS DISTINCT FROM
     'MATERIAL_CONSUMPTION_PERMISSION_DENIED' THEN
    RAISE EXCEPTION 'GREEN_192_SAME_ACTOR_REVOKED_GRANT_REPLAY_ALLOWED: %',v_call;
  END IF;
  INSERT INTO public.role_permissions(role_id,permission_id)
    VALUES ('ed000000-0000-4000-8000-0000000000b1'::uuid,v_grant);
  v_call:=pg_temp.try_as(pg_temp.admin(),pg_temp.issue_sql(v_mo,v_event,10));
  IF v_call->>'ok'<>'false' OR v_call->>'error' IS DISTINCT FROM
     'MATERIAL_ISSUE_EVENT_CONFLICT' THEN
    RAISE EXCEPTION 'GREEN_192_ACTOR_NOT_IN_FINGERPRINT: %',v_call;
  END IF;
  -- Each normalized business field must conflict before stock/state checks.
  SELECT canonical_request->'lines'->0 INTO STRICT v_initial
    FROM wardah_internal.material_issue_events
    WHERE org_id=pg_temp.org() AND event_id=v_event;
  FOREACH v_field IN ARRAY ARRAY[
    'item_id','reservation_id','warehouse_id','work_order_id','uom_id','notes'
  ] LOOP
    v_change:=CASE v_field
      WHEN 'item_id' THEN to_jsonb(pg_temp.fg()::text)
      WHEN 'warehouse_id' THEN to_jsonb(pg_temp.w2()::text)
      WHEN 'notes' THEN to_jsonb('different note'::text)
      ELSE to_jsonb(gen_random_uuid()::text)
    END;
    v_payload:=jsonb_build_array(jsonb_set(v_initial,ARRAY[v_field],v_change));
    v_sql:=format($q$SELECT public.rpc_consume_material_event(
      %L::uuid,%L::uuid,%L::uuid,%L::jsonb)$q$,
      v_mo,pg_temp.stage(),v_event,v_payload::text);
    v_call:=pg_temp.try_as(pg_temp.consumer(),v_sql);
    IF v_call->>'ok'<>'false' OR v_call->>'error' IS DISTINCT FROM
       'MATERIAL_ISSUE_EVENT_CONFLICT' THEN
      RAISE EXCEPTION 'GREEN_192_FIELD_NOT_IN_FINGERPRINT %: %',v_field,v_call;
    END IF;
  END LOOP;
  v_call:=pg_temp.try_as(pg_temp.consumer(),format(
    $q$SELECT public.rpc_consume_material_event(
      %L::uuid,%L::uuid,%L::uuid,%L::jsonb)$q$,
    v_mo,gen_random_uuid(),v_event,jsonb_build_array(v_initial)::text));
  IF v_call->>'ok'<>'false' OR v_call->>'error' IS DISTINCT FROM
     'MATERIAL_ISSUE_EVENT_CONFLICT' THEN
    RAISE EXCEPTION 'GREEN_192_STAGE_NOT_IN_FINGERPRINT: %',v_call;
  END IF;
  -- Isolate MO identity in the receipt fingerprint before new-event validation.
  v_other_mo:=pg_temp.mk_mo('GREEN-192-DIFFERENT-MO',5,20,
                            'in_progress','IN_PROGRESS');
  -- Reuse the receipt's exact line payload, so MO identity is the ONLY
  -- changed business field. A replay that ignores mo_id would return ok=true.
  v_call:=pg_temp.try_as(pg_temp.consumer(),format(
    $q$SELECT public.rpc_consume_material_event(
      %L::uuid,%L::uuid,%L::uuid,%L::jsonb)$q$,
    v_other_mo,pg_temp.stage(),v_event,jsonb_build_array(v_initial)::text));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'error' IS DISTINCT FROM 'MATERIAL_ISSUE_EVENT_CONFLICT'
     OR pg_temp.consumption_state(v_mo) IS DISTINCT FROM v_state
     OR (pg_temp.consumption_state(v_other_mo)->>'mc_rows')::int<>0 THEN
    RAISE EXCEPTION 'GREEN_192_MO_NOT_IN_FINGERPRINT: %',v_call;
  END IF;
  PERFORM pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_sql(v_mo,gen_random_uuid(),5));
  IF (pg_temp.consumption_state(v_mo)->>'mc_rows')::int<>2 THEN
    RAISE EXCEPTION 'GREEN_192_SECOND_EVENT_DID_NOT_APPLY';
  END IF;
  -- An identical authorized replay bypasses NEW-event lifecycle checks.
  PERFORM pg_temp.transition(v_mo,'on_hold');
  v_replay:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_sql(v_mo,v_event,10));
  IF v_result IS DISTINCT FROM v_replay THEN
    RAISE EXCEPTION 'GREEN_192_REPLAY_AFTER_MO_HOLD_FAILED';
  END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_mo,gen_random_uuid(),1));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_NEW_EVENT_ON_HOLD_ALLOWED'; END IF;

  v_draft:=pg_temp.mk_mo('GREEN-192-DRAFT',5,20,'draft','IN_PROGRESS');
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_draft,gen_random_uuid(),5));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_DRAFT_MO_ALLOWED'; END IF;

  v_ready:=pg_temp.mk_mo('GREEN-192-READY',5,20,'in_progress','READY');
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_ready,gen_random_uuid(),5));
  IF v_call->>'ok'<>'false'
     OR position('WORK_ORDER_NOT_ELIGIBLE' in v_call->>'error')=0 THEN
    RAISE EXCEPTION 'GREEN_192_READY_ALLOWED_BY_DEFAULT: %',v_call;
  END IF;
  PERFORM pg_temp.as_user(pg_temp.admin(),
    format($q$SELECT public.rpc_set_material_issue_wo_statuses(
       %L::uuid,ARRAY['IN_PROGRESS','READY']::text[])$q$,pg_temp.org()));
  v_result:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_sql(v_ready,v_ready_event,5));
  PERFORM pg_temp.as_user(pg_temp.admin(),format(
    $q$SELECT public.rpc_set_material_issue_wo_statuses(
       %L::uuid,ARRAY['IN_PROGRESS']::text[])$q$,pg_temp.org()));
  v_replay:=pg_temp.as_user(pg_temp.consumer(),pg_temp.issue_sql(v_ready,v_ready_event,5));
  IF v_result IS DISTINCT FROM v_replay THEN
    RAISE EXCEPTION 'GREEN_192_REPLAY_AFTER_POLICY_TIGHTEN_FAILED';
  END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_ready,gen_random_uuid(),1));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_READY_ALLOWED_AFTER_TIGHTEN'; END IF;

  -- Force second-line stock failure after the first line mutates stock.
  -- The entire RPC, including the receipt, must roll back.
  v_initial:=pg_temp.consumption_state(v_ready);
  SELECT id INTO v_res FROM public.material_reservations WHERE mo_id=v_ready LIMIT 1;
  SELECT id INTO v_wo FROM public.work_orders WHERE mo_id=v_ready LIMIT 1;
  SELECT base_uom_id INTO v_uom FROM public.products WHERE id=pg_temp.raw();
  INSERT INTO public.material_reservations(
    org_id,mo_id,item_id,product_id,quantity_reserved,status,uom_id
  ) VALUES (
    pg_temp.org(),v_ready,pg_temp.raw_item(),pg_temp.raw(),5,'reserved',v_uom
  ) RETURNING id INTO v_res2;
  -- Restore READY eligibility so execution reaches the second stock line.
  PERFORM pg_temp.as_user(pg_temp.admin(),format(
    $q$SELECT public.rpc_set_material_issue_wo_statuses(
       %L::uuid,ARRAY['IN_PROGRESS','READY']::text[])$q$,pg_temp.org()));
  v_payload:=jsonb_build_array(
    jsonb_build_object('item_id',pg_temp.raw_item(),'reservation_id',v_res,
      'warehouse_id',pg_temp.w1(),'work_order_id',v_wo,'uom_id',v_uom,
      'quantity',1,'consumption_type','MANUAL'),
    jsonb_build_object('item_id',pg_temp.raw_item(),'reservation_id',v_res2,
      'warehouse_id',pg_temp.w2(),'work_order_id',v_wo,'uom_id',v_uom,
      'quantity',1,'consumption_type','MANUAL')
  );
  v_sql:=format($q$SELECT public.rpc_consume_material_event(
    %L::uuid,%L::uuid,%L::uuid,%L::jsonb)$q$,
    v_ready,pg_temp.stage(),v_bad_event,v_payload::text);
  v_call:=pg_temp.try_as(pg_temp.consumer(),v_sql);
  IF v_call->>'ok'<>'false'
     OR pg_temp.consumption_state(v_ready) IS DISTINCT FROM v_initial
     OR EXISTS(SELECT 1 FROM wardah_internal.material_issue_events
               WHERE org_id=pg_temp.org() AND event_id=v_bad_event) THEN
    RAISE EXCEPTION 'GREEN_192_SECOND_LINE_ROLLBACK_FAILED: %',v_call;
  END IF;

  v_null:=pg_temp.mk_mo('GREEN-192-NULL',5,20,'in_progress',NULL);
  v_call:=pg_temp.try_as(pg_temp.consumer(),pg_temp.issue_sql(v_null,gen_random_uuid(),5));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_NULL_WO_ALLOWED'; END IF;
  v_call:=pg_temp.try_as(pg_temp.reader(),format(
    $q$SELECT public.rpc_set_material_issue_wo_statuses(
      %L::uuid,ARRAY['IN_PROGRESS','IN_SETUP']::text[])$q$,pg_temp.org()));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_NONADMIN_CHANGED_POLICY'; END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    $q$SELECT public.rpc_set_material_issue_wo_statuses(
      %L::uuid,ARRAY['IN_PROGRESS','COMPLETED']::text[])$q$,pg_temp.org()));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_INVALID_POLICY_ALLOWED'; END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format(
    $q$UPDATE wardah_internal.material_issue_wo_policies
       SET allowed_statuses=ARRAY['IN_PROGRESS','READY']::text[]
       WHERE org_id=%L::uuid RETURNING to_jsonb(org_id)$q$,pg_temp.org()));
  IF v_call->>'ok'<>'false' THEN RAISE EXCEPTION 'GREEN_192_DIRECT_POLICY_WRITE_ALLOWED'; END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),format(
    $q$SELECT public.rpc_consume_reserved_materials_v2(
       %L::uuid,%L::uuid,'[]'::jsonb)$q$,v_mo,pg_temp.stage()));
  IF v_call->>'ok'<>'false'
     OR position('EVENT_ID_REQUIRED' in v_call->>'error')=0 THEN
    RAISE EXCEPTION 'GREEN_192_EVENTLESS_V2_WRITES_OR_WRONG_ERROR: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),format(
    $q$SELECT public.rpc_consume_reserved_materials(%L::uuid,'[]'::jsonb)$q$,v_mo));
  IF v_call->>'ok'<>'false'
     OR position('EVENT_ID_REQUIRED' in v_call->>'error')=0 THEN
    RAISE EXCEPTION 'GREEN_192_EVENTLESS_WRAPPER_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),format(
    $q$SELECT public.consume_materials_for_mo(%L::uuid,%L::uuid,ARRAY[]::jsonb[])$q$,
    pg_temp.org(),v_mo));
  IF v_call->>'ok'<>'false'
     OR position('EVENT_ID_REQUIRED' in v_call->>'error')=0 THEN
    RAISE EXCEPTION 'GREEN_192_EVENTLESS_ORG_WRAPPER_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),format($q$
    INSERT INTO public.material_consumption
      (org_id,work_order_id,mo_id,item_id,consumed_quantity,
       consumption_type,status,warehouse_id,total_cost)
    VALUES (%L::uuid,%L::uuid,%L::uuid,%L::uuid,1,'MANUAL','POSTED',%L::uuid,10)
    RETURNING to_jsonb(id)$q$,
    pg_temp.org(),v_wo,v_mo,pg_temp.raw_item(),pg_temp.w1()));
  IF v_call->>'ok'<>'false' OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_DIRECT_CONSUMPTION_INSERT_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),format($q$
    INSERT INTO wardah_internal.material_issue_events
      (org_id,event_id,mo_id,actor_id,canonical_request,request_hash,
       policy_version,allowed_wo_statuses,consumption_ids,result)
    VALUES (%L::uuid,gen_random_uuid(),%L::uuid,%L::uuid,
      '{}'::jsonb,'candidate',1,ARRAY['IN_PROGRESS']::text[],
      ARRAY[]::uuid[],'{}'::jsonb)
    RETURNING to_jsonb(event_id)$q$,pg_temp.org(),v_mo,pg_temp.admin()));
  IF v_call->>'ok'<>'false' OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_DIRECT_RECEIPT_INSERT_ALLOWED: %',v_call;
  END IF;
  -- A real receipt and consumption row exist; rejected mutations must fail
  -- with 42501, and the explicit effective-privilege backstop covers cases
  -- where RETURNING would otherwise be the reason for denial.
  v_call:=pg_temp.try_as(pg_temp.consumer(),format($q$
    UPDATE public.material_consumption SET consumed_quantity=42
    WHERE mo_id=%L::uuid RETURNING to_jsonb(id)$q$,v_mo));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_DIRECT_CONSUMPTION_UPDATE_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.consumer(),format($q$
    DELETE FROM public.material_consumption WHERE mo_id=%L::uuid
    RETURNING to_jsonb(id)$q$,v_mo));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_DIRECT_CONSUMPTION_DELETE_ALLOWED: %',v_call;
  END IF;
  -- No WHERE/RETURNING: the denial must be for UPDATE itself, rather
  -- than a missing SELECT grant on the private receipt table.
  v_call:=pg_temp.try_as(pg_temp.admin(),$q$
    WITH attempted AS (
      UPDATE wardah_internal.material_issue_events SET result='{}'::jsonb
    ) SELECT to_jsonb(1)$q$);
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_DIRECT_RECEIPT_UPDATE_ALLOWED: %',v_call;
  END IF;
  v_call:=pg_temp.try_as(pg_temp.admin(),$q$
    WITH attempted AS (
      DELETE FROM wardah_internal.material_issue_events
    ) SELECT to_jsonb(1)$q$);
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'sqlstate' IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_DIRECT_RECEIPT_DELETE_ALLOWED: %',v_call;
  END IF;
  IF has_schema_privilege('authenticated','wardah_internal','USAGE')
     OR has_schema_privilege('anon','wardah_internal','USAGE')
     OR has_table_privilege('authenticated','material_consumption','UPDATE')
     OR has_table_privilege('authenticated','material_consumption','DELETE')
     OR has_table_privilege('authenticated','material_consumption','TRUNCATE')
     OR has_table_privilege('anon','material_consumption','UPDATE')
     OR has_table_privilege('anon','material_consumption','DELETE')
     OR has_table_privilege('anon','material_consumption','TRUNCATE')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_wo_policies','INSERT')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_wo_policies','UPDATE')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_wo_policies','DELETE')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_wo_policies','TRUNCATE')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_wo_policies','INSERT')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_wo_policies','UPDATE')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_wo_policies','DELETE')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_wo_policies','TRUNCATE')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_events','UPDATE')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_events','DELETE')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_events','TRUNCATE')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_events','UPDATE')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_events','DELETE')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_events','TRUNCATE') THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_WRITE_OR_SCHEMA_GRANT_RESTORED';
  END IF;
  IF has_table_privilege('authenticated','material_consumption','INSERT')
     OR has_table_privilege('authenticated',
       'wardah_internal.material_issue_events','INSERT')
     OR has_table_privilege('anon','material_consumption','INSERT')
     OR has_table_privilege('anon',
       'wardah_internal.material_issue_events','INSERT') THEN
    RAISE EXCEPTION 'GREEN_192_CLIENT_INSERT_GRANT_RESTORED';
  END IF;
  RAISE NOTICE 'GREEN_192_SEQUENTIAL_ACCEPTANCE';
END
$check$;
ROLLBACK;
