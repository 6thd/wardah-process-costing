-- Acceptance test for migration 144 (products_base_uom_change_guard).
-- Runs against the freshly built `wardah_fresh` DB after the full migration chain,
-- as a superuser (RLS bypassed). auth.uid() is driven through the shim GUC
-- `request.jwt.claim.sub`. Any failed assertion RAISEs and, with psql
-- ON_ERROR_STOP=1, fails the CI job.

\set ON_ERROR_STOP on

-- ── assertion helper ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected [%] but got [%]', p_sql, p_needle, SQLERRM;
    END IF;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: for [%] expected error [%] but it succeeded', p_sql, p_needle;
  END IF;
END $$;

-- ── seed ─────────────────────────────────────────────────────────────────────
BEGIN;

-- Organizations
INSERT INTO public.organizations (id, code, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ORGA', 'Org A'),
  ('22222222-2222-2222-2222-222222222222', 'ORGB', 'Org B');

-- Admin of Org A only
INSERT INTO public.user_organizations (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('a0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', true, true, 'admin');

-- UoM category + units
INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'COUNT_T', 'Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  -- shared system base unit
  ('40000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1',
   'PCS_T', 'Piece', 'pcs', 1, true, false, NULL, true),
  -- shared non-base unit (used as a valid change target)
  ('40000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000c1',
   'DOZ_T', 'Dozen', 'doz', 12, false, false, NULL, true),
  -- shared product-specific unit (never a legal base)
  ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1',
   'SPEC_T', 'Specific', 'sp', NULL, false, true, NULL, true),
  -- Org B owned unit (must be invisible to Org A operations)
  ('60000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1',
   'OBX_T', 'Org B Box', 'obx', 5, false, false,
   '22222222-2222-2222-2222-222222222222', true),
  -- Org A owned unit (must be accepted for Org A operations)
  ('60000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   'OAX_T', 'Org A Box', 'oax', 3, false, false,
   '11111111-1111-1111-1111-111111111111', true);

-- Warehouse for the ledger movement
INSERT INTO public.warehouses (id, org_id, code, name) VALUES
  ('70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'WHA', 'Warehouse A');

-- Products in Org A
INSERT INTO public.products (id, org_id, code, name, unit, base_uom_id, uom_migration_status) VALUES
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'PU1', 'Unset 1', 'box', NULL, 'NO_UNIT'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'PU2', 'Unset 2', 'box', NULL, 'NO_UNIT'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'PU3', 'Unset 3', 'box', NULL, 'NO_UNIT'),
  ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'PM1', 'Mapped w/ SLE', 'pcs',
   '40000000-0000-0000-0000-000000000001', 'MAPPED'),
  ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'PM2', 'Mapped no SLE', 'pcs',
   '40000000-0000-0000-0000-000000000001', 'MAPPED'),
  ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'PU6', 'Unset 6', 'box', NULL, 'NO_UNIT');

-- Movement on PM1 → base unit becomes locked
INSERT INTO public.stock_ledger_entries
  (org_id, product_id, warehouse_id, posting_date, voucher_type, voucher_id,
   actual_qty, qty_after_transaction, valuation_rate, stock_value, stock_value_difference) VALUES
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004',
   '70000000-0000-0000-0000-000000000001', current_date, 'Test',
   '7f000000-0000-0000-0000-000000000001', 1, 1, 1, 1, 1);

-- Items for the items resolution paths: IT1 resolved by mapping the item itself,
-- IT2 resolved via an item_product_map bridge to a MAPPED product.
INSERT INTO public.items (id, org_id, code, name, base_uom_id, uom_migration_status) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'IT1', 'Item 1', NULL, 'NO_UNIT'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'IT2', 'Item 2', NULL, 'NO_UNIT');
-- Bridge IT2 → PU1 (which becomes MAPPED after the first assign below).
INSERT INTO public.item_product_map (id, org_id, item_id, product_id, is_active) VALUES
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', true);
INSERT INTO public.bom_headers (id, org_id, bom_number, item_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'BOM-1',
   'e0000000-0000-0000-0000-000000000001');
-- Simulate a pre-138 unresolved BOM line (uom_id/product_id NULL). The normalize
-- and item→product resolution triggers would otherwise force-resolve/reject it, so
-- user triggers are disabled only for this seed insert.
ALTER TABLE public.bom_lines DISABLE TRIGGER USER;
INSERT INTO public.bom_lines (id, org_id, bom_id, item_id, quantity, uom_id, product_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 1, NULL, NULL);
ALTER TABLE public.bom_lines ENABLE TRIGGER USER;

-- Open backfill issues
INSERT INTO public.uom_backfill_issues (id, org_id, source_table, source_id, issue_code, status) VALUES
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'products',
   'd0000000-0000-0000-0000-000000000001', 'UNIT_MISSING', 'OPEN'),   -- auto-resolved on assign
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'bom_lines',
   '10000000-0000-0000-0000-000000000001', 'BOM_UOM_UNRESOLVED', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'items',
   'e0000000-0000-0000-0000-000000000001', 'UNIT_MISSING', 'OPEN'),
  ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'products',
   'd0000000-0000-0000-0000-000000000005', 'UNIT_MISSING', 'OPEN'),   -- for cross-org resolved_uom test
  ('f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'items',
   'e0000000-0000-0000-0000-000000000001', 'UNIT_AMBIGUOUS_OR_UNKNOWN', 'OPEN'), -- ignore path
  ('f0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'items',
   'e0000000-0000-0000-0000-000000000002', 'UNIT_MISSING', 'OPEN');  -- item_product_map bridge path

COMMIT;

-- Impersonate the Org A admin for RPC calls.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- ── RPC: assign base unit ────────────────────────────────────────────────────
-- Positive: unset → shared unit succeeds, marks MAPPED, auto-resolves the issue.
SELECT public.rpc_assign_product_base_uom(
  '11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products
    WHERE id='d0000000-0000-0000-0000-000000000001'
      AND base_uom_id='40000000-0000-0000-0000-000000000001'
      AND uom_migration_status='MAPPED') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: product not MAPPED after assign';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.uom_backfill_issues
    WHERE id='f0000000-0000-0000-0000-000000000001' AND status='RESOLVED') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: products issue not auto-resolved on assign';
  END IF;
END $$;

-- Positive: the org's own custom unit is accepted as a base unit.
SELECT public.rpc_assign_product_base_uom(
  '11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000006',
  '60000000-0000-0000-0000-0000000000a1');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products
    WHERE id='d0000000-0000-0000-0000-000000000006'
      AND base_uom_id='60000000-0000-0000-0000-0000000000a1'
      AND uom_migration_status='MAPPED') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org-owned unit not accepted as base';
  END IF;
END $$;

-- Cross-org unit rejected (Org B unit is invisible to Org A).
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000001') $$,
  'UOM_NOT_FOUND_OR_INACTIVE');

-- Product-specific unit rejected.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001') $$,
  'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC');

-- Locked once movements exist (PM1 has an SLE).
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002') $$,
  'PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS');

-- ── Trigger backstop: direct UPDATE ──────────────────────────────────────────
-- Clearing the base unit is rejected.
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id=NULL WHERE id='d0000000-0000-0000-0000-000000000005' $$,
  'PRODUCT_BASE_UOM_REQUIRED');

-- Cross-org unit rejected at the trigger.
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id='60000000-0000-0000-0000-000000000001' WHERE id='d0000000-0000-0000-0000-000000000005' $$,
  'PRODUCT_BASE_UOM_INVALID');

-- Product-specific unit rejected at the trigger.
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id='50000000-0000-0000-0000-000000000001' WHERE id='d0000000-0000-0000-0000-000000000005' $$,
  'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC');

-- Change after movements rejected at the trigger.
SELECT pg_temp.expect_error(
  $$ UPDATE public.products SET base_uom_id='40000000-0000-0000-0000-000000000002' WHERE id='d0000000-0000-0000-0000-000000000004' $$,
  'PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS');

-- Valid change (no movements, shared unit) succeeds.
UPDATE public.products SET base_uom_id='40000000-0000-0000-0000-000000000002'
WHERE id='d0000000-0000-0000-0000-000000000005';

-- ── RPC: ignore requires a note ──────────────────────────────────────────────
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_ignore_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000005', NULL) $$,
  'UOM_BACKFILL_IGNORE_NOTE_REQUIRED');
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_ignore_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000005', '   ') $$,
  'UOM_BACKFILL_IGNORE_NOTE_REQUIRED');
SELECT public.rpc_ignore_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000005', 'intentional');

-- ── RPC: resolve only after the source is fixed ──────────────────────────────
-- BOM line still unresolved → reject.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000002', NULL, NULL) $$,
  'UOM_BACKFILL_SOURCE_NOT_RESOLVED');
-- Simulate the repair (uom_id + product_id populated), then resolve succeeds.
-- User triggers are disabled so the test sets the repaired columns directly, since
-- this item has no item_product_map (the real repair path is out of scope here).
ALTER TABLE public.bom_lines DISABLE TRIGGER USER;
UPDATE public.bom_lines
SET uom_id='40000000-0000-0000-0000-000000000001', product_id='d0000000-0000-0000-0000-000000000001'
WHERE id='10000000-0000-0000-0000-000000000001';
ALTER TABLE public.bom_lines ENABLE TRIGGER USER;
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000002', NULL, 'bom fixed');

-- Item still unmapped → reject; then map it → resolve succeeds.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000003', NULL, NULL) $$,
  'UOM_BACKFILL_SOURCE_NOT_RESOLVED');
UPDATE public.items
SET base_uom_id='40000000-0000-0000-0000-000000000001', uom_migration_status='MAPPED'
WHERE id='e0000000-0000-0000-0000-000000000001';
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000003', NULL, 'item mapped');

-- Items resolution via the item_product_map bridge: IT2 itself is NOT MAPPED, but
-- it is actively mapped to PU1 which is MAPPED → resolve succeeds through the bridge.
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000006', NULL, 'resolved via bridge');
DO $$
BEGIN
  IF (SELECT uom_migration_status FROM public.items WHERE id='e0000000-0000-0000-0000-000000000002') <> 'NO_UNIT' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: bridge test precondition — IT2 should be unmapped itself';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.uom_backfill_issues
    WHERE id='f0000000-0000-0000-0000-000000000006' AND status='RESOLVED') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: bridge resolve did not resolve the issue';
  END IF;
END $$;

-- Products resolve: cross-org resolution unit rejected, matching unit accepted.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_resolve_uom_backfill_issue('11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000001', NULL) $$,
  'UOM_NOT_FOUND_OR_INACTIVE');
SELECT public.rpc_resolve_uom_backfill_issue(
  '11111111-1111-1111-1111-111111111111','f0000000-0000-0000-0000-000000000004',
  '40000000-0000-0000-0000-000000000002', 'matches product base');

-- Non-admin / non-member is refused by the guard.
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_assign_product_base_uom('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001') $$,
  'NOT_ORG_MEMBER');

\echo '✅ acceptance_144_base_uom_guard: all assertions passed'
