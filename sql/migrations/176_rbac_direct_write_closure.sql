-- =====================================================================
-- 176_rbac_direct_write_closure
-- =====================================================================
-- Final database-boundary closure for Issue #93.
--
-- Migrations 174/175 moved the supported RBAC control plane to audited,
-- atomic SECURITY DEFINER RPCs and the application now has a CI gate that
-- rejects direct writes to roles, role_permissions, and user_roles.
-- Production read-only audit on 2026-08-22 confirmed authenticated still
-- retained table-level INSERT/UPDATE/DELETE/TRUNCATE on all three tables.
-- This migration removes only that obsolete browser/Data API mutation surface.
-- SELECT is intentionally preserved because the admin UI still reads RBAC
-- state directly. service_role privileges are intentionally unchanged.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'RBAC_176_REQUIRED_TABLE_MISSING';
  END IF;

  IF to_regprocedure('public.rpc_upsert_org_role(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_delete_org_role(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_replace_user_roles(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_remove_org_member(jsonb)') IS NULL
     OR to_regprocedure('public.create_role_from_template(uuid,uuid,character varying,uuid)') IS NULL THEN
    RAISE EXCEPTION 'RBAC_176_REQUIRED_RPC_MISSING';
  END IF;
END
$preflight$;

-- The supported client surface is RPC-only for mutations. Keep read access;
-- remove every table-level mutation privilege that could bypass that surface.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.roles, public.role_permissions, public.user_roles
  FROM authenticated;

DO $postflight$
DECLARE
  v_table text;
  v_rpc regprocedure;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['roles','role_permissions','user_roles']
  LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'RBAC_176_SELECT_MUST_REMAIN: %', v_table;
    END IF;

    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'TRUNCATE') THEN
      RAISE EXCEPTION 'RBAC_176_DIRECT_WRITE_PRIVILEGE_REMAINS: %', v_table;
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
      RAISE EXCEPTION 'RBAC_176_AUTHENTICATED_RPC_EXECUTE_MISSING: %', v_rpc;
    END IF;
  END LOOP;
END
$postflight$;

COMMIT;
