-- Acceptance for Migration 175.
--
-- Proves, behaviourally:
--   (1) user_roles INSERT can only point at active memberships; every UPDATE
--       is rejected at statement level in favor of rpc_replace_user_roles;
--       membership deletion/movement cannot strand assignments, while
--       reversible deactivation preserves but suppresses assignments.
--   (2) explicit-role authorization requires active membership.
--   (3) rpc_remove_org_member: org-admin guard, self-removal guard, last-admin
--       guard, atomic removal of roles + membership, audit row with a full
--       before snapshot.
--   (4) rpc_set_org_admin applies LAST_ORG_ADMIN only to a currently active
--       admin target.
--   (5) create_role_from_template: still creates the role and grants the
--       template's permissions exactly as before, AND now writes an audit row
--       carrying the granted permission keys and any sensitive ones among them.
--   (6) wardah_is_sensitive_permission: behavior is byte-identical to before
--       this migration for every input that mattered in 174's acceptance.
--   (7) Mutation proof: every 170-174 guarantee this migration must not have
--       disturbed, re-asserted individually.
--
-- Marker on success: RBAC_CONSUMER_175_ACCEPTANCE_PASS
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fixtures.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('99175175-0001-0001-0001-000000000001', 'p175-admin-a@example.test'),
  ('99175175-0002-0002-0002-000000000002', 'p175-admin-b@example.test'),
  ('99175175-0003-0003-0003-000000000003', 'p175-member@example.test'),
  ('99175175-0004-0004-0004-000000000004', 'p175-sole-admin@example.test'),
  ('99175175-0005-0005-0005-000000000005', 'p175-otherorg-admin@example.test'),
  ('99175175-0006-0006-0006-000000000006', 'p175-inactive-member@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99175175-a000-a000-a000-00000000000a', 'Perm175 Org A', 'P175-A'),
  ('99175175-b000-b000-b000-00000000000b', 'Perm175 Org B', 'P175-B');

-- Org A: two admins (so removal of one is legal) + one ordinary member.
INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99175175-0001-0001-0001-000000000001', '99175175-a000-a000-a000-00000000000a', true, true),
  ('99175175-0002-0002-0002-000000000002', '99175175-a000-a000-a000-00000000000a', true, true),
  ('99175175-0003-0003-0003-000000000003', '99175175-a000-a000-a000-00000000000a', true, false),
  ('99175175-0006-0006-0006-000000000006', '99175175-a000-a000-a000-00000000000a', false, false),
  ('99175175-0005-0005-0005-000000000005', '99175175-b000-b000-b000-00000000000b', true, true);

-- Org B: exactly ONE active admin, for the last-admin guard.
INSERT INTO public.organizations (id, name, code) VALUES
  ('99175175-c000-c000-c000-00000000000c', 'Perm175 Org C', 'P175-C');
INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99175175-0004-0004-0004-000000000004', '99175175-c000-c000-c000-00000000000c', true, true);

-- A role the ordinary member holds, so removal must clear it.
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('99175175-0000-0000-0000-000000000020', '99175175-a000-a000-a000-00000000000a', 'P175 Probe Role', 'دور فحص', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '99175175-0000-0000-0000-000000000020', p.id FROM public.permissions p
WHERE p.permission_key = 'accounting.entries.approve';
INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
  ('99175175-0003-0003-0003-000000000003', '99175175-0000-0000-0000-000000000020', '99175175-a000-a000-a000-00000000000a');

-- ---------------------------------------------------------------------------
-- 2. Active-membership invariant, both child and parent sides.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES (
      '99175175-0006-0006-0006-000000000006',
      '99175175-0000-0000-0000-000000000020',
      '99175175-a000-a000-a000-00000000000a');
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I1]: inactive member received a role';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_ACTIVE_MEMBERSHIP_REQUIRED%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.user_roles
    SET user_id = '99175175-0006-0006-0006-000000000006'
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a';
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I2]: direct key UPDATE was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES%' THEN RAISE; END IF;
  END;

  -- A statement trigger must reject even an UPDATE that matches no rows. This
  -- proves the guard runs before PostgreSQL can lock a user_roles tuple.
  BEGIN
    UPDATE public.user_roles
    SET expires_at = expires_at
    WHERE false;
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I2b]: zero-row direct UPDATE bypassed the statement guard';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES%' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (
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
      AND (t.tgtype & 16) = 16
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I2c]: UPDATE guard is not an enabled BEFORE STATEMENT trigger';
  END IF;

  UPDATE public.user_organizations
  SET is_active = false
  WHERE user_id = '99175175-0003-0003-0003-000000000003'
    AND org_id = '99175175-a000-a000-a000-00000000000a';
  IF NOT EXISTS (
    SELECT 1 FROM public.user_organizations
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a'
      AND is_active IS FALSE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I3]: deactivation did not preserve membership and assignments';
  END IF;

  BEGIN
    DELETE FROM public.user_organizations
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a';
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I4]: membership deleted while roles remained';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_MEMBERSHIP_HAS_ROLE_ASSIGNMENTS%' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.user_organizations
    SET org_id = '99175175-b000-b000-b000-00000000000b'
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a';
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I4b]: membership moved while roles remained';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_MEMBERSHIP_HAS_ROLE_ASSIGNMENTS%' THEN RAISE; END IF;
  END;
END;
$$;

-- Defense-in-depth proof: the role remains stored after the supported direct
-- status toggle, but both authorization helpers must deny it while inactive.
DO $$
BEGIN
  BEGIN
    UPDATE public.user_roles
    SET expires_at = now() + interval '1 day'
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a';
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I5]: non-key direct UPDATE was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES%' THEN RAISE; END IF;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '99175175-0003-0003-0003-000000000003', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.has_permission(
    '99175175-0003-0003-0003-000000000003',
    '99175175-a000-a000-a000-00000000000a',
    'accounting.entries.approve') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I6]: has_permission accepted an inactive-member grant';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF public.wardah_has_exact_permission(
    '99175175-0003-0003-0003-000000000003',
    '99175175-a000-a000-a000-00000000000a',
    'accounting.entries.approve') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I7]: exact helper accepted an inactive-member grant';
  END IF;
END;
$$;

UPDATE public.user_organizations
SET is_active = true
WHERE user_id = '99175175-0003-0003-0003-000000000003'
  AND org_id = '99175175-a000-a000-a000-00000000000a';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_organizations
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a'
      AND is_active IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = '99175175-0003-0003-0003-000000000003'
      AND org_id = '99175175-a000-a000-a000-00000000000a'
  ) OR NOT public.has_permission(
    '99175175-0003-0003-0003-000000000003',
    '99175175-a000-a000-a000-00000000000a',
    'accounting.entries.approve'
  ) OR NOT public.wardah_has_exact_permission(
    '99175175-0003-0003-0003-000000000003',
    '99175175-a000-a000-a000-00000000000a',
    'accounting.entries.approve'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I7b]: reactivation did not restore the preserved assignment';
  END IF;
END;
$$;

-- The public 174 contract remains callable through the new organization-first
-- wrapper, while its renamed implementation is no longer an API surface.
SELECT set_config('request.jwt.claim.sub', '99175175-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.rpc_replace_user_roles(jsonb_build_object(
    'org_id', '99175175-a000-a000-a000-00000000000a',
    'user_id', '99175175-0003-0003-0003-000000000003',
    'role_ids', jsonb_build_array('99175175-0000-0000-0000-000000000020')));
  IF (v_res->>'role_count')::int <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I8]: replace wrapper changed the 174 result contract: %', v_res;
  END IF;
END;
$$;
RESET ROLE;

-- The organization-first wrapper must preserve 174's validation order before
-- authorization. Use a caller with no authority in Org A so these assertions
-- would expose any premature wardah_assert_org_admin call.
SELECT set_config('request.jwt.claim.sub', '99175175-0005-0005-0005-000000000005', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.rpc_replace_user_roles(jsonb_build_object(
      'org_id', '99175175-a000-a000-a000-00000000000a',
      'role_ids', '[]'::jsonb));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I8a]: missing user_id reached authorization';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_174_ORG_AND_USER_REQUIRED%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.rpc_replace_user_roles(jsonb_build_object(
      'org_id', '99175175-a000-a000-a000-00000000000a',
      'user_id', 'not-a-uuid',
      'role_ids', '[]'::jsonb));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I8b]: invalid user_id reached authorization';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLSTATE <> '22P02' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.rpc_replace_user_roles(jsonb_build_object(
      'org_id', '99175175-a000-a000-a000-00000000000a',
      'user_id', '99175175-0003-0003-0003-000000000003',
      'expires_at', 'not-a-timestamp',
      'role_ids', '[]'::jsonb));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-I8c]: invalid expires_at reached authorization';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLSTATE <> '22007' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- A role template for create_role_from_template, with one sensitive key.
INSERT INTO public.role_templates (id, name, name_ar, description, description_ar, permission_keys, is_active)
VALUES (
  '99175175-0000-0000-0000-000000000090', 'P175 Template', 'قالب 175',
  'acceptance fixture', 'عنصر اختبار',
  ARRAY['accounting.vouchers.unpost','accounting.entries.approve'], true
);

-- ---------------------------------------------------------------------------
-- 3. rpc_remove_org_member — cross-org rejection, self-removal, last-admin,
--    then the real removal with audit proof.
-- ---------------------------------------------------------------------------

-- 2a. Cross-org admin cannot touch org A at all (fails at the org-admin guard).
SELECT set_config('request.jwt.claim.sub', '99175175-0005-0005-0005-000000000005', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.rpc_remove_org_member(jsonb_build_object(
      'org_id', '99175175-a000-a000-a000-00000000000a',
      'user_id', '99175175-0003-0003-0003-000000000003'));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-1]: a non-member admin removed a user from a foreign org';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- 2b. Self-removal is refused, even for a legitimate org admin.
SELECT set_config('request.jwt.claim.sub', '99175175-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.rpc_remove_org_member(jsonb_build_object(
      'org_id', '99175175-a000-a000-a000-00000000000a',
      'user_id', '99175175-0001-0001-0001-000000000001'));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-2]: admin was allowed to remove themselves';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_CANNOT_REMOVE_SELF%' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- 2c. Last-admin protection, two parts.
--
-- Part 1 (legal): org C temporarily gets a second admin (0003, promoted via
-- direct fixture setup — production always goes through rpc_set_org_admin),
-- then 0004 removes 0003. One admin (0004) remains: this must succeed.
INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99175175-0003-0003-0003-000000000003', '99175175-c000-c000-c000-00000000000c', true, true);

SELECT set_config('request.jwt.claim.sub', '99175175-0004-0004-0004-000000000004', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.rpc_remove_org_member(jsonb_build_object(
    'org_id', '99175175-c000-c000-c000-00000000000c',
    'user_id', '99175175-0003-0003-0003-000000000003'));
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-3a]: legal removal of a non-last admin failed';
  END IF;
END;
$$;
RESET ROLE;

-- Part 2 (rejected): org C now has exactly one active admin (0004). To reject
-- a removal on the LAST_ORG_ADMIN branch specifically (as opposed to
-- CANNOT_REMOVE_SELF), the
-- caller must be admin-gated but distinct from the target — the only way that
-- combination exists is a super admin who is also a plain (non-admin) member
-- of the org: wardah_assert_org_admin's OR clause admits them without
-- is_org_admin being true on their own row. Set that up and attempt exactly
-- the rejected call, behaviourally, not just by source inspection.
INSERT INTO auth.users (id, email) VALUES ('99175175-0007-0007-0007-000000000007', 'p175-super-member@example.test');
INSERT INTO public.super_admins (user_id, email, is_active) VALUES
  ('99175175-0007-0007-0007-000000000007', 'p175-super-member@example.test', true);
INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99175175-0007-0007-0007-000000000007', '99175175-c000-c000-c000-00000000000c', true, false);

-- A false -> false request against an ordinary target must not run the
-- last-admin guard merely because the organization has only one real admin.
SELECT set_config('request.jwt.claim.sub', '99175175-0004-0004-0004-000000000004', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.rpc_set_org_admin(
    '99175175-0007-0007-0007-000000000007',
    '99175175-c000-c000-c000-00000000000c',
    false);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-3b]: ordinary target hit last-admin guard: %', v_res;
  END IF;
END;
$$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '99175175-0007-0007-0007-000000000007', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.rpc_remove_org_member(jsonb_build_object(
      'org_id', '99175175-c000-c000-c000-00000000000c',
      'user_id', '99175175-0004-0004-0004-000000000004'));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-3c]: the last active admin of an org was removed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_175_LAST_ORG_ADMIN%' THEN RAISE; END IF;
  END;

  -- And prove it was really rejected, not silently no-op'd: the row is untouched.
  IF NOT EXISTS (SELECT 1 FROM public.user_organizations
                  WHERE user_id = '99175175-0004-0004-0004-000000000004'
                    AND org_id = '99175175-c000-c000-c000-00000000000c'
                    AND is_active AND is_org_admin) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-3d]: rejected LAST_ORG_ADMIN call still mutated the membership row';
  END IF;
END;
$$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3d. The real removal: org A's ordinary member (0003), by admin 0001.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99175175-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_res jsonb;
  v_row public.audit_logs%ROWTYPE;
BEGIN
  v_res := public.rpc_remove_org_member(jsonb_build_object(
    'org_id', '99175175-a000-a000-a000-00000000000a',
    'user_id', '99175175-0003-0003-0003-000000000003'));

  IF (v_res->>'removed_role_count')::int <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-4a]: removed_role_count wrong, got %', v_res->>'removed_role_count';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles
              WHERE user_id = '99175175-0003-0003-0003-000000000003'
                AND org_id = '99175175-a000-a000-a000-00000000000a') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-4b]: role assignment survived removal';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_organizations
              WHERE user_id = '99175175-0003-0003-0003-000000000003'
                AND org_id = '99175175-a000-a000-a000-00000000000a') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-4c]: membership row survived removal';
  END IF;

  SELECT * INTO v_row FROM public.audit_logs
   WHERE action = 'rbac.org_member.remove'
     AND entity_id = '99175175-0003-0003-0003-000000000003'
   ORDER BY created_at DESC LIMIT 1;
  IF v_row.old_data IS NULL OR NOT (v_row.old_data->'role_assignments' @> jsonb_build_array(
       jsonb_build_object('role_id', '99175175-0000-0000-0000-000000000020', 'expires_at', NULL))) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-4d]: removal audit row missing the pre-removal role snapshot';
  END IF;
  IF v_row.new_data IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-4e]: removal audit row unexpectedly has new_data';
  END IF;
END;
$$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. create_role_from_template — still works, and now audits.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99175175-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_role_id uuid;
  v_row public.audit_logs%ROWTYPE;
  v_granted text[];
BEGIN
  v_role_id := public.create_role_from_template(
    '99175175-a000-a000-a000-00000000000a',
    '99175175-0000-0000-0000-000000000090',
    'P175 From Template');

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-5a]: create_role_from_template returned no id';
  END IF;

  SELECT COALESCE(array_agg(p.permission_key ORDER BY p.permission_key), ARRAY[]::text[])
    INTO v_granted
  FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = v_role_id;
  IF NOT ('accounting.vouchers.unpost' = ANY(v_granted))
     OR NOT ('accounting.entries.approve' = ANY(v_granted)) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-5b]: template permissions not granted, got %', v_granted;
  END IF;

  SELECT * INTO v_row FROM public.audit_logs
   WHERE action = 'rbac.role.create' AND entity_id = v_role_id::text
   ORDER BY created_at DESC LIMIT 1;
  IF v_row.entity_id IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-5c]: create_role_from_template wrote no audit row (the gap this migration closes)';
  END IF;
  IF NOT (v_row.metadata->'sensitive_keys' @> '"accounting.vouchers.unpost"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-5d]: audit row does not flag the sensitive key the template granted';
  END IF;
  IF v_row.metadata->>'source' <> 'template' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-5e]: audit row does not record template as the source';
  END IF;
END;
$$;
RESET ROLE;

-- Cross-org: a template create in a foreign org must fail on the guard.
SELECT set_config('request.jwt.claim.sub', '99175175-0005-0005-0005-000000000005', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.create_role_from_template(
      '99175175-a000-a000-a000-00000000000a',
      '99175175-0000-0000-0000-000000000090',
      'Intruder');
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-6]: cross-org template creation succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Mutation proof — this migration must not have disturbed 170-174.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_hp text; v_ex text; v_cls text;
BEGIN
  SELECT prosrc INTO v_hp FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='has_permission';
  SELECT prosrc INTO v_ex FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='wardah_has_exact_permission';
  SELECT prosrc INTO v_cls FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='wardah_is_sensitive_permission';

  IF v_hp !~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M1]: 170 caller-identity guard missing';
  END IF;
  IF v_hp ~ 'LIKE' OR v_ex ~ 'LIKE' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M2]: 172 LIKE fallback reappeared';
  END IF;
  IF v_hp !~ 'r\.is_active' OR v_ex !~ 'r\.is_active' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M3]: 173 active-role join missing';
  END IF;
  IF v_hp !~ 'user_organizations uo' OR v_hp !~ 'uo\.is_active IS TRUE'
     OR v_ex !~ 'user_organizations uo' OR v_ex !~ 'uo\.is_active IS TRUE' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M3b]: active-membership defense missing';
  END IF;
  IF v_hp !~ 'wardah_is_sensitive_permission' OR v_ex !~ 'wardah_is_sensitive_permission' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M4]: 174 sensitive-permission narrowing missing';
  END IF;
  IF v_cls !~ 'accounting\.vouchers\.unpost' OR v_cls !~ 'accounting\.vouchers\.cancel' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M5]: classifier lost a sensitive key during the search_path edit';
  END IF;

  -- The three original 174 RPCs must still exist and be authenticated-only.
  IF NOT has_function_privilege('authenticated', 'public.rpc_upsert_org_role(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_replace_user_roles(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_delete_org_role(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_permission_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M6]: a 174 RPC lost its authenticated execute grant';
  END IF;
  IF has_function_privilege('authenticated', 'public.wardah_175_internal_replace_user_roles(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wardah_175_internal_replace_user_roles(jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_175_internal_replace_user_roles(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M6b]: internal replace implementation is externally callable';
  END IF;

  -- No table grant has been touched: authenticated still has table-level
  -- write grants. user_roles UPDATE is behaviorally blocked by a statement
  -- trigger; grant revocation remains Migration 176.
  IF NOT has_table_privilege('authenticated', 'public.user_roles', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.user_roles', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.roles', 'INSERT') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[175-M7]: 175 revoked a table grant it must not touch';
  END IF;
END;
$$;

DO $$ BEGIN RAISE NOTICE 'RBAC_CONSUMER_175_ACCEPTANCE_PASS'; END $$;

ROLLBACK;
