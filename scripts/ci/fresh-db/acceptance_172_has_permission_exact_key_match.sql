-- Acceptance for Migration 172.
-- Proves the exact bug scenario and every behavior Migration 172 must
-- preserve unchanged from Migration 170:
-- (1) a role holding a DIFFERENT permission in the SAME module
--     (reports.financial.read) does NOT grant reports.ai_insights.use —
--     the specific defeat of Migration 171's dedicated permission that
--     motivated this fix;
-- (2) an explicit, exact grant of reports.ai_insights.use itself still
--     returns true;
-- (3) org-admin and super-admin overrides still return true regardless of
--     any specific grant;
-- (4) cross-user, cross-org, expired-role, and ungranted checks all still
--     return false.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fixtures.
--
-- Org A / Org B, disjoint.
-- User SameModule: org A member, role grants ONLY reports.financial.read.
-- User Exact: org A member, role grants ONLY reports.ai_insights.use.
-- User OrgAdmin: org A member, is_org_admin = true, no explicit grants.
-- User Super: super_admins row, is_active = true, no explicit grants.
-- User Expired: org A member, role grants reports.ai_insights.use but
--   user_roles.expires_at is in the past.
-- User CrossOrg: org B member, no grants at all in org A.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('99172172-0001-0001-0001-000000000001', 'perm172-samemodule@example.test'),
  ('99172172-0002-0002-0002-000000000002', 'perm172-exact@example.test'),
  ('99172172-0003-0003-0003-000000000003', 'perm172-orgadmin@example.test'),
  ('99172172-0004-0004-0004-000000000004', 'perm172-super@example.test'),
  ('99172172-0005-0005-0005-000000000005', 'perm172-expired@example.test'),
  ('99172172-0006-0006-0006-000000000006', 'perm172-crossorg@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99172172-a000-a000-a000-00000000000a', 'Perm172 Org A', 'P172-A'),
  ('99172172-b000-b000-b000-00000000000b', 'Perm172 Org B', 'P172-B');

INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99172172-0001-0001-0001-000000000001', '99172172-a000-a000-a000-00000000000a', true, false),
  ('99172172-0002-0002-0002-000000000002', '99172172-a000-a000-a000-00000000000a', true, false),
  ('99172172-0003-0003-0003-000000000003', '99172172-a000-a000-a000-00000000000a', true, true),
  ('99172172-0004-0004-0004-000000000004', '99172172-a000-a000-a000-00000000000a', true, false),
  ('99172172-0005-0005-0005-000000000005', '99172172-a000-a000-a000-00000000000a', true, false),
  ('99172172-0006-0006-0006-000000000006', '99172172-b000-b000-b000-00000000000b', true, false);

INSERT INTO public.super_admins (user_id, email, is_active) VALUES
  ('99172172-0004-0004-0004-000000000004', 'perm172-super@example.test', true);

-- Two permissions in the SAME module ('reports'): the pre-fix defeat and
-- the permission actually being tested for.
INSERT INTO public.permissions (id, module_id, resource, resource_ar, action, action_ar, permission_key)
SELECT '99172172-0000-0000-0000-000000000010', id, 'financial', 'مالي', 'read', 'قراءة', 'reports.financial.read'
FROM public.modules WHERE name = 'reports'
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.permissions (id, module_id, resource, resource_ar, action, action_ar, permission_key)
SELECT '99172172-0000-0000-0000-000000000011', id, 'ai_insights', 'الرؤى الذكية', 'use', 'استخدام', 'reports.ai_insights.use'
FROM public.modules WHERE name = 'reports'
ON CONFLICT (permission_key) DO NOTHING;

-- Roles: one per test user that needs a specific grant.
INSERT INTO public.roles (id, org_id, name, name_ar) VALUES
  ('99172172-0000-0000-0000-000000000020', '99172172-a000-a000-a000-00000000000a', 'Perm172 SameModule Role', 'دور نفس-الوحدة'),
  ('99172172-0000-0000-0000-000000000021', '99172172-a000-a000-a000-00000000000a', 'Perm172 Exact Role', 'دور مطابقة تامة'),
  ('99172172-0000-0000-0000-000000000022', '99172172-a000-a000-a000-00000000000a', 'Perm172 Expired Role', 'دور منتهي');

INSERT INTO public.role_permissions (role_id, permission_id) VALUES
  ('99172172-0000-0000-0000-000000000020',
   (SELECT id FROM public.permissions WHERE permission_key = 'reports.financial.read')),
  ('99172172-0000-0000-0000-000000000021',
   (SELECT id FROM public.permissions WHERE permission_key = 'reports.ai_insights.use')),
  ('99172172-0000-0000-0000-000000000022',
   (SELECT id FROM public.permissions WHERE permission_key = 'reports.ai_insights.use'));

INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  ('99172172-0001-0001-0001-000000000001', '99172172-0000-0000-0000-000000000020',
   '99172172-a000-a000-a000-00000000000a', NULL),
  ('99172172-0002-0002-0002-000000000002', '99172172-0000-0000-0000-000000000021',
   '99172172-a000-a000-a000-00000000000a', NULL),
  ('99172172-0005-0005-0005-000000000005', '99172172-0000-0000-0000-000000000022',
   '99172172-a000-a000-a000-00000000000a', '2020-01-01T00:00:00Z');

-- ---------------------------------------------------------------------------
-- 2. As each fixture user (JWT-scoped, matching has_permission's own
-- auth.uid() self-check), call has_permission for 'reports.ai_insights.use'.
-- ---------------------------------------------------------------------------

-- 2a. THE bug scenario: a role granting only reports.financial.read (same
-- module, different permission) must NOT satisfy reports.ai_insights.use.
SELECT set_config('request.jwt.claim.sub', '99172172-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0001-0001-0001-000000000001',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-1]: reports.financial.read implicitly granted reports.ai_insights.use (same-module wildcard regression): %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2b. Explicit exact grant must still return true.
SELECT set_config('request.jwt.claim.sub', '99172172-0002-0002-0002-000000000002', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0002-0002-0002-000000000002',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-2]: exact reports.ai_insights.use grant did not return true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2c. Org admin override still returns true with no explicit grant at all.
SELECT set_config('request.jwt.claim.sub', '99172172-0003-0003-0003-000000000003', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0003-0003-0003-000000000003',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-3]: org-admin override did not return true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2d. Super admin override still returns true with no explicit grant and no
-- org-admin flag.
SELECT set_config('request.jwt.claim.sub', '99172172-0004-0004-0004-000000000004', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0004-0004-0004-000000000004',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-4]: super-admin override did not return true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2e. Cross-user: a caller cannot query a different user's permission
-- state (Migration 170 behavior, must survive unchanged).
SELECT set_config('request.jwt.claim.sub', '99172172-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0002-0002-0002-000000000002',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-5]: has_permission answered for a different caller: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2f. Cross-org: a real member of org B, checked against org A's id, must
-- return false even for the exact permission key (no membership in org A
-- at all).
SELECT set_config('request.jwt.claim.sub', '99172172-0006-0006-0006-000000000006', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0006-0006-0006-000000000006',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-6]: org B member evaluated true against org A: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2g. Expired role: a grant of the exact permission key via a role whose
-- user_roles.expires_at is in the past must return false.
SELECT set_config('request.jwt.claim.sub', '99172172-0005-0005-0005-000000000005', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0005-0005-0005-000000000005',
    '99172172-a000-a000-a000-00000000000a',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-7]: expired user_roles grant still evaluated true: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

-- 2h. Ungranted: a real org member with zero role/permission rows at all
-- must return false, not error.
SELECT set_config('request.jwt.claim.sub', '99172172-0006-0006-0006-000000000006', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_result boolean;
BEGIN
  SELECT public.has_permission(
    '99172172-0006-0006-0006-000000000006',
    '99172172-b000-b000-b000-00000000000b',
    'reports.ai_insights.use'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[172-8]: ungranted same-org check did not return false: %', v_result;
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;

SELECT 'HAS_PERMISSION_172_ACCEPTANCE_PASS';
