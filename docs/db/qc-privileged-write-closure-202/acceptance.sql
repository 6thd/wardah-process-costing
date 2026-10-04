-- M202 acceptance (disposable PG17, after M190..M201 and 202). One transaction,
-- rolled back. Sections: A surface, B genuine path, C forgery/RED mutants,
-- D NULL + supersession, E post-201 contract.
\set ON_ERROR_STOP on
BEGIN;
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.inspector() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a4'::uuid $$;
CREATE FUNCTION pg_temp.qmanager()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a5'::uuid $$;
CREATE FUNCTION pg_temp.outsider()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a7'::uuid $$;
CREATE FUNCTION pg_temp.keyholder() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a8'::uuid $$;
CREATE FUNCTION pg_temp.org2()      RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-000000000002'::uuid $$;
CREATE FUNCTION pg_temp.stage_b()   RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000f3'::uuid $$;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: %', p_label; END IF;
  RAISE NOTICE 'ok  %', p_label;
END $fn$;

CREATE FUNCTION pg_temp.denied(p_uid uuid, p_sql text, p_expect text, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb := pg_temp.try_as(p_uid, p_sql);
BEGIN
  IF (v->>'ok')::boolean OR position(p_expect IN COALESCE(v->>'error','')) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected % got %', p_label, p_expect, v;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;

-- Run one statement under a DB role (no JWT), inside a subtransaction.
CREATE FUNCTION pg_temp.try_role(p_role text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('ok', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN jsonb_build_object('ok', false, 'sqlstate', v_state, 'error', v_msg);
  END;
END $fn$;
CREATE FUNCTION pg_temp.role_denied(p_role text, p_sql text, p_expect text, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb := pg_temp.try_role(p_role, p_sql);
BEGIN
  IF (v->>'ok')::boolean OR position(p_expect IN COALESCE(v->>'error','')) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected % got %', p_label, p_expect, v;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;

-- Apply a catalog mutation, run the closed-graph assertion, expect it to raise
-- p_expect, and roll the mutation back.
CREATE FUNCTION pg_temp.mutant(p_label text, p_setup text, p_expect text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_msg text;
BEGIN
  BEGIN
    EXECUTE p_setup;
    BEGIN
      PERFORM wardah_internal.qc_assert_closed_graph_202();
      v_msg := '<assertion passed>';
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = v_msg;
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF position(p_expect IN v_msg) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: mutant % expected % got %', p_label, p_expect, v_msg;
  END IF;
  RAISE NOTICE 'ok  mutant caught: % (%)', p_label, p_expect;
END $fn$;

-- Attempt a (forging) statement as a role; it must fail with p_expect, and any
-- effect is rolled back with the subtransaction.
CREATE FUNCTION pg_temp.forge_denied(p_role text, p_sql text, p_expect text, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := pg_temp.try_role(p_role, p_sql);
  IF (v->>'ok')::boolean OR position(p_expect IN COALESCE(v->>'error','')) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: forgery % expected % got %', p_label, p_expect, v;
  END IF;
  RAISE NOTICE 'ok  forgery refused: % (%)', p_label, p_expect;
END $fn$;

CREATE FUNCTION pg_temp.mo(p_number text, p_status text DEFAULT 'in_progress', p_creator uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $fn$
  INSERT INTO public.manufacturing_orders(org_id, order_number, product_id, quantity, status, created_by)
  VALUES (pg_temp.org(), p_number, pg_temp.fg(), 10, p_status, COALESCE(p_creator, pg_temp.admin()))
  RETURNING id;
$fn$;
CREATE FUNCTION pg_temp.version(p_mo uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT maintenance_version FROM public.manufacturing_orders WHERE id = p_mo $$;
CREATE FUNCTION pg_temp.hold_sql(p_mo uuid, p_action text, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_set_mo_quality_hold(%L::uuid, %L, %s, %L)', p_mo, p_action,
    pg_temp.version(p_mo), p_reason) $fn$;
CREATE FUNCTION pg_temp.inspect_sql(p_mo uuid, p_request uuid, p_payload jsonb) RETURNS text
LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_record_quality_inspection(%L::uuid, %L::uuid, %L::jsonb)',
    p_mo, p_request, p_payload) $fn$;
CREATE FUNCTION pg_temp.final(p_result text, p_passed numeric, p_failed numeric,
  p_disposition text DEFAULT NULL, p_corrective text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object('inspection_type', 'FINAL', 'result', p_result,
    'passed_quantity', p_passed, 'failed_quantity', p_failed,
    'disposition', p_disposition, 'corrective_action', p_corrective)) $fn$;
CREATE FUNCTION pg_temp.stage_insp(p_stage uuid, p_result text DEFAULT 'PASS') RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('inspection_type', 'IN_PROCESS', 'result', p_result, 'stage_id', p_stage,
    'passed_quantity', 5, 'failed_quantity', 0) $fn$;
CREATE FUNCTION pg_temp.policy(p_gate text, p_scope text DEFAULT 'final_only') RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object('release_gate_mode', p_gate, 'inspection_scope', p_scope,
    'allow_conditional_release', false, 'segregation_of_duties', true,
    'admins_subject_to_quality_controls', true) $fn$;
CREATE FUNCTION pg_temp.set_policy(p_policy jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_user(pg_temp.admin(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, %s)',
    pg_temp.org(), p_policy, (SELECT version FROM wardah_internal.quality_policies WHERE org_id = pg_temp.org()))) $fn$;
CREATE FUNCTION pg_temp.release(p_mo uuid) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT wardah_internal.evaluate_quality_release_199(m.org_id, m.id, m.routing_id, m.status, NULL)
  FROM public.manufacturing_orders m WHERE m.id = p_mo $fn$;
CREATE FUNCTION pg_temp.ready(p_mo uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT (pg_temp.release(p_mo) ->> 'ready')::boolean $$;
CREATE FUNCTION pg_temp.reason(p_mo uuid) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.release(p_mo) ->> 'blocking_reason_if_required' $$;
CREATE FUNCTION pg_temp.supersede_sql(p_mo uuid, p_type text, p_stage uuid, p_expected integer, p_reason text)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_supersede_quality_evidence_202(%L::uuid, %L, %L::uuid, %s, %L)',
    p_mo, p_type, p_stage, COALESCE(p_expected::text, 'NULL'), p_reason) $fn$;

-- A direct INSERT statement text (what a forger would try).
CREATE FUNCTION pg_temp.ins_sql(p_id uuid, p_mo uuid, p_req uuid, p_number text,
  p_org uuid DEFAULT NULL, p_seq bigint DEFAULT 999) RETURNS text LANGUAGE sql AS $fn$
  SELECT format($q$INSERT INTO public.quality_inspections(id, org_id, mo_id, inspection_number,
      inspection_type, inspector_id, passed_quantity, failed_quantity, result, qc_cycle,
      inspection_seq, request_id, request_hash)
    VALUES (%L, %L, %L, %L, 'FINAL', %L, 10, 0, 'PASS', 1, %s, %L, 'forged')$q$,
    p_id, COALESCE(p_org, pg_temp.org()), p_mo, p_number, pg_temp.inspector(), p_seq, p_req) $fn$;

-- Pre-202-style evidence (forged or NULL-sequence rows that predate the guard).
CREATE FUNCTION pg_temp.legacy_row(p_mo uuid, p_number text, p_type text, p_stage uuid,
  p_cycle integer, p_seq bigint, p_result text, p_passed numeric, p_failed numeric) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202;
  INSERT INTO public.quality_inspections(org_id, mo_id, stage_id, inspection_number, inspection_type,
    inspector_id, passed_quantity, failed_quantity, result, qc_cycle, inspection_seq, request_hash)
  VALUES (pg_temp.org(), p_mo, p_stage, p_number, p_type, pg_temp.inspector(), p_passed, p_failed,
    p_result, p_cycle, p_seq, 'legacy') RETURNING id INTO v_id;
  ALTER TABLE public.quality_inspections ENABLE ALWAYS TRIGGER qc_write_guard_202;
  RETURN v_id;
END $fn$;

-- ------------------------------------------------------------------ fixture
INSERT INTO public.organizations(id, name, code) VALUES (pg_temp.org2(), 'QC Org 2', 'QC-ORG2');
INSERT INTO auth.users(id, email) VALUES
  (pg_temp.inspector(), 'qc-inspector@example.test'),
  (pg_temp.qmanager(),  'qc-manager@example.test'),
  (pg_temp.outsider(),  'qc-outsider@example.test'),
  (pg_temp.keyholder(), 'qc-keyholder@example.test');
INSERT INTO public.user_organizations(user_id, org_id, role, is_active, is_org_admin) VALUES
  (pg_temp.inspector(), pg_temp.org(),  'user', true, false),
  (pg_temp.qmanager(),  pg_temp.org(),  'user', true, false),
  (pg_temp.keyholder(), pg_temp.org(),  'user', true, false),
  (pg_temp.outsider(),  pg_temp.org2(), 'admin', true, true);
INSERT INTO public.roles(id, org_id, name, name_ar, is_active) VALUES
  ('ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), 'QC Inspector', 'مراقب', true),
  ('ed000000-0000-4000-8000-0000000000b8', pg_temp.org(), 'Mfg Settings', 'إعدادات', true);
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b4'::uuid, id FROM public.permissions
WHERE permission_key IN ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create');
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b8'::uuid, id FROM public.permissions
WHERE permission_key = 'manufacturing.settings.update';
INSERT INTO public.user_roles(user_id, role_id, org_id, expires_at) VALUES
  (pg_temp.inspector(), 'ed000000-0000-4000-8000-0000000000b4', pg_temp.org(), NULL),
  (pg_temp.keyholder(), 'ed000000-0000-4000-8000-0000000000b8', pg_temp.org(), NULL);
INSERT INTO public.manufacturing_stages(id, org_id, code, name, order_sequence)
VALUES (pg_temp.stage_b(), pg_temp.org(), 'F3-QC', 'QC Stage B', 99);
SELECT pg_temp.set_policy(pg_temp.policy('all_orders'));

CREATE TEMP TABLE m(k text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE r(k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

-- ======================================================== A. surface closure
DO $a$
DECLARE v_role text; v_tbl text; v_priv text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['service_role','anon','authenticated'] LOOP
    FOREACH v_tbl IN ARRAY ARRAY['public.quality_inspections', 'wardah_internal.qc_entry_markers_202',
        'wardah_internal.quality_inspection_authority_202', 'wardah_internal.quality_supersessions_202'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv)
           OR (v_priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(v_role, v_tbl, v_priv)) THEN
          RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % keeps % on %', v_role, v_priv, v_tbl;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'ok  service_role, anon and authenticated hold no table or column privilege on the four QC stores';
END $a$;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
  WHERE c.oid = 'public.quality_inspections'::regclass AND a.grantee = 0), 'no PUBLIC grant on quality_inspections');
SELECT pg_temp.role_denied('service_role', pg_temp.ins_sql(gen_random_uuid(), pg_temp.mo('A-DIRECT','quality_check'), gen_random_uuid(), 'A-1'),
  'permission denied', 'service_role direct INSERT is refused by privileges (F1)');
SELECT pg_temp.role_denied('service_role', 'UPDATE public.quality_inspections SET result = ''PASS''', 'permission denied', 'service_role UPDATE refused');
SELECT pg_temp.role_denied('service_role', 'DELETE FROM public.quality_inspections', 'permission denied', 'service_role DELETE refused');
SELECT pg_temp.role_denied('service_role', 'TRUNCATE public.quality_inspections', 'permission denied', 'service_role TRUNCATE refused');
SELECT pg_temp.role_denied('service_role', 'SELECT count(*) FROM public.quality_inspections', 'permission denied', 'service_role SELECT refused');
SELECT pg_temp.role_denied('service_role', 'INSERT INTO wardah_internal.qc_entry_markers_202(xid,backend_pid,org_id,mo_id,request_id,inspection_id) VALUES (pg_current_xact_id(),1,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())',
  'permission denied', 'service_role cannot write a marker');
SELECT pg_temp.role_denied('authenticated', 'INSERT INTO wardah_internal.quality_inspection_authority_202(inspection_id,org_id,authority_revision) VALUES (gen_random_uuid(),gen_random_uuid(),9)',
  'permission denied', 'authenticated cannot write an authority link');
SELECT pg_temp.role_denied('service_role', 'SELECT public.rpc_record_quality_inspection(gen_random_uuid(), gen_random_uuid(), ''{}''::jsonb)',
  'permission denied for function', 'service_role cannot execute the recording RPC');
SELECT pg_temp.role_denied('service_role', 'SELECT wardah_internal.qc_prepare_inspection_202(gen_random_uuid(), gen_random_uuid(), ''{}''::jsonb)',
  'permission denied', 'service_role cannot execute the prepare helper');
SELECT pg_temp.role_denied('authenticated', 'SELECT wardah_internal.qc_assert_closed_graph_202()', 'permission denied', 'authenticated cannot execute the graph assertion');
SELECT pg_temp.role_denied('anon', 'SELECT public.rpc_supersede_quality_evidence_202(gen_random_uuid(), ''FINAL'', NULL, 0, ''x'')',
  'permission denied for function', 'anon cannot supersede');
SELECT pg_temp.role_denied('service_role', 'SELECT public.rpc_supersede_quality_evidence_202(gen_random_uuid(), ''FINAL'', NULL, 0, ''x'')',
  'permission denied for function', 'service_role cannot supersede');

SELECT wardah_internal.qc_assert_closed_graph_202();
SELECT pg_temp.ok(true, 'the execution graph is closed on the migrated chain');
SELECT pg_temp.ok((SELECT NOT rolsuper AND NOT rolcanlogin AND NOT rolcreaterole AND NOT rolcreatedb
    AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL
  FROM pg_roles WHERE rolname = 'wardah_qc_entry_202'), 'entry role carries no attribute');
SELECT pg_temp.ok((SELECT count(*) FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass
    AND d.refobjid = 'wardah_qc_entry_202'::regrole AND d.deptype = 'o'
    AND d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))) = 1
  AND (SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'public.rpc_record_quality_inspection(uuid,uuid,jsonb)'::regprocedure) = 'wardah_qc_entry_202',
  'entry role owns exactly the recording RPC');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = 'wardah_qc_entry_202'::regrole OR m.member = 'wardah_qc_entry_202'::regrole),
  'entry role has no membership edge');
SELECT pg_temp.ok((SELECT count(*) FROM pg_trigger WHERE tgname = 'qc_write_guard_202' AND tgenabled = 'A' AND NOT tgisinternal) = 2,
  'the guard is ENABLE ALWAYS on both guarded stores');
SELECT pg_temp.ok(NOT has_parameter_privilege('service_role', 'session_replication_role', 'SET')
  AND NOT has_parameter_privilege('authenticated', 'session_replication_role', 'SET')
  AND NOT has_parameter_privilege('anon', 'session_replication_role', 'SET')
  AND NOT has_parameter_privilege('wardah_qc_entry_202', 'session_replication_role', 'SET'),
  'no client, server or entry role may SET session_replication_role');
SELECT pg_temp.ok((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.quality_inspections'::regclass
    AND tgname IN ('deny_history_truncate_193','deny_quality_inspection_change_199') AND tgenabled = 'O') = 2,
  'M193 truncate guard and M199 immutability trigger are untouched');

-- ============================================================ B. genuine path
INSERT INTO m VALUES ('g', pg_temp.mo('B-GENUINE'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='g'), 'hold'));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='g')) IS FALSE, 'gate closed before any inspection');
INSERT INTO r VALUES ('first', pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql(
  (SELECT id FROM m WHERE k='g'), 'ed000000-0000-4000-8000-00000000f101', pg_temp.final('PASS', 10, 0))));
SELECT pg_temp.ok((SELECT (v->>'replayed')::boolean IS FALSE AND (v #>> '{release,ready}')::boolean
    AND v->>'result' = 'PASS' AND (v->>'qc_cycle')::int = 1 FROM r WHERE k='first'),
  'the RPC records a FINAL PASS through the entry role and the release evaluates ready');
SELECT pg_temp.ok((SELECT qi.inspector_id = pg_temp.inspector() AND qi.inspection_seq IS NOT NULL
    AND qi.work_order_id IS NULL AND au.authority_revision = 0 AND au.org_id = qi.org_id
  FROM public.quality_inspections qi
  JOIN wardah_internal.quality_inspection_authority_202 au ON au.inspection_id = qi.id
  WHERE qi.id = (SELECT (v->>'inspection_id')::uuid FROM r WHERE k='first')),
  'actor, sequence and a protected authority link (revision 0) are server-assigned');
SELECT pg_temp.ok((SELECT count(*) FROM wardah_internal.qc_entry_markers_202) = 0, 'no marker survives the RPC');
SELECT pg_temp.ok((SELECT (metadata->>'authority_revision')::int = 0 FROM public.audit_logs
  WHERE action = 'manufacturing.quality_inspection.create'
    AND entity_id = (SELECT v->>'inspection_id' FROM r WHERE k='first')), 'the audit record carries the authority revision');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='g'),
  'ed000000-0000-4000-8000-00000000f101', pg_temp.final('PASS', 10, 0))) ->> 'replayed')::boolean,
  'the same request replays');
SELECT pg_temp.ok((SELECT count(*) FROM public.quality_inspections WHERE mo_id = (SELECT id FROM m WHERE k='g')) = 1
  AND (SELECT count(*) FROM wardah_internal.qc_entry_markers_202) = 0, 'replay wrote nothing and left no marker');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='g'),
  'ed000000-0000-4000-8000-00000000f101', pg_temp.final('PASS', 9, 1, 'scrap')), 'QUALITY_REQUEST_ID_REUSED',
  'a reused request id with another payload is refused');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='g'), gen_random_uuid(),
  pg_temp.final('PASS', 8, 2)), 'QUALITY_DISPOSITION_REQUIRED', 'M199 validation is preserved');
SELECT pg_temp.denied(pg_temp.outsider(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='g'), gen_random_uuid(),
  pg_temp.final('PASS', 10, 0)), 'NOT_ORG_MEMBER', 'another tenant cannot record');
SELECT pg_temp.denied(pg_temp.inspector(), format('SELECT to_jsonb(count(*)) FROM public.quality_inspections'),
  'permission denied', 'the client cannot read the table directly');
SELECT pg_temp.ok((SELECT count(*) FROM wardah_internal.qc_entry_markers_202) = 0
  AND (SELECT count(*) FROM public.quality_inspections WHERE mo_id = (SELECT id FROM m WHERE k='g')) = 1,
  'refused calls leave no row and no marker');

-- ============================================== C. forgery attempts and mutants
-- Helpers: apply a mutation, attempt something, require the outcome, roll back.
CREATE FUNCTION pg_temp.mutated_forge(p_label text, p_setup text, p_role text, p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_setup;
    v := pg_temp.try_role(p_role, p_sql);
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = v::text;
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF position(p_expect IN v_msg) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected % got %', p_label, p_expect, v_msg;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;
CREATE FUNCTION pg_temp.mutated_rpc(p_label text, p_setup text, p_uid uuid, p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_setup;
    v := pg_temp.try_as(p_uid, p_sql);
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = v::text;
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF position(p_expect IN v_msg) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected % got %', p_label, p_expect, v_msg;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;

-- Entry-role flow: marker (optionally corrupted) then the inspection INSERT.
CREATE FUNCTION pg_temp.flow_sql(p_id uuid, p_mo uuid, p_req uuid, p_number text,
  p_m_id uuid DEFAULT NULL, p_m_org uuid DEFAULT NULL, p_m_mo uuid DEFAULT NULL,
  p_m_req uuid DEFAULT NULL, p_xid_off bigint DEFAULT 0, p_pid_off integer DEFAULT 0) RETURNS text
LANGUAGE sql AS $fn$
  SELECT format($q$INSERT INTO wardah_internal.qc_entry_markers_202(xid, backend_pid, org_id, mo_id, request_id, inspection_id)
    VALUES ((pg_current_xact_id()::text::bigint + %s)::text::xid8, pg_backend_pid() + %s, %L, %L, %L, %L);
    %s$q$, p_xid_off, p_pid_off, COALESCE(p_m_org, pg_temp.org()), COALESCE(p_m_mo, p_mo),
    COALESCE(p_m_req, p_req), COALESCE(p_m_id, p_id), pg_temp.ins_sql(p_id, p_mo, p_req, p_number)) $fn$;

-- A realistic connection: a non-superuser session user (as Supabase's authenticator)
-- that may switch only to the API roles it is a member of. SET ROLE is checked
-- against the SESSION user, so the plain try_role harness (superuser session)
-- cannot answer "may this credential reach the entry role?".
CREATE ROLE zz_authenticator NOLOGIN;
GRANT service_role, authenticated, anon TO zz_authenticator;
CREATE FUNCTION pg_temp.try_connected(p_role text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    SET LOCAL SESSION AUTHORIZATION zz_authenticator;
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    RESET SESSION AUTHORIZATION;
    RETURN jsonb_build_object('ok', true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN jsonb_build_object('ok', false, 'sqlstate', v_state, 'error', v_msg);
  END;
END $fn$;
CREATE FUNCTION pg_temp.mutated_connected(p_label text, p_setup text, p_role text, p_sql text, p_expect text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_setup;
    v := pg_temp.try_connected(p_role, p_sql);
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = v::text;
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF position(p_expect IN v_msg) = 0 THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected % got %', p_label, p_expect, v_msg;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;

INSERT INTO m VALUES ('c', pg_temp.mo('C-FORGE', 'quality_check'));
CREATE TEMP TABLE c_ids(id uuid, req uuid) ON COMMIT DROP;
INSERT INTO c_ids VALUES (gen_random_uuid(), gen_random_uuid());

-- C1. Provenance is by execution role, not by owner: the owner/superuser is refused too.
SELECT pg_temp.forge_denied('postgres', pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-OWNER'),
  'QC_WRITE_PROVENANCE_REQUIRED_202', 'owner/superuser direct INSERT');
-- C2. Same-owner forger: a postgres-owned SECURITY DEFINER that service_role can call.
CREATE FUNCTION public.zz_forge(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$
BEGIN EXECUTE p_sql; END $f$;
GRANT EXECUTE ON FUNCTION public.zz_forge(text) TO service_role;
SELECT pg_temp.forge_denied('service_role', format('SELECT public.zz_forge(%L)',
  pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-SAMEOWNER')),
  'QC_WRITE_PROVENANCE_REQUIRED_202', 'same-owner (postgres) forger reached through service_role');
SELECT pg_temp.forge_denied('service_role', format('SELECT public.zz_forge(%L)',
  pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-SAMEOWNER2')),
  'QC_WRITE_PROVENANCE_REQUIRED_202', 'same-owner forger that also writes a valid-looking marker');
-- C3. Different-owner forger without and with every privilege.
CREATE ROLE zz_forger NOLOGIN;
GRANT CREATE ON SCHEMA public TO zz_forger;
DO $d$ BEGIN
  SET LOCAL ROLE zz_forger;
  CREATE FUNCTION public.zz_f3(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$
  BEGIN EXECUTE p_sql; END $f$;
  RESET ROLE;
END $d$;
GRANT EXECUTE ON FUNCTION public.zz_f3(text) TO service_role;
SELECT pg_temp.forge_denied('service_role', format('SELECT public.zz_f3(%L)',
  pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-DIFFOWNER')),
  'permission denied', 'different-owner forger without privileges');
SELECT pg_temp.mutated_forge('different-owner forger given INSERT and BYPASSRLS is still refused by the guard',
  'GRANT INSERT ON public.quality_inspections TO zz_forger; ALTER ROLE zz_forger BYPASSRLS',
  'service_role', format('SELECT public.zz_f3(%L)',
    pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-DIFFOWNER2')),
  'QC_WRITE_PROVENANCE_REQUIRED_202');
SELECT pg_temp.mutant('different-owner forger holding INSERT is an open direct-write path',
  'GRANT INSERT ON public.quality_inspections TO zz_forger', 'DIRECT_WRITE_PATH zz_forger INSERT');
-- C4. Same-owner forger: a rogue function owned by the entry role itself.
CREATE FUNCTION public.zz_rogue(p_mo uuid, p_org uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE v uuid := gen_random_uuid(); r uuid := gen_random_uuid();
BEGIN
  INSERT INTO wardah_internal.qc_entry_markers_202(xid, backend_pid, org_id, mo_id, request_id, inspection_id)
  VALUES (pg_current_xact_id(), pg_backend_pid(), p_org, p_mo, r, v);
  INSERT INTO public.quality_inspections(id, org_id, mo_id, inspection_number, inspection_type,
    passed_quantity, failed_quantity, result, qc_cycle, inspection_seq, request_id, request_hash)
  VALUES (v, p_org, p_mo, 'ROGUE-1', 'FINAL', 10, 0, 'PASS', 1, 999, r, 'rogue');
  DELETE FROM wardah_internal.qc_entry_markers_202 WHERE inspection_id = v;
END $f$;
GRANT EXECUTE ON FUNCTION public.zz_rogue(uuid, uuid) TO service_role;
SELECT pg_temp.forge_denied('service_role', format('SELECT public.zz_rogue(%L, %L)', (SELECT id FROM m WHERE k='c'), pg_temp.org()),
  'QC_WRITE_PROVENANCE_REQUIRED_202', 'control: a rogue function owned by postgres is refused by the guard');
SELECT pg_temp.mutated_forge('rogue function owned by the entry role is stopped by the closed-graph guard',
  'ALTER FUNCTION public.zz_rogue(uuid, uuid) OWNER TO wardah_qc_entry_202',
  'service_role', format('SELECT public.zz_rogue(%L, %L)', (SELECT id FROM m WHERE k='c'), pg_temp.org()),
  'QC_EXECUTION_GRAPH_OPEN_202: OWNED_OBJECTS');
SELECT pg_temp.mutated_forge('non-vacuity: with the guard trigger disabled the same rogue forgery succeeds',
  'ALTER FUNCTION public.zz_rogue(uuid, uuid) OWNER TO wardah_qc_entry_202; ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202',
  'service_role', format('SELECT public.zz_rogue(%L, %L)', (SELECT id FROM m WHERE k='c'), pg_temp.org()),
  '"ok": true');
-- C5. Marker forging: no grants, and GUC state means nothing.
SELECT pg_temp.forge_denied('service_role', 'SELECT set_config(''wardah.qc_entry_marker'', ''1'', true); SELECT set_config(''wardah.qc_entry_context'', ''qc'', true); '
  || pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-GUC'),
  'permission denied', 'client-set GUC markers authorise nothing');
SELECT pg_temp.forge_denied('authenticated', pg_temp.flow_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-MARKER'),
  'permission denied', 'authenticated cannot forge a marker');
-- C6. The entry role itself: marker must match the row, the transaction and the backend.
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-NOMARKER'),
  'QC_WRITE_MARKER_REQUIRED_202', 'entry role without a marker');
SELECT pg_temp.mutated_forge('non-vacuity: a valid marker and row from the entry role is accepted', 'SELECT 1',
  'wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-VALID'),
  '"ok": true');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-XID', p_xid_off => -1),
  'QC_WRITE_MARKER_REQUIRED_202', 'marker from another transaction (xid8)');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-PID', p_pid_off => 1),
  'QC_WRITE_MARKER_REQUIRED_202', 'marker from another backend');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-MID', p_m_id => gen_random_uuid()),
  'QC_WRITE_MARKER_REQUIRED_202', 'marker for another inspection id');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-MORG', p_m_org => pg_temp.org2()),
  'QC_WRITE_MARKER_REQUIRED_202', 'marker for another organization');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-MMO', p_m_mo => gen_random_uuid()),
  'QC_WRITE_MARKER_REQUIRED_202', 'marker for another manufacturing order');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-MREQ', p_m_req => gen_random_uuid()),
  'QC_WRITE_MARKER_REQUIRED_202', 'marker for another request');
SELECT pg_temp.forge_denied('wardah_qc_entry_202', 'INSERT INTO wardah_internal.quality_inspection_authority_202(inspection_id, org_id, authority_revision) VALUES (gen_random_uuid(), '
  || quote_literal(pg_temp.org()) || ', 7)', 'QC_WRITE_MARKER_REQUIRED_202', 'entry role cannot write an authority link without a marker');
-- The orphan check: a marker that survives to COMMIT is refused (forced early here).
SELECT pg_temp.forge_denied('wardah_qc_entry_202', format($q$INSERT INTO wardah_internal.qc_entry_markers_202(xid, backend_pid, org_id, mo_id, request_id, inspection_id)
    VALUES (pg_current_xact_id(), pg_backend_pid(), %L, %L, gen_random_uuid(), gen_random_uuid());
    SET CONSTRAINTS ALL IMMEDIATE$q$, pg_temp.org(), (SELECT id FROM m WHERE k='c')),
  'QC_MARKER_ORPHAN_202', 'a marker that is not removed is refused at commit');
SELECT pg_temp.mutated_forge('control: a marker removed before commit passes the check',
  'SELECT 1', 'wardah_qc_entry_202', format($q$INSERT INTO wardah_internal.qc_entry_markers_202(xid, backend_pid, org_id, mo_id, request_id, inspection_id)
    VALUES (pg_current_xact_id(), pg_backend_pid(), %L, %L, '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000bb');
    DELETE FROM wardah_internal.qc_entry_markers_202 WHERE inspection_id = '00000000-0000-4000-8000-0000000000bb';
    SET CONSTRAINTS ALL IMMEDIATE$q$, pg_temp.org(), (SELECT id FROM m WHERE k='c')),
  '"ok": true');
-- SET CONSTRAINTS is not undone by the probes' subtransaction rollback; restore the default.
SET CONSTRAINTS ALL DEFERRED;
-- C7. Nested execution: the INSERT must come straight from the RPC statement.
SELECT pg_temp.mutated_forge('an INSERT issued from inside another trigger is refused (trigger depth)',
  $s$CREATE TABLE public.zz_nest(x int);
     GRANT INSERT ON public.zz_nest TO wardah_qc_entry_202;
     CREATE FUNCTION public.zz_nest_trg() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN
         INSERT INTO public.quality_inspections(id, org_id, mo_id, inspection_number, inspection_type,
           passed_quantity, failed_quantity, result, qc_cycle, inspection_seq, request_id, request_hash)
         SELECT m.inspection_id, m.org_id, m.mo_id, 'NESTED-1', 'FINAL', 10, 0, 'PASS', 1, 999, m.request_id, 'nested'
         FROM wardah_internal.qc_entry_markers_202 m WHERE m.xid = pg_current_xact_id();
         RETURN NULL;
       END $f$;
     CREATE TRIGGER zz_nest AFTER INSERT ON public.zz_nest FOR EACH ROW EXECUTE FUNCTION public.zz_nest_trg();$s$,
  'wardah_qc_entry_202', format($q$INSERT INTO wardah_internal.qc_entry_markers_202(xid, backend_pid, org_id, mo_id, request_id, inspection_id)
    VALUES (pg_current_xact_id(), pg_backend_pid(), %L, %L, gen_random_uuid(), gen_random_uuid());
    INSERT INTO public.zz_nest VALUES (1)$q$, pg_temp.org(), (SELECT id FROM m WHERE k='c')),
  'QC_WRITE_NESTED_202');
-- A different-owner INVOKER trigger that would forge during the genuine RPC.
SELECT pg_temp.mutated_rpc('an extra trigger that forges from inside the genuine RPC cannot produce evidence',
  $s$CREATE FUNCTION public.zz_inv_trg() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN
         INSERT INTO public.quality_inspections(id, org_id, mo_id, inspection_number, inspection_type,
           passed_quantity, failed_quantity, result, qc_cycle, inspection_seq, request_id, request_hash)
         VALUES (gen_random_uuid(), NEW.org_id, NEW.mo_id, 'INV-FORGE', 'FINAL', 10, 0, 'PASS', 1, 999, gen_random_uuid(), 'inv');
         RETURN NULL;
       END $f$;
     CREATE TRIGGER zz_inv AFTER INSERT ON wardah_internal.qc_entry_markers_202
       FOR EACH ROW EXECUTE FUNCTION public.zz_inv_trg();$s$,
  pg_temp.inspector(), pg_temp.inspect_sql((SELECT id FROM m WHERE k='c'), gen_random_uuid(), pg_temp.final('PASS', 10, 0)),
  'QC_WRITE_NESTED_202');
-- C8. session_replication_role.
DO $a$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['service_role','authenticated','anon','wardah_qc_entry_202'] LOOP
    PERFORM pg_temp.role_denied(v_role, 'SET LOCAL session_replication_role = replica', 'permission denied', v_role || ' SET session_replication_role');
    PERFORM pg_temp.role_denied(v_role, 'SELECT set_config(''session_replication_role'', ''replica'', true)', 'permission denied', v_role || ' set_config session_replication_role');
    PERFORM pg_temp.role_denied(v_role, 'SET session_replication_role = replica', 'permission denied', v_role || ' session-level SET session_replication_role');
  END LOOP;
END $a$;
SELECT pg_temp.ok(current_setting('session_replication_role') = 'origin', 'every probe left session_replication_role at origin');
SELECT pg_temp.mutated_forge('replica mode does not skip the guard (ENABLE ALWAYS)', 'SET LOCAL session_replication_role = replica',
  'postgres', pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-REPLICA'),
  'QC_WRITE_PROVENANCE_REQUIRED_202');
SELECT pg_temp.mutated_forge('entry role in replica mode is refused', 'SET LOCAL session_replication_role = replica',
  'wardah_qc_entry_202', pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-REPLICA2'),
  'QC_WRITE_REPLICA_MODE_202');
SELECT pg_temp.mutated_forge('non-vacuity: an ORIGIN-only guard is skipped in replica mode',
  'ALTER TABLE public.quality_inspections ENABLE TRIGGER qc_write_guard_202; SET LOCAL session_replication_role = replica',
  'postgres', pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-REPLICA3'),
  '"ok": true');
SELECT pg_temp.mutant('an ORIGIN-only guard fails the closed graph', 'ALTER TABLE public.quality_inspections ENABLE TRIGGER qc_write_guard_202', 'INSERT_TRIGGERS');
SELECT pg_temp.mutant('GRANT SET ON PARAMETER session_replication_role to service_role',
  'GRANT SET ON PARAMETER session_replication_role TO service_role', 'SESSION_REPLICATION_ROLE');
SELECT pg_temp.mutant('GRANT SET ON PARAMETER reaches the role through membership',
  'CREATE ROLE zz_param NOLOGIN; GRANT SET ON PARAMETER session_replication_role TO zz_param; GRANT zz_param TO authenticated',
  'SESSION_REPLICATION_ROLE');
-- C9. Direct-write paths: table, inherited and column grants.
SELECT pg_temp.mutant('table-level grant to service_role restored', 'GRANT ALL ON public.quality_inspections TO service_role', 'DIRECT_WRITE_PATH');
SELECT pg_temp.mutated_forge('with the grant restored the guard still refuses service_role (defence in depth)',
  'GRANT ALL ON public.quality_inspections TO service_role', 'service_role',
  pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-REGRANT'), 'QC_WRITE_PROVENANCE_REQUIRED_202');
SELECT pg_temp.mutated_forge('non-vacuity: with the grant restored AND the guard disabled the forgery succeeds',
  'GRANT ALL ON public.quality_inspections TO service_role; ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202',
  'service_role', pg_temp.ins_sql(gen_random_uuid(), (SELECT id FROM m WHERE k='c'), gen_random_uuid(), 'C-NOGUARD'), '"ok": true');
SELECT pg_temp.mutant('inherited grant through a bridge role',
  'CREATE ROLE zz_bridge NOLOGIN; GRANT INSERT ON public.quality_inspections TO zz_bridge; GRANT zz_bridge TO service_role', 'DIRECT_WRITE_PATH');
SELECT pg_temp.mutant('column-level INSERT for service_role', 'GRANT INSERT (org_id) ON public.quality_inspections TO service_role', 'DIRECT_WRITE_PATH');
SELECT pg_temp.mutant('column-level UPDATE for service_role', 'GRANT UPDATE (result) ON public.quality_inspections TO service_role', 'DIRECT_WRITE_PATH');
SELECT pg_temp.mutant('authenticated may INSERT an authority link', 'GRANT INSERT ON wardah_internal.quality_inspection_authority_202 TO authenticated', 'DIRECT_WRITE_PATH');
SELECT pg_temp.mutant('PUBLIC may INSERT markers', 'GRANT INSERT ON wardah_internal.qc_entry_markers_202 TO PUBLIC', 'DIRECT_WRITE_PATH');
SELECT pg_temp.mutant('authenticated may UPDATE supersessions', 'GRANT UPDATE ON wardah_internal.quality_supersessions_202 TO authenticated', 'DIRECT_WRITE_PATH');
-- C10. Membership edges.
SELECT pg_temp.mutated_connected('a service_role connection cannot SET ROLE to the entry role', 'SELECT 1',
  'service_role', 'SET LOCAL ROLE wardah_qc_entry_202', 'permission denied');
SELECT pg_temp.mutated_connected('an authenticated connection cannot SET ROLE to the entry role', 'SELECT 1',
  'authenticated', 'SET LOCAL ROLE wardah_qc_entry_202', 'permission denied');
SELECT pg_temp.mutant('service_role is a member of the entry role', 'GRANT wardah_qc_entry_202 TO service_role', 'MEMBERSHIP');
SELECT pg_temp.mutated_connected('a member that switches to the entry role and writes a valid marker is stopped by the closed graph',
  'GRANT wardah_qc_entry_202 TO service_role', 'service_role',
  'SET LOCAL ROLE wardah_qc_entry_202; ' || pg_temp.flow_sql((SELECT id FROM c_ids), (SELECT id FROM m WHERE k='c'), (SELECT req FROM c_ids), 'C-MEMBER'),
  'QC_EXECUTION_GRAPH_OPEN_202: MEMBERSHIP');
SELECT pg_temp.mutant('an ADMIN-only grant to service_role is still a membership edge',
  'GRANT wardah_qc_entry_202 TO service_role WITH ADMIN OPTION, SET FALSE, INHERIT FALSE', 'MEMBERSHIP');
SELECT pg_temp.mutant('a SET-only grant to the table owner is a membership edge',
  'GRANT wardah_qc_entry_202 TO postgres WITH SET TRUE, INHERIT FALSE', 'MEMBERSHIP');
SELECT pg_temp.mutant('non-vacuity: the creator-style ADMIN-only row of the table owner is the one tolerated edge',
  'GRANT wardah_qc_entry_202 TO postgres WITH ADMIN OPTION, SET FALSE, INHERIT FALSE', '<assertion passed>');
SELECT pg_temp.mutant('the entry role is a member of another role', 'GRANT authenticated TO wardah_qc_entry_202', 'MEMBERSHIP');
-- C11. Role attributes, settings, ownership and ACL set.
SELECT pg_temp.mutant('entry role may LOGIN', 'ALTER ROLE wardah_qc_entry_202 LOGIN', 'ROLE_ATTRIBUTES');
SELECT pg_temp.mutant('entry role BYPASSRLS', 'ALTER ROLE wardah_qc_entry_202 BYPASSRLS', 'ROLE_ATTRIBUTES');
SELECT pg_temp.mutant('entry role CREATEROLE', 'ALTER ROLE wardah_qc_entry_202 CREATEROLE', 'ROLE_ATTRIBUTES');
SELECT pg_temp.mutant('entry role SUPERUSER', 'ALTER ROLE wardah_qc_entry_202 SUPERUSER', 'ROLE_ATTRIBUTES');
SELECT pg_temp.mutant('entry role carries a role-level setting', 'ALTER ROLE wardah_qc_entry_202 SET search_path = public', 'ROLE_ATTRIBUTES');
SELECT pg_temp.mutant('entry role carries a per-database setting',
  format('ALTER ROLE wardah_qc_entry_202 IN DATABASE %I SET work_mem = ''4MB''', current_database()), 'ROLE_SETTINGS');
SELECT pg_temp.mutant('the entry role owns a second object', 'CREATE TABLE public.zz_t(); ALTER TABLE public.zz_t OWNER TO wardah_qc_entry_202', 'OWNED_OBJECTS');
SELECT pg_temp.mutant('the recording RPC loses its owner', 'ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) OWNER TO postgres', 'OWNED_OBJECTS');
SELECT pg_temp.mutant('entry role may read manufacturing orders', 'GRANT SELECT ON public.manufacturing_orders TO wardah_qc_entry_202', 'ENTRY_ACL_SET');
SELECT pg_temp.mutant('entry role column privilege elsewhere', 'GRANT SELECT (id) ON public.manufacturing_orders TO wardah_qc_entry_202', 'ENTRY_ACL_SET');
SELECT pg_temp.mutant('entry role may CREATE in public', 'GRANT CREATE ON SCHEMA public TO wardah_qc_entry_202', 'ENTRY_ACL_SET');
SELECT pg_temp.mutant('default privileges grant to the entry role', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO wardah_qc_entry_202', 'ENTRY_ACL_SET');
SELECT pg_temp.mutant('entry role loses the membership assertion it needs', 'REVOKE EXECUTE ON FUNCTION public.wardah_assert_org_member(uuid) FROM wardah_qc_entry_202', 'ENTRY_ACL_SET');
SELECT pg_temp.mutant('entry role may execute another public function', 'GRANT EXECUTE ON FUNCTION public.has_permission(uuid,uuid,character varying) TO wardah_qc_entry_202', 'ENTRY_ACL_SET');
SELECT pg_temp.mutant('entry role may UPDATE quality_inspections', 'GRANT UPDATE ON public.quality_inspections TO wardah_qc_entry_202', 'ENTRY_TABLE_PRIVILEGES');
SELECT pg_temp.mutant('entry role may DELETE quality_inspections', 'GRANT DELETE ON public.quality_inspections TO wardah_qc_entry_202', 'ENTRY_TABLE_PRIVILEGES');
SELECT pg_temp.mutant('entry role may UPDATE markers', 'GRANT UPDATE ON wardah_internal.qc_entry_markers_202 TO wardah_qc_entry_202', 'ENTRY_TABLE_PRIVILEGES');
-- C12. Triggers, hidden routines, RLS and policies.
SELECT pg_temp.mutant('guard trigger disabled', 'ALTER TABLE public.quality_inspections DISABLE TRIGGER qc_write_guard_202', 'INSERT_TRIGGERS');
SELECT pg_temp.mutant('guard trigger dropped from the authority link', 'DROP TRIGGER qc_write_guard_202 ON wardah_internal.quality_inspection_authority_202', 'INSERT_TRIGGERS');
SELECT pg_temp.mutant('a second INSERT trigger on quality_inspections',
  'CREATE FUNCTION public.zz_t1() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$; CREATE TRIGGER zz_t1 BEFORE INSERT ON public.quality_inspections FOR EACH ROW EXECUTE FUNCTION public.zz_t1()',
  'INSERT_TRIGGERS');
SELECT pg_temp.mutant('a second INSERT trigger on the authority link',
  'CREATE FUNCTION public.zz_t2() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$; CREATE TRIGGER zz_t2 AFTER INSERT ON wardah_internal.quality_inspection_authority_202 FOR EACH ROW EXECUTE FUNCTION public.zz_t2()',
  'INSERT_TRIGGERS');
SELECT pg_temp.mutant('an extra trigger on the marker table',
  'CREATE FUNCTION public.zz_t3() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$; CREATE TRIGGER zz_t3 AFTER INSERT ON wardah_internal.qc_entry_markers_202 FOR EACH ROW EXECUTE FUNCTION public.zz_t3()',
  'MARKER_TRIGGERS');
SELECT pg_temp.mutant('the orphan-marker check is dropped', 'DROP TRIGGER qc_marker_orphan_check_202 ON wardah_internal.qc_entry_markers_202', 'MARKER_TRIGGERS');
SELECT pg_temp.mutant('hidden routine in a column default',
  'CREATE FUNCTION public.zz_def() RETURNS text LANGUAGE sql AS $f$ SELECT 1::text $f$; ALTER TABLE public.quality_inspections ALTER COLUMN specifications SET DEFAULT public.zz_def()',
  'HIDDEN_ROUTINE');
SELECT pg_temp.mutant('hidden routine in a CHECK constraint',
  'CREATE FUNCTION public.zz_chk() RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$; ALTER TABLE public.quality_inspections ADD CONSTRAINT zz_chk CHECK (public.zz_chk())',
  'HIDDEN_ROUTINE');
SELECT pg_temp.mutant('hidden routine in an index expression',
  'CREATE FUNCTION public.zz_idx(text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT $1 $f$; CREATE INDEX zz_idx ON public.quality_inspections (public.zz_idx(request_hash))',
  'HIDDEN_ROUTINE');
SELECT pg_temp.mutant('row-level security disabled', 'ALTER TABLE public.quality_inspections DISABLE ROW LEVEL SECURITY', 'POLICIES');
SELECT pg_temp.mutant('another permissive INSERT policy', 'CREATE POLICY zz_any ON public.quality_inspections FOR INSERT TO PUBLIC WITH CHECK (true)', 'POLICIES');
SELECT pg_temp.mutant('the entry role policy is dropped', 'DROP POLICY quality_inspections_entry_insert_202 ON public.quality_inspections', 'POLICIES');
-- C13. Pinned code, properties and ACLs.
SELECT pg_temp.mutant('recording RPC body replaced',
  $s$DO $d$ DECLARE d text := pg_get_functiondef('public.rpc_record_quality_inspection(uuid,uuid,jsonb)'::regprocedure);
     BEGIN EXECUTE replace(d, E'\nBEGIN\n', E'\nBEGIN\n  NULL;\n'); END $d$$s$, 'FUNCTION_PIN');
SELECT pg_temp.mutant('prepare helper body replaced',
  $s$DO $d$ DECLARE d text := pg_get_functiondef('wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb)'::regprocedure);
     BEGIN EXECUTE replace(d, E'\nBEGIN\n', E'\nBEGIN\n  NULL;\n'); END $d$$s$, 'FUNCTION_PIN');
SELECT pg_temp.mutant('evaluation body replaced',
  $s$DO $d$ DECLARE d text := pg_get_functiondef('wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)'::regprocedure);
     BEGIN EXECUTE replace(d, E'\nBEGIN\n', E'\nBEGIN\n  NULL;\n'); END $d$$s$, 'FUNCTION_PIN');
SELECT pg_temp.mutant('guard body replaced',
  $s$DO $d$ DECLARE d text := pg_get_functiondef('wardah_internal.qc_write_guard_202()'::regprocedure);
     BEGIN EXECUTE replace(d, E'\nBEGIN\n', E'\nBEGIN\n  RETURN NEW;\n'); END $d$$s$, 'FUNCTION_PIN');
SELECT pg_temp.mutant('recording RPC search_path loosened',
  'ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) SET search_path = public', 'FUNCTION_PIN');
SELECT pg_temp.mutant('prepare helper becomes SECURITY INVOKER',
  'ALTER FUNCTION wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb) SECURITY INVOKER', 'FUNCTION_PIN');
SELECT pg_temp.mutant('service_role may execute the recording RPC',
  'GRANT EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) TO service_role', 'RPC_ACL');
SELECT pg_temp.mutant('PUBLIC may execute the recording RPC',
  'GRANT EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) TO PUBLIC', 'RPC_ACL');
SELECT pg_temp.mutant('authenticated loses the recording RPC',
  'REVOKE EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) FROM authenticated', 'RPC_ACL');
SELECT pg_temp.mutant('authenticated may execute the prepare helper',
  'GRANT EXECUTE ON FUNCTION wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb) TO authenticated', 'HELPER_ACL');
SELECT pg_temp.mutant('service_role may execute the graph assertion',
  'GRANT EXECUTE ON FUNCTION wardah_internal.qc_assert_closed_graph_202() TO service_role', 'HELPER_ACL');
SELECT pg_temp.mutant('PUBLIC may execute the evaluation helper',
  'GRANT EXECUTE ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric) TO PUBLIC', 'HELPER_ACL');
-- C14. Guard failures leave nothing behind: the whole RPC call rolls back.
SELECT pg_temp.mutated_rpc('a closed-graph failure aborts the genuine RPC with no row, marker or audit',
  'GRANT SELECT ON public.manufacturing_orders TO wardah_qc_entry_202', pg_temp.inspector(),
  pg_temp.inspect_sql((SELECT id FROM m WHERE k='c'), gen_random_uuid(), pg_temp.final('PASS', 10, 0)),
  'QC_EXECUTION_GRAPH_OPEN_202: ENTRY_ACL_SET');
SELECT pg_temp.ok((SELECT count(*) FROM wardah_internal.qc_entry_markers_202) = 0
  AND NOT EXISTS (SELECT 1 FROM public.quality_inspections WHERE mo_id = (SELECT id FROM m WHERE k='c')),
  'all forgery attempts and mutants left no row and no marker');
SELECT wardah_internal.qc_assert_closed_graph_202();
SELECT pg_temp.ok(true, 'the execution graph is still closed after every mutant was rolled back');

-- ================================================ D. NULL ordering, supersession
CREATE FUNCTION pg_temp.legacy_link(p_inspection uuid, p_org uuid, p_rev integer) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  ALTER TABLE wardah_internal.quality_inspection_authority_202 DISABLE TRIGGER qc_write_guard_202;
  INSERT INTO wardah_internal.quality_inspection_authority_202(inspection_id, org_id, authority_revision)
  VALUES (p_inspection, p_org, p_rev);
  ALTER TABLE wardah_internal.quality_inspection_authority_202 ENABLE ALWAYS TRIGGER qc_write_guard_202;
END $fn$;
CREATE FUNCTION pg_temp.record(p_mo uuid, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.inspect_sql(p_mo, gen_random_uuid(), p_payload)) $fn$;
CREATE FUNCTION pg_temp.revision_of(p_inspection uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT authority_revision FROM wardah_internal.quality_inspection_authority_202 WHERE inspection_id = p_inspection $$;

-- D1. NULL sequence: a genuine FAIL is no longer shadowed (RED2 closed).
INSERT INTO m VALUES ('nul', pg_temp.mo('D-NULL'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='nul'), 'hold'));
SELECT pg_temp.legacy_row((SELECT id FROM m WHERE k='nul'), 'D-NULL-F', 'FINAL', NULL, 1, NULL, 'PASS', 10, 0);
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='nul')) IS TRUE,
  'D1 a legacy NULL-sequence PASS is evidence when it is the only evidence (compatible at revision 0)');
SELECT pg_temp.record((SELECT id FROM m WHERE k='nul'), pg_temp.final('FAIL', 0, 10, 'scrap', 'reject lot'));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='nul')) IS FALSE
  AND pg_temp.reason((SELECT id FROM m WHERE k='nul')) = 'QUALITY_RELEASE_REJECTED',
  'D1 NULLS LAST: the genuine FAIL is selected over the NULL-sequence PASS');
SELECT pg_temp.ok((SELECT result FROM public.quality_inspections WHERE id =
  (pg_temp.release((SELECT id FROM m WHERE k='nul')) #>> '{final_inspection,id}')::uuid) = 'FAIL',
  'D1 the selected FINAL is the FAIL');

-- D2. High sequence + append-only supersession (RED3 closed without deleting history).
INSERT INTO m VALUES ('hi', pg_temp.mo('D-HIGH'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='hi'), 'hold'));
INSERT INTO r VALUES ('forged_hi', to_jsonb(pg_temp.legacy_row((SELECT id FROM m WHERE k='hi'), 'D-HIGH-F', 'FINAL', NULL, 1, 999, 'PASS', 10, 0)));
INSERT INTO r VALUES ('fail_hi', pg_temp.record((SELECT id FROM m WHERE k='hi'), pg_temp.final('FAIL', 0, 10, 'scrap', 'reject lot')));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='hi')) IS TRUE,
  'D2 within revision 0 a high forged sequence still shadows (the documented pre-supersession limit)');
SELECT pg_temp.denied(pg_temp.inspector(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 0, 'x'),
  'QUALITY_SUPERSEDE_ADMIN_REQUIRED', 'D2 an inspector cannot supersede');
SELECT pg_temp.denied(pg_temp.keyholder(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 0, 'x'),
  'QUALITY_SUPERSEDE_ADMIN_REQUIRED', 'D2 the delegated manufacturing.settings.update key does not delegate supersession');
INSERT INTO r VALUES ('sup1', pg_temp.as_user(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 0,
  'sequence 999 row was not produced by an inspection RPC')));
SELECT pg_temp.ok((SELECT (v->>'revision')::int = 1 AND jsonb_array_length(v->'superseded_inspection_ids') = 2
    AND (v #>> '{release,ready}')::boolean IS FALSE AND v #>> '{release,reason}' = 'QUALITY_RELEASE_REQUIRED'
  FROM r WHERE k='sup1'), 'D2 supersession raises FINAL to revision 1 and closes the gate until genuine re-inspection');
SELECT pg_temp.ok((SELECT count(*) FROM public.quality_inspections WHERE mo_id = (SELECT id FROM m WHERE k='hi')) = 2,
  'D2 no inspection was deleted or rewritten');
SELECT pg_temp.ok((SELECT count(*) FROM public.audit_logs WHERE action = 'manufacturing.quality_evidence.supersede'
  AND entity_id = (SELECT id::text FROM m WHERE k='hi') AND new_data->>'reason' LIKE 'sequence 999%') = 1,
  'D2 the supersession is audited with its reason');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 0, 'again'),
  'QUALITY_SUPERSESSION_REVISION_CONFLICT', 'D2 a stale expected revision is refused');
SELECT pg_temp.record((SELECT id FROM m WHERE k='hi'), pg_temp.final('FAIL', 0, 10, 'scrap', 'reject lot again'));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='hi')) IS FALSE
  AND pg_temp.reason((SELECT id FROM m WHERE k='hi')) = 'QUALITY_RELEASE_REJECTED',
  'D2 a genuine FAIL at revision 1 is selected (the forged 999 PASS is ignored)');
INSERT INTO r VALUES ('pass_hi', pg_temp.record((SELECT id FROM m WHERE k='hi'), pg_temp.final('PASS', 10, 0)));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='hi')) IS TRUE
  AND (pg_temp.release((SELECT id FROM m WHERE k='hi')) #>> '{final_inspection,id}')::uuid = (SELECT (v->>'inspection_id')::uuid FROM r WHERE k='pass_hi')
  AND (pg_temp.release((SELECT id FROM m WHERE k='hi')) ->> 'authority_revision')::int = 1,
  'D2 a genuine PASS at revision 1 releases, and it is the selected evidence');
SELECT pg_temp.ok(pg_temp.revision_of((SELECT (v->>'inspection_id')::uuid FROM r WHERE k='pass_hi')) = 1
  AND pg_temp.revision_of((SELECT (v->>'inspection_id')::uuid FROM r WHERE k='fail_hi')) = 0,
  'D2 new evidence joins revision 1; the earlier genuine row stays at revision 0');
SELECT pg_temp.ok((SELECT bool_and((e->>'superseded')::boolean = (e->>'authority_revision' = '0'))
    FROM jsonb_array_elements(pg_temp.as_user(pg_temp.inspector(), format(
      'SELECT public.rpc_list_quality_inspections(%L::uuid, %L::uuid, 50)', pg_temp.org(), (SELECT id FROM m WHERE k='hi')))) e)
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.as_user(pg_temp.inspector(), format(
      'SELECT public.rpc_list_quality_inspections(%L::uuid, %L::uuid, 50)', pg_temp.org(), (SELECT id FROM m WHERE k='hi')))) e
      WHERE (e->>'superseded')::boolean) = 2,
  'D2 the listing marks exactly the two retired rows as superseded and shows each revision');
SELECT pg_temp.as_user(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 1, 'second review'));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='hi')) IS FALSE
  AND pg_temp.reason((SELECT id FROM m WHERE k='hi')) = 'QUALITY_RELEASE_REQUIRED'
  AND (pg_temp.release((SELECT id FROM m WHERE k='hi')) ->> 'authority_revision')::int = 2,
  'D2 a second supersession (revision 2) closes the gate again');

-- D3. IN_PROCESS: per stage, never across stages.
SELECT pg_temp.set_policy(pg_temp.policy('all_orders', 'stages_and_final'));
INSERT INTO m VALUES ('stg', pg_temp.mo('D-STAGES'));
INSERT INTO public.stage_wip_log(org_id, mo_id, stage_id, period_start, period_end, created_by) VALUES
  (pg_temp.org(), (SELECT id FROM m WHERE k='stg'), pg_temp.stage(), CURRENT_DATE, CURRENT_DATE, pg_temp.qmanager()),
  (pg_temp.org(), (SELECT id FROM m WHERE k='stg'), pg_temp.stage_b(), CURRENT_DATE, CURRENT_DATE, pg_temp.qmanager());
INSERT INTO r VALUES ('stage_b', pg_temp.record((SELECT id FROM m WHERE k='stg'), pg_temp.stage_insp(pg_temp.stage_b())));
SELECT pg_temp.legacy_row((SELECT id FROM m WHERE k='stg'), 'D-STG-A', 'IN_PROCESS', pg_temp.stage(), 1, 999, 'PASS', 5, 0);
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='stg'), 'hold'));
SELECT pg_temp.record((SELECT id FROM m WHERE k='stg'), pg_temp.final('PASS', 10, 0));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='stg')) IS TRUE,
  'D3 stage A satisfied by legacy evidence, stage B by genuine evidence, FINAL genuine: ready');
SELECT pg_temp.as_user(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='stg'), 'IN_PROCESS', pg_temp.stage(), 0, 'stage A row is not from an RPC'));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='stg')) IS FALSE
  AND pg_temp.reason((SELECT id FROM m WHERE k='stg')) = 'QUALITY_STAGE_INSPECTION_REQUIRED'
  AND (pg_temp.release((SELECT id FROM m WHERE k='stg')) -> 'missing_stage_ids') = to_jsonb(ARRAY[pg_temp.stage()::text]),
  'D3 superseding stage A makes exactly stage A missing; stage B and FINAL are untouched');
SELECT pg_temp.ok((pg_temp.release((SELECT id FROM m WHERE k='stg')) ->> 'authority_revision')::int = 0,
  'D3 the FINAL partition revision is independent of the stage partition');
INSERT INTO r VALUES ('stage_a', pg_temp.record((SELECT id FROM m WHERE k='stg'), pg_temp.stage_insp(pg_temp.stage())));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='stg')) IS TRUE
  AND pg_temp.revision_of((SELECT (v->>'inspection_id')::uuid FROM r WHERE k='stage_a')) = 1
  AND pg_temp.revision_of((SELECT (v->>'inspection_id')::uuid FROM r WHERE k='stage_b')) = 0,
  'D3 genuine stage A evidence at revision 1 restores the gate; stage B stays at revision 0');
SELECT pg_temp.as_user(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='stg'), 'IN_PROCESS', pg_temp.stage_b(), 0, 'stage B re-check'));
SELECT pg_temp.ok(pg_temp.reason((SELECT id FROM m WHERE k='stg')) = 'QUALITY_STAGE_INSPECTION_REQUIRED'
  AND (pg_temp.release((SELECT id FROM m WHERE k='stg')) -> 'missing_stage_ids') = to_jsonb(ARRAY[pg_temp.stage_b()::text]),
  'D3 superseding stage B leaves stage A (revision 1 evidence) valid');
SELECT pg_temp.set_policy(pg_temp.policy('all_orders'));

-- D4. QC cycles: a supersession belongs to one cycle only.
INSERT INTO m VALUES ('cyc', pg_temp.mo('D-CYCLE'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='cyc'), 'hold'));
SELECT pg_temp.legacy_row((SELECT id FROM m WHERE k='cyc'), 'D-CYC-F', 'FINAL', NULL, 1, 999, 'PASS', 10, 0);
SELECT pg_temp.as_user(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='cyc'), 'FINAL', NULL, 0, 'cycle 1 forged'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='cyc'), 'return', 'rework'));
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='cyc'), 'hold')) ->> 'qc_cycle')::int = 2,
  'D4 the second hold opens cycle 2');
SELECT pg_temp.ok(pg_temp.reason((SELECT id FROM m WHERE k='cyc')) = 'QUALITY_RELEASE_REQUIRED'
  AND (pg_temp.release((SELECT id FROM m WHERE k='cyc')) ->> 'authority_revision')::int = 0,
  'D4 cycle 2 starts at revision 0 without inheriting cycle 1 evidence or its supersession');
INSERT INTO r VALUES ('cyc2', pg_temp.record((SELECT id FROM m WHERE k='cyc'), pg_temp.final('PASS', 10, 0)));
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='cyc')) IS TRUE
  AND pg_temp.revision_of((SELECT (v->>'inspection_id')::uuid FROM r WHERE k='cyc2')) = 0
  AND (SELECT count(*) FROM wardah_internal.quality_supersessions_202 WHERE mo_id = (SELECT id FROM m WHERE k='cyc') AND qc_cycle = 1) = 1,
  'D4 a genuine cycle-2 PASS releases at revision 0; the cycle-1 supersession stays recorded');

-- D5. Corrupt authority metadata refuses release instead of reading as a newer decision.
INSERT INTO m VALUES ('cor', pg_temp.mo('D-CORRUPT'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='cor'), 'hold'));
SELECT pg_temp.legacy_link(pg_temp.legacy_row((SELECT id FROM m WHERE k='cor'), 'D-COR-F', 'FINAL', NULL, 1, 1, 'PASS', 10, 0), pg_temp.org(), 5);
SELECT pg_temp.ok(pg_temp.ready((SELECT id FROM m WHERE k='cor')) IS FALSE
  AND pg_temp.reason((SELECT id FROM m WHERE k='cor')) = 'QUALITY_AUTHORITY_CORRUPT',
  'D5 an authority revision the partition never reached refuses release');
INSERT INTO m VALUES ('cor2', pg_temp.mo('D-CORRUPT2'));
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='cor2'), 'hold'));
SELECT pg_temp.legacy_link(pg_temp.legacy_row((SELECT id FROM m WHERE k='cor2'), 'D-COR2-F', 'FINAL', NULL, 1, 1, 'PASS', 10, 0), pg_temp.org2(), 0);
SELECT pg_temp.ok(pg_temp.reason((SELECT id FROM m WHERE k='cor2')) = 'QUALITY_AUTHORITY_CORRUPT',
  'D5 an authority link from another tenant refuses release');
SELECT pg_temp.set_policy(pg_temp.policy('all_orders', 'stages_and_final'));
INSERT INTO m VALUES ('cor3', pg_temp.mo('D-CORRUPT3'));
INSERT INTO public.stage_wip_log(org_id, mo_id, stage_id, period_start, period_end, created_by)
VALUES (pg_temp.org(), (SELECT id FROM m WHERE k='cor3'), pg_temp.stage(), CURRENT_DATE, CURRENT_DATE, pg_temp.qmanager());
SELECT pg_temp.legacy_link(pg_temp.legacy_row((SELECT id FROM m WHERE k='cor3'), 'D-COR3-S', 'IN_PROCESS', pg_temp.stage(), NULL, 1, 'PASS', 5, 0), pg_temp.org(), 3);
SELECT pg_temp.as_user(pg_temp.inspector(), pg_temp.hold_sql((SELECT id FROM m WHERE k='cor3'), 'hold'));
SELECT pg_temp.record((SELECT id FROM m WHERE k='cor3'), pg_temp.final('PASS', 10, 0));
SELECT pg_temp.ok(pg_temp.reason((SELECT id FROM m WHERE k='cor3')) = 'QUALITY_AUTHORITY_CORRUPT',
  'D5 a stage link beyond the stage partition revision refuses release');
SELECT pg_temp.set_policy(pg_temp.policy('all_orders'));

-- D6. Supersession RPC validation and history protection.
INSERT INTO m VALUES ('v', pg_temp.mo('D-VALID'));
SELECT pg_temp.denied(pg_temp.outsider(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 2, 'x'), 'NOT_ORG_MEMBER', 'D6 another tenant admin cannot supersede');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='v'), 'FINAL', NULL, 0, 'x'), 'QUALITY_QC_CYCLE_MISSING', 'D6 FINAL needs a QC cycle');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 7, 'x'), 'QUALITY_SUPERSESSION_REVISION_CONFLICT', 'D6 wrong expected revision');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, NULL, 'x'), 'QUALITY_SUPERSESSION_REVISION_CONFLICT', 'D6 NULL expected revision');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', NULL, 2, '   '), 'QUALITY_SUPERSEDE_REASON_REQUIRED', 'D6 a reason is required');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'RANDOM', NULL, 2, 'x'), 'QUALITY_INSPECTION_TYPE_INVALID', 'D6 only FINAL and IN_PROCESS');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'FINAL', pg_temp.stage(), 2, 'x'), 'QUALITY_STAGE_NOT_ALLOWED', 'D6 FINAL takes no stage');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'IN_PROCESS', NULL, 0, 'x'), 'QUALITY_STAGE_REQUIRED', 'D6 IN_PROCESS needs a stage');
SELECT pg_temp.denied(pg_temp.admin(), pg_temp.supersede_sql((SELECT id FROM m WHERE k='hi'), 'IN_PROCESS', gen_random_uuid(), 0, 'x'), 'QUALITY_STAGE_NOT_FOUND', 'D6 unknown stage');
SELECT pg_temp.forge_denied('postgres', 'UPDATE wardah_internal.quality_supersessions_202 SET reason = ''edited''', 'QC_HISTORY_IMMUTABLE_202', 'D6 supersessions cannot be edited');
SELECT pg_temp.forge_denied('postgres', 'DELETE FROM wardah_internal.quality_supersessions_202', 'QC_HISTORY_IMMUTABLE_202', 'D6 supersessions cannot be deleted');
SELECT pg_temp.forge_denied('postgres', 'TRUNCATE wardah_internal.quality_supersessions_202', 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED', 'D6 supersessions cannot be truncated');
SELECT pg_temp.forge_denied('postgres', 'UPDATE wardah_internal.quality_inspection_authority_202 SET authority_revision = 9', 'QC_HISTORY_IMMUTABLE_202', 'D6 authority links cannot be edited');
SELECT pg_temp.forge_denied('postgres', 'DELETE FROM wardah_internal.quality_inspection_authority_202', 'QC_HISTORY_IMMUTABLE_202', 'D6 authority links cannot be deleted');
SELECT pg_temp.forge_denied('postgres', 'TRUNCATE wardah_internal.quality_inspection_authority_202', 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED', 'D6 authority links cannot be truncated');
SELECT pg_temp.forge_denied('postgres', 'UPDATE public.quality_inspections SET result = ''PASS''', 'QUALITY_INSPECTION_IMMUTABLE', 'D6 inspections remain immutable');
SELECT pg_temp.forge_denied('postgres', 'DELETE FROM public.quality_inspections', 'QUALITY_INSPECTION_IMMUTABLE', 'D6 inspections cannot be deleted');
SELECT pg_temp.forge_denied('postgres', 'TRUNCATE public.quality_inspections', 'cannot truncate a table referenced in a foreign key constraint',
  'D6 inspections cannot be truncated (the authority link now references them)');
SELECT pg_temp.forge_denied('postgres', 'TRUNCATE public.quality_inspections CASCADE', 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED',
  'D6 TRUNCATE ... CASCADE still reaches the M193 history guard');

-- ===================================================== E. post-201 contract
SELECT pg_temp.ok((SELECT count(*) FROM (VALUES
    ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)', '68a55461e73a5829728b45f430d4db59'),
    ('public.rpc_set_material_issue_wo_statuses(uuid,text[])', 'cd01220eab3266ce28744821825b0915'),
    ('public.rpc_set_quality_policy(uuid,jsonb,bigint)', '782b30957175c20cfff71b6c9a3ee26d'),
    ('public.rpc_get_quality_policy(uuid)', '95347a01c938b4295d17e02e723b97ab'),
    ('public.create_role_from_template(uuid,uuid,character varying,uuid)', 'd1d315bab6f854a846624d79006b6008')
  ) e(sig, h) JOIN pg_proc p ON p.oid = to_regprocedure(e.sig) AND md5(p.prosrc) = e.h
    AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']) = 5,
  'E all five M201 functions keep their exact post-201 bodies');
-- (service_role already holds EXECUTE on two of them before 202; run_local.sh proves the
-- full proacl of all five is byte-identical before and after 202.)
SELECT pg_temp.ok((SELECT bool_and(has_function_privilege('authenticated', sig, 'EXECUTE')
      AND NOT has_function_privilege('anon', sig, 'EXECUTE'))
  FROM (VALUES ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)'),
    ('public.rpc_set_material_issue_wo_statuses(uuid,text[])'), ('public.rpc_set_quality_policy(uuid,jsonb,bigint)'),
    ('public.rpc_get_quality_policy(uuid)'), ('public.create_role_from_template(uuid,uuid,character varying,uuid)')) f(sig)),
  'E the five M201 functions keep their ACLs');
SELECT pg_temp.ok(
  (pg_temp.as_user(pg_temp.admin(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org())) #>> '{capabilities,can_manage_policy}')::boolean
  AND (pg_temp.as_user(pg_temp.keyholder(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org())) #>> '{capabilities,can_manage_policy}')::boolean
  AND NOT (pg_temp.as_user(pg_temp.inspector(), format('SELECT public.rpc_get_quality_policy(%L::uuid)', pg_temp.org())) #>> '{capabilities,can_manage_policy}')::boolean,
  'E rpc_get_quality_policy still reports can_manage_policy from the M201 predicate (admin, key holder, not inspector)');
SELECT pg_temp.ok((pg_temp.as_user(pg_temp.keyholder(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, %s)',
    pg_temp.org(), pg_temp.policy('all_orders'), (SELECT version FROM wardah_internal.quality_policies WHERE org_id = pg_temp.org()))) ->> 'version')::bigint > 1,
  'E the M201 delegated key holder still saves the quality policy');
SELECT pg_temp.denied(pg_temp.inspector(), format('SELECT public.rpc_set_quality_policy(%L::uuid, %L::jsonb, 1)', pg_temp.org(), pg_temp.policy('all_orders')),
  'MANUFACTURING_SETTINGS_UPDATE_DENIED', 'E the M201 denial message is unchanged');

DO $$ BEGIN RAISE NOTICE 'M202_QC_PRIVILEGED_WRITE_CLOSURE_ACCEPTANCE_PASS'; END $$;
ROLLBACK;
