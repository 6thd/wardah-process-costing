-- =====================================================================
-- 173_has_permission_active_role_check
-- =====================================================================
-- Closes a second gap in has_permission(p_user_id, p_org_id,
-- p_permission_key)'s ordinary-role branch, found during the security
-- review that approved Migration 172: the branch joins user_roles ->
-- role_permissions -> permissions and never joins public.roles at all, so
-- a role's own `is_active` flag is never checked. Disabling a role (a real,
-- exposed operation — see e.g. role management UI) leaves every user still
-- assigned to it fully authorized for everything that role grants, as long
-- as their user_roles row is untouched and unexpired.
--
-- This is a distinct bug from Migration 172's same-module wildcard match:
-- 172 fixed WHICH permission_key values a grant satisfies; this migration
-- fixes WHETHER a grant through a since-disabled role should count at all.
-- Reviewed together, approved as two separate, independently-testable
-- migrations rather than one combined change (see PR review on #109).
--
-- Precedent already exists in this codebase: Migration 166
-- (wardah_has_exact_permission, introduced for the sensitive
-- accounting.vouchers.unpost control) already joins roles with
-- `r.org_id = p_org_id AND coalesce(r.is_active, true)` for exactly this
-- reason — its own comment there ("has_permission intentionally supports
-- module-level fallback... unposting must bypass that fallback") shows the
-- broad-match gap 172 closed was a known, worked-around limitation before
-- it was fixed at the root. has_permission() itself was never updated to
-- match that stricter helper's role-activity check. This migration brings
-- it into line, mirroring the identical join shape and COALESCE(...,
-- true) null-safety convention already established in 166 — a role row
-- with is_active left NULL (schema default is `true`, but not NOT NULL)
-- must not silently lose access, matching how this codebase already
-- treats nullable is_active flags elsewhere (e.g. Migration 170's
-- `COALESCE(user_organizations.is_active, true)`).
--
-- Unaffected: the auth.uid() self-check (170), super-admin override
-- (super_admins has its own is_active check, untouched), org-admin
-- override (user_organizations has its own is_active check, untouched),
-- exact permission_key equality (172), org scoping, and role-expiry
-- behavior are all unchanged. Only the ordinary-role branch gains one
-- additional join condition.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- Preflight: fail closed if the schema has already drifted from what this
-- migration assumes, before touching anything.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_173_HAS_PERMISSION_MISSING';
  END IF;

  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.user_roles') IS NULL
     OR to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_173_REQUIRED_TABLE_MISSING';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- has_permission — ordinary-role branch now also requires the granting
-- role itself to be active. Every other branch and predicate is
-- byte-identical to Migration 172.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_org_id uuid, p_permission_key character varying) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_has_permission BOOLEAN;
BEGIN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
        RETURN false;
    END IF;

    -- Super Admin: كل الصلاحيات
    IF EXISTS (
        SELECT 1 FROM super_admins
        WHERE user_id = p_user_id AND is_active = true
    ) THEN
        RETURN true;
    END IF;

    -- Org Admin: كل صلاحيات منظمته
    IF EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = p_user_id
        AND org_id = p_org_id
        AND is_active = true
        AND is_org_admin = true
    ) THEN
        RETURN true;
    END IF;

    -- التحقق من الصلاحيات العادية: مطابقة تامة لمفتاح الصلاحية (172)، عبر
    -- دور نشط فقط (173) — تعطيل الدور يسحب صلاحياته فورًا من كل من يحمله.
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        INNER JOIN roles r ON r.id = ur.role_id
            AND r.org_id = p_org_id
            AND COALESCE(r.is_active, true)
        INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND ur.org_id = p_org_id
        AND p.permission_key = p_permission_key
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    ) INTO v_has_permission;

    RETURN COALESCE(v_has_permission, false);
END;
$$;

-- Grants unchanged: authenticated and service_role retain EXECUTE (see
-- Migration 170) — this migration narrows the ordinary-role predicate
-- only, not the execution boundary.

-- ---------------------------------------------------------------------------
-- Postflight: fail closed before COMMIT if the fix did not take, and that
-- every prior behavior (170, 172) survived untouched.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_permission';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL[173] has_permission not found after CREATE OR REPLACE';
  END IF;

  -- The new role-activity join, null-safe per the Migration 166 convention.
  IF v_src !~ 'roles r' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission does not join public.roles';
  END IF;
  IF v_src !~ 'COALESCE\(r\.is_active,\s*true\)' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission is missing the COALESCE(r.is_active, true) guard';
  END IF;

  -- Migration 172 behavior must survive untouched.
  IF v_src ~ 'LIKE' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission regained a LIKE-based same-module match';
  END IF;
  IF v_src !~ 'p\.permission_key\s*=\s*p_permission_key' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission lost the exact permission_key equality predicate (172)';
  END IF;
  IF v_src !~ 'ur\.org_id\s*=\s*p_org_id' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission lost the ur.org_id = p_org_id scoping predicate (172)';
  END IF;

  -- Migration 170 behavior must survive untouched.
  IF v_src !~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission lost the caller-identity guard (170)';
  END IF;
  IF v_src !~ 'super_admins' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission lost the super-admin override (170)';
  END IF;
  IF v_src !~ 'is_org_admin' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission lost the org-admin override (170)';
  END IF;
  IF v_src !~ 'expires_at' THEN
    RAISE EXCEPTION 'FAIL[173] has_permission lost role-expiry enforcement (170)';
  END IF;

  RAISE NOTICE 'PASS[173] has_permission now requires the granting role to be active; Migration 170/172 behavior preserved';
END
$verify$;

COMMIT;
