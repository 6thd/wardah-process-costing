-- Disposable PG17 only. The entire policy × MO × WO matrix rolls back.
\set ON_ERROR_STOP on
BEGIN;
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.issue_for_wo(p_mo uuid,p_wo uuid,p_event uuid)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_res uuid; v_uom uuid;
BEGIN
  SELECT id INTO STRICT v_res FROM public.material_reservations
    WHERE mo_id=p_mo ORDER BY id LIMIT 1;
  SELECT base_uom_id INTO STRICT v_uom
    FROM public.products WHERE id=pg_temp.raw();
  RETURN format($q$SELECT public.rpc_consume_material_event(
    %L::uuid,%L::uuid,%L::uuid,
    jsonb_build_array(jsonb_build_object(
      'item_id',%L::uuid,'reservation_id',%L::uuid,
      'warehouse_id',%L::uuid,'work_order_id',%L::uuid,
      'uom_id',%L::uuid,'quantity',0.1,'consumption_type','MANUAL'
    )))$q$,
    p_mo,pg_temp.stage(),p_event,pg_temp.raw_item(),v_res,
    pg_temp.w1(),p_wo,v_uom);
END
$fn$;

DO $matrix$
DECLARE
  v_policy integer; v_mo_idx integer:=0; v_wo_idx integer;
  v_allowed text[]; v_mo_status text; v_wo_status text;
  v_mo uuid; v_wo uuid; v_original_wo uuid;
  v_call jsonb; v_expected text; v_pass int:=0;
  v_all_mo text[]:=ARRAY[
    'draft','pending','confirmed','in_progress','on_hold',
    'quality_check','done','cancelled',NULL
  ];
  v_all_wo text[]:=ARRAY[
    'PENDING','READY','IN_SETUP','IN_PROGRESS','ON_HOLD',
    'COMPLETED','CANCELLED',NULL
  ];
BEGIN
  FOR v_policy IN 1..4 LOOP
    v_allowed:=CASE v_policy
      WHEN 1 THEN ARRAY['IN_PROGRESS']::text[]
      WHEN 2 THEN ARRAY['IN_PROGRESS','READY']::text[]
      WHEN 3 THEN ARRAY['IN_PROGRESS','IN_SETUP']::text[]
      ELSE ARRAY['IN_PROGRESS','READY','IN_SETUP']::text[]
    END;
    PERFORM pg_temp.as_user(pg_temp.admin(),format(
      'SELECT public.rpc_set_material_issue_wo_statuses(%L::uuid,%L::text[])',
      pg_temp.org(),v_allowed));
    FOREACH v_mo_status IN ARRAY v_all_mo LOOP
      v_mo_idx:=v_mo_idx+1;
      v_mo:=pg_temp.mk_mo('GREEN-192-MATRIX-'||v_mo_idx,5,1,
                          'draft','IN_PROGRESS');
      SELECT id INTO STRICT v_original_wo FROM public.work_orders WHERE mo_id=v_mo;
      IF v_mo_status IS DISTINCT FROM 'draft' THEN
        -- Superuser fixture injection only: exercise every stored state,
        -- including NULL and transitions the normal state machine disallows.
        -- Restore triggers before invoking the authenticated event RPC.
        PERFORM set_config('session_replication_role','replica',true);
        UPDATE public.manufacturing_orders SET status=v_mo_status WHERE id=v_mo;
        PERFORM set_config('session_replication_role','origin',true);
      END IF;
      FOR v_wo_idx IN 1..array_length(v_all_wo,1) LOOP
        v_wo_status:=v_all_wo[v_wo_idx];
        IF v_wo_status IS NOT DISTINCT FROM 'IN_PROGRESS' THEN
          v_wo:=v_original_wo;
        ELSE
          PERFORM set_config('request.jwt.claim.sub',pg_temp.admin()::text,true);
          PERFORM set_config('request.jwt.claims',
            json_build_object('sub',pg_temp.admin(),'role','authenticated')::text,true);
          INSERT INTO public.work_orders(
            org_id,mo_id,work_center_id,work_order_number,
            operation_sequence,operation_name,planned_quantity,status
          ) VALUES (
            pg_temp.org(),v_mo,pg_temp.wc(),
            'GREEN-192-MATRIX-'||v_mo_idx||'-WO-'||v_wo_idx,
            v_wo_idx+1,'Acceptance operation',5,v_wo_status
          ) RETURNING id INTO v_wo;
        END IF;
        v_expected:=CASE
          WHEN v_mo_status IS DISTINCT FROM 'in_progress'
            THEN 'MANUFACTURING_ORDER_NOT_IN_PROGRESS'
          WHEN NOT COALESCE(v_wo_status=ANY(v_allowed),false)
            THEN 'WORK_ORDER_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE'
          ELSE NULL
        END;
        v_call:=pg_temp.try_as(pg_temp.consumer(),
          pg_temp.issue_for_wo(v_mo,v_wo,gen_random_uuid()));
        IF v_expected IS NULL THEN
          IF v_call->>'ok' IS DISTINCT FROM 'true'
             OR v_call->'result'->>'success' IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION 'GREEN_192_MATRIX_ELIGIBLE_FAILED policy %, MO %, WO %: %',
              v_allowed,v_mo_status,v_wo_status,v_call;
          END IF;
        ELSIF v_call->>'ok' IS DISTINCT FROM 'false'
              OR v_call->>'error' IS DISTINCT FROM v_expected
              OR v_call->>'sqlstate' IS DISTINCT FROM 'P0001' THEN
          RAISE EXCEPTION 'GREEN_192_MATRIX_WRONG_REJECTION policy %, MO %, WO %, expected %: %',
            v_allowed,v_mo_status,v_wo_status,v_expected,v_call;
        END IF;
        v_pass:=v_pass+1;
      END LOOP;
    END LOOP;
  END LOOP;
  IF v_pass<>288 THEN RAISE EXCEPTION 'GREEN_192_MATRIX_INCOMPLETE: %',v_pass; END IF;
  RAISE NOTICE 'GREEN_192_STATUS_MATRIX_288';
END
$matrix$;

DO $foreign_wo$
DECLARE v_mo uuid; v_other uuid; v_wo uuid; v_call jsonb;
BEGIN
  v_mo:=pg_temp.mk_mo('GREEN-192-OWN-MO',5,1,'in_progress','IN_PROGRESS');
  v_other:=pg_temp.mk_mo('GREEN-192-OTHER-MO',5,1,'in_progress','IN_PROGRESS');
  SELECT id INTO STRICT v_wo FROM public.work_orders WHERE mo_id=v_other;
  v_call:=pg_temp.try_as(pg_temp.consumer(),
    pg_temp.issue_for_wo(v_mo,v_wo,gen_random_uuid()));
  IF v_call->>'ok' IS DISTINCT FROM 'false'
     OR v_call->>'error' IS DISTINCT FROM
        'WORK_ORDER_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE' THEN
    RAISE EXCEPTION 'GREEN_192_WRONG_MO_WO_ALLOWED: %',v_call;
  END IF;
END
$foreign_wo$;
ROLLBACK;
