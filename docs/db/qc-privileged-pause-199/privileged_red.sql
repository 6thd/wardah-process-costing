-- Disposable canonical M199 only. Proves existing privileged write surfaces;
-- this is a RED reproduction, never a desired security acceptance contract.
\set ON_ERROR_STOP on
BEGIN;
\if :qc_mutate_insert
REVOKE INSERT ON public.quality_inspections FROM service_role;
\endif
\if :qc_mutate_truncate
DROP TRIGGER deny_history_truncate_193 ON public.quality_inspections;
\endif
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.require(p_ok boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'QC_PRIVILEGED_RED_MISSING: %', p_label; END IF;
END $$;

CREATE FUNCTION pg_temp.try_role(p_role text, p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_state text; v_message text; v_result jsonb;
BEGIN
  IF p_role NOT IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'BAD_TEST_ROLE'; END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v_result;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('ok',true,'result',v_result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE, v_message=MESSAGE_TEXT;
    RETURN jsonb_build_object('ok',false,'sqlstate',v_state,'error',v_message);
  END;
END $$;

SELECT pg_temp.require((SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'),
  'service-role fidelity');
UPDATE wardah_internal.quality_policies SET release_gate_mode='all_orders'
WHERE org_id=pg_temp.org();

INSERT INTO public.manufacturing_orders(id,org_id,order_number,product_id,quantity,status,created_by)
VALUES ('ed000000-0000-4000-8000-000000000091',pg_temp.org(),'QC-PRIV-RED',pg_temp.fg(),10,'quality_check',pg_temp.admin());

SELECT pg_temp.require(NOT (wardah_internal.evaluate_quality_release_199(
  pg_temp.org(),'ed000000-0000-4000-8000-000000000091',NULL,'quality_check',10)->>'ready')::boolean,
  'gate starts blocked');

DO $$
DECLARE stmt text; result jsonb; role_name text; before_audits bigint;
BEGIN
  SELECT count(*) INTO before_audits FROM public.audit_logs
  WHERE action='manufacturing.quality_inspection.create';
  stmt := format($sql$INSERT INTO public.quality_inspections(
    org_id,mo_id,inspection_number,inspection_type,inspector_id,result,
    passed_quantity,failed_quantity,qc_cycle,inspection_seq,request_id,request_hash)
    VALUES (%L,'ed000000-0000-4000-8000-000000000091','PRIV-FORGED','FINAL',%L,
      'PASS',10,0,1,999,'ed000000-0000-4000-8000-000000000092','not-an-rpc-hash')
    RETURNING to_jsonb(quality_inspections.*)$sql$, pg_temp.org(),pg_temp.admin());
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    result := pg_temp.try_role(role_name,stmt);
    PERFORM pg_temp.require(result->>'sqlstate'='42501' AND result->>'ok'='false',role_name||' insert control');
  END LOOP;
  result := pg_temp.try_role('service_role',stmt);
  PERFORM pg_temp.require(result->>'ok'='true','SERVICE_ROLE_INSERT');
  PERFORM pg_temp.require(result#>>'{result,inspector_id}'=pg_temp.admin()::text,'chosen inspector');
  PERFORM pg_temp.require(result#>>'{result,request_hash}'='not-an-rpc-hash','chosen request hash');
  PERFORM pg_temp.require((SELECT count(*) FROM public.audit_logs
    WHERE action='manufacturing.quality_inspection.create')=before_audits,'missing RPC audit');
  PERFORM pg_temp.require((wardah_internal.evaluate_quality_release_199(
    pg_temp.org(),'ed000000-0000-4000-8000-000000000091',NULL,'quality_check',10)->>'ready')::boolean,
    'forged final opens evaluated gate');
  RAISE NOTICE 'QC_SERVICE_INSERT_RED actor_claim=empty forged_inspector=true gate_ready=true rpc_audit_delta=0';

  result := pg_temp.try_role('service_role', $sql$UPDATE public.quality_inspections
    SET result='FAIL' WHERE inspection_number='PRIV-FORGED' RETURNING to_jsonb(quality_inspections.*)$sql$);
  PERFORM pg_temp.require(result->>'sqlstate'='42501' AND result->>'error'='QUALITY_INSPECTION_IMMUTABLE',
    'service UPDATE immutable control');
  result := pg_temp.try_role('service_role', $sql$DELETE FROM public.quality_inspections
    WHERE inspection_number='PRIV-FORGED' RETURNING to_jsonb(quality_inspections.*)$sql$);
  PERFORM pg_temp.require(result->>'sqlstate'='42501' AND result->>'error'='QUALITY_INSPECTION_IMMUTABLE',
    'service DELETE immutable control');

  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    result := pg_temp.try_role(role_name,'TRUNCATE public.quality_inspections');
    PERFORM pg_temp.require(result->>'sqlstate'='42501' AND result->>'ok'='false',role_name||' truncate control');
  END LOOP;
  result := pg_temp.try_role('service_role','TRUNCATE public.quality_inspections');
  PERFORM pg_temp.require(result->>'ok'='false' AND result->>'sqlstate'='P0001'
    AND result->>'error'='M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED','TRUNCATE_GUARD');
  PERFORM pg_temp.require((SELECT count(*) FROM public.quality_inspections)=1,'truncate preserves row');
  PERFORM pg_temp.require((wardah_internal.evaluate_quality_release_199(
    pg_temp.org(),'ed000000-0000-4000-8000-000000000091',NULL,'quality_check',10)->>'ready')::boolean,
    'truncate preserves release evidence');
  RAISE NOTICE 'QC_SERVICE_HISTORY_CONTROLS_PASS update=42501 delete=42501 truncate=P0001 rows_unchanged=true';
END $$;
ROLLBACK;
\echo QC_PRIVILEGED_RED_REPRODUCED rollback=true
