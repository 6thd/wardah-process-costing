-- M202 INSERT-only history rehearsal, step 4/4 (FRESH connection after the COMMIT):
-- reads the baseline fingerprint captured BEFORE the procedure from f0.txt and
-- requires the committed state to match it; then denied direct writes, restored-row
-- equality, FK, the gate, catalog mutants that the oracle must reject, and a genuine
-- authenticated RPC. Run in a NEW psql process with cwd = the export directory.
\set ON_ERROR_STOP on
\ir ../manufacturing-inventory-red-20260925/_helpers.sql
\ir history_rehearsal_lib.sql

\set f0 `cat f0.txt`
SELECT set_config('m202.f0', :'f0', false);
CREATE TEMP TABLE h_qi (LIKE public.quality_inspections);
CREATE TEMP TABLE h_auth (LIKE wardah_internal.quality_inspection_authority_202);
GRANT SELECT ON h_qi, h_auth TO PUBLIC;
\copy h_qi FROM 'qi.csv' WITH (FORMAT csv)
\copy h_auth FROM 'auth.csv' WITH (FORMAT csv)
SELECT 'FRESH_CONNECTION pid=' || pg_backend_pid() AS evidence;

SELECT pg_temp.expect_same('fresh connection: the data survived the COMMIT (3 inspections, 3 links) without this session writing them',
  (SELECT count(*)::text FROM public.quality_inspections) || '/' ||
  (SELECT count(*)::text FROM wardah_internal.quality_inspection_authority_202), '3/3');
SELECT pg_temp.fp() AS f1 \gset
SELECT 'FINGERPRINT_AFTER_FRESH_CONNECTION ' || :'f1' AS evidence;
SELECT pg_temp.assert_fp('fresh connection after COMMIT');
SELECT pg_temp.expect_same('FINGERPRINT (fresh connection): owners, ACLs, column ACLs, recorder, entry role, membership and triggers equal the pre-procedure baseline', :'f0', :'f1');
SELECT wardah_internal.qc_assert_closed_graph_202();
SELECT pg_temp.expect_same('the closed-graph assertion passes on the committed state', 'true', 'true');
SELECT pg_temp.expect_same('both guard triggers are ENABLE ALWAYS',
  (SELECT string_agg(g.tgenabled::text, '' ORDER BY g.tgrelid::regclass::text) FROM pg_trigger g
   WHERE g.tgname = 'qc_write_guard_202' AND NOT g.tgisinternal), 'AA');

-- Ordinary direct writes denied; restored rows; gate.
SELECT pg_temp.expect_same('matching history restored: quality_inspections rows equal the source rows (both EXCEPT directions empty)',
  (SELECT count(*)::text FROM (SELECT * FROM public.quality_inspections EXCEPT SELECT * FROM h_qi) x) || '/' ||
  (SELECT count(*)::text FROM (SELECT * FROM h_qi EXCEPT SELECT * FROM public.quality_inspections) y) || '/' ||
  (SELECT count(*)::text FROM public.quality_inspections), '0/0/3');
SELECT pg_temp.expect_same('matching history restored: authority links equal the source links',
  (SELECT count(*)::text FROM (SELECT * FROM wardah_internal.quality_inspection_authority_202 EXCEPT SELECT * FROM h_auth) x) || '/' ||
  (SELECT count(*)::text FROM (SELECT * FROM h_auth EXCEPT SELECT * FROM wardah_internal.quality_inspection_authority_202) y) || '/' ||
  (SELECT count(*)::text FROM wardah_internal.quality_inspection_authority_202), '0/0/3');
SELECT pg_temp.expect_same('authority FK: no orphan link and no inspection without a link; constraint validated',
  (SELECT count(*)::text FROM wardah_internal.quality_inspection_authority_202 a LEFT JOIN public.quality_inspections q ON q.id = a.inspection_id WHERE q.id IS NULL) || '/' ||
  (SELECT count(*)::text FROM public.quality_inspections q LEFT JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = q.id WHERE a.inspection_id IS NULL) || '/' ||
  (SELECT bool_and(convalidated)::text FROM pg_constraint WHERE conrelid = 'wardah_internal.quality_inspection_authority_202'::regclass AND contype = 'f'),
  '0/0/true');
SELECT pg_temp.expect_same('restored evidence is honoured by the gate (HIST-1 FINAL PASS releases; HIST-2 genuine FINAL FAIL rejects)',
  (SELECT (wardah_internal.evaluate_quality_release_199(m.org_id, m.id, m.routing_id, 'quality_check', NULL) ->> 'ready') FROM public.manufacturing_orders m WHERE m.order_number = 'HIST-1') || '/' ||
  (SELECT (wardah_internal.evaluate_quality_release_199(m.org_id, m.id, m.routing_id, 'quality_check', NULL) ->> 'blocking_reason_if_required') FROM public.manufacturing_orders m WHERE m.order_number = 'HIST-2'),
  'true/QUALITY_RELEASE_REJECTED');

-- Ordinary direct writes are denied again after the re-arm.
SELECT pg_temp.refused('after: authenticated direct INSERT into quality_inspections', 'authenticated',
  'INSERT INTO public.quality_inspections SELECT * FROM h_qi', 'permission denied for table quality_inspections');
SELECT pg_temp.refused('after: service_role direct INSERT into quality_inspections', 'service_role',
  'INSERT INTO public.quality_inspections SELECT * FROM h_qi', 'permission denied for table quality_inspections');
SELECT pg_temp.refused('after: authenticated direct INSERT into the authority link', 'authenticated',
  'INSERT INTO wardah_internal.quality_inspection_authority_202 SELECT * FROM h_auth', 'permission denied for schema wardah_internal');
SELECT pg_temp.refused('after: service_role direct INSERT into the authority link', 'service_role',
  'INSERT INTO wardah_internal.quality_inspection_authority_202 SELECT * FROM h_auth', 'permission denied for schema wardah_internal');
SELECT pg_temp.refused('after: the owner/superuser direct INSERT into quality_inspections', NULL,
  'INSERT INTO public.quality_inspections SELECT * FROM h_qi', 'QC_WRITE_PROVENANCE_REQUIRED_202');
SELECT pg_temp.refused('after: the owner/superuser direct INSERT into the authority link', NULL,
  'INSERT INTO wardah_internal.quality_inspection_authority_202 SELECT * FROM h_auth', 'QC_WRITE_PROVENANCE_REQUIRED_202');
SELECT pg_temp.refused('after: the owner INSERT is refused even with session_replication_role = replica (guard is ENABLE ALWAYS)', NULL,
  'SET LOCAL session_replication_role = replica; INSERT INTO public.quality_inspections SELECT * FROM h_qi', 'QC_WRITE_PROVENANCE_REQUIRED_202');
SELECT pg_temp.refused('after: the entry role cannot insert without the transaction marker', 'wardah_qc_entry_202',
  'INSERT INTO public.quality_inspections SELECT * FROM h_qi', 'QC_WRITE_MARKER_REQUIRED_202');
SELECT pg_temp.refused('after: UPDATE still refused', NULL, 'UPDATE public.quality_inspections SET result = result', 'QUALITY_INSPECTION_IMMUTABLE');
SELECT pg_temp.refused('after: DELETE still refused', NULL, 'DELETE FROM wardah_internal.quality_inspection_authority_202', 'QC_HISTORY_IMMUTABLE_202');
SELECT pg_temp.refused('after: TRUNCATE ... CASCADE still refused', NULL, 'TRUNCATE public.quality_inspections CASCADE', 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED');

-- The ORACLE must FAIL (not recapture) on the committed state when a captured
-- owner / ACL / config / role / trigger field is altered; each mutation is rolled back.
SELECT pg_temp.oracle_rejects('a COLUMN ACL is granted on quality_inspections', 'GRANT SELECT (id) ON public.quality_inspections TO authenticated');
SELECT pg_temp.oracle_rejects('a TABLE ACL is granted on the authority link', 'GRANT SELECT ON wardah_internal.quality_inspection_authority_202 TO authenticated');
SELECT pg_temp.oracle_rejects('the quality_inspections owner changes', 'ALTER TABLE public.quality_inspections OWNER TO service_role');
SELECT pg_temp.oracle_rejects('the recorder owner changes', 'ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) OWNER TO postgres');
SELECT pg_temp.oracle_rejects('the recorder ACL changes', 'GRANT EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) TO anon');
SELECT pg_temp.oracle_rejects('the recorder config changes', 'ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) SET search_path = public');
SELECT pg_temp.oracle_rejects('the entry role gains an attribute', 'ALTER ROLE wardah_qc_entry_202 CREATEDB');
SELECT pg_temp.oracle_rejects('the entry role gains a membership edge', 'GRANT wardah_qc_entry_202 TO authenticated');
SELECT pg_temp.oracle_rejects('a guard trigger is left DISABLED (quality_inspections)', 'ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202');
SELECT pg_temp.oracle_rejects('the authority guard is re-armed with plain ENABLE', 'ALTER TABLE wardah_internal.quality_inspection_authority_202 ENABLE TRIGGER qc_write_guard_202');
SELECT pg_temp.oracle_rejects('a history-protection trigger is disabled', 'ALTER TABLE public.quality_inspections DISABLE TRIGGER deny_quality_inspection_change_199');
SELECT pg_temp.oracle_rejects('the authority foreign key is dropped', 'ALTER TABLE wardah_internal.quality_inspection_authority_202 DROP CONSTRAINT quality_inspection_authority_202_inspection_id_fkey');
SELECT pg_temp.assert_fp('after every rolled-back mutation');
SELECT pg_temp.expect_same('every mutation was rolled back: the oracle accepts the committed state again', 'true', 'true');

-- A fresh genuine authenticated RPC succeeds after the restore.
SELECT pg_temp.as_user(pg_temp.inspector(), format(
  'SELECT public.rpc_record_quality_inspection(%L::uuid, %L::uuid, %L::jsonb)',
  'ed000000-0000-4000-8000-00000000f103', gen_random_uuid(),
  '{"inspection_type":"FINAL","result":"PASS","passed_quantity":10,"failed_quantity":0}')) AS fresh \gset
SELECT pg_temp.expect_same('a fresh authenticated RPC records a new inspection after the restore (not a replay, linked at revision 0)',
  (:'fresh'::jsonb ->> 'replayed') || '/' ||
  (SELECT a.authority_revision::text FROM wardah_internal.quality_inspection_authority_202 a WHERE a.inspection_id = (:'fresh'::jsonb ->> 'inspection_id')::uuid) || '/' ||
  (SELECT count(*)::text FROM public.quality_inspections) || '/' ||
  (SELECT count(*)::text FROM public.quality_inspections WHERE inspection_number = (:'fresh'::jsonb ->> 'inspection_number')),
  'false/0/4/1');
SELECT 'FRESH_RPC_RESULT ' || :'fresh' AS evidence;
SELECT pg_temp.expect_same('the fresh RPC left the fingerprint unchanged', :'f0', pg_temp.fp());
SELECT pg_temp.expect_same('the fresh genuine inspection releases HIST-3-FRESH',
  (SELECT (wardah_internal.evaluate_quality_release_199(m.org_id, m.id, m.routing_id, 'quality_check', NULL) ->> 'ready') FROM public.manufacturing_orders m WHERE m.order_number = 'HIST-3-FRESH'), 'true');


SELECT pg_temp.assert_fp('after the fresh genuine RPC');
SELECT pg_temp.fp() AS f2 \gset
SELECT 'M202_HISTORY_INSERT_ONLY_REHEARSAL_PASS fingerprint_before=' || :'f0' || ' fingerprint_after=' || :'f2' AS result;
