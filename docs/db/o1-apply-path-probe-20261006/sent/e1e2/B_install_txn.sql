BEGIN;
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
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'supabase_migrations.schema_migrations'::regclass
         AND NOT t.tgisinternal) <> 0
     OR to_regprocedure('o1_probe.ledger_refuse_e1e2()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'o1_probe_ledger_refuse_e1e2')
     OR to_regclass('o1_probe.e1_after_own_commit') IS NOT NULL
     OR to_regclass('o1_probe.e2_plain') IS NOT NULL THEN
    RAISE EXCEPTION 'O1_PROBE_E1E2_PRECONDITION_FAILED';
  END IF;
END
$pre$;
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
COMMIT;
