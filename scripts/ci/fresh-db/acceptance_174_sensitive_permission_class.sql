-- Acceptance for Migration 174 — sensitive permission class (Issue #93).
--
-- Proves, behaviourally and on both permission functions:
--   (1) org admin WITHOUT an explicit grant is denied the sensitive keys;
--   (2) org admin WITH an explicit grant is allowed them;
--   (3) super admin keeps the full override, sensitive keys included;
--   (4) a DISABLED role does not carry a sensitive grant (173 preserved);
--   (5) an EXPIRED assignment does not carry it either;
--   (6) cross-org: an admin of another org gets nothing here;
--   (7) the caller-identity guard still denies asking about someone else (170);
--   (8) ORDINARY keys still ride the org-admin override untouched;
--   (9) mutation proof: the 166-173 guarantees are re-asserted individually,
--       each with its own failing assertion, so a regression in any single
--       layer fails loudly and identifiably rather than being masked.
--
-- Marker on success: SENSITIVE_PERMISSION_174_ACCEPTANCE_PASS
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The two sensitive keys must exist before anything is asserted, so a
--    missing catalog fails as a setup error rather than as a false "denied".
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.permissions
       WHERE permission_key IN ('accounting.vouchers.unpost','accounting.vouchers.cancel')) <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FIXTURE_MISSING[174]: sensitive permission keys absent from the catalog';
  END IF;
  IF (SELECT count(*) FROM public.permissions
       WHERE permission_key = 'accounting.entries.approve') <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FIXTURE_MISSING[174]: ordinary control key accounting.entries.approve absent';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: two orgs, seven users covering every branch.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('99174174-0001-0001-0001-000000000001', 'p174-admin-nogrant@example.test'),
  ('99174174-0002-0002-0002-000000000002', 'p174-admin-granted@example.test'),
  ('99174174-0003-0003-0003-000000000003', 'p174-super@example.test'),
  ('99174174-0004-0004-0004-000000000004', 'p174-disabled@example.test'),
  ('99174174-0005-0005-0005-000000000005', 'p174-expired@example.test'),
  ('99174174-0006-0006-0006-000000000006', 'p174-member-granted@example.test'),
  ('99174174-0007-0007-0007-000000000007', 'p174-otherorg-admin@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99174174-a000-a000-a000-00000000000a', 'Perm174 Org A', 'P174-A'),
  ('99174174-b000-b000-b000-00000000000b', 'Perm174 Org B', 'P174-B');

INSERT INTO public.user_organizations (user_id, org_id, is_active, is_org_admin) VALUES
  ('99174174-0001-0001-0001-000000000001', '99174174-a000-a000-a000-00000000000a', true, true),
  ('99174174-0002-0002-0002-000000000002', '99174174-a000-a000-a000-00000000000a', true, true),
  ('99174174-0003-0003-0003-000000000003', '99174174-a000-a000-a000-00000000000a', true, false),
  ('99174174-0004-0004-0004-000000000004', '99174174-a000-a000-a000-00000000000a', true, false),
  ('99174174-0005-0005-0005-000000000005', '99174174-a000-a000-a000-00000000000a', true, false),
  ('99174174-0006-0006-0006-000000000006', '99174174-a000-a000-a000-00000000000a', true, false),
  ('99174174-0007-0007-0007-000000000007', '99174174-b000-b000-b000-00000000000b', true, true);

INSERT INTO public.super_admins (user_id, email, is_active) VALUES
  ('99174174-0003-0003-0003-000000000003', 'p174-super@example.test', true);

-- Financial-controller-shaped roles: active / disabled, wired identically.
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('99174174-0000-0000-0000-000000000020', '99174174-a000-a000-a000-00000000000a', 'P174 Financial Controller', 'مراقب مالي', true),
  ('99174174-0000-0000-0000-000000000021', '99174174-a000-a000-a000-00000000000a', 'P174 Disabled Controller', 'مراقب معطل', false);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.rid, p.id
FROM (VALUES ('99174174-0000-0000-0000-000000000020'::uuid),
             ('99174174-0000-0000-0000-000000000021'::uuid)) AS r(rid)
CROSS JOIN public.permissions p
WHERE p.permission_key IN ('accounting.vouchers.unpost','accounting.vouchers.cancel');

INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  -- org admin WITH an explicit grant
  ('99174174-0002-0002-0002-000000000002', '99174174-0000-0000-0000-000000000020',
   '99174174-a000-a000-a000-00000000000a', NULL),
  -- disabled role
  ('99174174-0004-0004-0004-000000000004', '99174174-0000-0000-0000-000000000021',
   '99174174-a000-a000-a000-00000000000a', NULL),
  -- active role, expired assignment
  ('99174174-0005-0005-0005-000000000005', '99174174-0000-0000-0000-000000000020',
   '99174174-a000-a000-a000-00000000000a', '2020-01-01T00:00:00Z'),
  -- ordinary member with a live grant
  ('99174174-0006-0006-0006-000000000006', '99174174-0000-0000-0000-000000000020',
   '99174174-a000-a000-a000-00000000000a', NULL);

-- Fixture sanity: the disabled-role and expired users' grants are otherwise
-- real. Without this, a false result below could come from a broken fixture
-- rather than from the gate under test.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = '99174174-0004-0004-0004-000000000004'
      AND p.permission_key = 'accounting.vouchers.unpost'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = '99174174-0005-0005-0005-000000000005'
      AND p.permission_key = 'accounting.vouchers.unpost'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FIXTURE_MISSING[174]: disabled/expired grants are not wired at all';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The classifier itself.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT public.wardah_is_sensitive_permission('accounting.vouchers.unpost')
     OR NOT public.wardah_is_sensitive_permission('accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-0a]: classifier misses a sensitive key';
  END IF;
  IF public.wardah_is_sensitive_permission('reports.ai_insights.use')
     OR public.wardah_is_sensitive_permission('accounting.entries.approve')
     OR public.wardah_is_sensitive_permission('accounting.vouchers.reverse') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-0b]: classifier over-classifies';
  END IF;
  IF public.wardah_is_sensitive_permission(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-0c]: classifier is not STRICT (NULL must yield NULL)';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. has_permission, per user. Each block runs as `authenticated` with that
--    user's JWT subject, matching the function's own auth.uid() self-check.
-- ---------------------------------------------------------------------------

-- 3a. Org admin WITHOUT a grant: sensitive DENIED, ordinary ALLOWED.
SELECT set_config('request.jwt.claim.sub', '99174174-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.has_permission('99174174-0001-0001-0001-000000000001',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-1a]: org admin still passes unpost with no explicit grant';
  END IF;
  IF public.has_permission('99174174-0001-0001-0001-000000000001',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-1b]: org admin still passes cancel with no explicit grant';
  END IF;
  -- (8) ordinary keys must be unaffected — this is the regression risk of 174.
  IF NOT public.has_permission('99174174-0001-0001-0001-000000000001',
                               '99174174-a000-a000-a000-00000000000a',
                               'accounting.entries.approve') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-1c]: org-admin override broke for an ORDINARY key';
  END IF;
END;
$$;
RESET ROLE;

-- 3b. Org admin WITH an explicit grant: sensitive ALLOWED.
SELECT set_config('request.jwt.claim.sub', '99174174-0002-0002-0002-000000000002', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT public.has_permission('99174174-0002-0002-0002-000000000002',
                               '99174174-a000-a000-a000-00000000000a',
                               'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-2]: explicit grant does not authorize a sensitive key';
  END IF;
END;
$$;
RESET ROLE;

-- 3c. Super admin: full override including sensitive keys, with no role.
SELECT set_config('request.jwt.claim.sub', '99174174-0003-0003-0003-000000000003', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT public.has_permission('99174174-0003-0003-0003-000000000003',
                               '99174174-a000-a000-a000-00000000000a',
                               'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-3]: super-admin emergency override lost for a sensitive key';
  END IF;
END;
$$;
RESET ROLE;

-- 3d. Disabled role (173 preserved under the new branch).
SELECT set_config('request.jwt.claim.sub', '99174174-0004-0004-0004-000000000004', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.has_permission('99174174-0004-0004-0004-000000000004',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-4]: a DISABLED role still carries a sensitive grant (173 regression)';
  END IF;
END;
$$;
RESET ROLE;

-- 3e. Expired assignment.
SELECT set_config('request.jwt.claim.sub', '99174174-0005-0005-0005-000000000005', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.has_permission('99174174-0005-0005-0005-000000000005',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-5]: an EXPIRED assignment still carries a sensitive grant';
  END IF;
END;
$$;
RESET ROLE;

-- 3f. Ordinary member with a live grant: allowed. And (7) the identity guard
--     still refuses to answer about a different user.
SELECT set_config('request.jwt.claim.sub', '99174174-0006-0006-0006-000000000006', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT public.has_permission('99174174-0006-0006-0006-000000000006',
                               '99174174-a000-a000-a000-00000000000a',
                               'accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-6]: live explicit grant denied for an ordinary member';
  END IF;
  IF public.has_permission('99174174-0002-0002-0002-000000000002',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-7]: caller-identity guard lost (170) — answered about another user';
  END IF;
  -- (172) exact-key match: a sibling key in the same module must not ride along.
  IF public.has_permission('99174174-0006-0006-0006-000000000006',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.entries.approve') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-8]: same-module wildcard match reappeared (172 regression)';
  END IF;
END;
$$;
RESET ROLE;

-- 3g. Cross-org: org B's admin gets nothing in org A, sensitive or ordinary.
SELECT set_config('request.jwt.claim.sub', '99174174-0007-0007-0007-000000000007', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.has_permission('99174174-0007-0007-0007-000000000007',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-9a]: cross-org admin passed a sensitive key in a foreign org';
  END IF;
  IF public.has_permission('99174174-0007-0007-0007-000000000007',
                           '99174174-a000-a000-a000-00000000000a',
                           'accounting.entries.approve') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-9b]: cross-org admin passed an ordinary key in a foreign org';
  END IF;
END;
$$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. wardah_has_exact_permission — the helper the voucher unpost/cancel RPCs
--    actually call. Same matrix, so the two functions cannot drift.
--    Executed as the migration owner: this helper is postgres-only by design.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF public.wardah_has_exact_permission('99174174-0001-0001-0001-000000000001',
        '99174174-a000-a000-a000-00000000000a', 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-10]: exact helper still lets an ungranted org admin unpost';
  END IF;
  IF NOT public.wardah_has_exact_permission('99174174-0002-0002-0002-000000000002',
        '99174174-a000-a000-a000-00000000000a', 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-11]: exact helper denies an explicitly granted admin';
  END IF;
  IF NOT public.wardah_has_exact_permission('99174174-0003-0003-0003-000000000003',
        '99174174-a000-a000-a000-00000000000a', 'accounting.vouchers.cancel') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-12]: exact helper lost the super-admin override';
  END IF;
  IF public.wardah_has_exact_permission('99174174-0004-0004-0004-000000000004',
        '99174174-a000-a000-a000-00000000000a', 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-13]: exact helper honours a DISABLED role (173 regression)';
  END IF;
  IF public.wardah_has_exact_permission('99174174-0005-0005-0005-000000000005',
        '99174174-a000-a000-a000-00000000000a', 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-14]: exact helper honours an EXPIRED assignment';
  END IF;
  IF NOT public.wardah_has_exact_permission('99174174-0001-0001-0001-000000000001',
        '99174174-a000-a000-a000-00000000000a', 'accounting.entries.approve') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-15]: exact helper broke the org-admin override for an ORDINARY key';
  END IF;
  IF public.wardah_has_exact_permission('99174174-0007-0007-0007-000000000007',
        '99174174-a000-a000-a000-00000000000a', 'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-16]: exact helper leaked across orgs';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Execute boundaries: the helper must stay unreachable from the client.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.wardah_has_exact_permission(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.wardah_has_exact_permission(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_has_exact_permission(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-17]: exact helper escaped its postgres-only execute boundary';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.has_permission(uuid,uuid,character varying)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.has_permission(uuid,uuid,character varying)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-18]: has_permission execute boundary drifted';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. The RBAC control plane: atomic, org-scoped, audited — and usable by an
--    org admin to grant themselves the sensitive role (the approved contract).
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '99174174-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_res      jsonb;
  v_role     uuid;
  v_audit    int;
BEGIN
  -- 6a. Create a role carrying both sensitive keys.
  v_res := public.rpc_upsert_org_role(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'name', 'P174 Self Granted Controller',
    'permission_keys', jsonb_build_array('accounting.vouchers.unpost','accounting.vouchers.cancel')));
  v_role := (v_res->>'role_id')::uuid;
  IF v_role IS NULL OR NOT (v_res->>'created')::boolean THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-19]: rpc_upsert_org_role did not create the role';
  END IF;
  IF jsonb_array_length(v_res->'sensitive_keys') <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-20]: sensitive keys not reported back to the caller';
  END IF;

  -- 6b. An unknown key must fail closed, not be silently dropped.
  BEGIN
    PERFORM public.rpc_upsert_org_role(jsonb_build_object(
      'org_id', '99174174-a000-a000-a000-00000000000a',
      'role_id', v_role, 'name', 'P174 Self Granted Controller',
      'permission_keys', jsonb_build_array('does.not.exist')));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-21]: unknown permission key was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%RBAC_174_UNKNOWN_PERMISSION_KEY%' THEN RAISE; END IF;
  END;

  -- The failed call must not have emptied the permission set.
  IF (SELECT count(*) FROM public.role_permissions WHERE role_id = v_role) <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-22]: a rejected update still mutated role_permissions (not atomic)';
  END IF;

  -- 6c. Self-assignment is allowed and audited.
  v_res := public.rpc_replace_user_roles(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'user_id', '99174174-0001-0001-0001-000000000001',
    'role_ids', jsonb_build_array(v_role)));
  IF jsonb_array_length(v_res->'sensitive_keys_granted') <> 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-23]: sensitive grant not surfaced on assignment';
  END IF;

  SELECT count(*) INTO v_audit FROM public.audit_logs
   WHERE org_id = '99174174-a000-a000-a000-00000000000a'
     AND action IN ('rbac.role.create','rbac.user_roles.replace');
  IF v_audit < 2 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-24]: RBAC changes were not written to audit_logs';
  END IF;

  -- 6d. Now the same admin passes the sensitive key — through the grant.
  IF NOT public.has_permission('99174174-0001-0001-0001-000000000001',
                               '99174174-a000-a000-a000-00000000000a',
                               'accounting.vouchers.unpost') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-25]: self-granted sensitive role does not authorize';
  END IF;

  -- 6e. A role that is still assigned cannot be deleted out from under users.
  BEGIN
    PERFORM public.rpc_delete_org_role(jsonb_build_object(
      'org_id', '99174174-a000-a000-a000-00000000000a', 'role_id', v_role));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-26]: an assigned role was deleted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%RBAC_174_ROLE_STILL_ASSIGNED%' THEN RAISE; END IF;
  END;

  -- 6f. Cross-org write must fail on the guard, not on a row filter.
  BEGIN
    PERFORM public.rpc_upsert_org_role(jsonb_build_object(
      'org_id', '99174174-b000-b000-b000-00000000000b', 'name', 'P174 Intruder',
      'permission_keys', jsonb_build_array()));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-27]: org A admin created a role in org B';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
  END;

  -- 6g. Snapshot: the single source of truth the UI must consume.
  v_res := public.rpc_permission_snapshot('99174174-a000-a000-a000-00000000000a');
  IF NOT (v_res->>'is_org_admin')::boolean THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-28]: snapshot lost is_org_admin';
  END IF;
  IF NOT (v_res->'permission_keys' @> '"accounting.vouchers.unpost"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-29]: snapshot omits an explicitly granted sensitive key';
  END IF;
  IF NOT (v_res->'sensitive_permission_keys' @> '"accounting.vouchers.cancel"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-30]: snapshot does not advertise the sensitive set for badging';
  END IF;
END;
$$;
RESET ROLE;

-- 6h. The ungranted admin's snapshot must NOT contain the sensitive keys,
--     while still containing ordinary ones. This is the exact divergence the
--     UI used to invent locally.
SELECT set_config('request.jwt.claim.sub', '99174174-0007-0007-0007-000000000007', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.rpc_permission_snapshot('99174174-b000-b000-b000-00000000000b');
  IF v_res->'permission_keys' @> '"accounting.vouchers.unpost"'::jsonb THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-31]: snapshot grants a sensitive key to an ungranted org admin';
  END IF;
  IF NOT (v_res->'permission_keys' @> '"accounting.entries.approve"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-32]: snapshot dropped ordinary org-admin permissions';
  END IF;
END;
$$;
RESET ROLE;

-- 6i. A snapshot may only ever be about an org the caller belongs to.
SELECT set_config('request.jwt.claim.sub', '99174174-0007-0007-0007-000000000007', false);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.rpc_permission_snapshot('99174174-a000-a000-a000-00000000000a');
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-33]: snapshot returned for a foreign organization';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- 6j. Per-assignment expiry survives a whole-set replacement.
--
-- A replace states WHICH roles are held; it must not silently extend a
-- time-boxed sensitive grant to permanent just because the caller omitted a
-- payload-level expires_at. Fixture: give the member two roles, one of them
-- time-limited, then replace the set with only the time-limited one and no
-- expires_at in the payload.
SELECT set_config('request.jwt.claim.sub', '99174174-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_deadline timestamptz := now() + interval '30 days';
  v_after    timestamptz;
BEGIN
  -- Seed: the member holds the controller role with an explicit deadline.
  PERFORM public.rpc_replace_user_roles(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'user_id', '99174174-0006-0006-0006-000000000006',
    'role_ids', jsonb_build_array(
      jsonb_build_object('role_id', '99174174-0000-0000-0000-000000000020',
                         'expires_at', v_deadline))));

  SELECT expires_at INTO v_after FROM public.user_roles
   WHERE user_id = '99174174-0006-0006-0006-000000000006'
     AND role_id = '99174174-0000-0000-0000-000000000020';
  IF v_after IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-34]: per-role expires_at was not honoured on assignment';
  END IF;

  -- Replace the set again, omitting expires_at entirely.
  PERFORM public.rpc_replace_user_roles(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'user_id', '99174174-0006-0006-0006-000000000006',
    'role_ids', jsonb_build_array('99174174-0000-0000-0000-000000000020')));

  SELECT expires_at INTO v_after FROM public.user_roles
   WHERE user_id = '99174174-0006-0006-0006-000000000006'
     AND role_id = '99174174-0000-0000-0000-000000000020';
  IF v_after IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-35]: a retained time-limited sensitive grant was silently made permanent';
  END IF;

  -- An explicit null must still be able to clear it deliberately.
  PERFORM public.rpc_replace_user_roles(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'user_id', '99174174-0006-0006-0006-000000000006',
    'role_ids', jsonb_build_array(
      jsonb_build_object('role_id', '99174174-0000-0000-0000-000000000020',
                         'expires_at', NULL))));

  SELECT expires_at INTO v_after FROM public.user_roles
   WHERE user_id = '99174174-0006-0006-0006-000000000006'
     AND role_id = '99174174-0000-0000-0000-000000000020';
  IF v_after IS NOT NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-36]: an explicit null expires_at did not clear the deadline';
  END IF;
END;
$$;
RESET ROLE;

-- 6l. A repeated role_id is rejected outright, and the rejection mutates
--     nothing. Silently de-duplicating would pick one of two conflicting
--     deadlines on the caller's behalf.
SELECT set_config('request.jwt.claim.sub', '99174174-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('r', role_id, 'e', expires_at) ORDER BY role_id), '[]'::jsonb)
    INTO v_before
  FROM public.user_roles
  WHERE user_id = '99174174-0006-0006-0006-000000000006'
    AND org_id  = '99174174-a000-a000-a000-00000000000a';

  BEGIN
    PERFORM public.rpc_replace_user_roles(jsonb_build_object(
      'org_id', '99174174-a000-a000-a000-00000000000a',
      'user_id', '99174174-0006-0006-0006-000000000006',
      'role_ids', jsonb_build_array(
        jsonb_build_object('role_id', '99174174-0000-0000-0000-000000000020',
                           'expires_at', (now() + interval '10 days')::text),
        jsonb_build_object('role_id', '99174174-0000-0000-0000-000000000020',
                           'expires_at', NULL))));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-39]: a duplicated role_id with conflicting expiry was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_174_DUPLICATE_ROLE_ID%' THEN RAISE; END IF;
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('r', role_id, 'e', expires_at) ORDER BY role_id), '[]'::jsonb)
    INTO v_after
  FROM public.user_roles
  WHERE user_id = '99174174-0006-0006-0006-000000000006'
    AND org_id  = '99174174-a000-a000-a000-00000000000a';

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-40]: the rejected duplicate payload still mutated user_roles';
  END IF;

  -- A plain repeated string must be rejected the same way.
  BEGIN
    PERFORM public.rpc_replace_user_roles(jsonb_build_object(
      'org_id', '99174174-a000-a000-a000-00000000000a',
      'user_id', '99174174-0006-0006-0006-000000000006',
      'role_ids', jsonb_build_array('99174174-0000-0000-0000-000000000020',
                                    '99174174-0000-0000-0000-000000000020')));
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-41]: a duplicated plain role_id was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ACCEPTANCE_FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%RBAC_174_DUPLICATE_ROLE_ID%' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- 6m. Audit completeness: every RBAC mutation must record a full before/after
--     snapshot, not just an identifier. These assertions are what stop the
--     audit trail from silently degrading in a later refactor.
SELECT set_config('request.jwt.claim.sub', '99174174-0001-0001-0001-000000000001', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_role  uuid;
  v_row   public.audit_logs%ROWTYPE;
BEGIN
  -- Create with one key, then update to a different key: the update's audit row
  -- must carry the OLD key set, not only the new one.
  v_role := (public.rpc_upsert_org_role(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'name', 'P174 Audit Probe',
    'permission_keys', jsonb_build_array('accounting.vouchers.unpost')))->>'role_id')::uuid;

  PERFORM public.rpc_upsert_org_role(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a',
    'role_id', v_role, 'name', 'P174 Audit Probe',
    'permission_keys', jsonb_build_array('accounting.vouchers.cancel')));

  SELECT * INTO v_row FROM public.audit_logs
   WHERE entity_id = v_role::text AND action = 'rbac.role.update'
   ORDER BY created_at DESC LIMIT 1;

  IF v_row.old_data IS NULL OR NOT (v_row.old_data->'permission_keys' @> '"accounting.vouchers.unpost"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-42]: role update did not record the outgoing permission set';
  END IF;
  IF NOT (v_row.new_data->'permission_keys' @> '"accounting.vouchers.cancel"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-43]: role update did not record the incoming permission set';
  END IF;
  IF NOT (v_row.metadata->'permissions_removed' @> '"accounting.vouchers.unpost"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-44]: role update did not record which permissions were removed';
  END IF;

  -- Delete must record the permissions it destroyed.
  PERFORM public.rpc_delete_org_role(jsonb_build_object(
    'org_id', '99174174-a000-a000-a000-00000000000a', 'role_id', v_role));

  SELECT * INTO v_row FROM public.audit_logs
   WHERE entity_id = v_role::text AND action = 'rbac.role.delete'
   ORDER BY created_at DESC LIMIT 1;

  IF v_row.old_data IS NULL
     OR NOT (v_row.old_data->'permission_keys' @> '"accounting.vouchers.cancel"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-45]: role delete did not record the destroyed permission set';
  END IF;
  IF NOT COALESCE((v_row.metadata->>'removed_sensitive')::boolean, false) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-46]: role delete did not flag that a sensitive key was removed';
  END IF;

  -- Assignment replacement must record per-role expires_at on both sides.
  SELECT * INTO v_row FROM public.audit_logs
   WHERE action = 'rbac.user_roles.replace'
     AND entity_id = '99174174-0006-0006-0006-000000000006'
   ORDER BY created_at DESC LIMIT 1;

  IF v_row.old_data IS NULL OR jsonb_typeof(v_row.old_data) <> 'array' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-47]: user_roles replace did not record a before snapshot';
  END IF;
  IF jsonb_array_length(v_row.old_data) > 0
     AND NOT (v_row.old_data->0 ? 'expires_at') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-48]: user_roles before snapshot omits expires_at';
  END IF;
  IF jsonb_array_length(v_row.new_data) > 0
     AND NOT (v_row.new_data->0 ? 'expires_at') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-49]: user_roles after snapshot omits expires_at';
  END IF;
END;
$$;
RESET ROLE;

-- 6k. A platform super admin who is NOT a member of the organization must
--     still get a snapshot, because has_permission grants them the override
--     independently of membership. The earlier fixture masked this by making
--     the super admin a member; this user deliberately is not.
INSERT INTO auth.users (id, email)
VALUES ('99174174-0008-0008-0008-000000000008', 'p174-super-nonmember@example.test');
INSERT INTO public.super_admins (user_id, email, is_active)
VALUES ('99174174-0008-0008-0008-000000000008', 'p174-super-nonmember@example.test', true);

SELECT set_config('request.jwt.claim.sub', '99174174-0008-0008-0008-000000000008', false);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_res jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_organizations
              WHERE user_id = '99174174-0008-0008-0008-000000000008') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FIXTURE_MISSING[174]: the non-member super admin is a member after all';
  END IF;

  v_res := public.rpc_permission_snapshot('99174174-a000-a000-a000-00000000000a');
  IF NOT (v_res->>'is_super_admin')::boolean THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-37]: snapshot did not report super-admin status';
  END IF;
  IF NOT (v_res->'permission_keys' @> '"accounting.vouchers.unpost"'::jsonb) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-38]: super-admin snapshot omits a sensitive key';
  END IF;
END;
$$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. Mutation proof: each 166-173 guarantee re-asserted as its own failure.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_hp text; v_ex text;
BEGIN
  SELECT prosrc INTO v_hp FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='has_permission';
  SELECT prosrc INTO v_ex FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='wardah_has_exact_permission';

  IF v_hp !~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M1]: 170 caller-identity guard missing';
  END IF;
  IF v_hp ~ 'LIKE' OR v_ex ~ 'LIKE' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M2]: 172 LIKE fallback reappeared';
  END IF;
  IF v_hp !~ 'p\.permission_key\s*=\s*p_permission_key' OR v_ex !~ 'p\.permission_key\s*=\s*p_permission_key' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M3]: 172 exact-key equality missing';
  END IF;
  IF v_hp !~ 'r\.is_active' OR v_ex !~ 'r\.is_active' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M4]: 173 active-role join missing';
  END IF;
  IF v_hp !~ 'expires_at' OR v_ex !~ 'expires_at' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M5]: role-expiry enforcement missing';
  END IF;
  IF v_hp !~ 'ur\.org_id = p_org_id' OR v_ex !~ 'ur\.org_id = p_org_id' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M6]: org scoping missing';
  END IF;
  IF v_hp !~ 'super_admins' OR v_ex !~ 'super_admins' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M7]: super-admin override missing';
  END IF;
  IF v_hp !~ 'is_org_admin' OR v_ex !~ 'is_org_admin' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M8]: org-admin override removed entirely';
  END IF;
  IF v_hp !~ 'wardah_is_sensitive_permission' OR v_ex !~ 'wardah_is_sensitive_permission' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL[174-M9]: a permission function stopped consulting the central classifier';
  END IF;
END;
$$;

DO $$ BEGIN RAISE NOTICE 'SENSITIVE_PERMISSION_174_ACCEPTANCE_PASS'; END $$;

ROLLBACK;
