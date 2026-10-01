-- Operator-run export only. No business RPC, role switch, DDL or DML.
-- Execute only against an independently authorized database.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
SELECT jsonb_build_object(
 'format_version',1,'database',current_database(),
 'server_version_num',current_setting('server_version_num')::integer,
 'captured_at',transaction_timestamp(),'transaction_read_only',current_setting('transaction_read_only'),
 'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
  'prosrc_md5',md5(p.prosrc),'language',l.lanname,'kind',p.prokind,
  'security_definer',p.prosecdef,'config',COALESCE(to_jsonb(p.proconfig),'[]'::jsonb),
  'acl',(SELECT jsonb_agg(jsonb_build_object(
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable))
   FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a),
  'execute',(SELECT jsonb_object_agg(r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE'))
   FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role'))
 ) ORDER BY p.oid::regprocedure::text)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','wardah_internal') AND p.proname IN (
  'seed_material_issue_wo_policy','rpc_set_material_issue_wo_statuses','rpc_get_material_issue_wo_statuses',
  'rpc_consume_material_event','rpc_consume_reserved_materials_v2','rpc_consume_reserved_materials',
  'consume_materials_for_mo','guard_posted_wo_delete_193','guard_posted_consumption_delete_193',
  'guard_posted_wip_delete_193','deny_manufacturing_history_truncate_193',
  'wardah_assert_stage_wip_editor_194','guard_stage_wip_write_194','rpc_close_stage_wip_194',
  'rpc_list_material_issue_orders','rpc_get_material_issue_context','assert_issue_maintenance_permission',
  'bump_issue_maintenance_version','rpc_manage_material_issue_setup','rpc_reconcile_material_issue_setup',
  'rpc_get_material_reservation_setup','create_role_from_template'
 )),'[]'::jsonb));
ROLLBACK;
