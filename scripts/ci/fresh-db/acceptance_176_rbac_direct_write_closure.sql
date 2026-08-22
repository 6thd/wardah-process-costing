\set ON_ERROR_STOP on

DO $acceptance$
DECLARE
  v_table text;
  v_rpc regprocedure;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['roles','role_permissions','user_roles']
  LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'RBAC_176_ACCEPTANCE_SELECT_MISSING: %', v_table;
    END IF;

    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'TRUNCATE') THEN
      RAISE EXCEPTION 'RBAC_176_ACCEPTANCE_DIRECT_WRITE_REMAINS: %', v_table;
    END IF;
  END LOOP;

  FOREACH v_rpc IN ARRAY ARRAY[
    'public.rpc_upsert_org_role(jsonb)'::regprocedure,
    'public.rpc_delete_org_role(jsonb)'::regprocedure,
    'public.rpc_replace_user_roles(jsonb)'::regprocedure,
    'public.rpc_remove_org_member(jsonb)'::regprocedure,
    'public.create_role_from_template(uuid,uuid,character varying,uuid)'::regprocedure
  ]
  LOOP
    IF NOT has_function_privilege('authenticated', v_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'RBAC_176_ACCEPTANCE_RPC_EXECUTE_MISSING: %', v_rpc;
    END IF;
  END LOOP;

  IF public.wardah_is_sensitive_permission('accounting.vouchers.cancel') IS DISTINCT FROM true
     OR public.wardah_is_sensitive_permission('accounting.vouchers.unpost') IS DISTINCT FROM true
     OR public.wardah_is_sensitive_permission('reports.ai_insights.use') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RBAC_176_ACCEPTANCE_SENSITIVE_CLASSIFIER_REGRESSION';
  END IF;
END
$acceptance$;

SELECT 'RBAC_176_DIRECT_WRITE_CLOSURE_ACCEPTANCE_PASS' AS result;
