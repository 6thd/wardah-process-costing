-- =====================================================================
-- 172_has_permission_exact_key_match
-- =====================================================================
-- Closes an authorization-scope bug in has_permission(p_user_id, p_org_id,
-- p_permission_key), inherited unchanged through Migration 170: the
-- "ordinary role" branch matched not only an exact permission_key, but
-- also any other permission_key sharing the same first dot-segment
-- ("module"):
--
--   p.permission_key = p_permission_key
--   OR p.permission_key LIKE REPLACE(
--        SPLIT_PART(p_permission_key, '.', 1) || '.%', '*', '%'
--      )
--
-- For p_permission_key = 'reports.ai_insights.use', SPLIT_PART(...,'.',1)
-- is 'reports', so the pattern reduces to `p.permission_key LIKE
-- 'reports.%'` — REPLACE(...,'*','%') is a no-op here since the pattern
-- never contains a literal '*'. Any role holding ANY 'reports.*'
-- permission (e.g. reports.financial.read, reports.exports.export)
-- therefore implicitly satisfied reports.ai_insights.use, defeating the
-- dedicated permission Migration 171 introduced specifically to gate the
-- reports-insights Edge Function's AI usage quota. The same shape applies
-- to every other permission_key in the catalog, not just this one — it is
-- a general same-module authorization-scope bug, found during pre-deploy
-- verification of reports-insights on 2026-08-08, before that function was
-- ever deployed (verify_jwt) or given production traffic.
--
-- Confirmed live in Production (project uutfztmqvajmsxnrqeiv) before this
-- migration was written: `has_permission`'s prosrc matches the buggy text
-- above verbatim, and the live `permissions` catalog holds 169 rows, 0 of
-- which contain a literal '*' — i.e. no permission_key in actual use
-- depends on wildcard/prefix matching. The REPLACE(...,'*','%') call was
-- therefore always a no-op against real data; the LIKE clause never did
-- anything except accidentally broaden every same-module check.
--
-- Fix: ordinary role authorization now requires exact permission_key
-- equality only. auth.uid() self-check (170), super-admin override,
-- org-admin override, org scoping, and role-expiry behavior are all
-- unchanged — only the ordinary-role predicate's OR-LIKE clause is
-- removed.
--
-- Caller audit (see docs/db/HAS_PERMISSION_172_RUNBOOK.md §2 for detail):
-- every SQL caller (149, 150, and their baseline copies) already passes an
-- exact, real permission_key it expects to match exactly — neither relies
-- on or is affected by the broad match. The one application-code RPC
-- caller that constructed a differently-shaped key
-- (`checkPermission()` in src/hooks/usePermissions.ts, a `${moduleCode}.
-- ${action}` 2-segment key against a 3-segment `module.resource.action`
-- catalog) has zero importers anywhere in `src/` — dead code, not a live
-- dependency on the broad match. The live `usePermissions()` hook actually
-- used by the app (ModuleGuard, ProtectedComponent, sidebar, withPermission)
-- never calls this RPC at all; it does its own exact client-side
-- module_code+action comparison against permission rows fetched directly.
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
    RAISE EXCEPTION 'PERMISSION_172_HAS_PERMISSION_MISSING';
  END IF;

  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_172_REQUIRED_TABLE_MISSING';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- has_permission — exact permission_key match only. auth.uid() self-check,
-- super-admin override, org-admin override, org scoping, and role-expiry
-- behavior are byte-identical to Migration 170; only the ordinary-role
-- predicate changes.
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

    -- التحقق من الصلاحيات العادية: مطابقة تامة لمفتاح الصلاحية فقط — لا
    -- توسيع لأي صلاحية أخرى تشارك نفس الوحدة (module).
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
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
-- Migration 170) — this migration narrows the predicate only, not the
-- execution boundary.

-- ---------------------------------------------------------------------------
-- Postflight: fail closed before COMMIT if the fix did not take.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_permission';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL[172] has_permission not found after CREATE OR REPLACE';
  END IF;

  IF v_src ~ 'LIKE' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission still contains a LIKE-based same-module match: %', v_src;
  END IF;

  IF v_src !~ 'p\.permission_key\s*=\s*p_permission_key' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission is missing the exact permission_key equality predicate';
  END IF;

  -- The auth.uid() self-check, super-admin, and org-admin branches from
  -- Migration 170 must survive untouched.
  IF v_src !~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission lost the caller-identity guard from Migration 170';
  END IF;
  IF v_src !~ 'super_admins' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission lost the super-admin override';
  END IF;
  IF v_src !~ 'is_org_admin' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission lost the org-admin override';
  END IF;
  IF v_src !~ 'expires_at' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission lost role-expiry enforcement';
  END IF;
  -- The org-scoping predicate itself: without this, the exact-equality fix
  -- above would still let a grant in ANY org satisfy a check against a
  -- DIFFERENT org, as long as the permission_key matched exactly. This is
  -- the predicate acceptance_172's cross-org assertion (172-6) is built to
  -- regression-guard.
  IF v_src !~ 'ur\.org_id\s*=\s*p_org_id' THEN
    RAISE EXCEPTION 'FAIL[172] has_permission lost the ur.org_id = p_org_id scoping predicate';
  END IF;

  RAISE NOTICE 'PASS[172] has_permission now requires exact permission_key equality; same-module wildcard match removed';
END
$verify$;

COMMIT;
