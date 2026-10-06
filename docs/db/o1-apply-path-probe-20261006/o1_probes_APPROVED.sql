-- O1 apply_migration probes — FOR REVIEW ONLY. NOTHING HERE HAS BEEN RUN ON ANY SUPABASE PROJECT.
--
-- Only valid target: Supabase project  kfzwgldukqmcvzhzysrx
--   (Wardah-O1-Apply-Migration-Probe-20261006, empty, free, under Wardah.Factory).
-- NEVER: uutfztmqvajmsxnrqeiv (Production), bhomjavdkzcvjyymzyla (Staging).
--
-- Questions answered (and nothing else):
--   G8   which role does apply_migration execute as, and who owns what it creates?
--   G11  when the file carries its own BEGIN/COMMIT: what is left in the CATALOG and in
--        the LEDGER when a failure happens AFTER the COMMIT, BEFORE the COMMIT, with no
--        own transaction at all (control), and when it succeeds?
--
-- Rules:
--   * Every write probe starts with the GUARD and refuses (RAISE) unless the database is
--     the empty probe project.
--   * Writes only inside schema o1_probe. No roles, grants, extensions, ALTER SYSTEM; no
--     touch of public / auth / storage / supabase_migrations (the ledger is only READ).
--   * Ledger rows are evidence: cleanup NEVER deletes them.
--   * One apply_migration per write probe, in order, with the readback R between steps.
--   * NO atomicity conclusion from the success probe alone: P2 (fail after COMMIT),
--     P3 (fail before COMMIT) and P4 (fail, no own transaction) are all required, and the
--     verdict is read from R after EACH of them, never inferred.
--
-- Bytes sent: the text of each probe is sent EXACTLY as the expanded file
--   probe_<Pn>.sql  =  (probe body with the line "-- <GUARD>" replaced byte-for-byte by the
--   GUARD block below), UTF-8, LF line endings, one trailing LF. Their sha256 / md5 / length
--   are in o1_sent_bytes_manifest.txt, computed BEFORE sending. After each run the stored
--   `statements` from the ledger are compared with those bytes and BOTH are reported raw.
--
-- Runner contract (assistant side, only after the reviewer approves this text):
--   1. get_project(kfzwgldukqmcvzhzysrx) read-only: name + ACTIVE_HEALTHY must match.
--   2. every call carries project_id = kfzwgldukqmcvzhzysrx literally; abort on any other id.
--   3. stop at the first unexpected result and report it raw; never retry a write blindly.

-- ============================================================================
-- GUARD (expanded verbatim at the top of P1..P5 and C)
-- ============================================================================
DO $guard$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.manufacturing_orders') IS NOT NULL
     OR to_regclass('public.stage_wip_log') IS NOT NULL
     OR to_regnamespace('wardah_internal') IS NOT NULL THEN
    RAISE EXCEPTION 'O1_PROBE_REFUSED_NOT_AN_EMPTY_PROBE_PROJECT';
  END IF;
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname = 'public';
  IF n <> 0 THEN
    RAISE EXCEPTION 'O1_PROBE_REFUSED_PUBLIC_NOT_EMPTY (%)', n;
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM supabase_migrations.schema_migrations
                WHERE name IS NULL OR name NOT LIKE 'o1\_probe\_%' ESCAPE '\'$q$ INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'O1_PROBE_REFUSED_FOREIGN_LEDGER_ROWS (%)', n;
    END IF;
  END IF;
END
$guard$;

-- ============================================================================
-- P0  execute_sql   READ-ONLY (writes nothing, so no guard)
--     Identity of the execute_sql endpoint (for contrast with apply_migration) and the
--     raw ledger shape/contents BEFORE any probe.
-- ============================================================================
SELECT current_database()                        AS db,
       current_user                              AS current_user,
       session_user                              AS session_user,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)       AS is_superuser,
       (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user)  AS can_create_role,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)   AS bypass_rls,
       (SELECT array_agg(r.rolname ORDER BY r.rolname)
          FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
         WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS member_of,
       current_setting('server_version')         AS server_version,
       current_setting('application_name')       AS application_name,
       pg_backend_pid()                          AS backend_pid,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS public_tables,
       to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists;
-- ledger columns (raw) and any pre-existing rows (raw); both may be empty / absent
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
 ORDER BY ordinal_position;

-- ============================================================================
-- P1  apply_migration  name: o1_probe_01_identity     (G8)
--     Who runs the migration, whether the file is ONE transaction, who owns what it makes.
-- ============================================================================
-- <GUARD>
DO $pre$
BEGIN
  IF to_regnamespace('o1_probe') IS NOT NULL THEN
    RAISE EXCEPTION 'O1_PROBE_REFUSED_PROBE_SCHEMA_ALREADY_EXISTS';
  END IF;
END
$pre$;
CREATE SCHEMA o1_probe;
CREATE TABLE o1_probe.identity (
  probe text PRIMARY KEY,
  value text
);
INSERT INTO o1_probe.identity (probe, value) VALUES
  ('current_user',         current_user),
  ('session_user',         session_user),
  ('is_superuser',         (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user)),
  ('can_create_role',      (SELECT rolcreaterole::text FROM pg_roles WHERE rolname = current_user)),
  ('application_name',     current_setting('application_name')),
  ('backend_pid',          pg_backend_pid()::text),
  ('isolation',            current_setting('transaction_isolation')),
  ('statement_timeout',    current_setting('statement_timeout')),
  ('lock_timeout',         current_setting('lock_timeout')),
  ('search_path',          current_setting('search_path')),
  ('xid_a',                txid_current()::text);
-- LIMIT OF THIS MEASUREMENT: equal xid_a / xid_b proves only that THESE TWO sampled
-- statements ran in one transaction. It does NOT prove the whole file is one transaction,
-- and says nothing about atomic catalog+ledger writes; that is decided by P2/P3/P4 + R.
-- Different xids => at least these two statements were separate (auto-commit) transactions.
INSERT INTO o1_probe.identity (probe, value) VALUES ('xid_b', txid_current()::text);
INSERT INTO o1_probe.identity (probe, value)
  SELECT 'same_xid_for_sampled_statements',
         ((SELECT value FROM o1_probe.identity WHERE probe = 'xid_a') =
          (SELECT value FROM o1_probe.identity WHERE probe = 'xid_b'))::text;
-- owner of what this endpoint creates (matters for the postgres-owned pins in 194/203)
CREATE FUNCTION o1_probe.owner_probe() RETURNS int
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$ SELECT 1 $$;
INSERT INTO o1_probe.identity (probe, value) VALUES
  ('table_owner',    (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'o1_probe.identity'::regclass)),
  ('function_owner', (SELECT pg_get_userbyid(proowner) FROM pg_proc  WHERE oid = 'o1_probe.owner_probe()'::regprocedure));
-- can this role SET ROLE to the two owners the M194/M203 pins expect?
-- The result is written only AFTER RESET ROLE, under the original identity and outside the
-- exception handler, so an INSERT failure can never be recorded as a SET ROLE denial.
-- current_user is sampled INSIDE the target role to prove the SET really took effect.
DO $$
DECLARE
  r text;
  v_set_ok boolean;
  v_inside text;
  v_state text;
  v_msg text;
BEGIN
  FOREACH r IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    v_set_ok := false; v_inside := NULL; v_state := NULL; v_msg := NULL;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      v_inside := current_user;
      v_set_ok := true;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE; v_msg := SQLERRM;
      RESET ROLE;
    END;
    INSERT INTO o1_probe.identity (probe, value)
    VALUES ('set_role_' || r,
            CASE WHEN v_set_ok THEN 'SET allowed; current_user inside = ' || v_inside
                 ELSE 'SET denied: ' || v_state || ' ' || v_msg END);
  END LOOP;
END $$;

-- ============================================================================
-- P2  apply_migration  name: o1_probe_02_fail_after_own_commit     (G11)
--     Own BEGIN ... COMMIT, THEN a failure. Tool result expected: error.
--     Read R: does o1_probe.fail_after_commit_a exist?  is there a ledger row for this name?
--       catalog=yes + ledger=no  => catalog/ledger drift when a failure follows an own COMMIT.
-- ============================================================================
-- <GUARD>
BEGIN;
CREATE TABLE o1_probe.fail_after_commit_a (id int);
COMMIT;
DO $$ BEGIN RAISE EXCEPTION 'O1_PROBE_02_INTENDED_FAILURE_AFTER_OWN_COMMIT'; END $$;

-- ============================================================================
-- P3  apply_migration  name: o1_probe_03_fail_before_own_commit     (G11)
--     Own BEGIN, a CREATE, a failure BEFORE the COMMIT is reached (the COMMIT is never run).
--     Read R: does o1_probe.fail_before_commit_b exist?  is there a ledger row?
--       expected if atomic: neither.
-- ============================================================================
-- <GUARD>
BEGIN;
CREATE TABLE o1_probe.fail_before_commit_b (id int);
DO $$ BEGIN RAISE EXCEPTION 'O1_PROBE_03_INTENDED_FAILURE_BEFORE_OWN_COMMIT'; END $$;
COMMIT;

-- ============================================================================
-- P4  apply_migration  name: o1_probe_04_plain_fail     (G11 control)
--     NO own transaction statements at all, a failure after a CREATE.
--     Read R: does o1_probe.plain_fail_c exist?  is there a ledger row?
--       expected if the endpoint wraps the file in one transaction: neither.
-- ============================================================================
-- <GUARD>
CREATE TABLE o1_probe.plain_fail_c (id int);
DO $$ BEGIN RAISE EXCEPTION 'O1_PROBE_04_INTENDED_FAILURE_PLAIN'; END $$;

-- ============================================================================
-- P5  apply_migration  name: o1_probe_05_own_commit_success     (G11, the M203 shape)
--     Own BEGIN ... COMMIT, succeeds. Read R: exactly ONE ledger row? stored `statements`
--     byte-equal to the file sent? any difference in how BEGIN/COMMIT are stored?
--     (A success run proves nothing about atomicity by itself; see P2/P3/P4.)
-- ============================================================================
-- <GUARD>
BEGIN;
CREATE TABLE o1_probe.commit_ok_d (id int);
INSERT INTO o1_probe.commit_ok_d VALUES (1);
COMMIT;

-- ============================================================================
-- R   execute_sql   READ-ONLY RAW READBACK. Run after EACH of P1..P5 (the failing probes
--     especially). Three result sets; all are reported raw, nothing is summarised.
-- ============================================================================
-- R1: ledger rows, raw (every column as stored EXCEPT created_by, which is never published)
SELECT (to_jsonb(m) - 'created_by') AS ledger_row_raw   -- created_by deliberately omitted
  FROM supabase_migrations.schema_migrations m
 WHERE m.name LIKE 'o1\_probe\_%' ESCAPE '\'
 ORDER BY m.version;
-- R2: ledger duplicates per name (must be 0 or 1 per probe)
SELECT name, count(*) AS rows
  FROM supabase_migrations.schema_migrations
 WHERE name LIKE 'o1\_probe\_%' ESCAPE '\'
 GROUP BY name ORDER BY name;
-- R3: catalog presence per probe object (t/f), owners, and the identity table, raw
SELECT t.obj,
       to_regclass('o1_probe.' || t.obj) IS NOT NULL AS exists_now,
       (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('o1_probe.' || t.obj)) AS owner
  FROM (VALUES ('identity'), ('fail_after_commit_a'), ('fail_before_commit_b'),
               ('plain_fail_c'), ('commit_ok_d')) AS t(obj)
 ORDER BY t.obj;
SELECT probe, value FROM o1_probe.identity ORDER BY probe;   -- only after P1 succeeded
-- Byte comparison (assistant side, after R1): the raw `statements` text from R1 is compared
-- as an exact string and by sha256 with the file in o1_sent_bytes_manifest.txt; both are
-- reported, including any normalisation the endpoint applied (split on ';', trimmed
-- whitespace, BEGIN/COMMIT retained or dropped).

-- ============================================================================
-- C   execute_sql   CLEANUP — drops ONLY the probe schema; ledger rows are kept as evidence
-- ============================================================================
-- <GUARD>
DROP SCHEMA IF EXISTS o1_probe CASCADE;
SELECT to_regnamespace('o1_probe') IS NULL                                  AS probe_schema_gone,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')          AS public_tables,
       (SELECT count(*) FROM supabase_migrations.schema_migrations
         WHERE name LIKE 'o1\_probe\_%' ESCAPE '\')                          AS ledger_rows_kept;
