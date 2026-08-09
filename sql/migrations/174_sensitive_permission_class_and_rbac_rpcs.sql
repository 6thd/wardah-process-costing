-- =====================================================================
-- 174_sensitive_permission_class_and_rbac_rpcs
-- =====================================================================
-- Closes Issue #93: the org-admin override branch of both permission
-- functions never reads p_permission_key at all, so any active org admin
-- passes EVERY key, including the accounting controls that exist
-- precisely to be exceptional. Verified live on 2026-08-09 before this
-- migration was written: the single active org admin held
-- accounting.vouchers.unpost and accounting.vouchers.cancel purely
-- through that override — via_super_admin = false, via_explicit_grant =
-- false, and both keys granted to zero roles.
--
-- The approved contract (see docs/db/SENSITIVE_PERMISSIONS_174_RUNBOOK.md):
--
--   * Platform super admin  -> keeps the full override, including
--                              sensitive keys (emergency access).
--   * Org admin             -> keeps the override for every ordinary key,
--                              including user and role administration,
--                              but NOT for sensitive keys.
--   * Sensitive key         -> requires an explicit grant through an
--                              active, unexpired role in that org. An org
--                              admin may create such a role and assign it,
--                              including to themselves — authority becomes
--                              an explicit, audited decision instead of a
--                              silent override.
--
-- The sensitive set is defined by ONE central classifier,
-- wardah_is_sensitive_permission(text), called by both permission
-- functions. Deliberately a function and not a table: widening the
-- sensitive set must go through a migration, code review and tests, never
-- a silent data edit. It is IMMUTABLE and STRICT, so every caller wraps it
-- in COALESCE(..., false) — a NULL key must not be treated as sensitive
-- (it is simply not a real permission, and the ordinary-role branch will
-- fail to match it anyway).
--
-- Sensitive keys in this migration, exactly two:
--   accounting.vouchers.unpost
--   accounting.vouchers.cancel
--
-- accounting.vouchers.reverse is NOT included: it does not exist in the
-- live permissions table and has no reference anywhere in the repository.
-- It is not added speculatively. reports.ai_insights.use is deliberately
-- ordinary, not sensitive.
--
-- Preserved unchanged from the 170-173 chain (all five layers, in both
-- functions, re-asserted by the postflight block at the end):
--   170  caller-identity guard on has_permission
--   172  exact permission_key equality, no LIKE fallback
--   173  granting role must be active
--   pre  role expiry (expires_at) and org scoping
--
-- NOT changed here, deliberately:
--   * No auth.uid() identity guard is added to
--     wardah_has_exact_permission. It is internal (EXECUTE is postgres
--     only — not authenticated, not anon, not service_role), its four
--     callers pass an actor resolved inside the RPC, and adding the guard
--     now risks breaking them for no reachable gain. Its execute boundary
--     is re-asserted in the postflight instead.
--   * Direct INSERT/UPDATE/DELETE on roles, role_permissions and
--     user_roles is NOT revoked from `authenticated` in this migration.
--     The live role-management UI still writes those tables directly;
--     revoking here would break it in the window between applying this
--     migration and deploying the dependent UI. This mirrors the
--     163/167 -> 169 sequence already established in this repository:
--     ship the atomic RPCs first, move the UI onto them, then close the
--     direct-write surface in its own follow-up migration (175).
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
  IF to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_174_HAS_PERMISSION_MISSING';
  END IF;
  IF to_regprocedure('public.wardah_has_exact_permission(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_174_EXACT_HELPER_MISSING';
  END IF;
  IF to_regprocedure('public.wardah_assert_org_admin(uuid)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_174_ORG_GUARD_MISSING';
  END IF;

  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.user_roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.user_organizations') IS NULL
     OR to_regclass('public.super_admins') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_174_REQUIRED_TABLE_MISSING';
  END IF;

  -- The two sensitive keys must already exist. If a future environment
  -- renames them, this migration must be revisited rather than silently
  -- classifying nothing.
  IF (SELECT count(*) FROM public.permissions
       WHERE permission_key IN ('accounting.vouchers.unpost',
                                'accounting.vouchers.cancel')) <> 2 THEN
    RAISE EXCEPTION 'PERMISSION_174_SENSITIVE_KEYS_NOT_FOUND';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The central classifier.
--
-- IMMUTABLE + STRICT: a pure function of its argument, with no table access,
-- so it can be inlined and is safe to call inside other STABLE functions.
-- STRICT means NULL in -> NULL out; every call site wraps it in COALESCE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_is_sensitive_permission(p_permission_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
  SELECT p_permission_key IN (
    'accounting.vouchers.unpost',
    'accounting.vouchers.cancel'
  );
$function$;

COMMENT ON FUNCTION public.wardah_is_sensitive_permission(text) IS
  'Issue #93 / Migration 174. Single source of truth for which permission keys '
  'the org-admin override must NOT satisfy. Widening this set requires a new '
  'migration, code review and acceptance tests — never a data edit. '
  'STRICT: NULL in, NULL out; callers must COALESCE(..., false).';

REVOKE ALL ON FUNCTION public.wardah_is_sensitive_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wardah_is_sensitive_permission(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. has_permission: org-admin override no longer covers sensitive keys.
--
-- Every other layer is reproduced verbatim from the 170/172/173 chain. This
-- function is the union of four migrations now, not the last one — see
-- docs/db/PERMISSION_HARDENING_170_173_CHAIN.md.
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
    v_has_permission BOOLEAN;
    v_sensitive      BOOLEAN;
BEGIN
    -- (170) A caller may only ask about themselves.
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
        RETURN false;
    END IF;

    -- (174) Central classification. STRICT function: COALESCE is required.
    v_sensitive := COALESCE(
        public.wardah_is_sensitive_permission(p_permission_key::text), false);

    -- Super Admin: كل الصلاحيات، بما فيها الحساسة (تجاوز الطوارئ).
    IF EXISTS (
        SELECT 1 FROM super_admins
        WHERE user_id = p_user_id AND is_active = true
    ) THEN
        RETURN true;
    END IF;

    -- Org Admin: كل الصلاحيات العادية في منظمته — ولا يشمل التجاوز
    -- الصلاحيات الحساسة (174)، فهذه تحتاج منحًا صريحًا عبر دور نشط.
    IF NOT v_sensitive AND EXISTS (
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
    -- هذا هو المسار الوحيد المتبقي للصلاحيات الحساسة لغير المسؤول المنصّي.
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. wardah_has_exact_permission: the same narrowing, so the two functions
--    cannot drift. This is the helper the voucher unpost/cancel RPCs call.
--
--    Execute boundary unchanged (postgres only) and no identity guard added
--    — see the header note.
-- ---------------------------------------------------------------------------
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
    -- Platform super admin keeps the full override.
    EXISTS (
      SELECT 1
      FROM public.super_admins sa
      WHERE sa.user_id = p_user_id
        AND sa.is_active = true
    )
    -- Org admin override, ordinary keys only (174).
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
    -- Explicit grant through an active, unexpired, org-scoped role.
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r
        ON r.id = ur.role_id
       AND r.org_id = p_org_id
       AND coalesce(r.is_active, true)
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = p_user_id
        AND ur.org_id = p_org_id
        AND p.permission_key = p_permission_key
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    );
$function$;

-- Re-assert the postgres-only execute boundary immediately after the
-- definition. Replacing a function in place preserves its existing grants, so
-- this is belt-and-braces — and it keeps the boundary visible next to the
-- function it protects rather than only in the grants section below.
REVOKE ALL ON FUNCTION public.wardah_has_exact_permission(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Atomic RBAC control plane.
--
-- The existing UI performs role and assignment edits as separate DELETE and
-- INSERT round-trips with unchecked errors, which can leave a role with no
-- permissions or a user with no roles when the second call fails. These RPCs
-- replace that with one transactional statement each, org-scoped, guarded by
-- wardah_assert_org_admin, and written to audit_logs.
-- ---------------------------------------------------------------------------

-- 4.1 Create or update a role together with its complete permission set.
CREATE OR REPLACE FUNCTION public.rpc_upsert_org_role(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org         uuid := NULLIF(p_payload->>'org_id','')::uuid;
  v_role_id     uuid := NULLIF(p_payload->>'role_id','')::uuid;
  v_name        text := btrim(COALESCE(p_payload->>'name',''));
  v_name_ar     text := NULLIF(btrim(COALESCE(p_payload->>'name_ar','')),'');
  v_description text := NULLIF(btrim(COALESCE(p_payload->>'description','')),'');
  v_is_active   boolean := COALESCE((p_payload->>'is_active')::boolean, true);
  v_keys        text[];
  v_missing     text[];
  v_old         jsonb;
  v_created     boolean := false;
  v_sensitive   text[];
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'RBAC_174_ORG_REQUIRED';
  END IF;
  PERFORM public.wardah_assert_org_admin(v_org);

  IF v_name = '' THEN
    RAISE EXCEPTION 'RBAC_174_ROLE_NAME_REQUIRED';
  END IF;

  -- Permission keys are optional (a role may legitimately have none yet) but
  -- must all exist when supplied — an unknown key is a client bug, not a
  -- silently-dropped grant.
  SELECT COALESCE(array_agg(DISTINCT k), ARRAY[]::text[])
    INTO v_keys
  FROM jsonb_array_elements_text(COALESCE(p_payload->'permission_keys','[]'::jsonb)) AS t(k);

  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_missing
  FROM unnest(v_keys) AS k
  WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.permission_key = k);

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_174_UNKNOWN_PERMISSION_KEY: %', array_to_string(v_missing, ', ');
  END IF;

  IF v_role_id IS NULL THEN
    -- Create. Name must be unique within the organization.
    IF EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.org_id = v_org AND lower(r.name) = lower(v_name)
    ) THEN
      RAISE EXCEPTION 'RBAC_174_ROLE_NAME_TAKEN';
    END IF;

    -- roles.name_ar is NOT NULL in this schema with no default; fall back to
    -- the Latin name rather than failing on a client that omits it.
    INSERT INTO public.roles (org_id, name, name_ar, description, is_active, is_system_role, created_by)
    VALUES (v_org, v_name, COALESCE(v_name_ar, v_name), v_description, v_is_active, false, auth.uid())
    RETURNING id INTO v_role_id;

    v_created := true;
  ELSE
    -- Update. Lock the row so two concurrent editors cannot interleave.
    SELECT to_jsonb(r) INTO v_old
    FROM public.roles r
    WHERE r.id = v_role_id AND r.org_id = v_org
    FOR UPDATE;

    IF v_old IS NULL THEN
      RAISE EXCEPTION 'RBAC_174_ROLE_NOT_FOUND_IN_ORG';
    END IF;
    IF COALESCE((v_old->>'is_system_role')::boolean, false) THEN
      RAISE EXCEPTION 'RBAC_174_SYSTEM_ROLE_IMMUTABLE';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.org_id = v_org AND lower(r.name) = lower(v_name) AND r.id <> v_role_id
    ) THEN
      RAISE EXCEPTION 'RBAC_174_ROLE_NAME_TAKEN';
    END IF;

    UPDATE public.roles
       SET name = v_name,
           name_ar = COALESCE(v_name_ar, v_name),
           description = v_description,
           is_active = v_is_active,
           updated_at = now()
     WHERE id = v_role_id AND org_id = v_org;
  END IF;

  -- Replace the permission set atomically: both statements are in the same
  -- transaction as the role row itself, so a failure leaves neither applied.
  DELETE FROM public.role_permissions WHERE role_id = v_role_id;

  IF array_length(v_keys, 1) IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id, created_by)
    SELECT v_role_id, p.id, auth.uid()
    FROM public.permissions p
    WHERE p.permission_key = ANY (v_keys);
  END IF;

  SELECT COALESCE(array_agg(k), ARRAY[]::text[]) INTO v_sensitive
  FROM unnest(v_keys) AS k
  WHERE public.wardah_is_sensitive_permission(k);

  INSERT INTO public.audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (
    v_org, auth.uid(),
    CASE WHEN v_created THEN 'rbac.role.create' ELSE 'rbac.role.update' END,
    'role', v_role_id::text, v_old,
    jsonb_build_object('name', v_name, 'is_active', v_is_active, 'permission_keys', to_jsonb(v_keys)),
    jsonb_build_object(
      'migration', 174,
      'permission_count', COALESCE(array_length(v_keys, 1), 0),
      'sensitive_keys', to_jsonb(v_sensitive),
      'grants_sensitive', COALESCE(array_length(v_sensitive, 1), 0) > 0)
  );

  RETURN jsonb_build_object(
    'role_id', v_role_id,
    'created', v_created,
    'permission_count', COALESCE(array_length(v_keys, 1), 0),
    'sensitive_keys', to_jsonb(v_sensitive));
END;
$function$;

-- 4.2 Replace a user's complete role set for one organization.
CREATE OR REPLACE FUNCTION public.rpc_replace_user_roles(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org       uuid := NULLIF(p_payload->>'org_id','')::uuid;
  v_user      uuid := NULLIF(p_payload->>'user_id','')::uuid;
  v_expires   timestamptz := NULLIF(p_payload->>'expires_at','')::timestamptz;
  v_role_ids  uuid[];
  v_bad       int;
  v_old       jsonb;
  v_sensitive text[];
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'RBAC_174_ORG_AND_USER_REQUIRED';
  END IF;
  PERFORM public.wardah_assert_org_admin(v_org);

  -- The target must be a member of this organization; role assignment must
  -- never be a way to reach across tenants.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = v_user AND uo.org_id = v_org AND uo.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'RBAC_174_TARGET_NOT_ACTIVE_ORG_MEMBER';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT rid::uuid), ARRAY[]::uuid[])
    INTO v_role_ids
  FROM jsonb_array_elements_text(COALESCE(p_payload->'role_ids','[]'::jsonb)) AS t(rid);

  -- Every role must belong to this organization.
  SELECT count(*) INTO v_bad
  FROM unnest(v_role_ids) AS rid
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id = rid AND r.org_id = v_org
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'RBAC_174_ROLE_NOT_IN_ORG';
  END IF;

  SELECT COALESCE(jsonb_agg(ur.role_id), '[]'::jsonb) INTO v_old
  FROM public.user_roles ur
  WHERE ur.user_id = v_user AND ur.org_id = v_org;

  DELETE FROM public.user_roles WHERE user_id = v_user AND org_id = v_org;

  IF array_length(v_role_ids, 1) IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role_id, org_id, assigned_by, expires_at)
    SELECT v_user, rid, v_org, auth.uid(), v_expires
    FROM unnest(v_role_ids) AS rid;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT p.permission_key), ARRAY[]::text[])
    INTO v_sensitive
  FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = ANY (v_role_ids)
    AND public.wardah_is_sensitive_permission(p.permission_key);

  INSERT INTO public.audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (
    v_org, auth.uid(), 'rbac.user_roles.replace', 'user', v_user::text,
    v_old, to_jsonb(v_role_ids),
    jsonb_build_object(
      'migration', 174,
      'role_count', COALESCE(array_length(v_role_ids, 1), 0),
      'expires_at', v_expires,
      'sensitive_keys_granted', to_jsonb(v_sensitive),
      'self_assignment', v_user = auth.uid())
  );

  RETURN jsonb_build_object(
    'user_id', v_user,
    'role_count', COALESCE(array_length(v_role_ids, 1), 0),
    'sensitive_keys_granted', to_jsonb(v_sensitive));
END;
$function$;

-- 4.3 Delete a role, refusing anything that would silently strip access.
CREATE OR REPLACE FUNCTION public.rpc_delete_org_role(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org     uuid := NULLIF(p_payload->>'org_id','')::uuid;
  v_role_id uuid := NULLIF(p_payload->>'role_id','')::uuid;
  v_old     jsonb;
  v_users   int;
BEGIN
  IF v_org IS NULL OR v_role_id IS NULL THEN
    RAISE EXCEPTION 'RBAC_174_ORG_AND_ROLE_REQUIRED';
  END IF;
  PERFORM public.wardah_assert_org_admin(v_org);

  SELECT to_jsonb(r) INTO v_old
  FROM public.roles r
  WHERE r.id = v_role_id AND r.org_id = v_org
  FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'RBAC_174_ROLE_NOT_FOUND_IN_ORG';
  END IF;
  IF COALESCE((v_old->>'is_system_role')::boolean, false) THEN
    RAISE EXCEPTION 'RBAC_174_SYSTEM_ROLE_IMMUTABLE';
  END IF;

  -- Refuse while users still hold it. Revoking access is a separate,
  -- deliberate act (rpc_replace_user_roles) and must be visible as one.
  SELECT count(*) INTO v_users
  FROM public.user_roles ur WHERE ur.role_id = v_role_id;
  IF v_users > 0 THEN
    RAISE EXCEPTION 'RBAC_174_ROLE_STILL_ASSIGNED: % user(s)', v_users;
  END IF;

  DELETE FROM public.role_permissions WHERE role_id = v_role_id;
  DELETE FROM public.roles WHERE id = v_role_id AND org_id = v_org;

  INSERT INTO public.audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (v_org, auth.uid(), 'rbac.role.delete', 'role', v_role_id::text,
          v_old, NULL, jsonb_build_object('migration', 174));

  RETURN jsonb_build_object('role_id', v_role_id, 'deleted', true);
END;
$function$;

-- 4.4 The permission snapshot: the single source of truth for the UI.
--
-- Returns exactly what the backend would decide, so the client can never
-- reach a different conclusion by re-implementing the override locally.
CREATE OR REPLACE FUNCTION public.rpc_permission_snapshot(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_is_super      boolean;
  v_is_org_admin  boolean;
  v_keys          text[];
  v_sensitive_all text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'ORG_UNRESOLVED';
  END IF;
  -- Membership guard: a snapshot is only ever about the caller, in an org
  -- the caller actually belongs to.
  PERFORM public.wardah_assert_org_member(p_org_id);

  SELECT EXISTS (SELECT 1 FROM public.super_admins sa
                  WHERE sa.user_id = v_uid AND sa.is_active = true)
    INTO v_is_super;

  SELECT EXISTS (SELECT 1 FROM public.user_organizations uo
                  WHERE uo.user_id = v_uid AND uo.org_id = p_org_id
                    AND uo.is_active = true AND uo.is_org_admin = true)
    INTO v_is_org_admin;

  SELECT COALESCE(array_agg(p.permission_key ORDER BY p.permission_key), ARRAY[]::text[])
    INTO v_sensitive_all
  FROM public.permissions p
  WHERE public.wardah_is_sensitive_permission(p.permission_key);

  IF v_is_super THEN
    -- Full override including sensitive keys.
    SELECT COALESCE(array_agg(p.permission_key ORDER BY p.permission_key), ARRAY[]::text[])
      INTO v_keys
    FROM public.permissions p;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), ARRAY[]::text[]) INTO v_keys
    FROM (
      -- Ordinary keys via the org-admin override (never sensitive ones).
      SELECT p.permission_key AS k
      FROM public.permissions p
      WHERE v_is_org_admin
        AND NOT public.wardah_is_sensitive_permission(p.permission_key)
      UNION
      -- Explicit grants through an active, unexpired, org-scoped role.
      SELECT p.permission_key
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
        AND r.org_id = p_org_id AND COALESCE(r.is_active, true)
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = v_uid
        AND ur.org_id = p_org_id
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ) AS effective;
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_uid,
    'org_id', p_org_id,
    'is_super_admin', v_is_super,
    'is_org_admin', v_is_org_admin,
    'permission_keys', to_jsonb(v_keys),
    'sensitive_permission_keys', to_jsonb(v_sensitive_all),
    'generated_at', now());
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants. The RPCs are client-facing and re-check identity and membership
--    internally; the classifier is read-only and harmless. Nothing here is
--    reachable by anon, and service_role gets no client RPC surface.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_upsert_org_role(jsonb)      FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rpc_replace_user_roles(jsonb)   FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rpc_delete_org_role(jsonb)      FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rpc_permission_snapshot(uuid)   FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.rpc_upsert_org_role(jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_replace_user_roles(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_org_role(jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_permission_snapshot(uuid) TO authenticated;

-- (wardah_has_exact_permission keeps its postgres-only boundary — revoked
--  immediately after its definition in section 3.)

-- ---------------------------------------------------------------------------
-- 6. Postflight: prove the new contract AND that nothing from 170-173 was
--    lost, before COMMIT.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_hp  text;
  v_ex  text;
  v_fn  text;
BEGIN
  SELECT prosrc INTO v_hp FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_permission';
  SELECT prosrc INTO v_ex FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'wardah_has_exact_permission';

  -- The classifier exists, is IMMUTABLE and STRICT, and classifies exactly two keys.
  IF to_regprocedure('public.wardah_is_sensitive_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL[174] classifier missing';
  END IF;
  SELECT CASE WHEN p.provolatile = 'i' THEN 'ok' ELSE 'not-immutable' END INTO v_fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'wardah_is_sensitive_permission';
  IF v_fn <> 'ok' THEN
    RAISE EXCEPTION 'FAIL[174] classifier is not IMMUTABLE';
  END IF;
  IF NOT (SELECT proisstrict FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'wardah_is_sensitive_permission') THEN
    RAISE EXCEPTION 'FAIL[174] classifier is not STRICT';
  END IF;
  IF NOT public.wardah_is_sensitive_permission('accounting.vouchers.unpost')
     OR NOT public.wardah_is_sensitive_permission('accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'FAIL[174] classifier does not cover both sensitive keys';
  END IF;
  IF public.wardah_is_sensitive_permission('reports.ai_insights.use')
     OR public.wardah_is_sensitive_permission('accounting.entries.approve') THEN
    RAISE EXCEPTION 'FAIL[174] classifier over-classifies an ordinary key';
  END IF;
  IF (SELECT count(*) FROM public.permissions p
       WHERE public.wardah_is_sensitive_permission(p.permission_key)) <> 2 THEN
    RAISE EXCEPTION 'FAIL[174] sensitive set is not exactly two live permission rows';
  END IF;

  -- Both functions consult the classifier, and both still carry every
  -- guarantee from the 170-173 chain.
  IF v_hp !~ 'wardah_is_sensitive_permission' THEN
    RAISE EXCEPTION 'FAIL[174] has_permission does not consult the classifier';
  END IF;
  IF v_ex !~ 'wardah_is_sensitive_permission' THEN
    RAISE EXCEPTION 'FAIL[174] wardah_has_exact_permission does not consult the classifier';
  END IF;

  IF v_hp !~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' THEN
    RAISE EXCEPTION 'FAIL[174] has_permission lost the caller-identity guard (170)';
  END IF;
  IF v_hp ~ 'LIKE' OR v_ex ~ 'LIKE' THEN
    RAISE EXCEPTION 'FAIL[174] a LIKE-based same-module match reappeared (172)';
  END IF;
  IF v_hp !~ 'p\.permission_key\s*=\s*p_permission_key'
     OR v_ex !~ 'p\.permission_key\s*=\s*p_permission_key' THEN
    RAISE EXCEPTION 'FAIL[174] exact permission_key equality lost (172)';
  END IF;
  IF v_hp !~ 'COALESCE\(r\.is_active, true\)' OR v_ex !~ 'coalesce\(r\.is_active, true\)' THEN
    RAISE EXCEPTION 'FAIL[174] active-role requirement lost (173)';
  END IF;
  IF v_hp !~ 'expires_at' OR v_ex !~ 'expires_at' THEN
    RAISE EXCEPTION 'FAIL[174] role-expiry enforcement lost';
  END IF;
  IF v_hp !~ 'ur\.org_id = p_org_id' OR v_ex !~ 'ur\.org_id = p_org_id' THEN
    RAISE EXCEPTION 'FAIL[174] org scoping lost';
  END IF;
  IF v_hp !~ 'super_admins' OR v_ex !~ 'super_admins' THEN
    RAISE EXCEPTION 'FAIL[174] super-admin override lost';
  END IF;
  IF v_hp !~ 'is_org_admin' OR v_ex !~ 'is_org_admin' THEN
    RAISE EXCEPTION 'FAIL[174] org-admin override removed entirely (ordinary keys must keep it)';
  END IF;

  -- Execute boundaries.
  IF has_function_privilege('anon', 'public.has_permission(uuid,uuid,character varying)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.has_permission(uuid,uuid,character varying)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[174] has_permission execute boundary drifted';
  END IF;
  IF has_function_privilege('authenticated', 'public.wardah_has_exact_permission(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wardah_has_exact_permission(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_has_exact_permission(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[174] wardah_has_exact_permission escaped its postgres-only boundary';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rpc_upsert_org_role(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_replace_user_roles(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_delete_org_role(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_permission_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[174] an RBAC RPC is not executable by authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.rpc_upsert_org_role(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_replace_user_roles(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_delete_org_role(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_permission_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[174] an RBAC RPC is reachable by anon';
  END IF;

  RAISE NOTICE 'PASS[174] sensitive-permission class active; org-admin override narrowed; 170-173 guarantees intact';
END
$verify$;

COMMIT;
