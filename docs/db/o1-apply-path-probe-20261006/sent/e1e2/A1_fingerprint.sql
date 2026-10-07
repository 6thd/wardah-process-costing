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
