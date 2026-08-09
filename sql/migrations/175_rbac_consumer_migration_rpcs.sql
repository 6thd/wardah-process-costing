-- =====================================================================
-- 175_rbac_consumer_migration_rpcs
-- =====================================================================
-- Additive-only. No privilege revocation in this migration. Part of Issue
-- #93's second phase: an audit of every production TS/TSX file that writes
-- to roles, role_permissions or user_roles found four surfaces, only two of
-- which Migration 174 actually covered:
--
--   src/pages/org-admin/roles.tsx           -> covered by 174's RPCs
--   src/services/rbac-service.ts            -> covered by 174's RPCs
--   src/services/org-admin-service.ts       -> NOT covered:
--     updateUserRoles()      direct DELETE+INSERT on user_roles, no audit
--     removeUserFromOrg()    direct DELETE on user_roles then
--                             user_organizations, unchecked first error
--   src/services/super-admin-service.ts     -> NOT covered:
--     createOrgWithUser()    direct INSERT on user_roles
--
-- This migration adds what the consumer PR (a separate PR, applied after
-- this one is live and verified) needs to close all three gaps without a
-- single direct write remaining anywhere in the client:
--
--   1. rpc_remove_org_member    — new. Atomic, audited replacement for
--      removeUserFromOrg()'s two-step client sequence. Mirrors
--      rpc_set_org_admin's established self-action and last-admin guards
--      (migration 103) — removal is more drastic than demotion, so it
--      earns the same protection.
--   2. create_role_from_template — CREATE OR REPLACE, same signature and
--      return type (uuid), unchanged for any existing caller. Adds an
--      audit_logs row. This RPC already existed (migration ~120) and was
--      already SECURITY DEFINER + wardah_assert_org_admin-guarded — the
--      real bug was that roles.tsx imported a same-named, unrelated
--      direct-write function from org-admin-service.ts instead of the one
--      in rbac-service.ts that correctly calls this RPC. The consumer PR
--      fixes the import; this migration only adds the missing audit trail.
--   3. wardah_is_sensitive_permission — CREATE OR REPLACE, adds an explicit
--      empty search_path. The function has zero table or schema references
--      (a pure literal comparison), so this changes nothing about its
--      behavior; it exists to close the "Function Search Path Mutable"
--      advisory a linter raises on any function without one.
--
-- What this migration deliberately does NOT do:
--   * super-admin-service.ts's createOrgWithUser() user_roles insert is not
--     given a new RPC, because it is dead code: it looks up a role named
--     literally 'org_admin' by name, and no migration or seed in this
--     repository has ever created a role with that name for any
--     organization — 'org_admin' appears only as a MODULE label
--     (migration 53), never as a roles.name value. The lookup's .single()
--     therefore never resolves, and the guarded insert never runs. The
--     consumer PR removes this dead block outright rather than build an
--     RPC for a code path that has never executed; real admin authority for
--     a freshly bootstrapped organization comes entirely from
--     user_organizations.is_org_admin = true, set two statements earlier in
--     the same function, which already works correctly and is unaffected.
--   * wardah_assert_org_admin / wardah_assert_org_member are not touched.
--     They are used by dozens of functions across the whole schema, not
--     only the RBAC surface; widening their behavior (e.g. letting a
--     non-member super admin pass) is a separate, cross-cutting change that
--     deserves its own migration and review, not a rider on this one.
--   * No table grant is revoked here. authenticated keeps direct
--     INSERT/UPDATE/DELETE on roles, role_permissions and user_roles.
--     That closure is Migration 176, applied only after the consumer PR has
--     moved every real caller onto the RPC surface this migration and 174
--     together provide, and the browser smoke has proven it end to end.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- Preflight: fail closed if the schema has drifted from what this migration
-- assumes, before touching anything.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regprocedure('public.wardah_assert_org_admin(uuid)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_ORG_GUARD_MISSING';
  END IF;
  IF to_regprocedure('public.create_role_from_template(uuid,uuid,character varying,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_CREATE_ROLE_FROM_TEMPLATE_MISSING';
  END IF;
  IF to_regprocedure('public.wardah_is_sensitive_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_CLASSIFIER_MISSING';
  END IF;
  IF to_regclass('public.user_organizations') IS NULL
     OR to_regclass('public.user_roles') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_REQUIRED_TABLE_MISSING';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. rpc_remove_org_member — atomic, audited replacement for the client's
--    two-step "delete user_roles, then delete user_organizations" sequence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_remove_org_member(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org        uuid := NULLIF(p_payload->>'org_id','')::uuid;
  v_target     uuid := NULLIF(p_payload->>'user_id','')::uuid;
  v_old_member jsonb;
  v_old_roles  jsonb;
  v_was_admin  boolean;
  v_other_admins int;
BEGIN
  IF v_org IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'RBAC_175_ORG_AND_USER_REQUIRED';
  END IF;
  PERFORM public.wardah_assert_org_admin(v_org);

  -- Removal is more drastic than demotion; rpc_set_org_admin (migration 103)
  -- already refuses self-demotion and the last active admin. This mirrors
  -- both guards for removal, which was previously enforced only by disabling
  -- the button client-side — no server-side guard existed.
  IF v_target = auth.uid() THEN
    RAISE EXCEPTION 'RBAC_175_CANNOT_REMOVE_SELF';
  END IF;

  SELECT to_jsonb(uo) INTO v_old_member
  FROM public.user_organizations uo
  WHERE uo.user_id = v_target AND uo.org_id = v_org
  FOR UPDATE;

  IF v_old_member IS NULL THEN
    RAISE EXCEPTION 'RBAC_174_TARGET_NOT_ACTIVE_ORG_MEMBER';
  END IF;

  v_was_admin := COALESCE((v_old_member->>'is_org_admin')::boolean, false);

  IF v_was_admin THEN
    SELECT count(*) INTO v_other_admins
    FROM public.user_organizations
    WHERE org_id = v_org AND is_org_admin = true AND is_active = true
      AND user_id <> v_target;
    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'RBAC_175_LAST_ORG_ADMIN';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'role_id', ur.role_id, 'expires_at', ur.expires_at) ORDER BY ur.role_id), '[]'::jsonb)
    INTO v_old_roles
  FROM public.user_roles ur
  WHERE ur.user_id = v_target AND ur.org_id = v_org;

  DELETE FROM public.user_roles WHERE user_id = v_target AND org_id = v_org;
  DELETE FROM public.user_organizations WHERE user_id = v_target AND org_id = v_org;

  INSERT INTO public.audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (
    v_org, auth.uid(), 'rbac.org_member.remove', 'user', v_target::text,
    jsonb_build_object('membership', v_old_member, 'role_assignments', v_old_roles),
    NULL,
    jsonb_build_object(
      'migration', 175,
      'was_org_admin', v_was_admin,
      'removed_role_count', jsonb_array_length(v_old_roles))
  );

  RETURN jsonb_build_object(
    'user_id', v_target,
    'org_id', v_org,
    'removed_role_count', jsonb_array_length(v_old_roles));
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_remove_org_member(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_remove_org_member(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_role_from_template — same signature, same return type. Adds the
--    audit_logs row that was the only gap; everything else about this
--    function (guard, template lookup, permission-pattern matching) is
--    unchanged from its original body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_role_from_template(
  p_org_id uuid,
  p_template_id uuid,
  p_custom_name character varying DEFAULT NULL::character varying,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_template role_templates%ROWTYPE;
    v_new_role_id UUID;
    v_perm_key TEXT;
    v_granted_keys jsonb;
BEGIN
    -- [120] admin gate on the target org; p_created_by is ignored (would
    -- otherwise allow impersonating a different creator).
    PERFORM public.wardah_assert_org_admin(p_org_id);

    SELECT * INTO v_template FROM role_templates WHERE id = p_template_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;

    INSERT INTO roles (org_id, name, name_ar, description_ar, created_by)
    VALUES (
        p_org_id,
        COALESCE(p_custom_name, v_template.name),
        v_template.name_ar,
        v_template.description_ar,
        auth.uid()
    )
    RETURNING id INTO v_new_role_id;

    FOREACH v_perm_key IN ARRAY v_template.permission_keys
    LOOP
        INSERT INTO role_permissions (role_id, permission_id, created_by)
        SELECT v_new_role_id, p.id, auth.uid()
        FROM permissions p
        WHERE p.permission_key LIKE REPLACE(v_perm_key, '%', '%%')
           OR p.permission_key LIKE v_perm_key
        ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT COALESCE(jsonb_agg(p.permission_key ORDER BY p.permission_key), '[]'::jsonb)
      INTO v_granted_keys
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_new_role_id;

    -- 175: the only change to this function. Every other write above is
    -- byte-for-byte the body that shipped in migration ~120.
    INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
    VALUES (
      p_org_id, auth.uid(), 'rbac.role.create', 'role', v_new_role_id::text,
      NULL,
      jsonb_build_object('role_id', v_new_role_id,
                         'name', COALESCE(p_custom_name, v_template.name),
                         'permission_keys', v_granted_keys),
      jsonb_build_object(
        'migration', 175,
        'source', 'template',
        'template_id', p_template_id,
        'permission_count', jsonb_array_length(v_granted_keys),
        'sensitive_keys', (
          SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
          FROM jsonb_array_elements_text(v_granted_keys) AS t(k)
          WHERE wardah_is_sensitive_permission(k)
        ))
    );

    RETURN v_new_role_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. wardah_is_sensitive_permission — add an explicit search_path. The
--    function body references no table, view or unqualified name (it is a
--    pure `p_permission_key IN ('literal', 'literal')`), so this changes
--    nothing about its result for any input; it only removes the advisory a
--    linter raises for any SECURITY-relevant function with a mutable path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_is_sensitive_permission(p_permission_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT p_permission_key IN (
    'accounting.vouchers.unpost',
    'accounting.vouchers.cancel'
  );
$function$;

-- ---------------------------------------------------------------------------
-- Postflight: prove the new/changed contracts before COMMIT.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_remove_src text;
  v_template_src text;
  v_classifier_config text[];
BEGIN
  SELECT prosrc INTO v_remove_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_remove_org_member';
  IF v_remove_src IS NULL THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member missing after CREATE';
  END IF;
  IF v_remove_src !~ 'wardah_assert_org_admin' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member is not org-admin guarded';
  END IF;
  IF v_remove_src !~ 'RBAC_175_CANNOT_REMOVE_SELF' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member lost the self-removal guard';
  END IF;
  IF v_remove_src !~ 'RBAC_175_LAST_ORG_ADMIN' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member lost the last-admin guard';
  END IF;
  IF v_remove_src !~ 'RBAC_174_TARGET_NOT_ACTIVE_ORG_MEMBER' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member lost the not-a-member guard';
  END IF;
  IF v_remove_src !~ 'FOR UPDATE' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member no longer locks the membership row';
  END IF;
  IF v_remove_src !~ 'audit_logs' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member does not write an audit row';
  END IF;

  IF has_function_privilege('anon', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member execute boundary is wrong';
  END IF;

  SELECT prosrc INTO v_template_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_role_from_template';
  IF v_template_src !~ 'audit_logs' THEN
    RAISE EXCEPTION 'FAIL[175] create_role_from_template still has no audit trail';
  END IF;
  IF v_template_src !~ 'wardah_assert_org_admin' THEN
    RAISE EXCEPTION 'FAIL[175] create_role_from_template lost its org-admin guard';
  END IF;
  -- Return type must still be uuid: no caller contract may change silently.
  IF (SELECT pg_get_function_result(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'create_role_from_template') <> 'uuid' THEN
    RAISE EXCEPTION 'FAIL[175] create_role_from_template return type changed';
  END IF;

  SELECT proconfig INTO v_classifier_config FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'wardah_is_sensitive_permission';
  IF v_classifier_config IS NULL
     OR NOT EXISTS (SELECT 1 FROM unnest(v_classifier_config) AS cfg WHERE cfg LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'FAIL[175] wardah_is_sensitive_permission still has no explicit search_path';
  END IF;
  -- Behavior must be byte-identical to 174's classifier for every input.
  IF NOT public.wardah_is_sensitive_permission('accounting.vouchers.unpost')
     OR NOT public.wardah_is_sensitive_permission('accounting.vouchers.cancel')
     OR public.wardah_is_sensitive_permission('accounting.entries.approve')
     OR public.wardah_is_sensitive_permission(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL[175] wardah_is_sensitive_permission behavior changed';
  END IF;

  RAISE NOTICE 'PASS[175] rpc_remove_org_member live; create_role_from_template now audited; classifier search_path closed';
END
$verify$;

COMMIT;
