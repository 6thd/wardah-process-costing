-- Only terminal records exist server-side. Absence is NOT a rejected intent.
-- Owner-operated, read-only export; never call the fence/writer RPCs here.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
SELECT jsonb_build_object(
 'format_version',1,'database',current_database(),
 'captured_at',transaction_timestamp(),'transaction_read_only',current_setting('transaction_read_only'),
 'owner_verified',current_user=pg_get_userbyid(c.relowner) OR r.rolsuper,
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'org_id',e.org_id,'event_id',e.event_id,'actor_id',e.actor_id,
   'operation',e.command->>'operation','state',e.state,'resolved_at',e.created_at)
   ORDER BY e.org_id,e.event_id)
  FROM wardah_internal.material_issue_maintenance_events e),'[]'::jsonb)
 )
FROM pg_class c JOIN pg_roles r ON r.rolname=current_user
WHERE c.oid='wardah_internal.material_issue_maintenance_events'::regclass;
ROLLBACK;
