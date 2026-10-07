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
