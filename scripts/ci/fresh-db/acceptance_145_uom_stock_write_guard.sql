-- Acceptance test for migration 145 (flag-gated UoM stock write guard).
-- Runs after the full Fresh DB chain. Any failed assertion stops CI.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_any_error(p_sql text, p_needles text[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_succeeded boolean := false;
  v_matched boolean := false;
  v_needle text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    FOREACH v_needle IN ARRAY p_needles LOOP
      IF SQLERRM LIKE '%' || v_needle || '%' THEN
        v_matched := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT v_matched THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected one of [%] but got [%]',
        p_sql, array_to_string(p_needles, ', '), SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected one of errors [%] but it succeeded',
      p_sql, array_to_string(p_needles, ', ');
  END IF;
END $$;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'uom145-admin@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('31111111-1111-1111-1111-111111111111', 'U145A', 'UoM Guard Org A'),
  ('32222222-2222-2222-2222-222222222222', 'U145B', 'UoM Guard Org B');

INSERT INTO public.user_organizations (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('3a000000-0000-0000-0000-000000000001',
   '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '31111111-1111-1111-1111-111111111111', true, true, 'admin');

INSERT INTO public.org_settings (org_id, key, value) VALUES
  ('31111111-1111-1111-1111-111111111111', 'uom_engine_enabled', '{"enabled":true}'::jsonb),
  ('32222222-2222-2222-2222-222222222222', 'uom_engine_enabled', '{"enabled":false}'::jsonb);

INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('3c000000-0000-0000-0000-000000000001', 'U145_COUNT', 'U145 Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  ('34000000-0000-0000-0000-000000000001', '3c000000-0000-0000-0000-000000000001',
   'U145_PCS', 'U145 Piece', 'u145', 1, true, false, NULL, true);

INSERT INTO public.products
  (id, org_id, code, name, unit, base_uom_id, uom_migration_status) VALUES
  ('3d000000-0000-0000-0000-000000000001', '31111111-1111-1111-1111-111111111111',
   'U145-M', 'Mapped product', 'pcs', '34000000-0000-0000-0000-000000000001', 'MAPPED'),
  ('3d000000-0000-0000-0000-000000000002', '31111111-1111-1111-1111-111111111111',
   'U145-U', 'Unmapped product', 'pcs', NULL, 'NO_UNIT'),
  ('3d000000-0000-0000-0000-000000000003', '32222222-2222-2222-2222-222222222222',
   'U145-L', 'Legacy flag-off product', 'pcs', NULL, 'NO_UNIT');

INSERT INTO public.warehouses (id, org_id, code, name) VALUES
  ('37000000-0000-0000-0000-000000000001', '31111111-1111-1111-1111-111111111111', 'U145-WA', 'U145 Warehouse A'),
  ('37000000-0000-0000-0000-000000000002', '32222222-2222-2222-2222-222222222222', 'U145-WB', 'U145 Warehouse B');

INSERT INTO public.stock_adjustments
  (id, organization_id, org_id, adjustment_number, adjustment_date, posting_date,
   adjustment_type, reason, status, total_items, created_by) VALUES
  ('38000000-0000-0000-0000-000000000001', '31111111-1111-1111-1111-111111111111',
   '31111111-1111-1111-1111-111111111111', 'U145-ADJ-A', current_date, current_date,
   'PHYSICAL_COUNT', 'acceptance', 'DRAFT', 0, '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('38000000-0000-0000-0000-000000000002', '32222222-2222-2222-2222-222222222222',
   '32222222-2222-2222-2222-222222222222', 'U145-ADJ-B', current_date, current_date,
   'PHYSICAL_COUNT', 'legacy flag off', 'DRAFT', 0, '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

COMMIT;

SELECT set_config('request.jwt.claim.sub', '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- Structural tenant consistency is enforced regardless of rollout state.
SELECT pg_temp.expect_any_error(
  $$ INSERT INTO public.stock_adjustment_items
     (adjustment_id,organization_id,product_id,warehouse_id,current_qty,new_qty,difference_qty,current_rate,value_difference)
     VALUES ('38000000-0000-0000-0000-000000000002','31111111-1111-1111-1111-111111111111',
             '3d000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',0,1,1,1,1) $$,
  ARRAY['ADJUSTMENT_ORG_MISMATCH']);
SELECT pg_temp.expect_any_error(
  $$ INSERT INTO public.stock_adjustment_items
     (adjustment_id,organization_id,product_id,warehouse_id,current_qty,new_qty,difference_qty,current_rate,value_difference)
     VALUES ('38000000-0000-0000-0000-000000000001','31111111-1111-1111-1111-111111111111',
             '3d000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000002',0,1,1,1,1) $$,
  ARRAY['WAREHOUSE_NOT_FOUND_OR_WRONG_ORG']);

-- Flag ON: mapped product line is accepted.
INSERT INTO public.stock_adjustment_items
  (adjustment_id, organization_id, product_id, warehouse_id,
   current_qty, new_qty, difference_qty, current_rate, value_difference)
VALUES
  ('38000000-0000-0000-0000-000000000001', '31111111-1111-1111-1111-111111111111',
   '3d000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001',
   0, 1, 1, 1, 1);

-- Flag ON: unmapped and cross-org products are rejected at draft-line write time.
SELECT pg_temp.expect_any_error(
  $$ INSERT INTO public.stock_adjustment_items
     (adjustment_id,organization_id,product_id,warehouse_id,current_qty,new_qty,difference_qty,current_rate,value_difference)
     VALUES ('38000000-0000-0000-0000-000000000001','31111111-1111-1111-1111-111111111111',
             '3d000000-0000-0000-0000-000000000002','37000000-0000-0000-0000-000000000001',0,1,1,1,1) $$,
  ARRAY['PRODUCT_UOM_NOT_MAPPED', 'PRODUCT_BASE_UOM_REQUIRED']);
SELECT pg_temp.expect_any_error(
  $$ INSERT INTO public.stock_adjustment_items
     (adjustment_id,organization_id,product_id,warehouse_id,current_qty,new_qty,difference_qty,current_rate,value_difference)
     VALUES ('38000000-0000-0000-0000-000000000001','31111111-1111-1111-1111-111111111111',
             '3d000000-0000-0000-0000-000000000003','37000000-0000-0000-0000-000000000001',0,1,1,1,1) $$,
  ARRAY['PRODUCT_UOM_NOT_MAPPED', 'PRODUCT_BASE_UOM_REQUIRED', 'ADJUSTMENT_PRODUCT_NOT_FOUND_OR_WRONG_ORG']);

-- Flag ON: mapped SLE is accepted; unmapped SLE is rejected immediately.
INSERT INTO public.stock_ledger_entries
  (org_id, product_id, warehouse_id, posting_date, voucher_type, voucher_id,
   actual_qty, qty_after_transaction, valuation_rate, stock_value, stock_value_difference)
VALUES
  ('31111111-1111-1111-1111-111111111111', '3d000000-0000-0000-0000-000000000001',
   '37000000-0000-0000-0000-000000000001', current_date, 'U145 Test',
   '39000000-0000-0000-0000-000000000001', 1, 1, 1, 1, 1);
SELECT pg_temp.expect_any_error(
  $$ INSERT INTO public.stock_ledger_entries
     (org_id,product_id,warehouse_id,posting_date,voucher_type,voucher_id,
      actual_qty,qty_after_transaction,valuation_rate,stock_value,stock_value_difference)
     VALUES ('31111111-1111-1111-1111-111111111111','3d000000-0000-0000-0000-000000000002',
             '37000000-0000-0000-0000-000000000001',current_date,'U145 Test',
             '39000000-0000-0000-0000-000000000002',1,1,1,1,1) $$,
  ARRAY['PRODUCT_UOM_NOT_MAPPED', 'PRODUCT_BASE_UOM_REQUIRED']);

-- Isolate migration 145's flag-off behavior from migration 134's unconditional UoM
-- normalization trigger. Structural tenant checks remain active.
ALTER TABLE public.stock_adjustment_items DISABLE TRIGGER normalize_stock_adjustment_uom;
INSERT INTO public.stock_adjustment_items
  (adjustment_id, organization_id, product_id, warehouse_id,
   current_qty, new_qty, difference_qty, current_rate, value_difference)
VALUES
  ('38000000-0000-0000-0000-000000000002', '32222222-2222-2222-2222-222222222222',
   '3d000000-0000-0000-0000-000000000003', '37000000-0000-0000-0000-000000000002',
   0, 1, 1, 1, 1);
ALTER TABLE public.stock_adjustment_items ENABLE TRIGGER normalize_stock_adjustment_uom;

\echo '✅ acceptance_145_uom_stock_write_guard: all assertions passed'
