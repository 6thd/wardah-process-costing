-- Acceptance for migration 147.
-- Proves tenant isolation, legal purchase-UoM normalization, authoritative totals,
-- and complete rollback when any line in the document is invalid.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected [%] for [%], got [%]', p_needle, p_sql, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected error [%] for [%], but it succeeded', p_needle, p_sql;
  END IF;
END $$;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('47aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'uom147-member@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('47111111-1111-1111-1111-111111111111', 'U147A', 'UoM 147 Org A'),
  ('47222222-2222-2222-2222-222222222222', 'U147B', 'UoM 147 Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('47000000-0000-0000-0000-000000000001',
   '47aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '47111111-1111-1111-1111-111111111111', true, false, 'member');

INSERT INTO public.org_settings (org_id, key, value) VALUES
  ('47111111-1111-1111-1111-111111111111', 'uom_engine_enabled', '{"enabled":true}'::jsonb),
  ('47222222-2222-2222-2222-222222222222', 'uom_engine_enabled', '{"enabled":true}'::jsonb);

INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('47c00000-0000-0000-0000-000000000001', 'U147_COUNT', 'U147 Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  ('47400000-0000-0000-0000-000000000001',
   '47c00000-0000-0000-0000-000000000001',
   'U147_PCS', 'U147 Piece', 'u147p', 1, true, false, NULL, true),
  ('47400000-0000-0000-0000-000000000002',
   '47c00000-0000-0000-0000-000000000001',
   'U147_CTN', 'U147 Carton', 'u147c', 12, false, false, NULL, true),
  ('47400000-0000-0000-0000-000000000003',
   '47c00000-0000-0000-0000-000000000001',
   'U147_CASE', 'U147 Case', 'u147x', 24, false, false, NULL, true);

INSERT INTO public.products
  (id, org_id, code, name, unit, base_uom_id, uom_migration_status, is_active) VALUES
  ('47d00000-0000-0000-0000-000000000001',
   '47111111-1111-1111-1111-111111111111',
   'U147-A', 'Mapped product A', 'pcs',
   '47400000-0000-0000-0000-000000000001', 'MAPPED', true),
  ('47d00000-0000-0000-0000-000000000002',
   '47222222-2222-2222-2222-222222222222',
   'U147-B', 'Mapped product B', 'pcs',
   '47400000-0000-0000-0000-000000000001', 'MAPPED', true);

INSERT INTO public.product_uom_conversions
  (id, org_id, product_id, uom_id, factor_to_base,
   is_active, use_for_purchase, use_for_sale, valid_from) VALUES
  ('47e00000-0000-0000-0000-000000000001',
   '47111111-1111-1111-1111-111111111111',
   '47d00000-0000-0000-0000-000000000001',
   '47400000-0000-0000-0000-000000000002',
   12, true, true, false, now() - interval '1 day'),
  ('47e00000-0000-0000-0000-000000000002',
   '47111111-1111-1111-1111-111111111111',
   '47d00000-0000-0000-0000-000000000001',
   '47400000-0000-0000-0000-000000000003',
   24, true, false, true, now() - interval '1 day');

INSERT INTO public.vendors (id, org_id, code, name, is_active) VALUES
  ('47f00000-0000-0000-0000-000000000001',
   '47111111-1111-1111-1111-111111111111', 'U147-VA', 'Vendor A', true),
  ('47f00000-0000-0000-0000-000000000002',
   '47222222-2222-2222-2222-222222222222', 'U147-VB', 'Vendor B', true);

COMMIT;

SELECT set_config('request.jwt.claim.sub', '47aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- Successful document: two cartons at 120 each. Trigger 139 normalizes to
-- 24 base pieces at 10 each while preserving the commercial total 240 + 15% VAT.
SELECT public.rpc_create_uom_purchase_order(
  jsonb_build_object(
    'org_id', '47111111-1111-1111-1111-111111111111',
    'vendor_id', '47f00000-0000-0000-0000-000000000001',
    'order_number', 'U147-PO-SUCCESS',
    'order_date', '2026-07-24',
    'expected_delivery_date', '2026-07-30',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', '47d00000-0000-0000-0000-000000000001',
      'uom_id', '47400000-0000-0000-0000-000000000002',
      'qty_entered', 2,
      'unit_price_entered', 120,
      'discount_percentage', 0,
      'tax_percentage', 15
    ))
  )
);

DO $$
DECLARE
  v_order public.purchase_orders%ROWTYPE;
  v_line public.purchase_order_lines%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_order
  FROM public.purchase_orders
  WHERE org_id='47111111-1111-1111-1111-111111111111'
    AND order_number='U147-PO-SUCCESS';

  SELECT * INTO STRICT v_line
  FROM public.purchase_order_lines
  WHERE purchase_order_id=v_order.id;

  IF v_line.qty_entered <> 2
     OR v_line.conversion_factor_snapshot <> 12
     OR v_line.quantity <> 24
     OR v_line.unit_price_entered <> 120
     OR v_line.unit_price <> 10
     OR v_line.line_total <> 276 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: normalized line mismatch: %', row_to_json(v_line);
  END IF;

  IF v_order.subtotal <> 240
     OR v_order.discount_amount <> 0
     OR v_order.tax_amount <> 36
     OR v_order.total_amount <> 276 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: authoritative header totals mismatch: %', row_to_json(v_order);
  END IF;
END $$;

-- A sales-only conversion is not a legal purchase unit.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_create_uom_purchase_order(
    '{
      "org_id":"47111111-1111-1111-1111-111111111111",
      "vendor_id":"47f00000-0000-0000-0000-000000000001",
      "order_number":"U147-PO-ILLEGAL-UOM",
      "lines":[{
        "product_id":"47d00000-0000-0000-0000-000000000001",
        "uom_id":"47400000-0000-0000-0000-000000000003",
        "qty_entered":1,
        "unit_price_entered":10,
        "discount_percentage":0,
        "tax_percentage":15
      }]
    }'::jsonb) $$,
  'PO_UOM_NOT_LEGAL_FOR_PURCHASE');

-- A vendor from another organization is rejected before any header is inserted.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_create_uom_purchase_order(
    '{
      "org_id":"47111111-1111-1111-1111-111111111111",
      "vendor_id":"47f00000-0000-0000-0000-000000000002",
      "order_number":"U147-PO-WRONG-VENDOR",
      "lines":[{
        "product_id":"47d00000-0000-0000-0000-000000000001",
        "uom_id":"47400000-0000-0000-0000-000000000001",
        "qty_entered":1,
        "unit_price_entered":10,
        "discount_percentage":0,
        "tax_percentage":15
      }]
    }'::jsonb) $$,
  'VENDOR_NOT_FOUND_OR_WRONG_ORG');

-- Atomic rollback: the first line is valid, but the second line is invalid.
-- The header and first line must both disappear with the failed statement.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_create_uom_purchase_order(
    '{
      "org_id":"47111111-1111-1111-1111-111111111111",
      "vendor_id":"47f00000-0000-0000-0000-000000000001",
      "order_number":"U147-PO-ROLLBACK",
      "lines":[
        {
          "product_id":"47d00000-0000-0000-0000-000000000001",
          "uom_id":"47400000-0000-0000-0000-000000000002",
          "qty_entered":1,
          "unit_price_entered":120,
          "discount_percentage":0,
          "tax_percentage":15
        },
        {
          "product_id":"47d00000-0000-0000-0000-000000000002",
          "uom_id":"47400000-0000-0000-0000-000000000001",
          "qty_entered":1,
          "unit_price_entered":10,
          "discount_percentage":0,
          "tax_percentage":15
        }
      ]
    }'::jsonb) $$,
  'PO_PRODUCT_NOT_MAPPED_OR_WRONG_ORG');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.purchase_orders
    WHERE order_number IN ('U147-PO-ILLEGAL-UOM','U147-PO-WRONG-VENDOR','U147-PO-ROLLBACK')
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: failed RPC left an orphan purchase-order header';
  END IF;
END $$;

\echo '✅ acceptance_147_atomic_uom_purchase_order: all assertions passed'
