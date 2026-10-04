-- 202: QC privileged-write closure (F1) — service_role INSERT, provenance guard,
-- NULL-safe selection and append-only supersession for quality_inspections.
--
-- Additive on top of M199 (the M199 file is unchanged). It replaces three M199
-- bodies — rpc_record_quality_inspection, evaluate_quality_release_199 and
-- rpc_list_quality_inspections — after pinning their exact current bodies, and it
-- never replaces any of the five functions M201 replaced (they are pinned at
-- their post-201 bodies and checked again in the postflight). Requires 190..201.
-- Runbook and boundaries: docs/db/QC_PRIVILEGED_WRITE_CLOSURE_202_RUNBOOK.md.
--
-- Policy (owner default): no QC evidence is written directly by service_role or
-- any other client/server credential. The only writer is
-- rpc_record_quality_inspection, whose owner is a dedicated NOLOGIN role that
-- owns nothing else. A BEFORE INSERT guard (SECURITY INVOKER, so it sees the
-- execution role, ENABLE ALWAYS) refuses every insert unless
--   * current_user is that role, at trigger depth 1, session_replication_role=origin;
--   * a transaction-bound marker row (xid8 + backend pid + inspection/org/MO/request)
--     written by that role in this transaction matches the row;
--   * qc_assert_closed_graph_202() proves the execution graph is closed.
-- Owner identity alone is not accepted: a postgres-owned function that
-- service_role can reach runs as postgres, so it fails the role check.
--
-- Selection (NULL-safe, append-only supersession): FINAL is evaluated per
-- (org, MO, QC cycle), IN_PROCESS per (org, MO, stage), ordered
--   inspection_seq DESC NULLS LAST, id DESC
-- among evidence at the partition's latest authority revision. Evidence that has
-- no protected authority link is revision 0. rpc_supersede_quality_evidence_202
-- appends a supersession (revision + 1) that raises the partition's revision, so a
-- forged or NULL-sequence row is bypassed without deleting history, and the gate
-- stays closed until a genuine inspection is recorded at the new revision.
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE
  v_mismatch text;
BEGIN
  IF to_regprocedure('public.rpc_record_quality_inspection(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)') IS NULL
     OR to_regprocedure('public.rpc_list_quality_inspections(uuid,uuid,integer)') IS NULL
     OR to_regprocedure('wardah_internal.deny_manufacturing_history_truncate_193()') IS NULL
     OR to_regprocedure('wardah_internal.quality_is_admin_199(uuid)') IS NULL
     OR to_regclass('wardah_internal.mo_quality_cycles') IS NULL
     OR to_regclass('wardah_internal.quality_inspection_counters') IS NULL THEN
    RAISE EXCEPTION 'M202_REQUIRES_M199';
  END IF;
  IF to_regprocedure('wardah_internal.manufacturing_settings_can_update_201(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.permissions
                    WHERE permission_key = 'manufacturing.settings.update') THEN
    RAISE EXCEPTION 'M202_REQUIRES_M201';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wardah_qc_entry_202')
     OR to_regclass('wardah_internal.qc_entry_markers_202') IS NOT NULL
     OR to_regclass('wardah_internal.quality_inspection_authority_202') IS NOT NULL
     OR to_regclass('wardah_internal.quality_supersessions_202') IS NOT NULL
     OR to_regprocedure('wardah_internal.qc_write_guard_202()') IS NOT NULL THEN
    RAISE EXCEPTION 'M202_ALREADY_APPLIED';
  END IF;
  -- The entry role's functions live in public and the role is not granted USAGE
  -- explicitly: it relies on PUBLIC's USAGE, which must therefore exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'USAGE') THEN
    RAISE EXCEPTION 'M202_PUBLIC_SCHEMA_USAGE_REQUIRED';
  END IF;

  -- Post-201 bodies of the five functions M201 replaced. 202 replaces none of
  -- them; pinning proves it is built on the post-201 chain and not on the
  -- pre-201 text of M192/M199/M200.
  SELECT string_agg(format('%s: md5 %s, expected %s', e.sig, COALESCE(md5(p.prosrc), 'missing'), e.body_md5),
                    '; ' ORDER BY e.sig)
  INTO v_mismatch
  FROM (VALUES
    ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)', '68a55461e73a5829728b45f430d4db59'),
    ('public.rpc_set_material_issue_wo_statuses(uuid,text[])', 'cd01220eab3266ce28744821825b0915'),
    ('public.rpc_set_quality_policy(uuid,jsonb,bigint)', '782b30957175c20cfff71b6c9a3ee26d'),
    ('public.rpc_get_quality_policy(uuid)', '95347a01c938b4295d17e02e723b97ab'),
    ('public.create_role_from_template(uuid,uuid,character varying,uuid)', 'd1d315bab6f854a846624d79006b6008')
  ) AS e(sig, body_md5)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE md5(p.prosrc) IS DISTINCT FROM e.body_md5
     OR p.prosecdef IS DISTINCT FROM true
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'];
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M202_UNEXPECTED_M201_BODY: %', v_mismatch
      USING HINT = 'A post-201 function changed. Re-derive 202 from the current bodies; see the 202 runbook.';
  END IF;

  -- The three M199 bodies this file replaces must still be exactly M199's.
  SELECT string_agg(format('%s: md5 %s, expected %s', e.sig, COALESCE(md5(p.prosrc), 'missing'), e.body_md5),
                    '; ' ORDER BY e.sig)
  INTO v_mismatch
  FROM (VALUES
    ('public.rpc_record_quality_inspection(uuid,uuid,jsonb)',
     '499045298cf48632bd79325494307994', ARRAY['search_path=public, pg_temp']),
    ('wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)',
     'f640dd1264b840d593d82bf53a49e181', ARRAY['search_path=""']),
    ('public.rpc_list_quality_inspections(uuid,uuid,integer)',
     '159090c0b1f4e060cf218d026a0169c3', ARRAY['search_path=public, pg_temp'])
  ) AS e(sig, body_md5, cfg)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE md5(p.prosrc) IS DISTINCT FROM e.body_md5
     OR p.prosecdef IS DISTINCT FROM true
     OR p.proconfig IS DISTINCT FROM e.cfg;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M202_UNEXPECTED_M199_BODY: %', v_mismatch;
  END IF;

  IF has_table_privilege('authenticated', 'public.quality_inspections', 'SELECT')
     OR has_table_privilege('anon', 'public.quality_inspections', 'SELECT') THEN
    RAISE EXCEPTION 'M202_REQUIRES_M199';
  END IF;

  -- Pre-existing functions this file does NOT replace, but whose search_path
  -- this file corrects below (section 0), metadata only. Pin every body exactly
  -- (and, for the two SECURITY INVOKER ones, owner and ACL too) before touching
  -- only proconfig.
  SELECT string_agg(format('%s: md5 %s, expected %s', e.sig, COALESCE(md5(p.prosrc), 'missing'), e.body_md5),
                    '; ' ORDER BY e.sig)
  INTO v_mismatch
  FROM (VALUES
    ('wardah_internal.mo_quality_gate_199()', 'e2cf479d7a63eb9345bba34cef2bac1c',
     true, ARRAY['search_path=""']),
    ('wardah_internal.mo_quality_insert_199()', '0dd1403d7f0aaf7935f1ff4beaa26ed7',
     true, ARRAY['search_path=""']),
    ('public.wardah_assert_org_member(uuid)', '33c67e93cd2d49eb67dd84bf85721908',
     true, ARRAY['search_path=public']),
    ('public.wardah_is_org_admin(uuid)', '5f9184946d63312758ac000a338f8677',
     true, ARRAY['search_path=public']),
    ('wardah_internal.quality_actor_can_199(uuid,text,boolean)', '6075f418c1133c9bfb6172b626b3d32c',
     true, ARRAY['search_path=""']),
    ('trg_mo_status_machine()', 'e2489f51cadb5fb04d39e1d921ef7d2a',
     false, ARRAY['search_path=public']),
    ('public.validate_mo_transition(text,text)', '22789ca9c175eb3476b5c33648b92d1a',
     false, ARRAY['search_path=public'])
  ) AS e(sig, body_md5, want_secdef, cfg)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE md5(p.prosrc) IS DISTINCT FROM e.body_md5
     OR p.prosecdef IS DISTINCT FROM e.want_secdef
     OR p.proconfig IS DISTINCT FROM e.cfg;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M202_UNEXPECTED_PRE_EXISTING_BODY: %', v_mismatch
      USING HINT = 'One of the search_path corrections in section 0 targets a function that changed since this file was derived; re-derive that correction.';
  END IF;
  -- trg_mo_status_machine() and validate_mo_transition() must keep EXECUTE
  -- restricted exactly as today (ALTER FUNCTION SET never touches grants, this
  -- only proves the preflight read the live ACL, not a stale assumption).
  IF NOT has_function_privilege('authenticated', 'trg_mo_status_machine()', 'EXECUTE')
     OR has_function_privilege('anon', 'trg_mo_status_machine()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.validate_mo_transition(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.validate_mo_transition(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M202_UNEXPECTED_PRE_EXISTING_ACL';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 0. search_path correction, metadata only (ALTER FUNCTION ... SET, never
--    CREATE OR REPLACE; no canonical migration file is edited; every body
--    above is pinned byte-identical before and after — proven in postflight).
--
--    An unqualified type name inside a PL/pgSQL DECLARE or expression resolves
--    against pg_temp before pg_catalog whenever search_path does not list
--    pg_temp explicitly (confirmed live on PostgreSQL 17.11 with a benign
--    pg_temp.<type> domain whose CHECK only RAISEs NOTICE — no forged rows, no
--    payload): any authenticated login can create that domain, and its CHECK
--    then executes with the shadowed function's own, more privileged
--    current_user. Two corrections, not one:
--      * search_path='' or 'public' alone written the CORRECT, unquoted,
--        comma-separated way (search_path = pg_catalog, pg_temp, or
--        search_path = public, pg_temp — matching the schema the function's
--        own unqualified references, if any, need) stops it — verified by
--        current_schemas(true) returning pg_catalog (or public) ahead of
--        pg_temp_N, and the sentinel not firing.
--      * the SAME text with outer single quotes (search_path =
--        'pg_catalog, pg_temp') is NOT equivalent: PostgreSQL stores it as one
--        malformed schema name, current_schemas(true) comes back
--        {pg_temp_N, pg_catalog} — pg_temp first — and the sentinel fires.
--    Affected PL/pgSQL statement shapes confirmed vulnerable: a plain
--    assignment (v := text_expr::type), a cast inside INSERT ... VALUES, and a
--    DECLARE block's own bare-type variables resolved on that function's FIRST
--    call in a given backend (so a stale, differently-compiled session plan
--    cannot mask this during testing). A RETURN expr matching the function's
--    own declared return type was NOT reproducible (PL/pgSQL coerces to the
--    fixed return-type OID directly), but every other shape was, including
--    regclass, regprocedure, regnamespace and oid, not just text/numeric/uuid.
--
--    A function with NO SET clause of its own (auth.uid(), the local Supabase
--    shim: LANGUAGE sql, no proconfig, body `... ::uuid`) is NOT independently
--    vulnerable or safe — it inherits whatever search_path is ACTIVE AT ITS
--    CALL SITE. So a function with a provably safe body can still leak through
--    a callee like this: confirmed via PG_CONTEXT that wardah_assert_org_member
--    (search_path='public', no cast of its own) and quality_actor_can_199
--    (search_path='', no cast of its own) each call auth.uid() directly and
--    each reproduces the shadow with current_user=postgres; wardah_is_org_admin
--    (search_path='public') does the same and is reachable from
--    quality_is_admin_199 (called by rpc_supersede_quality_evidence_202, and by
--    qc_prepare_inspection_202 whenever a policy sets
--    admins_subject_to_quality_controls=false). This migration does NOT alter
--    auth.uid() or any object in the auth schema — the shim itself is a local,
--    unverified stand-in for Supabase's hosted implementation, which is reached
--    only through these callers' own search_path.
--    wardah_internal.qc_assert_closed_graph_202() additionally qualifies every
--    base-type reference in its own body with pg_catalog. explicitly (it is the
--    function the whole guarantee reduces to); every other function corrected
--    here relies on the ordered search_path alone, verified sufficient for
--    every shape above.
--    quality_has_explicit_grant_199 and quality_is_production_participant_199
--    take the caller-evaluated actor id as a plain uuid parameter and never
--    call auth.uid() or cast a bare type in their own body (confirmed from the
--    PG_CONTEXT trace: neither appears as a frame); they are correctly left
--    untouched. quality_is_admin_199's own body has no direct cast or
--    auth.uid() call either — fixing its two callees here is sufficient for it.
--
--    trg_mo_status_machine() and validate_mo_transition() predate M199 by a
--    wide margin and fire on every manufacturing_orders status transition, not
--    only QC's; both declare a bare `TEXT` local under search_path='public'
--    (pg_temp not listed) and were reproduced the same way via the ordinary
--    hold action. Rewriting the MO status machine is out of scope; this is the
--    same narrow, metadata-only, pinned correction as the rest of section 0,
--    not a change to any transition rule.
--
--    Explicitly NOT inventoried or closed by this migration: any OTHER
--    search_path='' (or pg_temp-unlisted) function reachable by an ordinary,
--    non-admin login outside the call graph actually exercised above —
--    including, named but not verified, similarly-shaped candidates in M196
--    and elsewhere. Treat as an open boundary, not a closed one.
-- ---------------------------------------------------------------------------
ALTER FUNCTION wardah_internal.mo_quality_gate_199() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION wardah_internal.mo_quality_insert_199() SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION public.wardah_assert_org_member(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.wardah_is_org_admin(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION wardah_internal.quality_actor_can_199(uuid,text,boolean) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION trg_mo_status_machine() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_mo_transition(text,text) SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. The dedicated execution role. NOLOGIN, no attributes, no memberships; it will
--    own exactly one function. The creator's temporary membership (needed only to
--    ALTER OWNER) is removed in section 8.
-- ---------------------------------------------------------------------------
CREATE ROLE wardah_qc_entry_202 NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;

-- ---------------------------------------------------------------------------
-- 2. Private tables. No client grants. The entry role gets only what the RPC needs.
-- ---------------------------------------------------------------------------
-- Transaction-bound marker: written by the entry role immediately before the
-- inspection INSERT and removed before the RPC returns.
CREATE TABLE wardah_internal.qc_entry_markers_202 (
  xid xid8 NOT NULL,
  backend_pid integer NOT NULL,
  org_id uuid NOT NULL,
  mo_id uuid NOT NULL,
  request_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (xid, inspection_id)
);
REVOKE ALL ON wardah_internal.qc_entry_markers_202
  FROM PUBLIC, anon, authenticated, service_role;

-- Protected authority link. The revision is assigned by the RPC and cannot be
-- supplied by a client; a row without a link is revision 0.
CREATE TABLE wardah_internal.quality_inspection_authority_202 (
  inspection_id uuid PRIMARY KEY REFERENCES public.quality_inspections(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  authority_revision integer NOT NULL CHECK (authority_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON wardah_internal.quality_inspection_authority_202
  FROM PUBLIC, anon, authenticated, service_role;

-- Append-only supersessions: one row raises the authority revision of one
-- evidence partition. Original inspections are never touched.
CREATE TABLE wardah_internal.quality_supersessions_202 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id),
  inspection_type text NOT NULL CHECK (inspection_type IN ('FINAL','IN_PROCESS')),
  stage_id uuid REFERENCES public.manufacturing_stages(id),
  qc_cycle integer CHECK (qc_cycle > 0),
  revision integer NOT NULL CHECK (revision >= 1),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  superseded_inspection_ids uuid[] NOT NULL DEFAULT '{}',
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quality_supersessions_partition_202 CHECK (
    (inspection_type = 'FINAL' AND qc_cycle IS NOT NULL AND stage_id IS NULL)
    OR (inspection_type = 'IN_PROCESS' AND stage_id IS NOT NULL AND qc_cycle IS NULL))
);
CREATE UNIQUE INDEX quality_supersessions_revision_202
  ON wardah_internal.quality_supersessions_202(org_id, mo_id, inspection_type,
    COALESCE(stage_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(qc_cycle, 0), revision);
REVOKE ALL ON wardah_internal.quality_supersessions_202
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Immutability and orphan-marker triggers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.deny_qc_history_change_202()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_HISTORY_IMMUTABLE_202',
    HINT = 'Append a supersession instead of changing or deleting QC history.';
END
$fn$;

CREATE TRIGGER deny_qc_history_change_202
BEFORE UPDATE OR DELETE ON wardah_internal.quality_inspection_authority_202
FOR EACH ROW EXECUTE FUNCTION wardah_internal.deny_qc_history_change_202();
CREATE TRIGGER deny_qc_history_change_202
BEFORE UPDATE OR DELETE ON wardah_internal.quality_supersessions_202
FOR EACH ROW EXECUTE FUNCTION wardah_internal.deny_qc_history_change_202();
CREATE TRIGGER deny_history_truncate_202
BEFORE TRUNCATE ON wardah_internal.quality_inspection_authority_202
FOR EACH STATEMENT EXECUTE FUNCTION wardah_internal.deny_manufacturing_history_truncate_193();
CREATE TRIGGER deny_history_truncate_202
BEFORE TRUNCATE ON wardah_internal.quality_supersessions_202
FOR EACH STATEMENT EXECUTE FUNCTION wardah_internal.deny_manufacturing_history_truncate_193();

-- A marker must not survive COMMIT. DEFINER on purpose: the deferred event is
-- evaluated at COMMIT, after the RPC has returned to the calling session.
CREATE FUNCTION wardah_internal.qc_marker_orphan_check_202()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM wardah_internal.qc_entry_markers_202 m
             WHERE m.xid = NEW.xid AND m.inspection_id = NEW.inspection_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_MARKER_ORPHAN_202';
  END IF;
  RETURN NULL;
END
$fn$;
CREATE CONSTRAINT TRIGGER qc_marker_orphan_check_202
AFTER INSERT ON wardah_internal.qc_entry_markers_202
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION wardah_internal.qc_marker_orphan_check_202();

-- ---------------------------------------------------------------------------
-- 4. Closed-execution-graph assertion. Raises QC_EXECUTION_GRAPH_OPEN_202: <reason>.
--    SECURITY INVOKER: it is evaluated for, and as, the role executing the write.
--    Reads catalogs only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.qc_assert_closed_graph_202()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  -- Defense in depth: every base-type reference below is explicitly
  -- pg_catalog-qualified, not just the function's search_path (which already
  -- lists pg_catalog before pg_temp). An authenticated session can always
  -- CREATE a pg_temp domain whose name shadows a builtin type (e.g. "oid",
  -- "regclass", "text"); PostgreSQL resolves an unqualified type name by
  -- scanning the schemas in search_path IN ORDER, so correctly ordering
  -- pg_catalog ahead of pg_temp is sufficient on its own (verified) — the
  -- explicit qualification here additionally survives any future edit that
  -- might change this function's search_path without reviewing this comment.
  c_entry constant pg_catalog.name := 'wardah_qc_entry_202';
  v_entry pg_catalog.oid;
  v_ins pg_catalog.oid := 'public.quality_inspections'::pg_catalog.regclass;
  v_mark pg_catalog.oid := 'wardah_internal.qc_entry_markers_202'::pg_catalog.regclass;
  v_auth pg_catalog.oid := 'wardah_internal.quality_inspection_authority_202'::pg_catalog.regclass;
  v_sup pg_catalog.oid := 'wardah_internal.quality_supersessions_202'::pg_catalog.regclass;
  v_rpc pg_catalog.oid := 'public.rpc_record_quality_inspection(uuid,uuid,jsonb)'::pg_catalog.regprocedure;
  v_prep pg_catalog.oid := 'wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb)'::pg_catalog.regprocedure;
  v_eval pg_catalog.oid := 'wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)'::pg_catalog.regprocedure;
  v_guard pg_catalog.oid := 'wardah_internal.qc_write_guard_202()'::pg_catalog.regprocedure;
  v_assert pg_catalog.oid := 'wardah_internal.qc_assert_closed_graph_202()'::pg_catalog.regprocedure;
  v_member pg_catalog.oid := 'public.wardah_assert_org_member(uuid)'::pg_catalog.regprocedure;
  v_ns pg_catalog.oid := 'wardah_internal'::pg_catalog.regnamespace;
  v_db pg_catalog.oid := (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database());
  v_cls pg_catalog.oid := 'pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid;
  v_prc pg_catalog.oid := 'pg_catalog.pg_proc'::pg_catalog.regclass::pg_catalog.oid;
  v_nsp pg_catalog.oid := 'pg_catalog.pg_namespace'::pg_catalog.regclass::pg_catalog.oid;
  v_tables pg_catalog.oid[];
  v_got pg_catalog.text[];
  v_want pg_catalog.text[];
  v_privs pg_catalog.text;
  r record;
  t pg_catalog.oid;
  v_priv pg_catalog.text;
BEGIN
  v_tables := ARRAY[v_ins, v_mark, v_auth, v_sup];

  -- 1. Role attributes and settings.
  SELECT pr.oid INTO v_entry FROM pg_catalog.pg_roles pr
  WHERE pr.rolname = c_entry AND NOT pr.rolsuper AND NOT pr.rolcreaterole AND NOT pr.rolcreatedb
    AND NOT pr.rolreplication AND NOT pr.rolbypassrls AND NOT pr.rolcanlogin AND pr.rolconfig IS NULL;
  IF v_entry IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: ROLE_ATTRIBUTES';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole = v_entry) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: ROLE_SETTINGS';
  END IF;

  -- 2. No membership edge that lets any role assume or inherit the entry role, and
  --    the entry role is a member of nothing. The one tolerated row is the ADMIN-only
  --    self-grant PostgreSQL 16+ gives a non-superuser CREATEROLE creator (no SET, no
  --    INHERIT) when it is the owner of the guarded tables: that DDL administrator
  --    can alter the tables and triggers anyway and is outside a database guard.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
             WHERE m.member = v_entry
                OR (m.roleid = v_entry
                    AND NOT (m.admin_option AND NOT m.set_option AND NOT m.inherit_option
                             AND m.member = (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = v_ins)))) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: MEMBERSHIP';
  END IF;

  -- 3. The role owns exactly one object: the entry RPC.
  --    (pg_shdepend is cluster-wide: only this database's rows and shared objects count.)
  IF (SELECT count(*) FROM pg_catalog.pg_shdepend d
      WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND d.refobjid = v_entry
        AND d.deptype = 'o' AND d.dbid IN (0, v_db)) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d
      WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND d.refobjid = v_entry
        AND d.deptype = 'o' AND d.dbid = v_db AND d.classid = v_prc AND d.objid = v_rpc
        AND d.objsubid = 0) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: OWNED_OBJECTS';
  END IF;

  -- 4. Every ACL entry naming the role is on the allowlist, with exactly the
  --    allowed privileges (column-level entries and default ACLs fail this).
  SELECT COALESCE(array_agg(format('%s:%s:%s', d.classid::pg_catalog.oid, d.objid::pg_catalog.oid, d.objsubid)
                            ORDER BY d.classid, d.objid, d.objsubid), '{}')
  INTO v_got
  FROM pg_catalog.pg_shdepend d
  WHERE d.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass AND d.refobjid = v_entry AND d.deptype = 'a'
    AND d.dbid IN (0, v_db);
  SELECT array_agg(x ORDER BY x) INTO v_want FROM unnest(ARRAY[
    format('%s:%s:0', v_nsp, v_ns), format('%s:%s:0', v_cls, v_ins), format('%s:%s:0', v_cls, v_mark),
    format('%s:%s:0', v_cls, v_auth), format('%s:%s:0', v_prc, v_prep),
    format('%s:%s:0', v_prc, v_eval), format('%s:%s:0', v_prc, v_assert),
    format('%s:%s:0', v_prc, v_member)]) x;
  SELECT array_agg(x ORDER BY x) INTO v_got FROM unnest(v_got) x;
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: ENTRY_ACL_SET';
  END IF;
  FOR r IN SELECT * FROM (VALUES (v_ins, 'INSERT'), (v_mark, 'DELETE,INSERT,SELECT'),
                                 (v_auth, 'INSERT')) w(tbl, want) LOOP
    SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) INTO v_privs
    FROM pg_catalog.pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = r.tbl AND a.grantee = v_entry;
    IF v_privs IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: ENTRY_TABLE_PRIVILEGES';
    END IF;
  END LOOP;
  IF (SELECT string_agg(a.privilege_type, ',') FROM pg_catalog.pg_namespace n, aclexplode(n.nspacl) a
      WHERE n.oid = v_ns AND a.grantee = v_entry) IS DISTINCT FROM 'USAGE'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                WHERE n.nspname !~ '^pg_(toast_)?temp_'
                  AND has_schema_privilege(v_entry, n.oid, 'CREATE'))
     OR has_database_privilege(v_entry, current_database(), 'CREATE') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: ENTRY_SCHEMA_PRIVILEGES';
  END IF;

  -- 5. No other credential can write the guarded stores directly, directly or by
  --    inheritance, at table or column level. Superusers and each table's owner
  --    are outside what a database guard can contain; the guard still refuses
  --    them (they are not the entry role).
  FOREACH t IN ARRAY v_tables LOOP
    FOR r IN SELECT ro.oid, ro.rolname FROM pg_catalog.pg_roles ro
             WHERE NOT ro.rolsuper AND ro.rolname !~ '^pg_' AND ro.oid <> v_entry
               AND ro.oid <> (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = t) LOOP
      FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        IF has_table_privilege(r.oid, t, v_priv)
           OR (v_priv IN ('INSERT','UPDATE') AND has_any_column_privilege(r.oid, t, v_priv)) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = format('QC_EXECUTION_GRAPH_OPEN_202: DIRECT_WRITE_PATH %s %s', r.rolname, v_priv);
        END IF;
      END LOOP;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c, aclexplode(c.relacl) a
               WHERE c.oid = t AND a.grantee = 0
                 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: DIRECT_WRITE_PATH PUBLIC';
    END IF;
  END LOOP;

  -- 6. Nobody but a superuser can switch session_replication_role (replica mode
  --    skips ordinary triggers). Includes inherited and explicit GRANT SET.
  FOR r IN SELECT ro.oid, ro.rolname FROM pg_catalog.pg_roles ro
           WHERE NOT ro.rolsuper AND ro.rolname !~ '^pg_' LOOP
    IF has_parameter_privilege(r.oid, 'session_replication_role', 'SET') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = format('QC_EXECUTION_GRAPH_OPEN_202: SESSION_REPLICATION_ROLE %s', r.rolname);
    END IF;
  END LOOP;

  -- 7. Triggers: exactly one INSERT trigger per guarded table — the guard, enabled
  --    ALWAYS, ROW|BEFORE|INSERT — and only the orphan check on the marker table.
  --    Any other trigger would run as the entry role.
  FOREACH t IN ARRAY ARRAY[v_ins, v_auth] LOOP
    IF (SELECT count(*) FROM pg_catalog.pg_trigger g
        WHERE g.tgrelid = t AND NOT g.tgisinternal AND (g.tgtype & 4) = 4) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
        WHERE g.tgrelid = t AND NOT g.tgisinternal AND (g.tgtype & 4) = 4
          AND g.tgfoid = v_guard AND g.tgenabled = 'A' AND g.tgtype = 7) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: INSERT_TRIGGERS';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger g
      WHERE g.tgrelid = v_mark AND NOT g.tgisinternal) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
      WHERE g.tgrelid = v_mark AND NOT g.tgisinternal AND g.tgname = 'qc_marker_orphan_check_202'
        AND g.tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: MARKER_TRIGGERS';
  END IF;

  -- 8. No non-catalog function or operator hides in a default, constraint or
  --    index of the stores the entry role writes.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_proc p ON d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.refobjid = p.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND ((d.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass AND d.objid IN (
              SELECT ad.oid FROM pg_catalog.pg_attrdef ad WHERE ad.adrelid = ANY (v_tables)))
        OR (d.classid = 'pg_catalog.pg_constraint'::pg_catalog.regclass AND d.objid IN (
              SELECT co.oid FROM pg_catalog.pg_constraint co WHERE co.conrelid = ANY (v_tables)))
        OR (d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid IN (
              SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = ANY (v_tables))))
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_operator o ON d.refclassid = 'pg_catalog.pg_operator'::pg_catalog.regclass AND d.refobjid = o.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND ((d.classid = 'pg_catalog.pg_attrdef'::pg_catalog.regclass AND d.objid IN (
              SELECT ad.oid FROM pg_catalog.pg_attrdef ad WHERE ad.adrelid = ANY (v_tables)))
        OR (d.classid = 'pg_catalog.pg_constraint'::pg_catalog.regclass AND d.objid IN (
              SELECT co.oid FROM pg_catalog.pg_constraint co WHERE co.conrelid = ANY (v_tables)))
        OR (d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid IN (
              SELECT i.indexrelid FROM pg_catalog.pg_index i WHERE i.indrelid = ANY (v_tables))))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: HIDDEN_ROUTINE';
  END IF;

  -- 8b. No column of a guarded store (or its array element type) may be a DOMAIN
  --     or composite type. A domain's CHECK is a function call that runs on every
  --     INSERT that supplies a value for that column, as whichever role performs
  --     the INSERT — the same mechanism as the pg_temp shadow this migration
  --     closes elsewhere, but reachable here by ALTER TABLE ... ALTER COLUMN TYPE
  --     (table ownership, not an ordinary login) rather than by an unqualified
  --     cast. Every column of the four stores must resolve, directly or through
  --     exactly one level of array, to a pg_catalog base type.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_type ety ON ety.oid = ty.typelem AND ty.typelem <> 0
    WHERE a.attrelid = ANY (v_tables) AND a.attnum > 0 AND NOT a.attisdropped
      AND (ty.typtype <> 'b' OR ty.typnamespace <> 'pg_catalog'::pg_catalog.regnamespace
           OR (ety.oid IS NOT NULL
               AND (ety.typtype <> 'b' OR ety.typnamespace <> 'pg_catalog'::pg_catalog.regnamespace)))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: COLUMN_TYPE';
  END IF;

  -- 8c. Every operator class backing an index on a guarded store must be a
  --     pg_catalog one. A user-defined operator class's support functions (used
  --     for comparison/hashing during INSERT and its unique-constraint checks,
  --     not just an expression in the index) would otherwise run as the
  --     inserting role, and section 8's dependency scan only follows expression
  --     functions, not opclass support functions.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i, unnest(i.indclass) AS used_opc
    JOIN pg_catalog.pg_opclass oc ON oc.oid = used_opc
    WHERE i.indrelid = ANY (v_tables) AND oc.opcnamespace <> 'pg_catalog'::pg_catalog.regnamespace
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: OPERATOR_CLASS';
  END IF;

  -- 8d. No rewrite rule on a guarded store. A rule (unlike a trigger) runs
  --     in place of, or in addition to, the original statement and is not
  --     covered by section 7's trigger inventory at all.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rw WHERE rw.ev_class = ANY (v_tables)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: REWRITE_RULE';
  END IF;

  -- 8e. The four stores are ordinary, non-partitioned tables with no ancestor or
  --     descendant in the inheritance/partition hierarchy (PostgreSQL implements
  --     both through pg_inherits). A child — plain INHERITS or an attached
  --     partition — does not automatically gain the parent's triggers, RLS or
  --     grants, so a direct write to it bypasses every guard above while a
  --     query against the parent (as the evaluator issues) can still see rows
  --     stored there. relkind also rules out a store later declared PARTITION
  --     BY with no partition attached yet.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class cl WHERE cl.oid = ANY (v_tables) AND cl.relkind <> 'r')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits ih
                WHERE ih.inhrelid = ANY (v_tables) OR ih.inhparent = ANY (v_tables)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: INHERITANCE';
  END IF;

  -- 9. RLS stays on and the only INSERT-capable policy is the entry role's own,
  --    pinned to its exact installed shape: PERMISSIVE, FOR INSERT, TO the entry
  --    role only, no USING qualifier, and a WITH CHECK that is the literal
  --    constant true. A WITH CHECK that calls a function would run that function
  --    (SECURITY INVOKER, so as the entry role) for every inserted row; the
  --    pg_get_expr text comparison rejects any such predicate -- and any other
  --    altered or RESTRICTIVE policy -- here, in the BEFORE INSERT guard, before
  --    the row reaches RLS evaluation.
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_ins)
     OR (SELECT count(*) FROM pg_catalog.pg_policy po
         WHERE po.polrelid = v_ins AND po.polcmd IN ('a','*')) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy po
         WHERE po.polrelid = v_ins AND po.polcmd = 'a'
           AND po.polname = 'quality_inspections_entry_insert_202'
           AND po.polroles = ARRAY[v_entry]::pg_catalog.oid[]
           AND po.polpermissive
           AND po.polqual IS NULL
           AND po.polwithcheck IS NOT NULL
           AND pg_catalog.pg_get_expr(po.polwithcheck, po.polrelid) = 'true') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: POLICIES';
  END IF;

  -- 10. The code that executes as the entry role is pinned: the RPC itself, the
  --     functions it calls, and the guard. Properties and ACL of the RPC too.
  FOR r IN SELECT * FROM (VALUES
      (v_rpc,   '88503b798e33108c9a4a70fe4ae4078c', true),
      (v_prep,  '59c37bde0173f6236ad3db146ed1b27c', false),
      (v_eval,  'fb8dd9fedf3cbf5da2cb26a17fd67eef', false),
      (v_guard, '87728ac9fe99afb1289af4e3ffd46d96', false)) w(fn, pin, owned) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                   WHERE p.oid = r.fn AND md5(p.prosrc) = r.pin AND p.prokind = 'f'
                     AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
                     AND (p.proowner = v_entry) = r.owned
                     AND (p.prosecdef = (r.fn <> v_guard))) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = format('QC_EXECUTION_GRAPH_OPEN_202: FUNCTION_PIN %s', r.fn::pg_catalog.regproc);
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     OR has_function_privilege('anon', v_rpc, 'EXECUTE')
     OR has_function_privilege('service_role', v_rpc, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = v_rpc AND a.grantee = 0) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: RPC_ACL';
  END IF;
  FOR r IN SELECT x.fn FROM unnest(ARRAY[v_prep, v_eval, v_assert]) x(fn) LOOP
    IF has_function_privilege('authenticated', r.fn, 'EXECUTE')
       OR has_function_privilege('anon', r.fn, 'EXECUTE')
       OR has_function_privilege('service_role', r.fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = r.fn AND a.grantee = 0) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'QC_EXECUTION_GRAPH_OPEN_202: HELPER_ACL';
    END IF;
  END LOOP;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The write guard (BEFORE INSERT on quality_inspections and the authority
--    link). SECURITY INVOKER so current_user is the role that executes the INSERT.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.qc_write_guard_202()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF current_user::text <> 'wardah_qc_entry_202' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_WRITE_PROVENANCE_REQUIRED_202',
      HINT = 'QC evidence is written only by rpc_record_quality_inspection.';
  END IF;
  IF pg_trigger_depth() <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_WRITE_NESTED_202';
  END IF;
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_WRITE_REPLICA_MODE_202';
  END IF;
  PERFORM wardah_internal.qc_assert_closed_graph_202();
  IF TG_TABLE_NAME = 'quality_inspections' THEN
    IF NOT EXISTS (
      SELECT 1 FROM wardah_internal.qc_entry_markers_202 m
      WHERE m.xid = pg_current_xact_id() AND m.backend_pid = pg_backend_pid()
        AND m.inspection_id = NEW.id AND m.org_id = NEW.org_id AND m.mo_id = NEW.mo_id
        AND m.request_id = NEW.request_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_WRITE_MARKER_REQUIRED_202';
    END IF;
  ELSIF TG_TABLE_NAME = 'quality_inspection_authority_202' THEN
    IF NOT EXISTS (
      SELECT 1 FROM wardah_internal.qc_entry_markers_202 m
      WHERE m.xid = pg_current_xact_id() AND m.backend_pid = pg_backend_pid()
        AND m.inspection_id = NEW.inspection_id AND m.org_id = NEW.org_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_WRITE_MARKER_REQUIRED_202';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QC_WRITE_PROVENANCE_REQUIRED_202';
  END IF;
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Evaluation (replaces the M199 body; same signature, ACL kept). Selection is
--    NULL-safe, scoped to the partition's latest authority revision, and refuses
--    (not ready) on corrupt authority metadata.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wardah_internal.evaluate_quality_release_199(
  p_org uuid, p_mo uuid, p_routing uuid, p_status text, p_completed_qty numeric
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_policy wardah_internal.quality_policies%ROWTYPE;
  v_required boolean;
  v_cycle integer;
  v_final public.quality_inspections%ROWTYPE;
  v_rev integer := 0;
  v_corrupt boolean := false;
  v_released numeric := 0;
  v_missing jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_policy FROM wardah_internal.quality_policies WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;

  v_required := CASE v_policy.release_gate_mode
    WHEN 'all_orders' THEN true
    WHEN 'routing_flagged' THEN p_routing IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.routing_operations ro
      WHERE ro.routing_id = p_routing AND ro.org_id = p_org
        AND COALESCE(ro.is_active, true)
        AND (COALESCE(ro.requires_inspection, false) OR ro.operation_type = 'INSPECTION'))
    ELSE false END;

  SELECT cycle INTO v_cycle FROM wardah_internal.mo_quality_cycles WHERE mo_id = p_mo;

  IF v_cycle IS NOT NULL THEN
    SELECT COALESCE(max(s.revision), 0) INTO v_rev
    FROM wardah_internal.quality_supersessions_202 s
    WHERE s.org_id = p_org AND s.mo_id = p_mo AND s.inspection_type = 'FINAL'
      AND s.qc_cycle = v_cycle;

    -- A link that belongs to another tenant or names a revision the partition
    -- never reached is corrupt: it must never read as a newer decision.
    v_corrupt := EXISTS (
      SELECT 1 FROM public.quality_inspections qi
      JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = qi.id
      WHERE qi.mo_id = p_mo AND qi.org_id = p_org AND qi.inspection_type = 'FINAL'
        AND qi.qc_cycle = v_cycle
        AND (a.org_id <> qi.org_id OR a.authority_revision > v_rev));

    SELECT qi.* INTO v_final FROM public.quality_inspections qi
    LEFT JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = qi.id
    WHERE qi.mo_id = p_mo AND qi.org_id = p_org AND qi.inspection_type = 'FINAL'
      AND qi.qc_cycle = v_cycle
      AND COALESCE(a.authority_revision, 0) = v_rev
    ORDER BY qi.inspection_seq DESC NULLS LAST, qi.id DESC LIMIT 1;
  END IF;

  IF v_final.id IS NOT NULL THEN
    v_released := CASE v_final.result
      WHEN 'PASS' THEN COALESCE(v_final.passed_quantity, 0)
      WHEN 'CONDITIONAL' THEN COALESCE(v_final.passed_quantity, 0)
                              + COALESCE(v_final.failed_quantity, 0)
      ELSE 0 END;
  END IF;

  IF v_policy.inspection_scope = 'stages_and_final' THEN
    v_corrupt := v_corrupt OR EXISTS (
      SELECT 1 FROM public.quality_inspections qi
      JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = qi.id
      WHERE qi.mo_id = p_mo AND qi.org_id = p_org AND qi.inspection_type = 'IN_PROCESS'
        AND (a.org_id <> qi.org_id
             OR a.authority_revision > COALESCE((
               SELECT max(x.revision) FROM wardah_internal.quality_supersessions_202 x
               WHERE x.org_id = p_org AND x.mo_id = p_mo AND x.inspection_type = 'IN_PROCESS'
                 AND x.stage_id = qi.stage_id), 0)));

    SELECT COALESCE(jsonb_agg(s.stage_id ORDER BY s.stage_id), '[]'::jsonb) INTO v_missing
    FROM (SELECT DISTINCT w.stage_id FROM public.stage_wip_log w
          WHERE w.mo_id = p_mo AND w.org_id = p_org) s
    WHERE NOT EXISTS (
      SELECT 1 FROM (
        SELECT qi.result FROM public.quality_inspections qi
        LEFT JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = qi.id
        WHERE qi.mo_id = p_mo AND qi.org_id = p_org
          AND qi.inspection_type = 'IN_PROCESS' AND qi.stage_id = s.stage_id
          AND COALESCE(a.authority_revision, 0) = COALESCE((
            SELECT max(x.revision) FROM wardah_internal.quality_supersessions_202 x
            WHERE x.org_id = p_org AND x.mo_id = p_mo AND x.inspection_type = 'IN_PROCESS'
              AND x.stage_id = s.stage_id), 0)
        ORDER BY qi.inspection_seq DESC NULLS LAST, qi.id DESC LIMIT 1
      ) latest
      WHERE latest.result = 'PASS'
         OR (latest.result = 'CONDITIONAL' AND v_policy.allow_conditional_release));
  END IF;

  v_reason := CASE
    WHEN public.normalize_mo_status(p_status) IS DISTINCT FROM 'quality_check'
      THEN 'QUALITY_CHECK_STATUS_REQUIRED'
    WHEN v_corrupt THEN 'QUALITY_AUTHORITY_CORRUPT'
    WHEN v_final.id IS NULL THEN 'QUALITY_RELEASE_REQUIRED'
    WHEN v_final.result = 'FAIL' THEN 'QUALITY_RELEASE_REJECTED'
    WHEN v_final.result = 'CONDITIONAL' AND NOT v_policy.allow_conditional_release
      THEN 'QUALITY_CONDITIONAL_RELEASE_DISABLED'
    WHEN jsonb_array_length(v_missing) > 0 THEN 'QUALITY_STAGE_INSPECTION_REQUIRED'
    WHEN p_completed_qty IS NOT NULL AND p_completed_qty > v_released
      THEN 'QUALITY_RELEASE_QUANTITY_EXCEEDED'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'gate_mode', v_policy.release_gate_mode,
    'inspection_scope', v_policy.inspection_scope,
    'allow_conditional_release', v_policy.allow_conditional_release,
    'required', v_required,
    'ready', (NOT v_required) OR v_reason IS NULL,
    'reason', CASE WHEN v_required THEN v_reason END,
    'blocking_reason_if_required', v_reason,
    'qc_cycle', v_cycle,
    'authority_revision', v_rev,
    'released_quantity', v_released,
    'missing_stage_ids', v_missing,
    'final_inspection', CASE WHEN v_final.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_final.id, 'inspection_number', v_final.inspection_number,
      'result', v_final.result, 'passed_quantity', v_final.passed_quantity,
      'failed_quantity', v_final.failed_quantity, 'disposition', v_final.disposition,
      'inspector_id', v_final.inspector_id, 'inspection_date', v_final.inspection_date) END);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Recording. The M199 validation, numbering and idempotency run unchanged in a
--    postgres-owned helper that writes no inspection; the entry-role RPC
--    performs the single guarded write.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.qc_prepare_inspection_202(
  p_mo_id uuid, p_request_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_org uuid;
  v_actor uuid := auth.uid();
  v_mo public.manufacturing_orders%ROWTYPE;
  v_policy wardah_internal.quality_policies%ROWTYPE;
  v_existing public.quality_inspections%ROWTYPE;
  v_type text; v_result text; v_disposition text; v_stage uuid;
  v_passed numeric; v_failed numeric; v_sample numeric;
  v_findings text; v_corrective text; v_specs text;
  v_request jsonb; v_hash text; v_seq bigint; v_cycle integer;
  v_status text; v_id uuid := gen_random_uuid(); v_rev integer := 0;
  v_number text; v_date timestamptz := clock_timestamp();
BEGIN
  SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id = p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'QUALITY_REQUEST_ID_REQUIRED'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'QUALITY_PAYLOAD_INVALID';
  END IF;

  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = p_mo_id FOR UPDATE;
  IF v_mo.org_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_policy FROM wardah_internal.quality_policies
  WHERE org_id = v_org FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;

  IF NOT wardah_internal.quality_actor_can_199(v_org,
       'manufacturing.quality_inspections.create', v_policy.admins_subject_to_quality_controls) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_INSPECT_PERMISSION_DENIED';
  END IF;

  v_type := upper(btrim(COALESCE(p_payload->>'inspection_type','')));
  v_result := upper(btrim(COALESCE(p_payload->>'result','')));
  v_disposition := NULLIF(lower(btrim(COALESCE(p_payload->>'disposition',''))), '');
  v_findings := NULLIF(btrim(COALESCE(p_payload->>'findings','')), '');
  v_corrective := NULLIF(btrim(COALESCE(p_payload->>'corrective_action','')), '');
  v_specs := NULLIF(btrim(COALESCE(p_payload->>'specifications','')), '');
  IF jsonb_typeof(p_payload->'passed_quantity') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'failed_quantity') IS DISTINCT FROM 'number'
     OR (p_payload ? 'sample_size' AND jsonb_typeof(p_payload->'sample_size') NOT IN ('number','null'))
     OR (p_payload ? 'stage_id' AND jsonb_typeof(p_payload->'stage_id') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'QUALITY_PAYLOAD_INVALID';
  END IF;
  v_passed := (p_payload->>'passed_quantity')::numeric;
  v_failed := (p_payload->>'failed_quantity')::numeric;
  v_sample := (p_payload->>'sample_size')::numeric;
  BEGIN
    v_stage := NULLIF(p_payload->>'stage_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'QUALITY_PAYLOAD_INVALID';
  END;
  v_request := jsonb_build_object(
    'mo_id', p_mo_id, 'inspection_type', v_type, 'result', v_result,
    'passed_quantity', v_passed, 'failed_quantity', v_failed, 'sample_size', v_sample,
    'disposition', v_disposition, 'stage_id', v_stage, 'findings', v_findings,
    'corrective_action', v_corrective, 'specifications', v_specs);
  v_hash := md5(v_request::text);

  SELECT * INTO v_existing FROM public.quality_inspections
  WHERE org_id = v_org AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash = v_hash AND v_existing.inspector_id = v_actor
       AND v_existing.mo_id = p_mo_id THEN
      RETURN jsonb_build_object('replayed', true, 'org_id', v_org, 'response', jsonb_build_object(
        'replayed', true, 'inspection_id', v_existing.id,
        'inspection_number', v_existing.inspection_number, 'result', v_existing.result,
        'qc_cycle', v_existing.qc_cycle,
        'release', wardah_internal.evaluate_quality_release_199(
          v_org, p_mo_id, v_mo.routing_id, v_mo.status, NULL)));
    END IF;
    RAISE EXCEPTION 'QUALITY_REQUEST_ID_REUSED';
  END IF;

  IF v_type NOT IN ('IN_PROCESS','FINAL') THEN RAISE EXCEPTION 'QUALITY_INSPECTION_TYPE_INVALID'; END IF;
  IF v_result NOT IN ('PASS','FAIL','CONDITIONAL') THEN RAISE EXCEPTION 'QUALITY_RESULT_INVALID'; END IF;
  IF v_passed < 0 OR v_failed < 0 OR v_passed + v_failed <= 0
     OR (v_sample IS NOT NULL AND v_sample < 0) THEN
    RAISE EXCEPTION 'QUALITY_INVALID_QUANTITY';
  END IF;
  IF v_disposition IS NOT NULL AND v_disposition NOT IN ('scrap','rework','use_as_is') THEN
    RAISE EXCEPTION 'QUALITY_DISPOSITION_INVALID';
  END IF;
  IF v_failed > 0 AND v_disposition IS NULL THEN RAISE EXCEPTION 'QUALITY_DISPOSITION_REQUIRED'; END IF;
  IF v_failed = 0 AND v_disposition IS NOT NULL THEN RAISE EXCEPTION 'QUALITY_DISPOSITION_NOT_ALLOWED'; END IF;
  IF v_result = 'FAIL' AND v_failed = 0 THEN RAISE EXCEPTION 'QUALITY_FAIL_REQUIRES_REJECTED_QUANTITY'; END IF;
  IF v_result = 'CONDITIONAL' AND (v_failed = 0 OR v_disposition <> 'use_as_is') THEN
    RAISE EXCEPTION 'QUALITY_CONDITIONAL_REQUIRES_USE_AS_IS';
  END IF;
  IF v_disposition = 'use_as_is' AND v_result <> 'CONDITIONAL' THEN
    RAISE EXCEPTION 'QUALITY_USE_AS_IS_REQUIRES_CONDITIONAL';
  END IF;
  IF v_result IN ('FAIL','CONDITIONAL') AND v_corrective IS NULL THEN
    RAISE EXCEPTION 'QUALITY_CORRECTIVE_ACTION_REQUIRED';
  END IF;

  v_status := public.normalize_mo_status(v_mo.status);
  IF v_type = 'FINAL' THEN
    IF v_stage IS NOT NULL THEN RAISE EXCEPTION 'QUALITY_STAGE_NOT_ALLOWED'; END IF;
    IF v_status <> 'quality_check' THEN RAISE EXCEPTION 'QUALITY_CHECK_STATUS_REQUIRED'; END IF;
  ELSE
    IF v_stage IS NULL THEN RAISE EXCEPTION 'QUALITY_STAGE_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manufacturing_stages
                   WHERE id = v_stage AND org_id = v_org) THEN
      RAISE EXCEPTION 'QUALITY_STAGE_NOT_FOUND';
    END IF;
    IF v_status NOT IN ('in_progress','quality_check') THEN
      RAISE EXCEPTION 'QUALITY_MO_STATUS_INVALID: %', v_status;
    END IF;
  END IF;

  IF v_result = 'CONDITIONAL' THEN
    IF NOT v_policy.allow_conditional_release THEN
      RAISE EXCEPTION 'QUALITY_CONDITIONAL_RELEASE_DISABLED';
    END IF;
    IF NOT wardah_internal.quality_actor_can_199(v_org,
         'manufacturing.quality_inspections.approve_conditional',
         v_policy.admins_subject_to_quality_controls) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_CONDITIONAL_PERMISSION_DENIED';
    END IF;
  END IF;

  IF v_policy.segregation_of_duties
     AND (v_policy.admins_subject_to_quality_controls
          OR NOT wardah_internal.quality_is_admin_199(v_org))
     AND wardah_internal.quality_is_production_participant_199(p_mo_id, v_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_SEGREGATION_OF_DUTIES';
  END IF;

  LOOP
    INSERT INTO wardah_internal.quality_inspection_counters(org_id, last_number)
    VALUES (v_org, 1)
    ON CONFLICT (org_id) DO UPDATE
      SET last_number = wardah_internal.quality_inspection_counters.last_number + 1
    RETURNING last_number INTO v_seq;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.quality_inspections
      WHERE org_id = v_org AND inspection_number = 'QI-' || lpad(v_seq::text, 6, '0'));
  END LOOP;
  v_number := 'QI-' || lpad(v_seq::text, 6, '0');
  SELECT cycle INTO v_cycle FROM wardah_internal.mo_quality_cycles WHERE mo_id = p_mo_id;

  -- The new evidence joins the partition's current authority revision (the MO row
  -- lock above serializes this with a concurrent supersession).
  IF v_type = 'FINAL' THEN
    IF v_cycle IS NULL THEN RAISE EXCEPTION 'QUALITY_QC_CYCLE_MISSING'; END IF;
    SELECT COALESCE(max(s.revision), 0) INTO v_rev
    FROM wardah_internal.quality_supersessions_202 s
    WHERE s.org_id = v_org AND s.mo_id = p_mo_id AND s.inspection_type = 'FINAL'
      AND s.qc_cycle = v_cycle;
  ELSE
    SELECT COALESCE(max(s.revision), 0) INTO v_rev
    FROM wardah_internal.quality_supersessions_202 s
    WHERE s.org_id = v_org AND s.mo_id = p_mo_id AND s.inspection_type = 'IN_PROCESS'
      AND s.stage_id = v_stage;
  END IF;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata)
  VALUES (v_org, v_actor, 'manufacturing.quality_inspection.create', 'quality_inspection',
    v_id::text, NULL, v_request || jsonb_build_object(
      'inspection_number', v_number, 'qc_cycle', v_cycle),
    jsonb_build_object('source','rpc_record_quality_inspection','migration',199,
      'policy_version', v_policy.version, 'request_id', p_request_id,
      'authority_revision', v_rev));

  RETURN jsonb_build_object('replayed', false, 'org_id', v_org,
    'authority_revision', v_rev, 'routing_id', v_mo.routing_id, 'status', v_mo.status,
    'row', jsonb_build_object(
      'id', v_id, 'org_id', v_org, 'mo_id', p_mo_id, 'stage_id', v_stage,
      'inspection_number', v_number, 'inspection_type', v_type, 'inspector_id', v_actor,
      'sample_size', COALESCE(v_sample, v_passed + v_failed),
      'passed_quantity', v_passed, 'failed_quantity', v_failed, 'result', v_result,
      'inspection_date', v_date, 'specifications', v_specs, 'findings', v_findings,
      'corrective_action', v_corrective, 'qc_cycle', v_cycle, 'inspection_seq', v_seq,
      'disposition', v_disposition, 'request_id', p_request_id, 'request_hash', v_hash));
END
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_record_quality_inspection(
  p_mo_id uuid, p_request_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prep jsonb;
  v_row jsonb;
  v_id uuid;
  v_org uuid;
BEGIN
  v_prep := wardah_internal.qc_prepare_inspection_202(p_mo_id, p_request_id, p_payload);
  -- The helper asserted membership already; the writing function states it again
  -- for the organization the helper resolved, so it never depends on the helper alone.
  v_org := (v_prep->>'org_id')::uuid;
  PERFORM public.wardah_assert_org_member(v_org);
  IF (v_prep->>'replayed')::boolean THEN RETURN v_prep->'response'; END IF;
  v_row := v_prep->'row';
  v_id := (v_row->>'id')::uuid;

  INSERT INTO wardah_internal.qc_entry_markers_202(
    xid, backend_pid, org_id, mo_id, request_id, inspection_id)
  VALUES (pg_current_xact_id(), pg_backend_pid(), v_org, p_mo_id, p_request_id, v_id);

  INSERT INTO public.quality_inspections(
    id, org_id, work_order_id, mo_id, stage_id, inspection_number, inspection_type,
    inspector_id, sample_size, passed_quantity, failed_quantity, result,
    inspection_date, specifications, findings, corrective_action,
    qc_cycle, inspection_seq, disposition, request_id, request_hash)
  VALUES (
    v_id, v_org, NULL, p_mo_id, (v_row->>'stage_id')::uuid, v_row->>'inspection_number',
    v_row->>'inspection_type', (v_row->>'inspector_id')::uuid,
    (v_row->>'sample_size')::numeric, (v_row->>'passed_quantity')::numeric,
    (v_row->>'failed_quantity')::numeric, v_row->>'result',
    (v_row->>'inspection_date')::timestamptz, v_row->>'specifications', v_row->>'findings',
    v_row->>'corrective_action', (v_row->>'qc_cycle')::integer,
    (v_row->>'inspection_seq')::bigint, v_row->>'disposition', p_request_id,
    v_row->>'request_hash');

  INSERT INTO wardah_internal.quality_inspection_authority_202(
    inspection_id, org_id, authority_revision)
  VALUES (v_id, v_org, (v_prep->>'authority_revision')::integer);

  DELETE FROM wardah_internal.qc_entry_markers_202
  WHERE xid = pg_current_xact_id() AND inspection_id = v_id;

  RETURN jsonb_build_object('replayed', false, 'inspection_id', v_id,
    'inspection_number', v_row->>'inspection_number', 'result', v_row->>'result',
    'qc_cycle', (v_row->>'qc_cycle')::integer,
    'release', wardah_internal.evaluate_quality_release_199(
      v_org, p_mo_id, (v_prep->>'routing_id')::uuid, v_prep->>'status', NULL));
END
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Listing (replaces the M199 body). Rows are ordered inside each release
--    partition exactly as the gate resolves it -- authority revision first, then
--    sequence, then id -- so a legacy row with an arbitrary high sequence can
--    never be listed ahead of genuine evidence recorded at a later revision.
--    Partitions: FINAL by QC cycle, IN_PROCESS by stage (the gate's own
--    definitions; the gate additionally reads only the MO's current non-null
--    cycle for FINAL). Partitions are listed by their head row, newest first.
--    Each row carries its authority revision, whether a supersession retired it,
--    the partition's latest supersession revision, and an explicit status:
--    CURRENT, SUPERSEDED, or SUPERSEDED_AWAITING_REPLACEMENT (the latest
--    remediation revision has no genuine inspection yet; the gate stays blocked).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_quality_inspections(
  p_org_id uuid, p_mo_id uuid DEFAULT NULL, p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT COALESCE(public.has_permission(auth.uid(), p_org_id,
       'manufacturing.quality_inspections.read'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_READ_PERMISSION_DENIED';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(page.row_data ORDER BY page.head_seq DESC NULLS LAST, page.head_id DESC, page.rn)
    FROM (
      SELECT w.row_data, w.head_seq, w.head_id, w.rn
      FROM (
        SELECT
          row_number() OVER part AS rn,
          first_value(b.seq) OVER part AS head_seq,
          first_value(b.id) OVER part AS head_id,
          jsonb_build_object(
            'id', b.id, 'inspection_number', b.inspection_number,
            'inspection_type', b.inspection_type, 'result', b.result,
            'mo_id', b.mo_id, 'order_number', b.order_number,
            'work_order_id', b.work_order_id,
            'stage_id', b.stage_id, 'stage_name', b.stage_name, 'stage_name_ar', b.stage_name_ar,
            'qc_cycle', b.qc_cycle, 'sample_size', b.sample_size,
            'passed_quantity', b.passed_quantity, 'failed_quantity', b.failed_quantity,
            'disposition', b.disposition, 'findings', b.findings,
            'corrective_action', b.corrective_action, 'specifications', b.specifications,
            'inspector_id', b.inspector_id,
            'inspector_name', b.inspector_name,
            'inspection_date', b.inspection_date,
            'authority_revision', COALESCE(b.rev, 0),
            'superseded', COALESCE(b.rev, 0) < b.part_rev,
            'partition_revision', b.part_rev,
            'awaiting_replacement', b.awaiting,
            'authority_status', CASE
              WHEN b.awaiting THEN 'SUPERSEDED_AWAITING_REPLACEMENT'
              WHEN COALESCE(b.rev, 0) < b.part_rev THEN 'SUPERSEDED'
              ELSE 'CURRENT' END) AS row_data
        FROM (
          SELECT qi.id, qi.mo_id, qi.inspection_type, qi.qc_cycle, qi.stage_id,
            qi.inspection_seq AS seq, qi.inspection_number, qi.result, qi.work_order_id,
            qi.sample_size, qi.passed_quantity, qi.failed_quantity, qi.disposition,
            qi.findings, qi.corrective_action, qi.specifications, qi.inspector_id,
            qi.inspection_date, mo.order_number, st.name AS stage_name,
            st.name_ar AS stage_name_ar,
            COALESCE(up.full_name_ar, up.full_name) AS inspector_name,
            au.authority_revision AS rev,
            ps.part_rev,
            (ps.part_rev > 0 AND NOT EXISTS (
               SELECT 1 FROM public.quality_inspections q2
               LEFT JOIN wardah_internal.quality_inspection_authority_202 a2
                 ON a2.inspection_id = q2.id
               WHERE q2.org_id = qi.org_id AND q2.mo_id = qi.mo_id
                 AND q2.inspection_type = qi.inspection_type
                 AND ((qi.inspection_type = 'FINAL' AND q2.qc_cycle = qi.qc_cycle)
                   OR (qi.inspection_type = 'IN_PROCESS' AND q2.stage_id = qi.stage_id))
                 AND COALESCE(a2.authority_revision, 0) = ps.part_rev)) AS awaiting
          FROM public.quality_inspections qi
          LEFT JOIN wardah_internal.quality_inspection_authority_202 au ON au.inspection_id = qi.id
          LEFT JOIN public.manufacturing_orders mo ON mo.id = qi.mo_id
          LEFT JOIN public.manufacturing_stages st ON st.id = qi.stage_id
          LEFT JOIN LATERAL (
            SELECT u.full_name, u.full_name_ar FROM public.user_profiles u
            WHERE u.user_id = qi.inspector_id LIMIT 1) up ON true
          CROSS JOIN LATERAL (
            SELECT COALESCE(max(s.revision), 0) AS part_rev
            FROM wardah_internal.quality_supersessions_202 s
            WHERE s.org_id = qi.org_id AND s.mo_id = qi.mo_id
              AND s.inspection_type = qi.inspection_type
              AND ((qi.inspection_type = 'FINAL' AND s.qc_cycle = qi.qc_cycle)
                OR (qi.inspection_type = 'IN_PROCESS' AND s.stage_id = qi.stage_id))) ps
          WHERE qi.org_id = p_org_id
            AND (p_mo_id IS NULL OR qi.mo_id = p_mo_id)
        ) b
        WINDOW part AS (
          PARTITION BY b.mo_id, b.inspection_type,
            CASE WHEN b.inspection_type = 'FINAL' THEN b.qc_cycle END,
            CASE WHEN b.inspection_type = 'IN_PROCESS' THEN b.stage_id END
          ORDER BY COALESCE(b.rev, 0) DESC, b.seq DESC NULLS LAST, b.id DESC)
      ) w
      ORDER BY w.head_seq DESC NULLS LAST, w.head_id DESC, w.rn
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    ) page), '[]'::jsonb);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 9. Append-only supersession RPC (org admin). Never edits or deletes evidence;
--    raises the partition's authority revision, so the gate stays closed until a
--    genuine inspection is recorded at the new revision. Needs an owner-approved
--    forensics policy before any production use (runbook section 6).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rpc_supersede_quality_evidence_202(
  p_mo_id uuid, p_inspection_type text, p_stage_id uuid, p_expected_revision integer,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_org uuid;
  v_mo public.manufacturing_orders%ROWTYPE;
  v_type text := upper(btrim(COALESCE(p_inspection_type, '')));
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_cycle integer;
  v_current integer;
  v_ids uuid[];
BEGIN
  SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id = p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT wardah_internal.quality_is_admin_199(v_org) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_SUPERSEDE_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = p_mo_id FOR UPDATE;
  IF v_mo.org_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'QUALITY_SUPERSEDE_REASON_REQUIRED'; END IF;
  IF v_type NOT IN ('FINAL','IN_PROCESS') THEN RAISE EXCEPTION 'QUALITY_INSPECTION_TYPE_INVALID'; END IF;

  IF v_type = 'FINAL' THEN
    IF p_stage_id IS NOT NULL THEN RAISE EXCEPTION 'QUALITY_STAGE_NOT_ALLOWED'; END IF;
    SELECT cycle INTO v_cycle FROM wardah_internal.mo_quality_cycles WHERE mo_id = p_mo_id;
    IF v_cycle IS NULL THEN RAISE EXCEPTION 'QUALITY_QC_CYCLE_MISSING'; END IF;
    SELECT COALESCE(max(s.revision), 0) INTO v_current
    FROM wardah_internal.quality_supersessions_202 s
    WHERE s.org_id = v_org AND s.mo_id = p_mo_id AND s.inspection_type = 'FINAL'
      AND s.qc_cycle = v_cycle;
  ELSE
    IF p_stage_id IS NULL THEN RAISE EXCEPTION 'QUALITY_STAGE_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manufacturing_stages
                   WHERE id = p_stage_id AND org_id = v_org) THEN
      RAISE EXCEPTION 'QUALITY_STAGE_NOT_FOUND';
    END IF;
    SELECT COALESCE(max(s.revision), 0) INTO v_current
    FROM wardah_internal.quality_supersessions_202 s
    WHERE s.org_id = v_org AND s.mo_id = p_mo_id AND s.inspection_type = 'IN_PROCESS'
      AND s.stage_id = p_stage_id;
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_current THEN
    RAISE EXCEPTION 'QUALITY_SUPERSESSION_REVISION_CONFLICT: current=%', v_current;
  END IF;

  SELECT COALESCE(array_agg(qi.id ORDER BY qi.id), '{}') INTO v_ids
  FROM public.quality_inspections qi
  LEFT JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = qi.id
  WHERE qi.mo_id = p_mo_id AND qi.org_id = v_org AND qi.inspection_type = v_type
    AND ((v_type = 'FINAL' AND qi.qc_cycle = v_cycle) OR (v_type = 'IN_PROCESS' AND qi.stage_id = p_stage_id))
    AND COALESCE(a.authority_revision, 0) = v_current;

  INSERT INTO wardah_internal.quality_supersessions_202(
    org_id, mo_id, inspection_type, stage_id, qc_cycle, revision, reason,
    superseded_inspection_ids, approved_by)
  VALUES (v_org, p_mo_id, v_type, p_stage_id, v_cycle, v_current + 1, v_reason,
    v_ids, auth.uid());

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata)
  VALUES (v_org, auth.uid(), 'manufacturing.quality_evidence.supersede', 'manufacturing_order',
    p_mo_id::text, jsonb_build_object('authority_revision', v_current),
    jsonb_build_object('authority_revision', v_current + 1, 'inspection_type', v_type,
      'stage_id', p_stage_id, 'qc_cycle', v_cycle, 'reason', v_reason,
      'superseded_inspection_ids', to_jsonb(v_ids)),
    jsonb_build_object('source','rpc_supersede_quality_evidence_202','migration',202));

  RETURN jsonb_build_object('mo_id', p_mo_id, 'inspection_type', v_type,
    'stage_id', p_stage_id, 'qc_cycle', v_cycle, 'revision', v_current + 1,
    'superseded_inspection_ids', to_jsonb(v_ids),
    'release', wardah_internal.evaluate_quality_release_199(
      v_org, p_mo_id, v_mo.routing_id, v_mo.status, NULL));
END
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Triggers, policy, grants and the ownership switch.
-- ---------------------------------------------------------------------------
CREATE TRIGGER qc_write_guard_202
BEFORE INSERT ON public.quality_inspections
FOR EACH ROW EXECUTE FUNCTION wardah_internal.qc_write_guard_202();
CREATE TRIGGER qc_write_guard_202
BEFORE INSERT ON wardah_internal.quality_inspection_authority_202
FOR EACH ROW EXECUTE FUNCTION wardah_internal.qc_write_guard_202();
-- ALWAYS: session_replication_role = replica must not skip the guard.
ALTER TABLE public.quality_inspections ENABLE ALWAYS TRIGGER qc_write_guard_202;
ALTER TABLE wardah_internal.quality_inspection_authority_202
  ENABLE ALWAYS TRIGGER qc_write_guard_202;

-- F1: no direct privilege for any client or server credential. Table-level REVOKE
-- also removes column-level entries; the postflight reads both back.
REVOKE ALL ON TABLE public.quality_inspections FROM PUBLIC, anon, authenticated, service_role;
-- Insert policy for the entry role only (RLS stays enabled; service_role's
-- BYPASSRLS is irrelevant once it holds no privilege).
CREATE POLICY quality_inspections_entry_insert_202 ON public.quality_inspections
  AS PERMISSIVE FOR INSERT TO wardah_qc_entry_202 WITH CHECK (true);

REVOKE ALL ON FUNCTION wardah_internal.qc_assert_closed_graph_202()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA wardah_internal TO wardah_qc_entry_202;
GRANT INSERT ON public.quality_inspections TO wardah_qc_entry_202;
GRANT SELECT, INSERT, DELETE ON wardah_internal.qc_entry_markers_202 TO wardah_qc_entry_202;
GRANT INSERT ON wardah_internal.quality_inspection_authority_202 TO wardah_qc_entry_202;
GRANT EXECUTE ON FUNCTION wardah_internal.qc_prepare_inspection_202(uuid,uuid,jsonb)
  TO wardah_qc_entry_202;
GRANT EXECUTE ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)
  TO wardah_qc_entry_202;
GRANT EXECUTE ON FUNCTION wardah_internal.qc_assert_closed_graph_202()
  TO wardah_qc_entry_202;
GRANT EXECUTE ON FUNCTION public.wardah_assert_org_member(uuid) TO wardah_qc_entry_202;

-- CREATE OR REPLACE kept the ACLs of the two replaced RPCs; state them again
-- while the executing role still owns the function (ALTER OWNER carries them over).
REVOKE ALL ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.rpc_list_quality_inspections(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_list_quality_inspections(uuid,uuid,integer) TO authenticated;

-- ALTER OWNER needs the new owner's SET membership and CREATE on the schema for
-- the executing role. Both are granted and removed here, so nothing remains.
GRANT wardah_qc_entry_202 TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA public TO wardah_qc_entry_202;
ALTER FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb)
  OWNER TO wardah_qc_entry_202;
REVOKE CREATE ON SCHEMA public FROM wardah_qc_entry_202;
REVOKE wardah_qc_entry_202 FROM CURRENT_USER;

-- Closed helper ACLs (re-asserted after the last CREATE TRIGGER of this file).
REVOKE ALL ON FUNCTION wardah_internal.deny_qc_history_change_202()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.qc_marker_orphan_check_202()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.qc_write_guard_202()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.rpc_supersede_quality_evidence_202(uuid,text,uuid,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_supersede_quality_evidence_202(uuid,text,uuid,integer,text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. Postflight (fail closed).
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_role text; v_priv text; v_tbl text; v_mismatch text;
BEGIN
  -- The closed execution graph, as the guard evaluates it on every insert.
  PERFORM wardah_internal.qc_assert_closed_graph_202();

  -- F1: service_role (and the others) hold nothing on QC evidence, table or column.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH v_tbl IN ARRAY ARRAY['public.quality_inspections',
        'wardah_internal.qc_entry_markers_202','wardah_internal.quality_inspection_authority_202',
        'wardah_internal.quality_supersessions_202'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(v_role, v_tbl, v_priv)
           OR (v_priv IN ('SELECT','INSERT','UPDATE','REFERENCES')
               AND has_any_column_privilege(v_role, v_tbl, v_priv)) THEN
          RAISE EXCEPTION 'M202_DIRECT_GRANT_REMAINS: % % %', v_role, v_tbl, v_priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
             WHERE c.oid = 'public.quality_inspections'::regclass AND a.grantee = 0) THEN
    RAISE EXCEPTION 'M202_PUBLIC_GRANT_REMAINS';
  END IF;

  -- The creator's temporary SET membership and CREATE grant are gone (an ADMIN-only
  -- self-grant from CREATE ROLE by a non-superuser creator may remain; see the graph
  -- assertion).
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
             WHERE r.rolname = 'wardah_qc_entry_202' AND (m.set_option OR m.inherit_option))
     OR has_schema_privilege('wardah_qc_entry_202', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'M202_TEMPORARY_ACCESS_REMAINS';
  END IF;

  -- M193 / M199 history protection is intact; the new guard is enabled ALWAYS.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.quality_inspections'::regclass
        AND tgname IN ('deny_history_truncate_193','deny_quality_inspection_change_199')
        AND tgenabled = 'O') <> 2
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'qc_write_guard_202'
         AND NOT tgisinternal AND tgenabled = 'A') <> 2 THEN
    RAISE EXCEPTION 'M202_TRIGGER_STATE';
  END IF;

  -- The five M201 functions are exactly as 201 left them.
  SELECT string_agg(e.sig, '; ') INTO v_mismatch
  FROM (VALUES
    ('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)', '68a55461e73a5829728b45f430d4db59'),
    ('public.rpc_set_material_issue_wo_statuses(uuid,text[])', 'cd01220eab3266ce28744821825b0915'),
    ('public.rpc_set_quality_policy(uuid,jsonb,bigint)', '782b30957175c20cfff71b6c9a3ee26d'),
    ('public.rpc_get_quality_policy(uuid)', '95347a01c938b4295d17e02e723b97ab'),
    ('public.create_role_from_template(uuid,uuid,character varying,uuid)', 'd1d315bab6f854a846624d79006b6008')
  ) AS e(sig, body_md5)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE md5(p.prosrc) IS DISTINCT FROM e.body_md5;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M202_M201_BODY_CHANGED: %', v_mismatch;
  END IF;

  -- Public client RPC grants: authenticated only.
  FOR v_tbl IN SELECT unnest(ARRAY[
      'public.rpc_record_quality_inspection(uuid,uuid,jsonb)',
      'public.rpc_list_quality_inspections(uuid,uuid,integer)',
      'public.rpc_supersede_quality_evidence_202(uuid,text,uuid,integer,text)']) LOOP
    IF has_function_privilege('anon', v_tbl, 'EXECUTE')
       OR has_function_privilege('service_role', v_tbl, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_tbl, 'EXECUTE') THEN
      RAISE EXCEPTION 'M202_RPC_GRANT_DRIFT: %', v_tbl;
    END IF;
  END LOOP;
  -- M195 containment survives.
  IF has_table_privilege('authenticated','public.manufacturing_orders','UPDATE') THEN
    RAISE EXCEPTION 'M202_M195_CONTAINMENT_DRIFT';
  END IF;

  -- Section 0: the two ALTER FUNCTION statements changed only proconfig.
  -- M199's files are untouched; prove it here, not just assume it from the
  -- statement's shape.
  SELECT string_agg(e.sig, '; ') INTO v_mismatch
  FROM (VALUES
    ('wardah_internal.mo_quality_gate_199()', 'e2cf479d7a63eb9345bba34cef2bac1c'),
    ('wardah_internal.mo_quality_insert_199()', '0dd1403d7f0aaf7935f1ff4beaa26ed7')
  ) AS e(sig, body_md5)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
  WHERE md5(p.prosrc) IS DISTINCT FROM e.body_md5
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[];
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'M202_M199_TRIGGER_SEARCH_PATH_NOT_APPLIED: %', v_mismatch;
  END IF;
END
$postflight$;

-- Final ACL statement of the two postgres-owned DEFINER helpers that carry no
-- client-facing guard. Restated after the postflight, which calls same-file
-- routines, so the closure is the last word of the file (the DEFINER scanner
-- replays file order). The recording RPC is owned by the entry role by now and
-- carries its own membership assertion instead.
REVOKE ALL ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)
  TO wardah_qc_entry_202;
REVOKE ALL ON FUNCTION wardah_internal.qc_marker_orphan_check_202()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
