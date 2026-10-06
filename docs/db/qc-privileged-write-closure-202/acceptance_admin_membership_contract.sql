-- Acceptance-contract correction for the M202 creator membership.
-- Included by acceptance.sql. Not a migration, and migration 202 is unchanged.
--
-- qc_assert_closed_graph_202() already allows one incoming edge: ADMIN true,
-- SET false, INHERIT false, and the member is the owner of quality_inspections.
-- Every other incoming or outgoing edge is an open graph. This predicate is
-- that exception, not a weaker one. Zero edges still pass, which is what a
-- superuser CREATE ROLE produces.
--
-- The admin option is enough to GRANT a SET or INHERIT edge. It is not a
-- powerless leftover. After that grant, the write guard refuses the insert
-- because the graph assertion raises QC_EXECUTION_GRAPH_OPEN_202: MEMBERSHIP.

CREATE FUNCTION pg_temp.m202_membership_contract() RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    WHERE m.member = 'wardah_qc_entry_202'::pg_catalog.regrole
       OR (
         m.roleid = 'wardah_qc_entry_202'::pg_catalog.regrole
         AND NOT (
           m.admin_option
           AND NOT m.set_option
           AND NOT m.inherit_option
           AND m.member = (
             SELECT c.relowner
             FROM pg_catalog.pg_class c
             WHERE c.oid = 'public.quality_inspections'::pg_catalog.regclass
           )
         )
       )
  )
$fn$;

CREATE FUNCTION pg_temp.m202_membership_rejected(p_label text, p_setup text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_msg text;
BEGIN
  BEGIN
    EXECUTE p_setup;
    IF pg_temp.m202_membership_contract() THEN
      RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % contract accepted the edge', p_label;
    END IF;
    BEGIN
      PERFORM wardah_internal.qc_assert_closed_graph_202();
      v_msg := '<assertion passed>';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF position('QC_EXECUTION_GRAPH_OPEN_202: MEMBERSHIP' IN v_msg) = 0 THEN
      RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected MEMBERSHIP got %', p_label, v_msg;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN
    NULL;
  END;
  IF current_user::text IS DISTINCT FROM session_user::text
     OR NOT pg_temp.m202_membership_contract()
     OR to_regrole('zz_m202_mem_wrong') IS NOT NULL
     OR to_regrole('zz_m202_mem_out') IS NOT NULL THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % leaked a membership change', p_label;
  END IF;
  PERFORM wardah_internal.qc_assert_closed_graph_202();
  RAISE NOTICE 'ok  mutant caught: %', p_label;
END
$fn$;

-- ADMIN true is sufficient to add SET true. The entry role can then be
-- assumed, and the write guard refuses the insert. The grants roll back.
CREATE FUNCTION pg_temp.m202_set_edge_guard_refuses(p_label text, p_hop boolean)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_msg text;
BEGIN
  BEGIN
    IF NOT (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members m
        WHERE m.roleid = 'wardah_qc_entry_202'::pg_catalog.regrole
          AND m.member = session_user::text::pg_catalog.regrole
          AND m.admin_option
          AND NOT m.set_option
          AND NOT m.inherit_option
          AND m.member = (
            SELECT c.relowner FROM pg_catalog.pg_class c
            WHERE c.oid = 'public.quality_inspections'::pg_catalog.regclass
          )
      ) THEN
        RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected the admin-only DDL-owner edge', p_label;
      END IF;
    END IF;
    IF p_hop THEN
      CREATE ROLE zz_m202_mem_hop NOLOGIN;
      EXECUTE format(
        'GRANT wardah_qc_entry_202 TO zz_m202_mem_hop WITH SET TRUE, INHERIT FALSE');
      EXECUTE format(
        'GRANT zz_m202_mem_hop TO %I WITH SET TRUE, INHERIT FALSE', session_user);
      EXECUTE 'SET LOCAL ROLE zz_m202_mem_hop';
    ELSE
      EXECUTE format(
        'GRANT wardah_qc_entry_202 TO %I WITH SET TRUE, INHERIT FALSE', session_user);
    END IF;
    IF pg_temp.m202_membership_contract() THEN
      RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % contract accepted a SET edge', p_label;
    END IF;
    EXECUTE 'SET LOCAL ROLE wardah_qc_entry_202';
    IF current_user::text <> 'wardah_qc_entry_202' THEN
      RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % did not reach the entry role', p_label;
    END IF;
    BEGIN
      INSERT INTO public.quality_inspections DEFAULT VALUES;
      RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % write guard allowed the insert', p_label;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF position('QC_EXECUTION_GRAPH_OPEN_202: MEMBERSHIP' IN v_msg) = 0 THEN
        RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % expected MEMBERSHIP got %', p_label, v_msg;
      END IF;
    END;
    RAISE EXCEPTION USING ERRCODE = 'Z0202', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'Z0202' THEN
    NULL;
  END;
  IF current_user::text IS DISTINCT FROM session_user::text
     OR NOT pg_temp.m202_membership_contract()
     OR to_regrole('zz_m202_mem_hop') IS NOT NULL THEN
    RAISE EXCEPTION 'M202_ACCEPTANCE_FAIL: % leaked a membership change', p_label;
  END IF;
  PERFORM wardah_internal.qc_assert_closed_graph_202();
  RAISE NOTICE 'ok  %', p_label;
END
$fn$;

SELECT pg_temp.m202_set_edge_guard_refuses(
  'admin option created a SET edge and the write guard refused',
  false);
SELECT pg_temp.m202_membership_rejected(
  'INHERIT true',
  format('GRANT wardah_qc_entry_202 TO %I WITH INHERIT TRUE, SET FALSE', session_user));
SELECT pg_temp.m202_membership_rejected(
  'wrong member',
  'CREATE ROLE zz_m202_mem_wrong NOLOGIN; '
  'GRANT wardah_qc_entry_202 TO zz_m202_mem_wrong WITH ADMIN TRUE, INHERIT FALSE, SET FALSE');
SELECT pg_temp.m202_membership_rejected(
  'outgoing membership',
  'CREATE ROLE zz_m202_mem_out NOLOGIN; GRANT zz_m202_mem_out TO wardah_qc_entry_202');
SELECT pg_temp.m202_set_edge_guard_refuses(
  'a reachable SET chain was created and the write guard refused',
  true);
