\set ON_ERROR_STOP on

INSERT INTO public.organizations (id, name, code)
VALUES (
  '51856187-1000-0000-0000-000000000001',
  'Stock 187 Upgrade',
  'STK187-UPGRADE'
);

INSERT INTO public.products (
  id, org_id, code, name, is_stockable, base_uom_id
)
SELECT
  '51856187-1000-0000-0000-000000000002',
  '51856187-1000-0000-0000-000000000001',
  'STK187-HISTORY',
  'Stock 187 Historical Product',
  true,
  u.id
FROM public.uoms u
WHERE u.org_id IS NULL
  AND u.is_active
  AND NOT u.is_product_specific
LIMIT 1;

DO $seed_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.products
    WHERE id = '51856187-1000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'STOCK_187_SETUP_NO_SYSTEM_UOM';
  END IF;
END
$seed_check$;

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES (
  '51856187-1000-0000-0000-000000000003',
  '51856187-1000-0000-0000-000000000001',
  'STK187-WH',
  'Stock 187 Warehouse'
);

INSERT INTO public.bins (
  id, org_id, product_id, warehouse_id, actual_qty, reserved_qty,
  valuation_rate, stock_value, stock_queue
)
VALUES (
  '51856187-1000-0000-0000-000000000004',
  '51856187-1000-0000-0000-000000000001',
  '51856187-1000-0000-0000-000000000002',
  '51856187-1000-0000-0000-000000000003',
  10,
  0,
  1,
  10,
  '[{"qty":10,"rate":1}]'::jsonb
);

INSERT INTO auth.users (id, email)
VALUES (
  '51856187-1000-0000-0000-000000000005',
  'stock187-upgrade@example.test'
);

INSERT INTO public.user_organizations (
  user_id, org_id, is_active, is_org_admin
)
VALUES (
  '51856187-1000-0000-0000-000000000005',
  '51856187-1000-0000-0000-000000000001',
  true,
  true
);

-- A faithful shape for the known Production condition: duplicate historical
-- Stock Adjustment rows whose source-line provenance is unavailable. Migration
-- 187 must neither rewrite nor reject these rows during application.
INSERT INTO public.stock_ledger_entries (
  id,
  voucher_type,
  voucher_id,
  voucher_number,
  product_id,
  warehouse_id,
  posting_date,
  posting_time,
  actual_qty,
  qty_after_transaction,
  incoming_rate,
  valuation_rate,
  stock_value,
  stock_value_difference,
  stock_queue,
  is_cancelled,
  docstatus,
  org_id,
  created_at
)
VALUES
  (
    '51856187-1000-0000-0000-000000000007',
    'Stock Adjustment',
    '51856187-1000-0000-0000-000000000006',
    'STK187-HIST-DUP',
    '51856187-1000-0000-0000-000000000002',
    '51856187-1000-0000-0000-000000000003',
    DATE '2025-11-10',
    TIME '12:03:50',
    1,
    1,
    1,
    1,
    1,
    1,
    '[{"qty":1,"rate":1}]'::jsonb,
    false,
    1,
    '51856187-1000-0000-0000-000000000001',
    TIMESTAMPTZ '2025-11-11 09:03:49+00'
  ),
  (
    '51856187-1000-0000-0000-000000000008',
    'Stock Adjustment',
    '51856187-1000-0000-0000-000000000006',
    'STK187-HIST-DUP',
    '51856187-1000-0000-0000-000000000002',
    '51856187-1000-0000-0000-000000000003',
    DATE '2025-11-10',
    TIME '12:12:51',
    1,
    1,
    1,
    1,
    1,
    1,
    '[{"qty":1,"rate":1}]'::jsonb,
    false,
    1,
    '51856187-1000-0000-0000-000000000001',
    TIMESTAMPTZ '2025-11-11 09:12:50+00'
  );

SELECT 'STOCK_187_SETUP_PASS' AS result;
