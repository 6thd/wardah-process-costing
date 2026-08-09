-- Acceptance for Migration 173.
-- Proves has_permission()'s ordinary-role branch now requires the granting
-- role to be active, while every override/scoping/expiry behavior from
-- Migrations 170 and 172 survives untouched:
-- (1) a role holding the exact permission, active, returns true;
-- (2) the SAME grant shape through a DISABLED role (roles.is_active =
--     false) returns false — the regression this migration closes;
-- (3) an expired user_roles grant through an ACTIVE role still returns
--     false (170 behavior, unaffected by the new join);
-- (4) org-admin and super-admin overrides still return true with no role
--     at all — they never reach the ordinary-role branch.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fixtures.
--
-- One org. A dedicated permission (perm173.rolecheck.use) so this test
-- doesn't depend on any specific seeded catalog key.
-- role_active / role_disabled are wired IDENTICALLY (same permission, same
-- org, no user_roles.expires_at) — the only difference is roles.is_active.
-- This isolates the variable: a false result for the Disabled user can
-- only be attributed to the is_active gate, not a miswired fixture (the
-- setup assertion below proves the grant is otherwise real).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('99173173-0001-0001-0001-000000000001', 'perm173-active@example.test'),
  ('99173173-0002-0002-0002-000000000002', 'perm173-disabled@example.test'),
  ('99173173-0003-0003-0003-000000000003', 'perm173-expired@example.test'),
  ('99173173-0004-0004-0004-000000000004', 'perm173-orgadmin@example.test'),
  ('99173173-0005-0005-0005-000000000005', 'perm173-super@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99173173-a000-a000-a000-00000000000a', 'Perm173 Org A', 'P173-A');

INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99173173-0001-0001-0001-000000000001', '99173173-a000-a000-a000-00000000000a', true, false),
  ('99173173-0002-0002-0002-000000000002', '99173173-a000-a000-a000-00000000000a', true, false),
  ('99173173-0003-0003-0003-000000000003', '99173173-a000-a000-a000-00000000000a', true, false),
  ('99173173-0004-0004-0004-000000000004', '99173173-a000-a000-a000-00000000000a', true, true),
  ('99173173-0005-0005-0005-000000000005', '99173173-a000-a000-a000-00000000000a', true, false);

INSERT INTO public.super_admins (user_id, email, is_active) VALUES
  ('99173173-0005-0005-0005-000000000005', 'perm173-super@example.test', true);

INSERT INTO public.permissions (id, module_id, resource, resource_ar, action, action_ar, permission_key)
VALUES (
  '99173173-0000-0000-0000-000000000001', (SELECT id FROM public.modules LIMIT 1),
  'rolecheck173', 'اختبار_173', 'use', 'استخدام', 'perm173.rolecheck.use'
);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('99173173-0000-0000-0000-000000000020', '99173173-a000-a000-a000-00000000000a', 'Perm173 Active Role', 'دور نشط', true),
  ('99173173-0000-0000-0000-000000000021', '99173173-a000-a000-a000-00000000000a', 'Perm173 Disabled Role', 'دور معطل', false);

INSERT INTO public.role_permissions (role_id, permission_id) VALUES
  ('99173173-0000-0000-0000-000000000020',
   (SELECT id FROM public.permissions WHERE permission_key = 'perm173.rolecheck.use')),
  ('99173173-0000-0000-0000-000000000021',
   (SELECT id FROM public.permissions WHERE permission_key = 'perm173.rolecheck.use'));

INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  ('99173173-0001-0001-0001-000000000001', '99173173-0000-0000-0000-000000000020',
   '99173173-a000-a000-a000-00000000000a', NULL),
  ('99173173-0002-0002-0002-000000000002', '99173173-0000-0000-0000-000000000021',
   '99173173-a000-a000-a000-00000000000a', NULL),
  ('99173173-0003-0003-0003-000000000003', '99173173-0000-0000-0000-000000000020',
   '99173173-a000-a000-a000-00000000000a', '2020-01-01T00:00:00Z');

-- Setup sanity: the Disabled user's grant is wired identically to the
-- Active user's (same permission, same org, no expiry) when the is_active
-- gate itself is excluded from the check — proving the fixture is real,
-- not broken, before asserting has_permission denies it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = '99173173-0002-0002-0002-000000000002'
    AND ur.org_id = '99173173-a000-a000-a000-00000000000a'
    AND p.permission_key = 'perm173.rolecheck.use'
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[173-setup]: Disabled-role fixture grant is not wired at all (fixture broken — would not isolate roles.is_active as the cause)';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. As each fixture user, call has_permission for perm173.rolecheck.use.
-- ---------------------------------------------------------------------------

-- 2a. Active role: the grant must work.
SELECT set_config('request.jwt.claim.sub', '99173173-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99173173-0001-0001-0001-000000000001',
    '99173173-a000-a000-a000-00000000000a',
    'perm173.rolecheck.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[173-1]: active-role grant did not return true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2b. THE bug scenario: the identically-wired grant through a DISABLED role
-- must NOT authorize. Before this migration, has_permission never joined
-- roles at all, so this returned true regardless of roles.is_active.
SELECT set_config('request.jwt.claim.sub', '99173173-0002-0002-0002-000000000002', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99173173-0002-0002-0002-000000000002',
    '99173173-a000-a000-a000-00000000000a',
    'perm173.rolecheck.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[173-2]: a disabled role (roles.is_active=false) still authorized the caller (active-role-check regression): %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2c. Expired grant through an ACTIVE role must still deny (Migration 170
-- behavior — unaffected by the new roles join).
SELECT set_config('request.jwt.claim.sub', '99173173-0003-0003-0003-000000000003', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99173173-0003-0003-0003-000000000003',
    '99173173-a000-a000-a000-00000000000a',
    'perm173.rolecheck.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[173-3]: expired user_roles grant through an active role still evaluated true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2d. Org-admin override: true with no role/permission grant at all — the
-- ordinary-role branch (and its new roles join) is never reached.
SELECT set_config('request.jwt.claim.sub', '99173173-0004-0004-0004-000000000004', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99173173-0004-0004-0004-000000000004',
    '99173173-a000-a000-a000-00000000000a',
    'perm173.rolecheck.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[173-4]: org-admin override did not return true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2e. Super-admin override: true with no role/permission grant and not an
-- org admin — same reasoning as 2d.
SELECT set_config('request.jwt.claim.sub', '99173173-0005-0005-0005-000000000005', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99173173-0005-0005-0005-000000000005',
    '99173173-a000-a000-a000-00000000000a',
    'perm173.rolecheck.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[173-5]: super-admin override did not return true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;

SELECT 'HAS_PERMISSION_173_ACCEPTANCE_PASS';
