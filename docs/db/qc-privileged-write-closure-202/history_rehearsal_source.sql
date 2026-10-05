-- M202 INSERT-only history rehearsal, step 2/3: on the SOURCE copy, produce
-- historical evidence ONLY through the genuine authenticated RPC, then export the
-- two guarded tables to CSV (cwd). Run with the working directory set to the
-- export directory. Disposable cluster only.
\set ON_ERROR_STOP on
\ir ../manufacturing-inventory-red-20260925/_helpers.sql
CREATE FUNCTION pg_temp.inspector() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a4'::uuid $$;
CREATE FUNCTION pg_temp.rec(p_mo uuid, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_user(pg_temp.inspector(), format(
    'SELECT public.rpc_record_quality_inspection(%L::uuid, %L::uuid, %L::jsonb)', p_mo, gen_random_uuid(), p_payload)) $fn$;

SELECT pg_temp.rec('ed000000-0000-4000-8000-00000000f101',
  '{"inspection_type":"FINAL","result":"PASS","passed_quantity":10,"failed_quantity":0}'::jsonb);
SELECT pg_temp.rec('ed000000-0000-4000-8000-00000000f102', jsonb_build_object(
  'inspection_type','IN_PROCESS','result','PASS','stage_id',pg_temp.stage(),'passed_quantity',5,'failed_quantity',0));
SELECT pg_temp.rec('ed000000-0000-4000-8000-00000000f102',
  '{"inspection_type":"FINAL","result":"FAIL","passed_quantity":0,"failed_quantity":10,"disposition":"scrap","corrective_action":"reject lot"}'::jsonb);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.quality_inspections) <> 3
     OR (SELECT count(*) FROM wardah_internal.quality_inspection_authority_202) <> 3
     OR EXISTS (SELECT 1 FROM public.quality_inspections q
                LEFT JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = q.id
                WHERE a.inspection_id IS NULL) THEN
    RAISE EXCEPTION 'M202_HISTORY_SOURCE_FAIL';
  END IF;
  RAISE NOTICE 'M202_HISTORY_SOURCE_OK 3 genuine inspections, each with its authority link';
END $$;
\copy (SELECT * FROM public.quality_inspections ORDER BY created_at, id) TO 'qi.csv' WITH (FORMAT csv)
\copy (SELECT * FROM wardah_internal.quality_inspection_authority_202 ORDER BY inspection_id) TO 'auth.csv' WITH (FORMAT csv)
