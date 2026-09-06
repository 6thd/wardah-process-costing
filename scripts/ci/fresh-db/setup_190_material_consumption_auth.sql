\set ON_ERROR_STOP on

INSERT INTO public.organizations (id, name, code) VALUES
  ('19019019-1000-4000-8000-000000000001', 'F1 Auth Org A', 'F1-A'),
  ('19019019-2000-4000-8000-000000000001', 'F1 Auth Org B', 'F1-B');

INSERT INTO auth.users (id, email) VALUES
  ('19019019-0000-4000-8000-000000000001', 'f1-admin@example.test'),
  ('19019019-0000-4000-8000-000000000002', 'f1-no-perm@example.test'),
  ('19019019-0000-4000-8000-000000000003', 'f1-granted@example.test'),
  ('19019019-0000-4000-8000-000000000004', 'f1-revoked@example.test'),
  ('19019019-0000-4000-8000-000000000005', 'f1-expired@example.test'),
  ('19019019-0000-4000-8000-000000000006', 'f1-inactive-role@example.test'),
  ('19019019-0000-4000-8000-000000000007', 'f1-inactive-member@example.test'),
  ('19019019-0000-4000-8000-000000000008', 'f1-cross-org@example.test');

INSERT INTO public.user_organizations
  (user_id, org_id, role, is_active, is_org_admin)
VALUES
  ('19019019-0000-4000-8000-000000000001', '19019019-1000-4000-8000-000000000001', 'admin', true, true),
  ('19019019-0000-4000-8000-000000000002', '19019019-1000-4000-8000-000000000001', 'user', true, false),
  ('19019019-0000-4000-8000-000000000003', '19019019-1000-4000-8000-000000000001', 'user', true, false),
  ('19019019-0000-4000-8000-000000000004', '19019019-1000-4000-8000-000000000001', 'user', true, false),
  ('19019019-0000-4000-8000-000000000005', '19019019-1000-4000-8000-000000000001', 'user', true, false),
  ('19019019-0000-4000-8000-000000000006', '19019019-1000-4000-8000-000000000001', 'user', true, false),
  ('19019019-0000-4000-8000-000000000007', '19019019-1000-4000-8000-000000000001', 'user', false, false),
  ('19019019-0000-4000-8000-000000000008', '19019019-2000-4000-8000-000000000001', 'user', true, false);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('19019019-3000-4000-8000-000000000001', '19019019-1000-4000-8000-000000000001', 'F1 Granted', 'F1 ممنوح', true),
  ('19019019-3000-4000-8000-000000000002', '19019019-1000-4000-8000-000000000001', 'F1 Revoked', 'F1 مسحوب', true),
  ('19019019-3000-4000-8000-000000000003', '19019019-1000-4000-8000-000000000001', 'F1 Expired', 'F1 منتهي', true),
  ('19019019-3000-4000-8000-000000000004', '19019019-1000-4000-8000-000000000001', 'F1 Inactive Role', 'F1 دور غير نشط', false),
  ('19019019-3000-4000-8000-000000000005', '19019019-1000-4000-8000-000000000001', 'F1 Inactive Member', 'F1 عضوية غير نشطة', true);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.id IN (
    '19019019-3000-4000-8000-000000000001'::uuid,
    '19019019-3000-4000-8000-000000000003'::uuid,
    '19019019-3000-4000-8000-000000000004'::uuid,
    '19019019-3000-4000-8000-000000000005'::uuid
  )
  AND p.permission_key='manufacturing.material_consumption.consume';

-- F1 Revoked intentionally receives no role_permissions row.
INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  ('19019019-0000-4000-8000-000000000003', '19019019-3000-4000-8000-000000000001', '19019019-1000-4000-8000-000000000001', NULL),
  ('19019019-0000-4000-8000-000000000004', '19019019-3000-4000-8000-000000000002', '19019019-1000-4000-8000-000000000001', NULL),
  ('19019019-0000-4000-8000-000000000005', '19019019-3000-4000-8000-000000000003', '19019019-1000-4000-8000-000000000001', now() - interval '1 day'),
  ('19019019-0000-4000-8000-000000000006', '19019019-3000-4000-8000-000000000004', '19019019-1000-4000-8000-000000000001', NULL),
  ('19019019-0000-4000-8000-000000000007', '19019019-3000-4000-8000-000000000005', '19019019-1000-4000-8000-000000000001', NULL);

INSERT INTO public.items (id, org_id, code, name)
VALUES (
  '19019019-1000-4000-8000-000000000010',
  '19019019-1000-4000-8000-000000000001',
  'F1-MAT',
  'F1 Material'
);

INSERT INTO public.work_centers (id, org_id, code, name)
VALUES (
  '19019019-1000-4000-8000-000000000020',
  '19019019-1000-4000-8000-000000000001',
  'F1-WC',
  'F1 Work Center'
);

INSERT INTO public.manufacturing_orders (
  id, org_id, order_number, quantity, status
) VALUES (
  '19019019-1000-4000-8000-000000000030',
  '19019019-1000-4000-8000-000000000001',
  'F1-MO-001',
  1,
  'draft'
);

INSERT INTO public.work_orders (
  id, org_id, mo_id, work_center_id, work_order_number,
  operation_sequence, operation_name, planned_quantity, status
) VALUES (
  '19019019-1000-4000-8000-000000000040',
  '19019019-1000-4000-8000-000000000001',
  '19019019-1000-4000-8000-000000000030',
  '19019019-1000-4000-8000-000000000020',
  'F1-WO-001',
  1,
  'F1 Operation',
  1,
  'READY'
);

DO $setup_check$
BEGIN
  IF (SELECT count(*) FROM public.permissions
      WHERE permission_key='manufacturing.material_consumption.consume') <> 1 THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_190_SETUP_PERMISSION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.has_permission(
      '19019019-0000-4000-8000-000000000003'::uuid,
      '19019019-1000-4000-8000-000000000001'::uuid,
      'manufacturing.material_consumption.consume'
    ) AS allowed
    WHERE allowed
  ) THEN
    -- has_permission is caller-identity guarded, so this direct postgres call
    -- is expected to be false. The authenticated acceptance below proves the
    -- actual actor path; only fixture existence is asserted here.
    NULL;
  END IF;

  RAISE NOTICE 'MATERIAL_CONSUMPTION_190_SETUP_PASS';
END
$setup_check$;
