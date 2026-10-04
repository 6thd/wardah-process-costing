-- M202 INSERT-only history rehearsal: shared session-local helpers (fingerprint
-- oracle, refusal asserts). Included with \ir by the commit-connection script and by
-- the fresh-connection readback script. Disposable cluster only.
CREATE FUNCTION pg_temp.inspector() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a4'::uuid $$;

-- ---------------------------------------------------------------- fingerprint
-- Everything structural that carries the closure: the four guarded stores (owner,
-- ACL, column ACLs, RLS flags, options, columns, constraints, indexes, triggers
-- with their ENABLED state and function body hash, policies, rules, inheritance),
-- every function that executes as or guards the entry role (owner, ACL, config,
-- security mode, body hash), the entry role itself (attributes, settings,
-- membership edges, owned objects and ACL entries) and the schema ACLs. Row DATA
-- is deliberately excluded (it is what the rehearsal changes) and reported apart.
CREATE FUNCTION pg_temp.fp_parts() RETURNS jsonb LANGUAGE sql AS $fn$
WITH t(oid) AS (VALUES ('public.quality_inspections'::regclass::oid),
  ('wardah_internal.quality_inspection_authority_202'::regclass::oid),
  ('wardah_internal.qc_entry_markers_202'::regclass::oid),
  ('wardah_internal.quality_supersessions_202'::regclass::oid)),
f(oid) AS (VALUES ('public.rpc_record_quality_inspection(uuid,uuid,jsonb)'::regprocedure::oid),
  ('wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb)'::regprocedure::oid),
  ('wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)'::regprocedure::oid),
  ('wardah_internal.qc_write_guard_202()'::regprocedure::oid),
  ('wardah_internal.qc_assert_closed_graph_202()'::regprocedure::oid),
  ('wardah_internal.qc_marker_orphan_check_202()'::regprocedure::oid),
  ('public.rpc_list_quality_inspections(uuid,uuid,integer)'::regprocedure::oid),
  ('public.rpc_supersede_quality_evidence_202(uuid,text,uuid,integer,text)'::regprocedure::oid)),
r AS (SELECT oid FROM pg_roles WHERE rolname = 'wardah_qc_entry_202')
SELECT jsonb_build_object(
 'tables', (SELECT md5(coalesce(string_agg(concat_ws('|', c.oid::regclass, c.relkind, c.relowner::regrole, c.relacl, c.relrowsecurity,
        c.relforcerowsecurity, c.reloptions, c.relpersistence, c.relhasrules, c.relispartition, c.relreplident,
        c.reltablespace, c.relhassubclass), E'\n' ORDER BY c.oid::regclass::text), ''))
        FROM pg_class c JOIN t ON t.oid = c.oid),
 'columns', (SELECT md5(coalesce(string_agg(concat_ws('|', a.attrelid::regclass, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod),
        a.attnotnull, a.atthasdef, pg_get_expr(d.adbin, d.adrelid), a.attgenerated, a.attidentity, a.attacl,
        a.attoptions, a.attcollation, a.attisdropped), E'\n' ORDER BY a.attrelid::regclass::text, a.attnum), ''))
        FROM pg_attribute a JOIN t ON t.oid = a.attrelid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0),
 'constraints', (SELECT md5(coalesce(string_agg(concat_ws('|', co.conrelid::regclass, co.conname, co.contype, co.convalidated,
        co.condeferrable, co.condeferred, pg_get_constraintdef(co.oid)), E'\n' ORDER BY co.conrelid::regclass::text, co.conname), ''))
        FROM pg_constraint co JOIN t ON t.oid = co.conrelid),
 'indexes', (SELECT md5(coalesce(string_agg(concat_ws('|', i.indrelid::regclass, pg_get_indexdef(i.indexrelid), i.indisvalid,
        i.indisready, i.indisunique), E'\n' ORDER BY i.indrelid::regclass::text, pg_get_indexdef(i.indexrelid)), ''))
        FROM pg_index i JOIN t ON t.oid = i.indrelid),
 'triggers', (SELECT md5(coalesce(string_agg(concat_ws('|', g.tgrelid::regclass, g.tgname, g.tgenabled, g.tgtype, g.tgfoid::regprocedure,
        g.tgdeferrable, g.tginitdeferred, g.tgattr, md5(p.prosrc), pg_get_triggerdef(g.oid)), E'\n'
        ORDER BY g.tgrelid::regclass::text, g.tgname), ''))
        FROM pg_trigger g JOIN t ON t.oid = g.tgrelid JOIN pg_proc p ON p.oid = g.tgfoid WHERE NOT g.tgisinternal),
 'policies', (SELECT md5(coalesce(string_agg(concat_ws('|', po.polrelid::regclass, po.polname, po.polcmd, po.polpermissive, po.polroles,
        pg_get_expr(po.polqual, po.polrelid), pg_get_expr(po.polwithcheck, po.polrelid)), E'\n'
        ORDER BY po.polrelid::regclass::text, po.polname), ''))
        FROM pg_policy po JOIN t ON t.oid = po.polrelid),
 'rules_inherits', (SELECT md5((SELECT count(*) FROM pg_rewrite rw JOIN t ON t.oid = rw.ev_class)::text || '/' ||
        (SELECT count(*) FROM pg_inherits ih JOIN t ON t.oid = ih.inhrelid OR t.oid = ih.inhparent)::text)),
 'functions', (SELECT md5(coalesce(string_agg(concat_ws('|', p.oid::regprocedure, p.proowner::regrole, p.proacl, p.proconfig,
        p.prosecdef, p.provolatile, p.prokind, p.proleakproof, md5(p.prosrc)), E'\n' ORDER BY p.oid::regprocedure::text), ''))
        FROM pg_proc p JOIN f ON f.oid = p.oid),
 'entry_role', (SELECT md5(coalesce(string_agg(concat_ws('|', ro.rolname, ro.rolsuper, ro.rolinherit, ro.rolcreaterole, ro.rolcreatedb,
        ro.rolcanlogin, ro.rolreplication, ro.rolbypassrls, ro.rolconnlimit, ro.rolvaliduntil, ro.rolconfig), E'\n'), ''))
        FROM pg_roles ro JOIN r ON r.oid = ro.oid),
 'role_settings', (SELECT count(*) FROM pg_db_role_setting s JOIN r ON r.oid = s.setrole),
 'membership', (SELECT md5(coalesce(string_agg(concat_ws('|', m.roleid::regrole, m.member::regrole, m.grantor::regrole,
        m.admin_option, m.inherit_option, m.set_option), E'\n' ORDER BY m.roleid::regrole::text, m.member::regrole::text), ''))
        FROM pg_auth_members m JOIN r ON r.oid = m.roleid OR r.oid = m.member),
 'role_deps', (SELECT md5(coalesce(string_agg(concat_ws('|', d.dbid, d.classid::regclass, d.objid, d.objsubid, d.deptype),
        E'\n' ORDER BY d.dbid, d.classid::regclass::text, d.objid, d.objsubid, d.deptype), ''))
        FROM pg_shdepend d JOIN r ON r.oid = d.refobjid
        WHERE d.refclassid = 'pg_authid'::regclass AND d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))),
 'schemas', (SELECT md5(coalesce(string_agg(concat_ws('|', n.nspname, n.nspowner::regrole, n.nspacl), E'\n' ORDER BY n.nspname), ''))
        FROM pg_namespace n WHERE n.nspname IN ('public', 'wardah_internal'))
) $fn$;
CREATE FUNCTION pg_temp.fp() RETURNS text LANGUAGE sql AS $fn$ SELECT md5(pg_temp.fp_parts()::text) $fn$;

CREATE FUNCTION pg_temp.expect_same(p_label text, p_a text, p_b text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_a IS DISTINCT FROM p_b THEN RAISE EXCEPTION 'M202_HISTORY_FAIL: % (% <> %)', p_label, p_a, p_b; END IF;
  RAISE NOTICE 'ok  %', p_label;
END $fn$;
CREATE FUNCTION pg_temp.expect_diff(p_label text, p_a text, p_b text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_a IS NOT DISTINCT FROM p_b THEN RAISE EXCEPTION 'M202_HISTORY_FAIL: fingerprint blind spot, unchanged after: %', p_label; END IF;
  RAISE NOTICE 'ok  non-vacuity: fingerprint changes when %', p_label;
END $fn$;
-- Run p_sql (optionally as a role), require it to fail with p_expect; always roll back its effect.
CREATE FUNCTION pg_temp.refused(p_label text, p_role text, p_sql text, p_expect text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_msg text := '<succeeded>';
BEGIN
  BEGIN
    IF p_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_role); END IF;
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = '<succeeded>';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  EXECUTE 'RESET ROLE';
  IF v_msg = '<succeeded>' OR position(p_expect IN v_msg) = 0 THEN
    RAISE EXCEPTION 'M202_HISTORY_FAIL: % expected % got %', p_label, p_expect, v_msg;
  END IF;
  RAISE NOTICE 'ok  % (%)', p_label, p_expect;
END $fn$;


-- The ORACLE: compares the live structure to the baseline captured BEFORE the
-- procedure (GUC m202.f0). The value is captured before the load and persisted to
-- f0.txt after the COMMIT, from the retained value (history_rehearsal.sql). It never
-- re-captures; a drifted state raises.
CREATE FUNCTION pg_temp.assert_fp(p_label text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_now text := pg_temp.fp(); v_base text := current_setting('m202.f0');
BEGIN
  IF v_now IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'M202_HISTORY_FAIL: fingerprint mismatch at % (baseline % live %)', p_label, v_base, v_now;
  END IF;
END $fn$;
-- Apply a catalog mutation to the live (committed) state, require the oracle to REJECT it,
-- and roll the mutation back with the subtransaction.
CREATE FUNCTION pg_temp.oracle_rejects(p_label text, p_mutation text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_msg text := '<oracle accepted the mutated state>';
BEGIN
  BEGIN
    EXECUTE p_mutation;
    BEGIN
      PERFORM pg_temp.assert_fp(p_label);
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = v_msg;
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg NOT LIKE 'M202_HISTORY_FAIL: fingerprint mismatch at %' THEN
    RAISE EXCEPTION 'M202_HISTORY_FAIL: oracle did not reject: % -> %', p_label, v_msg;
  END IF;
  RAISE NOTICE 'ok  oracle rejects the committed state once %', p_label;
END $fn$;
