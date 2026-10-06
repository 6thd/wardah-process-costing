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
CREATE TABLE o1_probe.commit_ok_d (id int);
INSERT INTO o1_probe.commit_ok_d VALUES (1);
COMMIT;
