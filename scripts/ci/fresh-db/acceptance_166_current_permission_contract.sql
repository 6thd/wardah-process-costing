-- Current-schema companion for the historical Migration 166 gate.
-- Baseline refreshes after Migrations 172/174 must validate the hardened
-- permission contract, not the pre-hardening module fallback that 166 originally
-- contrasted with wardah_has_exact_permission().
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('66faaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'voucher166-current-admin@example.test'),
  ('66fbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'voucher166-current-reader@example.test'),
  ('66fcccc-cccc-cccc-cccc-cccccccccccc', 'voucher166-current-corrector@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('66f11111-1111-1111-1111-111111111111', 'V166C', 'Voucher 166 Current Contract');

INSERT INTO public.user_organizations
  (id, user_id, org_id, role, is_active, is_org_admin) VALUES
  ('66f00000-0000-0000-0000-000000000001',
   '66faaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '66f11111-1111-1111-1111-111111111111', 'admin', true, true),
  ('66f00000-0000-0000-0000-000000000002',
   '66fbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '66f11111-1111-1111-1111-111111111111', 'user', true, false),
  ('66f00000-0000-0000-0000-000000000003',
   '66fcccc-cccc-cccc-cccc-cccccccccccc',
   '66f11111-1111-1111-1111-111111111111', 'user', true, false);

INSERT INTO public.roles
  (id, org_id, name, name_ar, is_system_role, is_active) VALUES
  ('66f70000-0000-0000-0000-000000000001',
   '66f11111-1111-1111-1111-111111111111',
   'Voucher 166 current reader', 'قارئ 166 الحالي', false, true),
  ('66f70000-0000-0000-0000-000000000002',
   '66f11111-1111-1111-1111-111111111111',
   'Voucher 166 current corrector', 'مصحح 166 الحالي', false, true);

-- Reader gets an ordinary accounting permission only.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '66f70000-0000-0000-0000-000000000001'::uuid, p.id
FROM public.permissions p
WHERE p.permission_key LIKE 'accounting.%'
  AND p.permission_key NOT IN ('accounting.vouchers.unpost',
                               'accounting.vouchers.cancel',
                               'accounting.journals.reverse')
ORDER BY p.permission_key
LIMIT 1;

-- Corrector gets the sensitive key explicitly.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '66f70000-0000-0000-0000-000000000002'::uuid, p.id
FROM public.permissions p
WHERE p.permission_key = 'accounting.vouchers.unpost';

INSERT INTO public.user_roles (id, user_id, role_id, org_id) VALUES
  ('66f80000-0000-0000-0000-000000000001',
   '66fbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '66f70000-0000-0000-0000-000000000001',
   '66f11111-1111-1111-1111-111111111111'),
  ('66f80000-0000-0000-0000-000000000002',
   '66fcccc-cccc-cccc-cccc-cccccccccccc',
   '66f70000-0000-0000-0000-000000000002',
   '66f11111-1111-1111-1111-111111111111');

-- Reader: ordinary accounting permission must NOT satisfy sensitive unpost.
SELECT set_config('request.jwt.claim.sub',
                  '66fbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"66f11111-1111-1111-1111-111111111111"}', false);
DO $$
BEGIN
  IF public.has_permission(
       '66fbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
       '66f11111-1111-1111-1111-111111111111',
       'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'CURRENT_166_FAIL: has_permission restored a sensitive fallback';
  END IF;

  IF public.wardah_has_exact_permission(
       '66fbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
       '66f11111-1111-1111-1111-111111111111',
       'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'CURRENT_166_FAIL: exact helper accepted non-exact grant';
  END IF;
END;
$$;

-- Org admin: sensitive override must also remain closed after 174.
SELECT set_config('request.jwt.claim.sub',
                  '66faaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
DO $$
BEGIN
  IF public.has_permission(
       '66faaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       '66f11111-1111-1111-1111-111111111111',
       'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'CURRENT_166_FAIL: org-admin override satisfied sensitive key';
  END IF;
END;
$$;

-- Explicit corrector: both helpers must accept the exact sensitive grant.
SELECT set_config('request.jwt.claim.sub',
                  '66fcccc-cccc-cccc-cccc-cccccccccccc', false);
DO $$
BEGIN
  IF NOT public.has_permission(
       '66fcccc-cccc-cccc-cccc-cccccccccccc',
       '66f11111-1111-1111-1111-111111111111',
       'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'CURRENT_166_FAIL: has_permission rejected exact unpost grant';
  END IF;

  IF NOT public.wardah_has_exact_permission(
       '66fcccc-cccc-cccc-cccc-cccccccccccc',
       '66f11111-1111-1111-1111-111111111111',
       'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'CURRENT_166_FAIL: exact helper rejected exact unpost grant';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'VOUCHER_RESET_166_CURRENT_PERMISSION_CONTRACT_PASS' AS result;
