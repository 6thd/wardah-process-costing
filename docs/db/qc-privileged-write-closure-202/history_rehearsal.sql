-- M202 INSERT-only history rehearsal, step 3a/4 (TARGET copy, COMMIT connection): fingerprint the QC
-- write-closure surface, run EXACTLY the documented two-trigger
-- disable / INSERT-only load / ENABLE ALWAYS procedure (runbook section 6, item 3),
-- and require the fingerprint to be identical afterwards. NOT pg_dump, NOT a full
-- logical restore, NOT physical restore/PITR, NOT hosted Supabase. The procedure COMMITS here;
-- every after-COMMIT observation is repeated by history_rehearsal_after.sql on a FRESH
-- connection. Run as the
-- disposable cluster's superuser with cwd = the directory holding qi.csv/auth.csv.
\set ON_ERROR_STOP on
\ir ../manufacturing-inventory-red-20260925/_helpers.sql
\ir history_rehearsal_lib.sql

-- ------------------------------------------------------------------ stage data
-- The historical rows, produced by the genuine RPC on the SOURCE copy. Staged in
-- session-local tables; the load below is INSERT ... SELECT only.
CREATE TEMP TABLE h_qi (LIKE public.quality_inspections);
CREATE TEMP TABLE h_auth (LIKE wardah_internal.quality_inspection_authority_202);
GRANT SELECT ON h_qi, h_auth TO PUBLIC;  -- so a denied role is refused by the TARGET table, not by the staging table
\copy h_qi FROM 'qi.csv' WITH (FORMAT csv)
\copy h_auth FROM 'auth.csv' WITH (FORMAT csv)

-- ------------------------------------------------------------------- BEFORE
SELECT 'COMMIT_CONNECTION pid=' || pg_backend_pid() AS evidence;
SELECT pg_temp.expect_same('target starts with no QC history rows',
  (SELECT count(*)::text FROM public.quality_inspections) || '/' ||
  (SELECT count(*)::text FROM wardah_internal.quality_inspection_authority_202), '0/0');
SELECT pg_temp.expect_same('staged history is 3 inspections + 3 authority links',
  (SELECT count(*)::text FROM h_qi) || '/' || (SELECT count(*)::text FROM h_auth), '3/3');
SELECT wardah_internal.qc_assert_closed_graph_202();
SELECT pg_temp.fp() AS f0 \gset
SELECT pg_temp.fp_parts() AS p0 \gset
SELECT pg_temp.expect_same('fingerprint is deterministic (two reads, same state)', :'f0', pg_temp.fp());
SELECT 'FINGERPRINT_BEFORE ' || :'f0' AS evidence;

-- Non-vacuity of the fingerprint: each mutation, applied then rolled back, must change it.
BEGIN; GRANT SELECT (id) ON public.quality_inspections TO authenticated;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a COLUMN ACL is granted on quality_inspections', :'fm', :'f0');
BEGIN; GRANT SELECT ON wardah_internal.quality_inspection_authority_202 TO authenticated;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a TABLE ACL is granted on the authority link', :'fm', :'f0');
BEGIN; ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) OWNER TO postgres;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('the recorder owner changes', :'fm', :'f0');
BEGIN; GRANT EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) TO anon;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('the recorder ACL changes', :'fm', :'f0');
BEGIN; ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) SET search_path = public;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('the recorder config (search_path) changes', :'fm', :'f0');
BEGIN; ALTER ROLE wardah_qc_entry_202 SET work_mem = '64MB';
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('the entry role gains a setting', :'fm', :'f0');
BEGIN; ALTER ROLE wardah_qc_entry_202 CREATEDB;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('the entry role gains an attribute', :'fm', :'f0');
BEGIN; GRANT wardah_qc_entry_202 TO authenticated;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a membership edge on the entry role appears', :'fm', :'f0');
BEGIN; ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a guard trigger is left DISABLED', :'fm', :'f0');
BEGIN; ALTER TABLE wardah_internal.quality_inspection_authority_202 DISABLE TRIGGER qc_write_guard_202;
      ALTER TABLE wardah_internal.quality_inspection_authority_202 ENABLE TRIGGER qc_write_guard_202;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a guard trigger is re-armed with plain ENABLE instead of ENABLE ALWAYS', :'fm', :'f0');
BEGIN; ALTER TABLE wardah_internal.quality_inspection_authority_202 DROP CONSTRAINT quality_inspection_authority_202_inspection_id_fkey;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('the authority foreign key is dropped', :'fm', :'f0');
BEGIN; ALTER TABLE public.quality_inspections OWNER TO service_role;
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a guarded table changes owner', :'fm', :'f0');
BEGIN; CREATE POLICY zz_hist_probe ON public.quality_inspections FOR SELECT TO authenticated USING (true);
SELECT pg_temp.fp() AS fm \gset
ROLLBACK;
SELECT pg_temp.expect_diff('a policy is added', :'fm', :'f0');
SELECT pg_temp.expect_same('every mutation rolled back: fingerprint is back to the baseline', :'f0', pg_temp.fp());

-- The procedure is NECESSARY: without it the historical load is refused.
BEGIN;
SELECT pg_temp.refused('control: loading history WITHOUT the procedure is refused (quality_inspections)', NULL,
  'INSERT INTO public.quality_inspections SELECT * FROM h_qi', 'QC_WRITE_PROVENANCE_REQUIRED_202');
ROLLBACK;

-- ------------------------------------------------- THE DOCUMENTED PROCEDURE
-- Verbatim from runbook section 6, item 3 (restore bodies are INSERT ... SELECT).
BEGIN;
ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202;
ALTER TABLE wardah_internal.quality_inspection_authority_202 DISABLE TRIGGER qc_write_guard_202;

-- Inside the window: ONLY the two named guard triggers are disabled; history
-- protection holds for every mutation class on both tables.
SELECT pg_temp.expect_same('window: exactly the two named guard triggers are disabled, every other trigger unchanged',
  (SELECT string_agg(c.relname || ':' || g.tgname, ',' ORDER BY c.relname, g.tgname)
   FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
   WHERE NOT g.tgisinternal AND g.tgenabled = 'D' AND c.relname IN ('quality_inspections','quality_inspection_authority_202','qc_entry_markers_202','quality_supersessions_202')),
  'quality_inspection_authority_202:qc_write_guard_202,quality_inspections:qc_write_guard_202');
SELECT pg_temp.expect_same('window: the history-protection triggers are still enabled',
  (SELECT count(*)::text FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgenabled <> 'D'
     AND g.tgrelid IN ('public.quality_inspections'::regclass, 'wardah_internal.quality_inspection_authority_202'::regclass)
     AND g.tgname IN ('deny_quality_inspection_change_199','deny_history_truncate_193','deny_qc_history_change_202','deny_history_truncate_202')),
  (SELECT count(*)::text FROM pg_trigger g WHERE NOT g.tgisinternal
     AND g.tgrelid IN ('public.quality_inspections'::regclass, 'wardah_internal.quality_inspection_authority_202'::regclass)
     AND g.tgname IN ('deny_quality_inspection_change_199','deny_history_truncate_193','deny_qc_history_change_202','deny_history_truncate_202')));
SELECT pg_temp.refused('window: TRUNCATE of the authority link refused', NULL, 'TRUNCATE wardah_internal.quality_inspection_authority_202', 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED');
SELECT pg_temp.refused('window: TRUNCATE quality_inspections CASCADE refused', NULL, 'TRUNCATE public.quality_inspections CASCADE', 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED');
SELECT pg_temp.refused('window: TRUNCATE quality_inspections refused (authority FK)', NULL, 'TRUNCATE public.quality_inspections', 'cannot truncate a table referenced in a foreign key constraint');
SELECT pg_temp.refused('window: an authority link without its inspection violates the foreign key', NULL,
  'INSERT INTO wardah_internal.quality_inspection_authority_202(inspection_id, org_id, authority_revision) VALUES (gen_random_uuid(), (SELECT org_id FROM h_auth LIMIT 1), 0)',
  'violates foreign key constraint');

-- The load itself: INSERT-only, parents first.
INSERT INTO public.quality_inspections SELECT * FROM h_qi ORDER BY created_at, id;
INSERT INTO wardah_internal.quality_inspection_authority_202 SELECT * FROM h_auth ORDER BY inspection_id;

-- Row-level history guards are only exercised once rows exist, so they are checked
-- here, AFTER the load and BEFORE the re-arm (guards still disabled, history still protected).
SELECT pg_temp.refused('window (rows present): UPDATE of quality_inspections refused', NULL, 'UPDATE public.quality_inspections SET result = result', 'QUALITY_INSPECTION_IMMUTABLE');
SELECT pg_temp.refused('window (rows present): DELETE from quality_inspections refused', NULL, 'DELETE FROM public.quality_inspections', 'QUALITY_INSPECTION_IMMUTABLE');
SELECT pg_temp.refused('window (rows present): UPDATE of the authority link refused', NULL, 'UPDATE wardah_internal.quality_inspection_authority_202 SET authority_revision = authority_revision', 'QC_HISTORY_IMMUTABLE_202');
SELECT pg_temp.refused('window (rows present): DELETE from the authority link refused', NULL, 'DELETE FROM wardah_internal.quality_inspection_authority_202', 'QC_HISTORY_IMMUTABLE_202');

ALTER TABLE public.quality_inspections ENABLE ALWAYS TRIGGER qc_write_guard_202;
ALTER TABLE wardah_internal.quality_inspection_authority_202 ENABLE ALWAYS TRIGGER qc_write_guard_202;
COMMIT;


-- After COMMIT, SAME SESSION only (connection 1): the fingerprint readback. The
-- fresh-connection readback and every denied-write / genuine-RPC observation are in
-- history_rehearsal_after.sql.
SELECT pg_temp.fp() AS f1 \gset
SELECT 'FINGERPRINT_AFTER_COMMIT_SAME_SESSION ' || :'f1' AS evidence;
SELECT pg_temp.expect_same('same-session readback after COMMIT: fingerprint identical to the pre-procedure baseline', :'f0', :'f1');
-- Hand the pre-procedure baseline to the fresh connection through a file.
\pset tuples_only on
\pset format unaligned
SELECT :'f0' \g f0.txt
\pset tuples_only off
\pset format aligned
SELECT 'M202_HISTORY_PROCEDURE_COMMITTED baseline=' || :'f0' || ' same_session_after=' || :'f1' AS result;
