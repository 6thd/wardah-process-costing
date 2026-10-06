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
