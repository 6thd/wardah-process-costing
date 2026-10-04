-- Manufacturing / inventory RED evidence — shared committed fixture.
--
-- Loaded ONCE into a disposable database that was built from the canonical
-- baseline pair + every migration after its cutoff (see run_red.sh). Every probe
-- then runs inside BEGIN ... ROLLBACK, so probes are independent and this
-- fixture is the only committed state.
--
-- DISPOSABLE DATABASES ONLY. Never load this into Production or Staging.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id, name, code) VALUES
  ('ed000000-0000-4000-8000-000000000001', 'MFG RED Org', 'MFG-RED');

INSERT INTO auth.users (id, email) VALUES
  ('ed000000-0000-4000-8000-0000000000a1', 'mfg-red-admin@example.test'),
  ('ed000000-0000-4000-8000-0000000000a2', 'mfg-red-consumer@example.test'),
  ('ed000000-0000-4000-8000-0000000000a3', 'mfg-red-reader@example.test');

-- a1: active org admin (org-admin bypass holds every ordinary key).
-- a2: active member whose only grant is manufacturing.material_consumption.consume.
-- a3: active member whose only grant is manufacturing.orders.read — i.e. an
--     ordinary same-org member WITHOUT any manufacturing mutation permission.
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('ed000000-0000-4000-8000-0000000000a1', 'ed000000-0000-4000-8000-000000000001', 'admin', true, true),
  ('ed000000-0000-4000-8000-0000000000a2', 'ed000000-0000-4000-8000-000000000001', 'user',  true, false),
  ('ed000000-0000-4000-8000-0000000000a3', 'ed000000-0000-4000-8000-000000000001', 'user',  true, false);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('ed000000-0000-4000-8000-0000000000b1', 'ed000000-0000-4000-8000-000000000001', 'RED Consumer', 'RED مستهلك', true),
  ('ed000000-0000-4000-8000-0000000000b2', 'ed000000-0000-4000-8000-000000000001', 'RED Reader',   'RED قارئ',   true);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b1'::uuid, p.id
FROM public.permissions p WHERE p.permission_key = 'manufacturing.material_consumption.consume';
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'ed000000-0000-4000-8000-0000000000b2'::uuid, p.id
FROM public.permissions p WHERE p.permission_key = 'manufacturing.orders.read';

INSERT INTO public.user_roles (user_id, role_id, org_id, expires_at) VALUES
  ('ed000000-0000-4000-8000-0000000000a2', 'ed000000-0000-4000-8000-0000000000b1', 'ed000000-0000-4000-8000-000000000001', NULL),
  ('ed000000-0000-4000-8000-0000000000a3', 'ed000000-0000-4000-8000-0000000000b2', 'ed000000-0000-4000-8000-000000000001', NULL);

-- Products: RAW (reserved/consumed), FG (finished good, zero legal balance),
-- CNT (physical-count subject, two warehouses), XFR (stock-transfer subject).
INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id, cost_price)
SELECT p.id, 'ed000000-0000-4000-8000-000000000001', p.code, p.name, true, u.id, p.cost
FROM (VALUES
  ('ed000000-0000-4000-8000-0000000000c1'::uuid, 'RED-RAW', 'RED raw material', 10::numeric),
  ('ed000000-0000-4000-8000-0000000000c2'::uuid, 'RED-FG',  'RED finished good', 0::numeric),
  ('ed000000-0000-4000-8000-0000000000c3'::uuid, 'RED-CNT', 'RED counted item',  5::numeric),
  ('ed000000-0000-4000-8000-0000000000c4'::uuid, 'RED-XFR', 'RED transfer item', 7::numeric)
) AS p(id, code, name, cost)
CROSS JOIN LATERAL (
  SELECT id FROM public.uoms
  WHERE org_id IS NULL AND is_active AND NOT is_product_specific
  ORDER BY code LIMIT 1
) u;

INSERT INTO public.items (id, org_id, code, name) VALUES
  ('ed000000-0000-4000-8000-0000000000d1', 'ed000000-0000-4000-8000-000000000001', 'RED-I-RAW', 'RED raw item');
INSERT INTO public.item_product_map (org_id, item_id, product_id, mapping_source, is_active, valid_from) VALUES
  ('ed000000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-0000000000d1',
   'ed000000-0000-4000-8000-0000000000c1', 'MANUAL', true, now() - interval '1 day');

INSERT INTO public.warehouses (id, org_id, code, name) VALUES
  ('ed000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-000000000001', 'RED-W1', 'RED Warehouse 1'),
  ('ed000000-0000-4000-8000-0000000000e2', 'ed000000-0000-4000-8000-000000000001', 'RED-W2', 'RED Warehouse 2');

-- Legal opening balances (bins are the canonical balance truth).
INSERT INTO public.bins (org_id, product_id, warehouse_id, actual_qty, reserved_qty, valuation_rate, stock_value, stock_queue) VALUES
  ('ed000000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-0000000000c1', 'ed000000-0000-4000-8000-0000000000e1', 1000, 0, 10, 10000, '[{"qty":1000,"rate":10}]'),
  ('ed000000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-0000000000c3', 'ed000000-0000-4000-8000-0000000000e1',  60, 0,  5,  300, '[{"qty":60,"rate":5}]'),
  ('ed000000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-0000000000c3', 'ed000000-0000-4000-8000-0000000000e2',  40, 0,  5,  200, '[{"qty":40,"rate":5}]'),
  ('ed000000-0000-4000-8000-000000000001', 'ed000000-0000-4000-8000-0000000000c4', 'ed000000-0000-4000-8000-0000000000e1',  20, 0,  7,  140, '[{"qty":20,"rate":7}]');

-- Product projection seeded consistently with bins (FG has no bins -> 0).
UPDATE public.products p
SET stock_quantity = b.q, stock_value = b.v
FROM (SELECT product_id, SUM(actual_qty) q, SUM(stock_value) v
      FROM public.bins WHERE org_id = 'ed000000-0000-4000-8000-000000000001'
      GROUP BY product_id) b
WHERE p.id = b.product_id;
UPDATE public.products SET stock_quantity = 0, stock_value = 0
WHERE id = 'ed000000-0000-4000-8000-0000000000c2';

INSERT INTO public.manufacturing_stages (id, org_id, code, name, order_sequence) VALUES
  ('ed000000-0000-4000-8000-0000000000f1', 'ed000000-0000-4000-8000-000000000001', 'RED-ST1', 'RED Stage 1', 1);
INSERT INTO public.work_centers (id, org_id, code, name) VALUES
  ('ed000000-0000-4000-8000-0000000000f2', 'ed000000-0000-4000-8000-000000000001', 'RED-WC', 'RED Work Center');

-- Accounting fixture: the minimum mappings the current completion RPC needs.
-- Account codes are TEST data, not a proposed Chart of Accounts.
INSERT INTO public.gl_accounts (id, org_id, code, name, category, subtype, normal_balance, allow_posting, is_active) VALUES
  ('ed000000-0000-4000-8000-000000000091', 'ed000000-0000-4000-8000-000000000001', 'T1300', 'TEST Raw inventory', 'ASSET', 'INVENTORY', 'DEBIT', true, true),
  ('ed000000-0000-4000-8000-000000000092', 'ed000000-0000-4000-8000-000000000001', 'T1350', 'TEST FG inventory',  'ASSET', 'INVENTORY', 'DEBIT', true, true),
  ('ed000000-0000-4000-8000-000000000093', 'ed000000-0000-4000-8000-000000000001', 'T1400', 'TEST WIP',           'ASSET', 'INVENTORY', 'DEBIT', true, true);
INSERT INTO public.gl_event_mappings (org_id, event_code, debit_account_code, credit_account_code, is_active) VALUES
  ('ed000000-0000-4000-8000-000000000001', 'MATERIAL_ISSUE', 'T1400', 'T1300', true),
  ('ed000000-0000-4000-8000-000000000001', 'FG_RECEIPT',     'T1350', 'T1400', true);

COMMIT;

SELECT 'MFG_RED_FIXTURE_LOADED' AS result;
