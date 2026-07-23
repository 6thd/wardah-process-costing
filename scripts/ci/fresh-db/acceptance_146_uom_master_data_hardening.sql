-- Acceptance for migration 146.
-- Exercises authenticated admin/member identities through auth.uid() and verifies
-- adjustment revalidation without breaking append-ledger cancellation updates.
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
  ('46aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'uom146-admin@example.test'),
  ('46bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'uom146-member@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('46111111-1111-1111-1111-111111111111', 'U146', 'UoM 146 Org');

INSERT INTO public.user_organizations
  (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('46000000-0000-0000-0000-000000000001',
   '46aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '46111111-1111-1111-1111-111111111111', true, true, 'admin'),
  ('46000000-0000-0000-0000-000000000002',
   '46bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '46111111-1111-1111-1111-111111111111', true, false, 'member');

INSERT INTO public.org_settings (org_id, key, value) VALUES
  ('46111111-1111-1111-1111-111111111111', 'uom_engine_enabled', '{"enabled":true}'::jsonb);

INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('46c00000-0000-0000-0000-000000000001', 'U146_COUNT', 'U146 Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  ('46400000-0000-0000-0000-000000000001',
   '46c00000-0000-0000-0000-000000000001',
   'U146_PCS', 'U146 Piece', 'u146p', 1, true, false, NULL, true),
  ('46400000-0000-0000-0000-000000000002',
   '46c00000-0000-0000-0000-000000000001',
   'U146_DOZ', 'U146 Dozen', 'u146d', 12, false, false, NULL, true);

-- Trusted seed/service-role insert is still legal without auth.uid().
INSERT INTO public.products
  (id, org_id, code, name, unit, base_uom_id, uom_migration_status) VALUES
  ('46d00000-0000-0000-0000-000000000001',
   '46111111-1111-1111-1111-111111111111',
   'U146-U', 'Unset product', 'pcs', NULL, 'NO_UNIT'),
  ('46d00000-0000-0000-0000-000000000002',
   '46111111-1111-1111-1111-111111111111',
   'U146-M', 'Mapped product', 'pcs',
   '46400000-0000-0000-0000-000000000001', 'MAPPED');

INSERT INTO public.warehouses (id, org_id, code, name) VALUES
  ('46700000-0000-0000-0000-000000000001',
   '46111111-1111-1111-1111-111111111111', 'U146-W', 'U146 Warehouse');

INSERT INTO public.stock_adjustments
  (id, organization_id, org_id, adjustment_number, adjustment_date, posting_date,
   adjustment_type, reason, status, total_items, created_by) VALUES
  ('46800000-0000-0000-0000-000000000001',
   '46111111-1111-1111-1111-111111111111',
   '46111111-1111-1111-1111-111111111111',
   'U146-ADJ', current_date, current_date, 'PHYSICAL_COUNT', 'acceptance',
   'DRAFT', 1, '46aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

COMMIT;

-- Ordinary member cannot assign base_uom_id through a direct table update.
SELECT set_config('request.jwt.claim.sub', '46bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT pg_temp.expect_error(
  $$ UPDATE public.products
     SET base_uom_id='46400000-0000-0000-0000-000000000001'
     WHERE id='46d00000-0000-0000-0000-000000000001' $$,
  'NOT_ORG_ADMIN');

-- Admin can perform the first assignment, but cannot reinterpret an existing base.
SELECT set_config('request.jwt.claim.sub', '46aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT public.rpc_assign_product_base_uom(
  '46111111-1111-1111-1111-111111111111',
  '46d00000-0000-0000-0000-000000000001',
  '46400000-0000-0000-0000-000000000001');

SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom(
       '46111111-1111-1111-1111-111111111111',
       '46d00000-0000-0000-0000-000000000001',
       '46400000-0000-0000-0000-000000000002') $$,
  'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP');

-- A legal draft line is accepted while the base unit is active.
INSERT INTO public.stock_adjustment_items
  (adjustment_id, organization_id, product_id, warehouse_id,
   current_qty, new_qty, difference_qty, current_rate, value_difference) VALUES
  ('46800000-0000-0000-0000-000000000001',
   '46111111-1111-1111-1111-111111111111',
   '46d00000-0000-0000-0000-000000000002',
   '46700000-0000-0000-0000-000000000001', 0, 1, 1, 1, 1);

INSERT INTO public.stock_ledger_entries
  (org_id, product_id, warehouse_id, posting_date, voucher_type, voucher_id,
   actual_qty, qty_after_transaction, valuation_rate, stock_value,
   stock_value_difference, is_cancelled) VALUES
  ('46111111-1111-1111-1111-111111111111',
   '46d00000-0000-0000-0000-000000000002',
   '46700000-0000-0000-0000-000000000001', current_date, 'U146 Test',
   '46900000-0000-0000-0000-000000000001', 1, 1, 1, 1, 1, false);

-- Quarantine the UoM after draft creation. Every adjustment UPDATE must revalidate.
UPDATE public.uoms
SET is_active=false
WHERE id='46400000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_error(
  $$ UPDATE public.stock_adjustment_items
     SET new_qty=2, difference_qty=2
     WHERE adjustment_id='46800000-0000-0000-0000-000000000001' $$,
  'PRODUCT_UOM_NOT_MAPPED');

-- Historical SLE cancellation metadata remains updateable; eligibility is enforced
-- at movement INSERT, not retroactively on every ledger maintenance update.
UPDATE public.stock_ledger_entries
SET is_cancelled=true, modified_at=now()
WHERE voucher_id='46900000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_ledger_entries
    WHERE voucher_id='46900000-0000-0000-0000-000000000001'
      AND is_cancelled=true
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: SLE cancellation update was not preserved';
  END IF;
END $$;

\echo '✅ acceptance_146_uom_master_data_hardening: all assertions passed'
