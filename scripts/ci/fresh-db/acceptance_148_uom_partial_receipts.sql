-- Acceptance for migration 148.
-- Proves the purchase-order approval gate, immutable PO snapshot receiving,
-- fail-closed handling of ambiguous legacy payloads and missing snapshots, and
-- the quality-aware contract in which only accepted quantity closes a purchase
-- order while rejected quantity releases contract balance for a redelivery.
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

CREATE OR REPLACE FUNCTION pg_temp.assert_line(
  p_line_id uuid,
  p_received numeric,
  p_accepted numeric,
  p_rejected numeric,
  p_label text
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v public.purchase_order_lines%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v FROM public.purchase_order_lines WHERE id = p_line_id;
  IF COALESCE(v.received_quantity,0) <> p_received
     OR COALESCE(v.accepted_quantity,0) <> p_accepted
     OR COALESCE(v.rejected_quantity,0) <> p_rejected THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL [%]: expected received=%/accepted=%/rejected=%, got %/%/%',
      p_label, p_received, p_accepted, p_rejected,
      v.received_quantity, v.accepted_quantity, v.rejected_quantity;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_po_status(p_po_id uuid, p_status text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO STRICT v_status FROM public.purchase_orders WHERE id = p_po_id;
  IF v_status <> p_status THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL [%]: expected PO status %, got %', p_label, p_status, v_status;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_stock(p_product uuid, p_warehouse uuid, p_qty numeric, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_qty numeric;
BEGIN
  SELECT COALESCE(actual_qty,0) INTO v_qty
  FROM public.bins WHERE product_id = p_product AND warehouse_id = p_warehouse;
  IF COALESCE(v_qty,0) <> p_qty THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL [%]: expected stock %, got %', p_label, p_qty, COALESCE(v_qty,0);
  END IF;
END $$;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'uom148-member@example.test'),
  ('48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'uom148-admin@example.test'),
  ('48cccccc-cccc-cccc-cccc-cccccccccccc', 'uom148-orgb@example.test');

INSERT INTO public.organizations (id, code, name) VALUES
  ('48111111-1111-1111-1111-111111111111', 'U148A', 'UoM 148 Org A'),
  ('48222222-2222-2222-2222-222222222222', 'U148B', 'UoM 148 Org B');

INSERT INTO public.user_organizations
  (id, user_id, org_id, is_active, is_org_admin, role) VALUES
  ('48000000-0000-0000-0000-000000000001',
   '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '48111111-1111-1111-1111-111111111111', true, false, 'member'),
  ('48000000-0000-0000-0000-000000000002',
   '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '48111111-1111-1111-1111-111111111111', true, true, 'admin'),
  ('48000000-0000-0000-0000-000000000003',
   '48cccccc-cccc-cccc-cccc-cccccccccccc',
   '48222222-2222-2222-2222-222222222222', true, true, 'admin');

-- Org A has the rollout flag on; Org B deliberately does not.
INSERT INTO public.org_settings (org_id, key, value) VALUES
  ('48111111-1111-1111-1111-111111111111', 'uom_engine_enabled', '{"enabled":true}'::jsonb),
  ('48222222-2222-2222-2222-222222222222', 'uom_engine_enabled', '{"enabled":false}'::jsonb);

INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('48c00000-0000-0000-0000-000000000001', 'U148_COUNT', 'U148 Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  ('48400000-0000-0000-0000-000000000001',
   '48c00000-0000-0000-0000-000000000001',
   'U148_PCS', 'U148 Piece', 'u148p', 1, true, false, NULL, true),
  ('48400000-0000-0000-0000-000000000002',
   '48c00000-0000-0000-0000-000000000001',
   'U148_CTN', 'U148 Carton', 'u148c', 12, false, false, NULL, true);

INSERT INTO public.products
  (id, org_id, code, name, unit, base_uom_id, uom_migration_status, is_active,
   valuation_method) VALUES
  ('48d00000-0000-0000-0000-000000000001',
   '48111111-1111-1111-1111-111111111111',
   'U148-A', 'Mapped product A', 'pcs',
   '48400000-0000-0000-0000-000000000001', 'MAPPED', true, 'Weighted Average'),
  ('48d00000-0000-0000-0000-000000000002',
   '48111111-1111-1111-1111-111111111111',
   'U148-BASE', 'Base-unit product', 'pcs',
   '48400000-0000-0000-0000-000000000001', 'MAPPED', true, 'Weighted Average');

INSERT INTO public.product_uom_conversions
  (id, org_id, product_id, uom_id, factor_to_base,
   is_active, use_for_purchase, use_for_sale, valid_from) VALUES
  ('48e00000-0000-0000-0000-000000000001',
   '48111111-1111-1111-1111-111111111111',
   '48d00000-0000-0000-0000-000000000001',
   '48400000-0000-0000-0000-000000000002',
   12, true, true, false, now() - interval '1 day');

INSERT INTO public.vendors (id, org_id, code, name, is_active) VALUES
  ('48f00000-0000-0000-0000-000000000001',
   '48111111-1111-1111-1111-111111111111', 'U148-VA', 'Vendor A', true);

INSERT INTO public.warehouses (id, org_id, code, name) VALUES
  ('48a00000-0000-0000-0000-000000000001',
   '48111111-1111-1111-1111-111111111111', 'U148-WH', 'Warehouse A');

-- Minimal legal accounting map so the atomic GRNI journal can post.
INSERT INTO public.gl_accounts
  (org_id, code, name, category, subtype, normal_balance, allow_posting) VALUES
  ('48111111-1111-1111-1111-111111111111', '131100', 'Raw material inventory',
   'ASSET', 'CURRENT_ASSET', 'DEBIT', true),
  ('48111111-1111-1111-1111-111111111111', '210150', 'Goods received not invoiced',
   'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT', true);

INSERT INTO public.gl_event_mappings
  (org_id, event_code, work_center_code, debit_account_code, credit_account_code, is_active) VALUES
  ('48111111-1111-1111-1111-111111111111', 'GR_RECEIPT', NULL, '131100', '210150', true);

COMMIT;

-- The additive quality columns and their guard must exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_order_lines'
      AND column_name='accepted_quantity'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_order_lines'
      AND column_name='rejected_quantity'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: quality quantity columns missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.purchase_order_lines'::regclass
      AND conname='purchase_order_lines_quality_quantity_check'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: quality quantity constraint missing';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

-- ---------------------------------------------------------------------------
-- Order under test: 10 cartons of 12 pieces at 120 per carton.
-- Trigger 139 normalizes to 120 base pieces at 10 each.
-- ---------------------------------------------------------------------------
SELECT public.rpc_create_uom_purchase_order(
  jsonb_build_object(
    'org_id', '48111111-1111-1111-1111-111111111111',
    'vendor_id', '48f00000-0000-0000-0000-000000000001',
    'order_number', 'U148-PO-MAIN',
    'order_date', '2026-07-24',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', '48d00000-0000-0000-0000-000000000001',
      'uom_id', '48400000-0000-0000-0000-000000000002',
      'qty_entered', 10,
      'unit_price_entered', 120,
      'discount_percentage', 0,
      'tax_percentage', 15
    ))
  )
);

CREATE TEMP TABLE t148 AS
SELECT po.id AS po_id, pol.id AS pol_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
WHERE po.org_id='48111111-1111-1111-1111-111111111111'
  AND po.order_number='U148-PO-MAIN';

DO $$
DECLARE v public.purchase_order_lines%ROWTYPE; v_po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT pol.* INTO STRICT v FROM public.purchase_order_lines pol
  JOIN t148 t ON t.pol_id = pol.id;
  SELECT po.* INTO STRICT v_po FROM public.purchase_orders po JOIN t148 t ON t.po_id = po.id;

  IF v.quantity <> 120 OR v.conversion_factor_snapshot <> 12
     OR v.qty_entered <> 10 OR v.unit_price <> 10 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: PO snapshot mismatch: %', row_to_json(v);
  END IF;
  -- Migration 147 creates orders as draft; nothing is receivable yet.
  IF v_po.status <> 'draft' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected draft order, got %', v_po.status;
  END IF;
  -- Backfilled quality columns start at zero for a brand new line.
  PERFORM pg_temp.assert_line(v.id, 0, 0, 0, 'new line');
END $$;

-- ---------------------------------------------------------------------------
-- 1. Approval gate.
-- ---------------------------------------------------------------------------

-- A draft order cannot be received at all.
DO $$
DECLARE v_po uuid; v_pol uuid;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'qty_entered',1,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'PO_NOT_RECEIVABLE');
END $$;

-- A plain member cannot approve.
DO $$
DECLARE v_po uuid;
BEGIN
  SELECT po_id INTO v_po FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_approve_purchase_order(
      '48111111-1111-1111-1111-111111111111'::uuid, %L::uuid) $q$, v_po),
    'ORG');
END $$;

-- A member may submit.
SELECT public.rpc_submit_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid, (SELECT po_id FROM t148));
SELECT pg_temp.assert_po_status((SELECT po_id FROM t148), 'submitted', 'after submit');

-- Submitting twice is refused rather than silently repeated.
DO $$
DECLARE v_po uuid;
BEGIN
  SELECT po_id INTO v_po FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_submit_purchase_order(
      '48111111-1111-1111-1111-111111111111'::uuid, %L::uuid) $q$, v_po),
    'PO_NOT_SUBMITTABLE');
END $$;

-- A member of another organization cannot touch this order.
SELECT set_config('request.jwt.claim.sub', '48cccccc-cccc-cccc-cccc-cccccccccccc', false);
DO $$
DECLARE v_po uuid;
BEGIN
  SELECT po_id INTO v_po FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_approve_purchase_order(
      '48111111-1111-1111-1111-111111111111'::uuid, %L::uuid) $q$, v_po),
    'ORG');
END $$;

-- Org B cannot read Org A's receivable orders either.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_list_uom_receivable_purchase_orders(
    '48111111-1111-1111-1111-111111111111') $$,
  'ORG');

-- The rollout flag is off for Org B: its own read is fail-closed.
SELECT pg_temp.expect_error(
  $$ SELECT public.rpc_list_uom_receivable_purchase_orders(
    '48222222-2222-2222-2222-222222222222') $$,
  'UOM_ENGINE_NOT_ENABLED_FOR_ORG');

-- The organization admin approves.
SELECT set_config('request.jwt.claim.sub', '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT public.rpc_approve_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid, (SELECT po_id FROM t148));
SELECT pg_temp.assert_po_status((SELECT po_id FROM t148), 'approved', 'after approve');

-- An approved order is not approvable again.
DO $$
DECLARE v_po uuid;
BEGIN
  SELECT po_id INTO v_po FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_approve_purchase_order(
      '48111111-1111-1111-1111-111111111111'::uuid, %L::uuid) $q$, v_po),
    'PO_NOT_APPROVABLE');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Receivable read exposes contract balance in both units.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_orders jsonb; v_line jsonb;
BEGIN
  v_orders := public.rpc_list_uom_receivable_purchase_orders(
    '48111111-1111-1111-1111-111111111111');
  IF jsonb_array_length(v_orders) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected one receivable order, got %', v_orders;
  END IF;
  v_line := v_orders -> 0 -> 'lines' -> 0;
  IF (v_line ->> 'ordered_qty_base')::numeric <> 120
     OR (v_line ->> 'ordered_qty_entered')::numeric <> 10
     OR (v_line ->> 'remaining_qty_base')::numeric <> 120
     OR (v_line ->> 'remaining_qty_entered')::numeric <> 10
     OR (v_line ->> 'conversion_factor_snapshot')::numeric <> 12
     OR (v_line ->> 'unit_cost_entered')::numeric <> 120
     OR (v_line ->> 'unit_cost_base')::numeric <> 10 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: receivable line mismatch: %', v_line;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Ambiguous legacy payload is refused, never silently inflated.
-- ---------------------------------------------------------------------------
-- The pre-148 UI sends base quantities in received_quantity while the snapshot
-- contract is expressed in entered units. At factor 12 that is a 12x inflation
-- if guessed, so it must fail closed.
DO $$
DECLARE v_po uuid; v_pol uuid;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'received_quantity',48,
        'unit_cost',10,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'RECEIPT_SNAPSHOT_CONTRACT_REQUIRED');
END $$;

-- Snapshot mismatches are refused.
DO $$
DECLARE v_po uuid; v_pol uuid;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'uom_id','48400000-0000-0000-0000-000000000001',
        'qty_entered',1,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'RECEIPT_UOM_MISMATCH');

  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'qty_entered',1,
        'unit_cost_entered',99,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'RECEIPT_COST_MISMATCH');
END $$;

-- Nothing above may have created a document.
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.goods_receipts
  WHERE org_id='48111111-1111-1111-1111-111111111111';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: refused receipts left % header(s) behind', v_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Partial accepted receipt: 4 cartons = 48 base pieces.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_po uuid; v_pol uuid; v_res jsonb;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  v_res := public.rpc_post_goods_receipt(jsonb_build_object(
    'tenant_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','48f00000-0000-0000-0000-000000000001',
    'purchase_order_id',v_po,
    'warehouse_id','48a00000-0000-0000-0000-000000000001',
    'receipt_date','2026-07-24',
    'idempotency_key','U148-GR-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id','48d00000-0000-0000-0000-000000000001',
      'purchase_order_line_id',v_pol,
      'uom_id','48400000-0000-0000-0000-000000000002',
      'qty_entered',4,
      'unit_cost_entered',120,
      'quality_status','accepted'))));

  IF NOT COALESCE((v_res->>'success')::boolean,false)
     OR (v_res->>'total_value')::numeric <> 480
     OR NOT COALESCE((v_res->>'quality_aware_contract')::boolean,false) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: accepted receipt result mismatch: %', v_res;
  END IF;

  PERFORM pg_temp.assert_line(v_pol, 48, 48, 0, 'after accepted 4 cartons');
  PERFORM pg_temp.assert_po_status(v_po, 'partially_received', 'after accepted 4 cartons');
  PERFORM pg_temp.assert_stock(
    '48d00000-0000-0000-0000-000000000001',
    '48a00000-0000-0000-0000-000000000001', 48, 'after accepted 4 cartons');
END $$;

-- Replaying the same idempotency key must not double anything.
DO $$
DECLARE v_po uuid; v_pol uuid; v_res jsonb;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  v_res := public.rpc_post_goods_receipt(jsonb_build_object(
    'tenant_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','48f00000-0000-0000-0000-000000000001',
    'purchase_order_id',v_po,
    'warehouse_id','48a00000-0000-0000-0000-000000000001',
    'receipt_date','2026-07-24',
    'idempotency_key','U148-GR-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id','48d00000-0000-0000-0000-000000000001',
      'purchase_order_line_id',v_pol,
      'uom_id','48400000-0000-0000-0000-000000000002',
      'qty_entered',4,
      'unit_cost_entered',120,
      'quality_status','accepted'))));

  IF NOT COALESCE((v_res->>'idempotent_replay')::boolean,false) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected idempotent replay, got %', v_res;
  END IF;
  PERFORM pg_temp.assert_line(v_pol, 48, 48, 0, 'after replay');
  PERFORM pg_temp.assert_stock(
    '48d00000-0000-0000-0000-000000000001',
    '48a00000-0000-0000-0000-000000000001', 48, 'after replay');
END $$;

-- ---------------------------------------------------------------------------
-- 5. Core regression: a rejected delivery must not close the order and must not
--    touch inventory or the ledger.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_po uuid; v_pol uuid; v_res jsonb;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  v_res := public.rpc_post_goods_receipt(jsonb_build_object(
    'tenant_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','48f00000-0000-0000-0000-000000000001',
    'purchase_order_id',v_po,
    'warehouse_id','48a00000-0000-0000-0000-000000000001',
    'receipt_date','2026-07-24',
    'idempotency_key','U148-GR-2',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id','48d00000-0000-0000-0000-000000000001',
      'purchase_order_line_id',v_pol,
      'uom_id','48400000-0000-0000-0000-000000000002',
      'qty_entered',6,
      'unit_cost_entered',120,
      'quality_status','rejected'))));

  -- No accepted units, therefore no inventory and no GRNI value.
  IF (v_res->>'total_value')::numeric <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: rejected receipt produced value %', v_res;
  END IF;
  PERFORM pg_temp.assert_line(v_pol, 120, 48, 72, 'after rejected 6 cartons');
  -- Physically 120 of 120 received, but only 48 accepted: the order stays open.
  PERFORM pg_temp.assert_po_status(v_po, 'partially_received', 'after rejected 6 cartons');
  PERFORM pg_temp.assert_stock(
    '48d00000-0000-0000-0000-000000000001',
    '48a00000-0000-0000-0000-000000000001', 48, 'after rejected 6 cartons');
END $$;

-- The rejected units released contract balance, so the order is still listed
-- with exactly the rejected quantity outstanding.
DO $$
DECLARE v_orders jsonb; v_line jsonb;
BEGIN
  v_orders := public.rpc_list_uom_receivable_purchase_orders(
    '48111111-1111-1111-1111-111111111111');
  IF jsonb_array_length(v_orders) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: rejected quantity did not reopen the order: %', v_orders;
  END IF;
  v_line := v_orders -> 0 -> 'lines' -> 0;
  IF (v_line ->> 'remaining_qty_base')::numeric <> 72
     OR (v_line ->> 'remaining_qty_entered')::numeric <> 6
     OR (v_line ->> 'accepted_qty_base')::numeric <> 48
     OR (v_line ->> 'rejected_qty_base')::numeric <> 72
     OR (v_line ->> 'received_qty_base')::numeric <> 120 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: contract balance mismatch: %', v_line;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Replacement delivery against the rejected quantity is legal and closes it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_po uuid; v_pol uuid; v_res jsonb;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  v_res := public.rpc_post_goods_receipt(jsonb_build_object(
    'tenant_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','48f00000-0000-0000-0000-000000000001',
    'purchase_order_id',v_po,
    'warehouse_id','48a00000-0000-0000-0000-000000000001',
    'receipt_date','2026-07-24',
    'idempotency_key','U148-GR-3',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id','48d00000-0000-0000-0000-000000000001',
      'purchase_order_line_id',v_pol,
      'uom_id','48400000-0000-0000-0000-000000000002',
      'qty_entered',6,
      'unit_cost_entered',120,
      'quality_status','accepted'))));

  IF (v_res->>'total_value')::numeric <> 720 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: replacement receipt value mismatch: %', v_res;
  END IF;
  PERFORM pg_temp.assert_line(v_pol, 192, 120, 72, 'after replacement');
  PERFORM pg_temp.assert_po_status(v_po, 'fully_received', 'after replacement');
  PERFORM pg_temp.assert_stock(
    '48d00000-0000-0000-0000-000000000001',
    '48a00000-0000-0000-0000-000000000001', 120, 'after replacement');
END $$;

-- A fully accepted order disappears from the receivable list.
DO $$
DECLARE v_orders jsonb;
BEGIN
  v_orders := public.rpc_list_uom_receivable_purchase_orders(
    '48111111-1111-1111-1111-111111111111');
  IF jsonb_array_length(v_orders) <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: fully accepted order still receivable: %', v_orders;
  END IF;
END $$;

-- And it can no longer be received.
DO $$
DECLARE v_po uuid; v_pol uuid;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'idempotency_key','U148-GR-4',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'uom_id','48400000-0000-0000-0000-000000000002',
        'qty_entered',1,
        'unit_cost_entered',120,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'PO_NOT_RECEIVABLE');
END $$;

-- ---------------------------------------------------------------------------
-- 7. pending_inspection holds contract balance but produces no inventory.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT public.rpc_create_uom_purchase_order(
  jsonb_build_object(
    'org_id', '48111111-1111-1111-1111-111111111111',
    'vendor_id', '48f00000-0000-0000-0000-000000000001',
    'order_number', 'U148-PO-PENDING',
    'order_date', '2026-07-24',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', '48d00000-0000-0000-0000-000000000001',
      'uom_id', '48400000-0000-0000-0000-000000000002',
      'qty_entered', 2,
      'unit_price_entered', 120,
      'discount_percentage', 0,
      'tax_percentage', 15
    ))
  )
);

CREATE TEMP TABLE t148p AS
SELECT po.id AS po_id, pol.id AS pol_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
WHERE po.org_id='48111111-1111-1111-1111-111111111111'
  AND po.order_number='U148-PO-PENDING';

SELECT set_config('request.jwt.claim.sub', '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT public.rpc_approve_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid, (SELECT po_id FROM t148p));

DO $$
DECLARE v_po uuid; v_pol uuid; v_res jsonb;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148p;
  v_res := public.rpc_post_goods_receipt(jsonb_build_object(
    'tenant_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','48f00000-0000-0000-0000-000000000001',
    'purchase_order_id',v_po,
    'warehouse_id','48a00000-0000-0000-0000-000000000001',
    'receipt_date','2026-07-24',
    'idempotency_key','U148-GRP-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id','48d00000-0000-0000-0000-000000000001',
      'purchase_order_line_id',v_pol,
      'uom_id','48400000-0000-0000-0000-000000000002',
      'qty_entered',2,
      'unit_cost_entered',120,
      'quality_status','pending_inspection'))));

  IF (v_res->>'total_value')::numeric <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: pending inspection produced value %', v_res;
  END IF;
  PERFORM pg_temp.assert_line(v_pol, 24, 0, 0, 'after pending inspection');
  PERFORM pg_temp.assert_po_status(v_po, 'partially_received', 'after pending inspection');
  -- Stock is unchanged from the previous product total.
  PERFORM pg_temp.assert_stock(
    '48d00000-0000-0000-0000-000000000001',
    '48a00000-0000-0000-0000-000000000001', 120, 'after pending inspection');

  -- Pending units still hold the contract, so a further delivery over-receipts.
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'idempotency_key','U148-GRP-2',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'uom_id','48400000-0000-0000-0000-000000000002',
        'qty_entered',1,
        'unit_cost_entered',120,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'OVER_RECEIPT');
END $$;

-- ---------------------------------------------------------------------------
-- 8. Missing snapshot: fail closed on a non-base unit, factor 1 on a base unit.
-- ---------------------------------------------------------------------------
-- Clearing only the snapshot column does not fire the migration-139 normalization
-- trigger, which reproduces a legacy row that predates snapshot backfill.
UPDATE public.purchase_order_lines
SET conversion_factor_snapshot = NULL
WHERE id = (SELECT pol_id FROM t148p);

DO $$
DECLARE v_po uuid; v_pol uuid;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148p;
  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'idempotency_key','U148-GRP-3',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'qty_entered',1,
        'quality_status','accepted'))))$q$, v_po, v_pol),
    'PO_LINE_SNAPSHOT_MISSING');
END $$;

-- A base-unit line with no snapshot is unambiguous: entered equals base, so the
-- historical payload shape keeps working at factor 1.
SELECT set_config('request.jwt.claim.sub', '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT public.rpc_create_uom_purchase_order(
  jsonb_build_object(
    'org_id', '48111111-1111-1111-1111-111111111111',
    'vendor_id', '48f00000-0000-0000-0000-000000000001',
    'order_number', 'U148-PO-BASE',
    'order_date', '2026-07-24',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', '48d00000-0000-0000-0000-000000000002',
      'uom_id', '48400000-0000-0000-0000-000000000001',
      'qty_entered', 5,
      'unit_price_entered', 7,
      'discount_percentage', 0,
      'tax_percentage', 15
    ))
  )
);

CREATE TEMP TABLE t148b AS
SELECT po.id AS po_id, pol.id AS pol_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
WHERE po.org_id='48111111-1111-1111-1111-111111111111'
  AND po.order_number='U148-PO-BASE';

SELECT set_config('request.jwt.claim.sub', '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT public.rpc_approve_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid, (SELECT po_id FROM t148b));

UPDATE public.purchase_order_lines
SET conversion_factor_snapshot = NULL
WHERE id = (SELECT pol_id FROM t148b);

DO $$
DECLARE v_po uuid; v_pol uuid; v_res jsonb;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148b;
  v_res := public.rpc_post_goods_receipt(jsonb_build_object(
    'tenant_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','48f00000-0000-0000-0000-000000000001',
    'purchase_order_id',v_po,
    'warehouse_id','48a00000-0000-0000-0000-000000000001',
    'receipt_date','2026-07-24',
    'idempotency_key','U148-GRB-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id','48d00000-0000-0000-0000-000000000002',
      'purchase_order_line_id',v_pol,
      'received_quantity',5,
      'unit_cost',7,
      'quality_status','accepted'))));

  IF (v_res->>'total_value')::numeric <> 35 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: base-unit legacy receipt mismatch: %', v_res;
  END IF;
  PERFORM pg_temp.assert_line(v_pol, 5, 5, 0, 'base-unit legacy receipt');
  PERFORM pg_temp.assert_po_status(v_po, 'fully_received', 'base-unit legacy receipt');
END $$;

-- ---------------------------------------------------------------------------
-- 9. Whole-document rollback when a later line is illegal.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT public.rpc_create_uom_purchase_order(
  jsonb_build_object(
    'org_id', '48111111-1111-1111-1111-111111111111',
    'vendor_id', '48f00000-0000-0000-0000-000000000001',
    'order_number', 'U148-PO-ROLLBACK',
    'order_date', '2026-07-24',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', '48d00000-0000-0000-0000-000000000002',
      'uom_id', '48400000-0000-0000-0000-000000000001',
      'qty_entered', 3,
      'unit_price_entered', 7,
      'discount_percentage', 0,
      'tax_percentage', 15
    ))
  )
);

CREATE TEMP TABLE t148r AS
SELECT po.id AS po_id, pol.id AS pol_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
WHERE po.org_id='48111111-1111-1111-1111-111111111111'
  AND po.order_number='U148-PO-ROLLBACK';

SELECT set_config('request.jwt.claim.sub', '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT public.rpc_approve_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid, (SELECT po_id FROM t148r));

DO $$
DECLARE v_po uuid; v_pol uuid; v_before integer; v_after integer;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t148r;
  SELECT count(*) INTO v_before FROM public.goods_receipts
  WHERE org_id='48111111-1111-1111-1111-111111111111';

  PERFORM pg_temp.expect_error(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'idempotency_key','U148-GRR-1',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'product_id','48d00000-0000-0000-0000-000000000002',
          'purchase_order_line_id',%L,
          'qty_entered',1,
          'unit_cost_entered',7,
          'quality_status','accepted'),
        jsonb_build_object(
          'product_id','48d00000-0000-0000-0000-000000000002',
          'purchase_order_line_id',%L,
          'qty_entered',1,
          'unit_cost_entered',7,
          'quality_status','not_a_status'))))$q$, v_po, v_pol, v_pol),
    'INVALID_QUALITY_STATUS');

  SELECT count(*) INTO v_after FROM public.goods_receipts
  WHERE org_id='48111111-1111-1111-1111-111111111111';
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: failed receipt left a header behind';
  END IF;
  PERFORM pg_temp.assert_line(v_pol, 0, 0, 0, 'after rollback');
  PERFORM pg_temp.assert_po_status(v_po, 'approved', 'after rollback');
END $$;

-- ---------------------------------------------------------------------------
-- 10. Client execution contract.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'rpc_submit_purchase_order(uuid,uuid)',
    'rpc_approve_purchase_order(uuid,uuid)',
    'rpc_list_uom_receivable_purchase_orders(uuid)',
    'rpc_post_goods_receipt(jsonb)'
  ] LOOP
    IF has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: execute contract broken for %', v_fn;
    END IF;
  END LOOP;
END $$;

SELECT 'ACCEPTANCE_148_PASS' AS result;
