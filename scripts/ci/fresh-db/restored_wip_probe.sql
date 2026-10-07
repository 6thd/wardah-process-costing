-- Rolled-back stage-WIP probe for a restored clone.
-- NOTICE WIP_PROBE_GREEN when the authenticated insert commits inside this transaction.
-- NOTICE WIP_PROBE_RED_42501 when M195 containment still blocks the invoker lock.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.organizations (id, name, code) VALUES
  ('20320320-1000-4000-8000-000000000001', 'WIP Lock Org A', 'W203-A');
INSERT INTO auth.users (id, email) VALUES
  ('20320320-0000-4000-8000-000000000003', 'w203-granted@example.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('20320320-0000-4000-8000-000000000003', '20320320-1000-4000-8000-000000000001', 'user', true, false);
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('20320320-3000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001', 'W203 Granted', 'W203', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '20320320-3000-4000-8000-000000000001', p.id
FROM public.permissions p
WHERE p.permission_key = 'manufacturing.stage_costs.create';
INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
  ('20320320-0000-4000-8000-000000000003', '20320320-3000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001');
INSERT INTO public.manufacturing_stages (id, org_id, code, name, order_sequence) VALUES
  ('20320320-4000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001', 'W203-A', 'Stage A', 1);
INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity, status) VALUES
  ('20320320-5000-4000-8000-000000000001', '20320320-1000-4000-8000-000000000001', 'W203-MO-A', 1, 'draft');

SELECT set_config('request.jwt.claim.sub', '20320320-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"20320320-0000-4000-8000-000000000003","role":"authenticated","org_id":"20320320-1000-4000-8000-000000000001"}',
  true);
SET LOCAL ROLE authenticated;

DO $probe$
BEGIN
  INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
  VALUES (
    '20320320-6000-4000-8000-000000000001',
    '20320320-1000-4000-8000-000000000001',
    '20320320-5000-4000-8000-000000000001',
    '20320320-4000-4000-8000-000000000001',
    DATE '2026-01-01', DATE '2026-01-31');
  RAISE NOTICE 'WIP_PROBE_GREEN';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'WIP_PROBE_RED_42501';
END
$probe$;
RESET ROLE;
ROLLBACK;
