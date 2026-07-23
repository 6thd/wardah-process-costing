-- Acceptance test for migration 144 (products_base_uom_change_guard).
-- Runs against the full Fresh DB chain. RLS is bypassed by postgres, while auth.uid()
-- is deliberately switched between an org admin, an ordinary member, and a nonmember
-- so trigger/RPC authorization is exercised explicitly.

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
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected [%] but got [%]',
        p_sql, p_needle, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected error [%] but it succeeded',
      p_sql, p_needle;
  END IF;
END $$;

BEGIN;

INSERT INTO public.organizations (id, code, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ORGA', 'Org A'),
  ('22222222-2222-2222-2222-222222222222', 'ORGB', 'Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('a0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', true, true, 'admin'),
  ('a0000000-0000-0000-0000-000000000002',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111', true, false, 'member');

-- Product INSERTs carrying a base unit are now admin-guarded by the trigger.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'COUNT_T', 'Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  ('40000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1',
   'PCS_T', 'Piece', 'pcs', 1, true, false, NULL, true),
  ('40000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000c1',
   'DOZ_T', 'Dozen', 'doz', 12, false, false, NULL, true),
  ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1',
   'SPEC_T', 'Specific', 'sp', NULL, false, true, NULL, true),
  ('60000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1',
   'OBX_T', 'Org B Box', 'obx', 5, false, false,
   '22222222-2222-2222-2222-222222222222', true),
  ('60000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   'OAX_T', 'Org A Box', 'oax', 3, false, false,
   '11111111-1111-1111-1111-111111111111', true);

INSERT INTO public.warehouses (id, org_id, code, name) VALUES
  ('70000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'WHA', 'Warehouse A');

INSERT INTO public.products
  (id, org_id, code, name, unit, base_uom_id, uom_migration_status) VALUES
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'PU1', 'Unset 1', 'box', NULL, 'NO_UNIT'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'PU2', 'Unset 2', 'box', NULL, 'NO_UNIT'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'PU3', 'Unset 3', 'box', NULL, 'NO_UNIT'),
  ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'PM1', 'Mapped w/ SLE', 'pcs',
   '40000000-0000-0000-0000-000000000001', 'MAPPED'),
  ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'PM2', 'Mapped no SLE', 'pcs',
   '40000000-0000-0000-0000-000000000001', 'MAPPED'),
  ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'PU6', 'Unset 6', 'box', NULL, 'NO_UNIT');

INSERT INTO public.stock_ledger_entries
  (org_id, product_id, warehouse_id, posting_date, voucher_type, voucher_id,
   actual_qty, qty_after_transaction, valuation_rate, stock_value, stock_value_difference) VALUES
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004',
   '70000000-0000-0000-0000-000000000001', current_date, 'Test',
   '7f000000-0000-0000-0000-000000000001', 1, 1, 1, 1, 1);

INSERT INTO public.items (id, org_id, code, name, base_uom_id, uom_migration_status) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'IT1', 'Item 1', NULL, 'NO_UNIT'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'IT2', 'Item 2', NULL, 'NO_UNIT');

INSERT INTO public.item_product_map (id, org_id, item_id, product_id, is_active) VALUES
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', true);

INSERT INTO public.bom_headers (id, org_id, bom_number, item_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'BOM-1', 'e0000000-0000-0000-0000-000000000001');

ALTER TABLE public.bom_lines DISABLE TRIGGER USER;
INSERT INTO public.bom_lines
  (id, org_id, bom_id, item_id, quantity, uom_id, product_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   1, NULL, NULL);
ALTER TABLE public.bom_lines ENABLE TRIGGER USER;

INSERT INTO public.uom_backfill_issues
  (id, org_id, source_table, source_id, issue_code, status) VALUES
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'products', 'd0000000-0000-0000-0000-000000000001', 'UNIT_MISSING', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'bom_lines', '10000000-0000-0000-0000-000000000001', 'BOM_UOM_UNRESOLVED', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'items', 'e0000000-0000-0000-0000-000000000001', 'UNIT_MISSING', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'products', 'd0000000-0000-0000-0000-000000000005', 'UNIT_MISSING', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'items', 'e0000000-0000-0000-0000-000000000001', 'UNIT_AMBIGUOUS_OR_UNKNOWN', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'items', 'e0000000-0000-0000-0000-000000000002', 'UNIT_MISSING', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'legacy_unknown', 'd0000000-0000-0000-0000-000000000001', 'UNIT_MISSING', 'OPEN');

COMMIT;

-- First assignment through the legal RPC.
SELECT public.rpc_assign_product_base_uom(
  '11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = 'd0000000-0000-0000-0000-000000000001'
      AND base_uom_id = '40000000-0000-0000-0000-000000000001'
      AND uom_migration_status = 'MAPPED'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: product not MAPPED after first assignment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.uom_backfill_issues
    WHERE id = 'f0000000-0000-0000-0000-000000000001'
      AND status = 'RESOLVED'
      AND resolved_uom_id = '40000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: product issue not resolved from assigned unit';
  END IF;
END $$;

-- Idempotent same-unit reconciliation succeeds; reinterpretation does not.
SELECT public.rpc_assign_product_base_uom(
  '11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000005',
  '40000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000002') $$,
  'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP');
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002') $$,
  'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP');

-- Tenant and product-specific validation on unresolved products.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001') $$,
  'UOM_NOT_FOUND_OR_INACTIVE');
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001') $$,
  'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC');
SELECT public.rpc_assign_product_base_uom(
  '11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000006',
  '60000000-0000-0000-0000-0000000000a1');

-- Direct writes obey the same admin and first-assignment rules.
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id = NULL WHERE id = 'd0000000-0000-0000-0000-000000000005' $$,
  'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP');
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id = '40000000-0000-0000-0000-000000000002' WHERE id = 'd0000000-0000-0000-0000-000000000005' $$,
  'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP');

SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id = '40000000-0000-0000-0000-000000000001' WHERE id = 'd0000000-0000-0000-0000-000000000002' $$,
  'NOT_ORG_ADMIN');

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
UPDATE public.products
SET base_uom_id = '40000000-0000-0000-0000-000000000001'
WHERE id = 'd0000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = 'd0000000-0000-0000-0000-000000000002'
      AND uom_migration_status = 'MAPPED'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: direct admin first assignment did not normalize MAPPED';
  END IF;
END $$;

-- Ignore requires a nonblank note.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_ignore_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000005',NULL) $$,
  'UOM_BACKFILL_IGNORE_NOTE_REQUIRED');
SELECT public.rpc_ignore_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-000000000005',
  'intentional');

-- Source-aware resolution and exact unit matching.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000002',NULL,NULL) $$,
  'UOM_BACKFILL_SOURCE_NOT_RESOLVED');

ALTER TABLE public.bom_lines DISABLE TRIGGER USER;
UPDATE public.bom_lines
SET uom_id = '40000000-0000-0000-0000-000000000001',
    product_id = 'd0000000-0000-0000-0000-000000000001'
WHERE id = '10000000-0000-0000-0000-000000000001';
ALTER TABLE public.bom_lines ENABLE TRIGGER USER;

SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002',NULL) $$,
  'UOM_BACKFILL_RESOLUTION_UOM_MISMATCH');
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001',
  'bom fixed');

SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000003',NULL,NULL) $$,
  'UOM_BACKFILL_SOURCE_NOT_RESOLVED');
UPDATE public.items
SET base_uom_id = '40000000-0000-0000-0000-000000000001',
    uom_migration_status = 'MAPPED'
WHERE id = 'e0000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002',NULL) $$,
  'UOM_BACKFILL_RESOLUTION_UOM_MISMATCH');
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-000000000003',
  NULL,
  'item mapped');

SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-000000000006',
  '40000000-0000-0000-0000-000000000001',
  'resolved via active bridge');

SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002',NULL) $$,
  'UOM_BACKFILL_RESOLUTION_UOM_MISMATCH');
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111',
  'f0000000-0000-0000-0000-000000000004',
  '40000000-0000-0000-0000-000000000001',
  'matches product base');

SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001',NULL) $$,
  'UOM_BACKFILL_SOURCE_UNSUPPORTED');

-- Nonmember cannot use the RPC.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001') $$,
  'NOT_ORG_MEMBER');

\echo '✅ acceptance_144_base_uom_guard: all assertions passed'
