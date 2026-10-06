SELECT name, count(*) AS rows FROM supabase_migrations.schema_migrations
 WHERE name IN ('o1_probe_07_e1_ledger_fail_after_own_commit', 'o1_probe_08_e2_ledger_fail_plain')
 GROUP BY name ORDER BY name;
