-- Acceptance for Migration 170.
-- Proves: (1) physical_count_items/sessions no longer leak across tenants on
-- any of SELECT/INSERT/UPDATE/DELETE, that a disabled (is_active=false)
-- membership loses access, that WITH CHECK (not just USING) blocks
-- reassigning a row to another org, and that the same-org owner can still
-- do normal CRUD (the fix is not an accidental deny-all); (2)
-- manufacturing_stages/stage_wip_log/standard_costs no longer fall back to
-- a default organization for anon or for an authenticated non-member,
-- including an attempt to spoof the JWT org_id claim; (3) has_permission
-- refuses to report another user's permission state, still answers false
-- normally for a caller with no grant, and still answers true for a caller
-- with a real granted permission (so it cannot be a function hardcoded to
-- always return false).
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION
        'ACCEPTANCE_FAIL: expected [%] for [%], got [%]',
        p_needle, p_sql, SQLERRM;
    END IF;
  END;

  IF v_succeeded THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: expected error [%] for [%], but it succeeded',
      p_needle, p_sql;
  END IF;
END;
$$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: two organizations; user A (active member of org A), user B
-- (active member of org B), user C (membership in org A but is_active=false);
-- a product and physical-count session/item under org A; a manufacturing
-- stage under org A; a role/permission grant so user A has one real,
-- specific permission (proves has_permission's true path, not just false).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tenant170-orga@example.test'),
  ('99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tenant170-orgb@example.test'),
  ('99cccccc-cccc-cccc-cccc-cccccccccccc', 'tenant170-disabled@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99111111-1111-1111-1111-111111111111', 'Tenant170 Org A', 'T170-A'),
  ('99222222-2222-2222-2222-222222222222', 'Tenant170 Org B', 'T170-B');

INSERT INTO public.user_organizations (user_id, org_id, is_active) VALUES
  ('99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99111111-1111-1111-1111-111111111111', true),
  ('99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99222222-2222-2222-2222-222222222222', true),
  ('99cccccc-cccc-cccc-cccc-cccccccccccc', '99111111-1111-1111-1111-111111111111', false);

INSERT INTO public.products (id, code, name, org_id) VALUES
  ('99c00000-0000-0000-0000-000000000001', 'T170-PRODUCT', 'Tenant170 Product', '99111111-1111-1111-1111-111111111111');

INSERT INTO public.physical_count_sessions
  (id, organization_id, session_number, count_date, count_type, status, counter_user_ids, created_by)
VALUES
  ('99d00000-0000-0000-0000-000000000001', '99111111-1111-1111-1111-111111111111',
   'T170-SESSION-A', CURRENT_DATE, 'SPOT', 'OPEN',
   ARRAY['99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid], '99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.physical_count_items
  (id, session_id, organization_id, product_id, system_qty)
VALUES
  ('99e00000-0000-0000-0000-000000000001', '99d00000-0000-0000-0000-000000000001',
   '99111111-1111-1111-1111-111111111111', '99c00000-0000-0000-0000-000000000001', 10);

INSERT INTO public.manufacturing_stages (id, org_id, code, name, order_sequence) VALUES
  ('99f00000-0000-0000-0000-000000000001', '99111111-1111-1111-1111-111111111111',
   'T170-STAGE', 'Tenant170 Stage', 1);

INSERT INTO public.permissions (id, module_id, resource, resource_ar, action, action_ar, permission_key)
VALUES (
  '99999999-0000-0000-0000-000000000001', (SELECT id FROM public.modules LIMIT 1),
  'tenant170_test', 'اختبار_170', 'view', 'عرض', 'tenant170.test.view'
);
INSERT INTO public.roles (id, org_id, name, name_ar) VALUES
  ('99999999-0000-0000-0000-000000000002', '99111111-1111-1111-1111-111111111111',
   'Tenant170 Test Role', 'دور اختبار 170');
INSERT INTO public.role_permissions (role_id, permission_id) VALUES
  ('99999999-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000001');
INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
  ('99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-0000-0000-0000-000000000002',
   '99111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 2. physical_count_items / physical_count_sessions: org B's member cannot
-- see or write org A's rows on any of SELECT/INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99222222-2222-2222-2222-222222222222"}', false);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.physical_count_sessions
             WHERE id = '99d00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member can see org A physical_count_sessions row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.physical_count_items
             WHERE id = '99e00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member can see org A physical_count_items row';
  END IF;
END;
$$;

SELECT pg_temp.expect_error($sql$
  INSERT INTO public.physical_count_items
    (session_id, organization_id, product_id, system_qty)
  VALUES
    ('99d00000-0000-0000-0000-000000000001', '99111111-1111-1111-1111-111111111111',
     '99c00000-0000-0000-0000-000000000001', 5)
$sql$, 'row-level security');

DO $$
BEGIN
  UPDATE public.physical_count_items
  SET counted_qty = 999
  WHERE id = '99e00000-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member updated org A physical_count_items row';
  END IF;
END;
$$;

DO $$
BEGIN
  DELETE FROM public.physical_count_items
  WHERE id = '99e00000-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member deleted org A physical_count_items row';
  END IF;
END;
$$;

-- Same checks against physical_count_sessions directly (not just items):
-- prove org B cannot insert/update/delete org A's session row either.
SELECT pg_temp.expect_error($sql$
  INSERT INTO public.physical_count_sessions
    (organization_id, session_number, count_date, count_type, status, counter_user_ids, created_by)
  VALUES
    ('99111111-1111-1111-1111-111111111111', 'T170-SESSION-SPOOF', CURRENT_DATE, 'SPOT', 'OPEN',
     ARRAY['99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid], '99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
$sql$, 'row-level security');

DO $$
BEGIN
  UPDATE public.physical_count_sessions
  SET status = 'CANCELLED'
  WHERE id = '99d00000-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member updated org A physical_count_sessions row';
  END IF;
END;
$$;

DO $$
BEGIN
  DELETE FROM public.physical_count_sessions
  WHERE id = '99d00000-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member deleted org A physical_count_sessions row';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.physical_count_items
                 WHERE id = '99e00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org A physical_count_items row was lost during cross-tenant attempts';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Same-org happy path: the fix must not be an accidental deny-all. Org
-- A's own active member can still SELECT/INSERT/UPDATE/DELETE their own
-- org's rows, and WITH CHECK (not just USING) blocks reassigning an
-- already-visible row to a different org.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.physical_count_items
                 WHERE id = '99e00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org A member cannot see their own org physical_count_items row (deny-all regression)';
  END IF;

  UPDATE public.physical_count_items SET counted_qty = 9
  WHERE id = '99e00000-0000-0000-0000-000000000001';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org A member cannot update their own org physical_count_items row (deny-all regression)';
  END IF;

  INSERT INTO public.physical_count_items
    (id, session_id, organization_id, product_id, system_qty)
  VALUES
    ('99e00000-0000-0000-0000-000000000002', '99d00000-0000-0000-0000-000000000001',
     '99111111-1111-1111-1111-111111111111', '99c00000-0000-0000-0000-000000000001', 3);

  DELETE FROM public.physical_count_items WHERE id = '99e00000-0000-0000-0000-000000000002';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org A member cannot delete their own org physical_count_items row (deny-all regression)';
  END IF;
END;
$$;

SELECT pg_temp.expect_error($sql$
  UPDATE public.physical_count_items
  SET organization_id = '99222222-2222-2222-2222-222222222222'
  WHERE id = '99e00000-0000-0000-0000-000000000001'
$sql$, 'row-level security');

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2c. A disabled membership (is_active=false) must not keep access, even
-- with a JWT claiming the org the row belongs to.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '99cccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.physical_count_items
             WHERE id = '99e00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: a disabled (is_active=false) membership can still see org A physical_count_items row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.physical_count_sessions
             WHERE id = '99d00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: a disabled (is_active=false) membership can still see org A physical_count_sessions row';
  END IF;
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. manufacturing_stages / stage_wip_log / standard_costs: anon has no
-- grant at all; an authenticated non-member cannot see org A's row even
-- after spoofing the JWT org_id claim to org A (membership check on
-- wardah_org_id() blocks it, falling back to the caller's own real org,
-- never org A). stage_wip_log/standard_costs are checked with the same
-- anon-rejection shape as manufacturing_stages — the GRANT-level REVOKE
-- rejects before FK validation, so dummy foreign keys are fine here.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error(
  $$SELECT 1 FROM public.manufacturing_stages WHERE id = '99f00000-0000-0000-0000-000000000001'$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.manufacturing_stages (org_id, code, name, order_sequence)
    VALUES ('99111111-1111-1111-1111-111111111111', 'ANON-SPOOF', 'Anon Spoof', 1)$$,
  'permission denied');

SELECT pg_temp.expect_error(
  $$SELECT 1 FROM public.stage_wip_log LIMIT 1$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.stage_wip_log (org_id, mo_id, stage_id, period_start, period_end)
    VALUES ('99111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
            '99f00000-0000-0000-0000-000000000001', CURRENT_DATE, CURRENT_DATE)$$,
  'permission denied');

SELECT pg_temp.expect_error(
  $$SELECT 1 FROM public.standard_costs LIMIT 1$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.standard_costs (org_id, product_id, stage_id, effective_from)
    VALUES ('99111111-1111-1111-1111-111111111111', '99c00000-0000-0000-0000-000000000001',
            '99f00000-0000-0000-0000-000000000001', CURRENT_DATE)$$,
  'permission denied');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub',
                  '99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.manufacturing_stages
             WHERE id = '99f00000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org B member spoofing org A JWT claim can see org A manufacturing_stages row';
  END IF;
END;
$$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. has_permission: a caller cannot query another user's permission state;
-- a caller with no grant still evaluates to false (not an error, not a
-- short-circuit); and a caller with a real granted permission evaluates to
-- true — proving the function isn't simply hardcoded to always return false.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99111111-1111-1111-1111-111111111111"}', false);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_cross boolean;
  v_self_ungranted boolean;
  v_self_granted boolean;
BEGIN
  SELECT public.has_permission(
    '99bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '99222222-2222-2222-2222-222222222222',
    'accounting.journals.create'
  ) INTO v_cross;
  IF v_cross IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: has_permission answered for a different user: %', v_cross;
  END IF;

  -- No grant exists for this permission key — must evaluate to false, not
  -- error, and not short-circuit before reaching the normal evaluation path.
  SELECT public.has_permission(
    '99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '99111111-1111-1111-1111-111111111111',
    'accounting.journals.create'
  ) INTO v_self_ungranted;
  IF v_self_ungranted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: has_permission self-check (no grant) did not evaluate normally: %', v_self_ungranted;
  END IF;

  -- A real permission was granted via role_permissions/user_roles in the
  -- fixtures above — must evaluate to true. If has_permission were
  -- hardcoded/short-circuited to always return false, this would catch it.
  SELECT public.has_permission(
    '99aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '99111111-1111-1111-1111-111111111111',
    'tenant170.test.view'
  ) INTO v_self_granted;
  IF v_self_granted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: has_permission self-check (real grant) did not return true: %', v_self_granted;
  END IF;
END;
$$;

RESET ROLE;

ROLLBACK;

SELECT 'TENANT_ISOLATION_170_ACCEPTANCE_PASS';
