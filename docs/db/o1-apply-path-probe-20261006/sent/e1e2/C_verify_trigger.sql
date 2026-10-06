SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t
 WHERE t.tgrelid = 'supabase_migrations.schema_migrations'::regclass AND NOT t.tgisinternal;
