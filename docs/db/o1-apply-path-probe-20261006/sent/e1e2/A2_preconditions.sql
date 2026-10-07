SELECT (SELECT count(*) FROM pg_trigger t
         WHERE t.tgrelid = 'supabase_migrations.schema_migrations'::regclass
           AND NOT t.tgisinternal) AS ledger_user_triggers,
       to_regprocedure('o1_probe.ledger_refuse_e1e2()') IS NOT NULL AS function_exists,
       EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'o1_probe_ledger_refuse_e1e2') AS trigger_exists,
       to_regclass('o1_probe.e1_after_own_commit') IS NOT NULL AS e1_table_exists,
       to_regclass('o1_probe.e2_plain') IS NOT NULL AS e2_table_exists;
