-- =====================================================================
-- 175_rbac_consumer_migration_rpcs
-- =====================================================================
-- Backward-compatible RPC expansion plus integrity hardening. No table grant
-- is revoked in this migration, but invalid direct writes are now rejected at
-- the database boundary. Part of Issue
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
--   3. user_roles membership/write invariant — every INSERT must point at an
--      active membership; every UPDATE is rejected before row locking and
--      must use rpc_replace_user_roles; membership deletion/deactivation is
--      refused while role rows still exist. INSERT, replacement, and removal
--      take locks in the same organization-then-membership order.
--   4. rpc_set_org_admin + rpc_remove_org_member — serialize the last-admin
--      decision on the organization row and re-authorize after taking it.
--   5. has_permission + wardah_has_exact_permission — explicit-role grants
--      require an active membership as defense in depth.
--   6. wardah_is_sensitive_permission — CREATE OR REPLACE, adds an explicit
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
--   * No table grant is revoked here. authenticated keeps its table-level
--     INSERT/UPDATE/DELETE grants on roles, role_permissions and user_roles.
--     At the user_roles database boundary, INSERT requires active membership
--     and UPDATE is rejected entirely in favor of rpc_replace_user_roles.
--     This deliberate behavioral narrowing is required before the consumer
--     migration window can be safe and prevents inverse tuple/org lock order.
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
  IF to_regprocedure('public.rpc_set_org_admin(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_SET_ORG_ADMIN_MISSING';
  END IF;
  IF to_regprocedure('public.rpc_replace_user_roles(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_REPLACE_USER_ROLES_MISSING';
  END IF;
  IF to_regclass('public.user_organizations') IS NULL
     OR to_regclass('public.user_roles') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.organizations') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_175_REQUIRED_TABLE_MISSING';
  END IF;
END
$preflight$;

-- Prevent DML from slipping between the data preflight and trigger install.
-- SHARE ROW EXCLUSIVE conflicts with every ordinary INSERT/UPDATE/DELETE while
-- still allowing the read-only checks below.
LOCK TABLE public.user_organizations, public.user_roles
  IN SHARE ROW EXCLUSIVE MODE;

DO $data_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    LEFT JOIN public.user_organizations uo
      ON uo.user_id = ur.user_id
     AND uo.org_id = ur.org_id
     AND uo.is_active IS TRUE
    WHERE uo.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'RBAC_175_INVALID_USER_ROLE_MEMBERSHIP_PREFLIGHT';
  END IF;
END
$data_preflight$;

-- ---------------------------------------------------------------------------
-- 1. Preserve 174's complete replace contract behind an organization-first
--    wrapper. The old function already locks the target membership row; taking
--    the org row first makes its lock order consistent with member removal and
--    with the direct-write trigger below.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.rpc_replace_user_roles(jsonb)
  RENAME TO wardah_175_internal_replace_user_roles;

REVOKE ALL ON FUNCTION public.wardah_175_internal_replace_user_roles(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_replace_user_roles(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Preserve 174's pre-authorization payload-validation order. These three
  -- casts originally ran before wardah_assert_org_admin; moving only v_org
  -- into the wrapper would turn a missing/invalid user (or invalid expiry)
  -- into an authorization result for callers outside the organization.
  v_org     uuid := NULLIF(p_payload->>'org_id','')::uuid;
  v_user    uuid := NULLIF(p_payload->>'user_id','')::uuid;
  v_expires timestamptz := NULLIF(p_payload->>'expires_at','')::timestamptz;
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'RBAC_174_ORG_AND_USER_REQUIRED';
  END IF;

  -- Reject unauthorized callers before they can hold an organization lock.
  PERFORM public.wardah_assert_org_admin(v_org);

  PERFORM 1
  FROM public.organizations o
  WHERE o.id = v_org
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RBAC_175_ORG_NOT_FOUND';
  END IF;

  -- The internal 174 body re-runs the admin guard after this lock, then takes
  -- the target membership FOR UPDATE and executes its byte-identical replace,
  -- expiry-preservation, sensitive-key, and audit logic.
  RETURN public.wardah_175_internal_replace_user_roles(p_payload);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_replace_user_roles(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_replace_user_roles(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Database-boundary invariant: a role assignment exists only while the
--    corresponding membership is active.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_175_require_active_role_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_active boolean;
BEGIN
  -- Lock order is organization -> membership everywhere. The organization
  -- lock also prevents the audit FK from forming a member<->org deadlock with
  -- rpc_remove_org_member, which holds the org row before deleting membership.
  PERFORM 1
  FROM public.organizations o
  WHERE o.id = NEW.org_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RBAC_175_ACTIVE_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT uo.is_active
    INTO v_active
  FROM public.user_organizations uo
  WHERE uo.user_id = NEW.user_id
    AND uo.org_id = NEW.org_id
  FOR UPDATE;

  IF NOT FOUND OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'RBAC_175_ACTIVE_MEMBERSHIP_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_175_require_active_role_membership() FROM PUBLIC, anon, authenticated, service_role;

-- PostgreSQL locks a target tuple before a BEFORE ROW UPDATE trigger runs.
-- Taking the organization lock from that row trigger therefore inverts the
-- organization -> assignment order used by member removal. Reject UPDATE at
-- statement level, before tuple locking, and require the ordered replacement
-- RPC (whose 174 body uses DELETE + INSERT) for every assignment change.
CREATE OR REPLACE FUNCTION public.wardah_175_reject_direct_role_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION
    'RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES';
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_175_reject_direct_role_update() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wardah_175_protect_role_membership_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invalidates_membership boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invalidates_membership := true;
  ELSE
    v_invalidates_membership :=
      OLD.user_id IS DISTINCT FROM NEW.user_id
      OR OLD.org_id IS DISTINCT FROM NEW.org_id
      OR (OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE);
  END IF;

  IF v_invalidates_membership AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = OLD.user_id
      AND ur.org_id = OLD.org_id
  ) THEN
    RAISE EXCEPTION 'RBAC_175_MEMBERSHIP_HAS_ROLE_ASSIGNMENTS';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_175_protect_role_membership_parent() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_wardah_175_require_active_role_membership
  ON public.user_roles;
CREATE TRIGGER trg_wardah_175_require_active_role_membership
BEFORE INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.wardah_175_require_active_role_membership();

DROP TRIGGER IF EXISTS trg_wardah_175_reject_direct_role_update
  ON public.user_roles;
CREATE TRIGGER trg_wardah_175_reject_direct_role_update
BEFORE UPDATE ON public.user_roles
FOR EACH STATEMENT
EXECUTE FUNCTION public.wardah_175_reject_direct_role_update();

DROP TRIGGER IF EXISTS trg_wardah_175_protect_role_membership_parent
  ON public.user_organizations;
CREATE TRIGGER trg_wardah_175_protect_role_membership_parent
BEFORE UPDATE OR DELETE ON public.user_organizations
FOR EACH ROW
EXECUTE FUNCTION public.wardah_175_protect_role_membership_parent();

-- ---------------------------------------------------------------------------
-- 3. Defense in depth: an explicit role grant is effective only while the
--    assignee remains an active member of that same organization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_key character varying
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_permission boolean;
  v_sensitive boolean;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  v_sensitive := COALESCE(
    public.wardah_is_sensitive_permission(p_permission_key::text), false);

  IF EXISTS (
    SELECT 1 FROM public.super_admins
    WHERE user_id = p_user_id AND is_active = true
  ) THEN
    RETURN true;
  END IF;

  IF NOT v_sensitive AND EXISTS (
    SELECT 1 FROM public.user_organizations
    WHERE user_id = p_user_id
      AND org_id = p_org_id
      AND is_active = true
      AND is_org_admin = true
  ) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    INNER JOIN public.user_organizations uo
      ON uo.user_id = ur.user_id
     AND uo.org_id = ur.org_id
     AND uo.is_active IS TRUE
    INNER JOIN public.roles r
      ON r.id = ur.role_id
     AND r.org_id = p_org_id
     AND COALESCE(r.is_active, true)
    INNER JOIN public.role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN public.permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.org_id = p_org_id
      AND p.permission_key = p_permission_key
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  ) INTO v_has_permission;

  RETURN COALESCE(v_has_permission, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.wardah_has_exact_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.super_admins sa
      WHERE sa.user_id = p_user_id
        AND sa.is_active = true
    )
    OR (
      NOT COALESCE(public.wardah_is_sensitive_permission(p_permission_key), false)
      AND EXISTS (
        SELECT 1
        FROM public.user_organizations uo
        WHERE uo.user_id = p_user_id
          AND uo.org_id = p_org_id
          AND uo.is_active = true
          AND uo.is_org_admin = true
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.user_organizations uo
        ON uo.user_id = ur.user_id
       AND uo.org_id = ur.org_id
       AND uo.is_active IS TRUE
      JOIN public.roles r
        ON r.id = ur.role_id
       AND r.org_id = p_org_id
       AND COALESCE(r.is_active, true)
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = p_user_id
        AND ur.org_id = p_org_id
        AND p.permission_key = p_permission_key
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    );
$function$;

REVOKE ALL ON FUNCTION public.wardah_has_exact_permission(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Replace rpc_set_org_admin with the same caller contract plus a shared
--    organization-row lock. The authorization check is repeated after the
--    lock, so a caller removed or demoted while waiting cannot act afterward.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_set_org_admin(
  p_target_user_id uuid,
  p_org_id uuid,
  p_value boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_admins_count int;
  v_target_is_active_admin boolean;
  v_caller_member_active boolean;
  v_caller_member_admin boolean;
  v_caller_super_admin boolean := false;
BEGIN
  IF NOT (public.wardah_is_org_admin(p_org_id) OR public.is_super_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ORG_ADMIN');
  END IF;
  IF p_target_user_id = v_caller_id AND p_value = true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_PROMOTE_SELF');
  END IF;

  PERFORM 1
  FROM public.organizations o
  WHERE o.id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_NOT_FOUND');
  END IF;

  -- Re-authorize from locked rows after acquiring the shared organization
  -- lock. A second call to a STABLE helper would not be as explicit about
  -- observing a membership changed by the transaction that held this lock.
  SELECT uo.is_active IS TRUE,
         (uo.is_org_admin IS TRUE OR uo.role IN ('admin', 'owner'))
    INTO v_caller_member_active, v_caller_member_admin
  FROM public.user_organizations uo
  WHERE uo.user_id = v_caller_id
    AND uo.org_id = p_org_id
  FOR UPDATE;

  SELECT sa.is_active IS TRUE
    INTO v_caller_super_admin
  FROM public.super_admins sa
  WHERE sa.user_id = v_caller_id
  FOR UPDATE;

  IF NOT COALESCE(v_caller_super_admin, false)
     AND NOT (
       COALESCE(v_caller_member_active, false)
       AND COALESCE(v_caller_member_admin, false)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ORG_ADMIN');
  END IF;

  SELECT (uo.is_active IS TRUE AND uo.is_org_admin IS TRUE)
    INTO v_target_is_active_admin
  FROM public.user_organizations uo
  WHERE uo.user_id = p_target_user_id
    AND uo.org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_MEMBER');
  END IF;

  IF p_value = false AND v_target_is_active_admin THEN
    SELECT COUNT(*) INTO v_admins_count
    FROM public.user_organizations
    WHERE org_id = p_org_id
      AND is_org_admin = true
      AND is_active = true
      AND user_id <> p_target_user_id;
    IF v_admins_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'LAST_ORG_ADMIN');
    END IF;
  END IF;

  UPDATE public.user_organizations
  SET is_org_admin = p_value
  WHERE user_id = p_target_user_id
    AND org_id = p_org_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_set_org_admin(uuid,uuid,boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_org_admin(uuid,uuid,boolean)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. rpc_remove_org_member — atomic, audited replacement for the client's
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
  v_caller_member_active boolean;
  v_caller_member_admin boolean;
  v_caller_super_admin boolean := false;
BEGIN
  IF v_org IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'RBAC_175_ORG_AND_USER_REQUIRED';
  END IF;
  PERFORM public.wardah_assert_org_admin(v_org);

  PERFORM 1
  FROM public.organizations o
  WHERE o.id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RBAC_175_ORG_NOT_FOUND';
  END IF;

  -- Re-authorize from locked rows. rpc_remove_org_member deliberately keeps
  -- wardah_assert_org_admin's member-first contract even for super admins.
  SELECT uo.is_active IS TRUE,
         (uo.is_org_admin IS TRUE OR uo.role IN ('admin', 'owner'))
    INTO v_caller_member_active, v_caller_member_admin
  FROM public.user_organizations uo
  WHERE uo.user_id = auth.uid()
    AND uo.org_id = v_org
  FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(v_caller_member_active, false) THEN
    RAISE EXCEPTION 'NOT_ORG_MEMBER';
  END IF;

  SELECT sa.is_active IS TRUE
    INTO v_caller_super_admin
  FROM public.super_admins sa
  WHERE sa.user_id = auth.uid()
  FOR UPDATE;

  IF NOT COALESCE(v_caller_member_admin, false)
     AND NOT COALESCE(v_caller_super_admin, false) THEN
    RAISE EXCEPTION 'NOT_ORG_ADMIN';
  END IF;

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

  v_was_admin :=
    COALESCE((v_old_member->>'is_active')::boolean, false)
    AND COALESCE((v_old_member->>'is_org_admin')::boolean, false);

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
-- 6. create_role_from_template — same signature, same return type. Adds the
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
-- 7. wardah_is_sensitive_permission — add an explicit search_path. The
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
  v_replace_src text;
  v_set_admin_src text;
  v_has_permission_src text;
  v_exact_permission_src text;
  v_child_guard_src text;
  v_update_guard_src text;
  v_template_src text;
  v_classifier_config text[];
BEGIN
  SELECT prosrc INTO v_replace_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_replace_user_roles';
  IF v_replace_src !~ 'FOR KEY SHARE'
     OR v_replace_src !~ 'wardah_175_internal_replace_user_roles'
     OR v_replace_src !~ 'wardah_assert_org_admin' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_replace_user_roles lacks organization-first guarded wrapper';
  END IF;
  IF has_function_privilege('anon', 'public.wardah_175_internal_replace_user_roles(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_175_internal_replace_user_roles(jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_175_internal_replace_user_roles(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_replace_user_roles(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[175] replace-user-roles wrapper execute boundary is wrong';
  END IF;

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
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member no longer locks rows';
  END IF;
  IF v_remove_src !~ 'organizations o'
     OR v_remove_src !~ 'v_caller_member_active'
     OR v_remove_src !~ 'v_caller_member_admin' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member lacks shared org lock or post-lock reauthorization';
  END IF;
  IF v_remove_src !~ 'audit_logs' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member does not write an audit row';
  END IF;

  IF has_function_privilege('anon', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_remove_org_member(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[175] rpc_remove_org_member execute boundary is wrong';
  END IF;

  SELECT prosrc INTO v_set_admin_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_set_org_admin';
  IF v_set_admin_src !~ 'organizations o'
     OR v_set_admin_src !~ 'v_target_is_active_admin'
     OR v_set_admin_src !~ 'v_caller_member_active'
     OR v_set_admin_src !~ 'FOR UPDATE' THEN
    RAISE EXCEPTION 'FAIL[175] rpc_set_org_admin lacks shared lock or active-target last-admin guard';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_roles'
      AND t.tgname = 'trg_wardah_175_require_active_role_membership'
      AND t.tgenabled <> 'D'
      AND NOT t.tgisinternal
      AND (t.tgtype & 1) = 1
      AND (t.tgtype & 2) = 2
      AND (t.tgtype & 4) = 4
      AND (t.tgtype & 16) = 0
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_roles'
      AND t.tgname = 'trg_wardah_175_reject_direct_role_update'
      AND t.tgenabled <> 'D'
      AND NOT t.tgisinternal
      AND (t.tgtype & 1) = 0
      AND (t.tgtype & 2) = 2
      AND (t.tgtype & 4) = 0
      AND (t.tgtype & 16) = 16
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_organizations'
      AND t.tgname = 'trg_wardah_175_protect_role_membership_parent'
      AND t.tgenabled <> 'D'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL[175] membership/update invariant triggers missing, malformed, or disabled';
  END IF;

  IF has_function_privilege('anon', 'public.wardah_175_require_active_role_membership()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_175_require_active_role_membership()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_175_require_active_role_membership()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wardah_175_reject_direct_role_update()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_175_reject_direct_role_update()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_175_reject_direct_role_update()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wardah_175_protect_role_membership_parent()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wardah_175_protect_role_membership_parent()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_175_protect_role_membership_parent()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[175] invariant trigger function execute boundary is open';
  END IF;

  SELECT prosrc INTO v_child_guard_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'wardah_175_require_active_role_membership';
  IF v_child_guard_src !~ 'organizations o'
     OR v_child_guard_src !~ 'FOR KEY SHARE'
     OR v_child_guard_src !~ 'user_organizations uo'
     OR v_child_guard_src !~ 'FOR UPDATE' THEN
    RAISE EXCEPTION 'FAIL[175] assignment trigger lock order is not org then membership';
  END IF;

  SELECT prosrc INTO v_update_guard_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'wardah_175_reject_direct_role_update';
  IF v_update_guard_src !~ 'RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES' THEN
    RAISE EXCEPTION 'FAIL[175] direct user_roles UPDATE guard marker is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    LEFT JOIN public.user_organizations uo
      ON uo.user_id = ur.user_id
     AND uo.org_id = ur.org_id
     AND uo.is_active IS TRUE
    WHERE uo.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL[175] orphan or inactive-member assignment remains';
  END IF;

  SELECT prosrc INTO v_has_permission_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_permission';
  SELECT prosrc INTO v_exact_permission_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'wardah_has_exact_permission';
  IF v_has_permission_src !~ 'user_organizations uo'
     OR v_has_permission_src !~ 'uo\.is_active IS TRUE'
     OR v_exact_permission_src !~ 'user_organizations uo'
     OR v_exact_permission_src !~ 'uo\.is_active IS TRUE' THEN
    RAISE EXCEPTION 'FAIL[175] permission helpers do not require active explicit-role membership';
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

  RAISE NOTICE 'PASS[175] membership, last-admin, and direct-update races closed; consumer RPCs live; permission helpers hardened';
END
$verify$;

COMMIT;
