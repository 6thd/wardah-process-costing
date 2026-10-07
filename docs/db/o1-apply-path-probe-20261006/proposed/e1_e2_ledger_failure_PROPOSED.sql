-- E1/E2 ledger-failure experiment — PROPOSED, NOT RUN. For review only.
-- Target: Supabase project kfzwgldukqmcvzhzysrx (O1) ONLY. Never Production or Staging.
--
-- Question: when the service's ledger INSERT itself fails, what remains in the catalog?
--   E1: file WITH its own BEGIN ... COMMIT          E2: file WITHOUT its own transaction
--
-- Design limits (stated, not hidden):
--   * The refusal is a BEFORE INSERT trigger on supabase_migrations.schema_migrations that raises ONLY for the two
--     literal names below (exact IN-list: no LIKE, no pattern). Every other row passes through unchanged.
--   * It models "the ledger INSERT fails after the file ran". It does NOT model a lost connection, a killed backend,
--     a lost response or a platform timeout between the file's COMMIT and the ledger write. This experiment cannot
--     prove those risks absent; it only shows what the service does when the INSERT itself errors.
--   * The trigger is installed with execute_sql (so the installation writes NO ledger row), tested with two
--     apply_migration calls, and removed in the same session of work. If any step after the install cannot be
--     completed, STEP 5 (removal) is run first and the experiment is stopped.
--   * No grant, no role, no extension. If CREATE TRIGGER is denied (the ledger table may not be owned by postgres),
--     that is the result: STOP and report; do not try to change ownership or privileges.
--
-- Every write step starts with the same GUARD as the approved probes (expanded verbatim below).

-- ============================================================================
-- STEP 0  execute_sql  READ-ONLY  pre-fingerprint (saved raw)  -- no guard needed (writes nothing)
-- ============================================================================
SELECT count(*) AS ledger_rows,
       md5(coalesce(string_agg(version || '|' || name || '|' ||
             encode(sha256(convert_to(array_to_string(statements, ''), 'UTF8')), 'hex'),
             ',' ORDER BY version), '')) AS ledger_fingerprint,
       (SELECT count(*) FROM pg_trigger t
         WHERE t.tgrelid = 'supabase_migrations.schema_migrations'::regclass
           AND NOT t.tgisinternal) AS user_triggers_on_ledger,
       (SELECT pg_get_userbyid(relowner) FROM pg_class
         WHERE oid = 'supabase_migrations.schema_migrations'::regclass) AS ledger_owner,
       has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'TRIGGER') AS can_create_trigger
  FROM supabase_migrations.schema_migrations;

-- ============================================================================
-- STEP 1  execute_sql  INSTALL the refusing trigger (guard first; one implicit transaction)
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
CREATE FUNCTION o1_probe.ledger_refuse_e1e2() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $f$
BEGIN
  IF NEW.name IN ('o1_probe_07_e1_ledger_fail_after_own_commit',
                  'o1_probe_08_e2_ledger_fail_plain') THEN
    RAISE EXCEPTION 'O1_PROBE_E1E2_LEDGER_INSERT_REFUSED (%)', NEW.name;
  END IF;
  RETURN NEW;
END
$f$;
CREATE TRIGGER o1_probe_ledger_refuse_e1e2
  BEFORE INSERT ON supabase_migrations.schema_migrations
  FOR EACH ROW EXECUTE FUNCTION o1_probe.ledger_refuse_e1e2();

-- ============================================================================
-- STEP 2  execute_sql  READ-ONLY  confirm exactly one user trigger and its definition; fingerprint must equal STEP 0
-- ============================================================================
SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t
 WHERE t.tgrelid = 'supabase_migrations.schema_migrations'::regclass AND NOT t.tgisinternal;
-- then re-run the STEP 0 query: ledger_rows and ledger_fingerprint must be unchanged; user_triggers_on_ledger = 1.

-- ============================================================================
-- STEP 3  apply_migration  name: o1_probe_07_e1_ledger_fail_after_own_commit   (E1)
--         Expected tool result: an error naming O1_PROBE_E1E2_LEDGER_INSERT_REFUSED. Then run the READBACK below.
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
BEGIN;
CREATE TABLE o1_probe.e1_after_own_commit (id int);
COMMIT;

-- ============================================================================
-- STEP 4  apply_migration  name: o1_probe_08_e2_ledger_fail_plain   (E2)
--         Expected tool result: an error naming O1_PROBE_E1E2_LEDGER_INSERT_REFUSED. Then run the READBACK below.
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
CREATE TABLE o1_probe.e2_plain (id int);

-- ============================================================================
-- READBACK  execute_sql  READ-ONLY  after STEP 3 and again after STEP 4 (one statement per call; created_by never read)
-- ============================================================================
-- RB1: catalog presence
SELECT t.obj, to_regclass('o1_probe.' || t.obj) IS NOT NULL AS exists_now
  FROM (VALUES ('e1_after_own_commit'), ('e2_plain')) AS t(obj) ORDER BY t.obj;
-- RB2: ledger rows for the two names (expected 0 each)
SELECT name, count(*) AS rows FROM supabase_migrations.schema_migrations
 WHERE name IN ('o1_probe_07_e1_ledger_fail_after_own_commit', 'o1_probe_08_e2_ledger_fail_plain')
 GROUP BY name ORDER BY name;
-- RB3: the STEP 0 query again (fingerprint and row count must still equal STEP 0)

-- Reading the pair (E1 table / E2 table):
--   present / absent : the service runs the file and then inserts the ledger row as a separate step after the file's
--                      own COMMIT (e.g. begin; <file>; insert; commit;) -> a ledger-side failure CAN leave a hole
--                      for files that carry their own COMMIT, and not for plain files.
--   absent  / absent : the ledger insert happens before the file or inside one transaction that the file's COMMIT does
--                      not split -> no hole from a ledger-side failure.
--   present / present: the file and the ledger insert are independent requests -> a hole is possible for every file.
--   (any row present for 07/08: the trigger did not fire -> the experiment is invalid; stop.)

-- ============================================================================
-- STEP 5  execute_sql  REMOVE the trigger and the function (always run this, even after a failed step)
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
DROP TRIGGER IF EXISTS o1_probe_ledger_refuse_e1e2 ON supabase_migrations.schema_migrations;
DROP FUNCTION IF EXISTS o1_probe.ledger_refuse_e1e2();

-- ============================================================================
-- STEP 6  execute_sql  READ-ONLY  post-fingerprint: STEP 0 query again.
--         Required: ledger_rows and ledger_fingerprint equal STEP 0; user_triggers_on_ledger back to the STEP 0 value.
-- ============================================================================
