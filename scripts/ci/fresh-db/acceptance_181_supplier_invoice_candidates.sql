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
      RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: expected [%], got [%] for [%]',
        p_needle, SQLERRM, p_sql;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: expected error [%], but succeeded: %',
      p_needle, p_sql;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Definition / execute surface / D4 all-of contract.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)'::regprocedure
  ) INTO v_def;

  IF v_def NOT LIKE '%wardah_assert_org_member%'
     OR v_def NOT LIKE '%purchasing.purchase_orders.read%'
     OR v_def NOT LIKE '%purchasing.purchase_invoices.read%'
     OR v_def NOT LIKE '%quality_status = ''accepted''%'
     OR v_def NOT LIKE '%supplier_invoice_receipt_allocations%'
     OR v_def NOT LIKE '%fully_received%' THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: function definition misses reviewed contract';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.rpc_list_supplier_invoice_candidates(uuid,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: execute surface mismatch';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Permission / tenant boundaries.
-- Fixtures come from acceptance_148 + acceptance_149.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_list_supplier_invoice_candidates(
      '48111111-1111-1111-1111-111111111111'::uuid, NULL, NULL)$$,
  'AP_CANDIDATE_PERMISSION_DENIED'
);

SELECT set_config('request.jwt.claim.sub', '48cccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_list_supplier_invoice_candidates(
      '48111111-1111-1111-1111-111111111111'::uuid, NULL, NULL)$$,
  'ORG'
);

-- Org A admin receives the non-sensitive read permissions through the canonical
-- has_permission() contract and is therefore the positive caller.
SELECT set_config('request.jwt.claim.sub', '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

-- ---------------------------------------------------------------------------
-- 3. Happy path and authoritative remaining balance after 149 allocation.
-- acceptance_149_ap_three_way_match.sql consumes 10.5 from U148-GR-1's accepted
-- 48 base units, so this read must report exactly 37.5 remaining. Acceptance 148
-- leaves U148-PO-MAIN in fully_received; assert that state explicitly so later
-- fixture changes cannot silently remove coverage of Migration 152's terminal PO
-- state from this gate.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_po uuid;
  v_vendor uuid;
  v_grl uuid;
  v_rows jsonb;
  v_row jsonb;
BEGIN
  SELECT po.id, po.vendor_id, grl.id
    INTO STRICT v_po, v_vendor, v_grl
  FROM public.purchase_orders po
  JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
  JOIN public.goods_receipts gr ON gr.purchase_order_id = po.id
  JOIN public.goods_receipt_lines grl
    ON grl.goods_receipt_id = gr.id
   AND grl.purchase_order_line_id = pol.id
  WHERE po.order_number = 'U148-PO-MAIN'
    AND gr.idempotency_key = 'U148-GR-1'
    AND grl.quality_status = 'accepted';

  v_rows := public.rpc_list_supplier_invoice_candidates(
    '48111111-1111-1111-1111-111111111111'::uuid,
    v_vendor,
    v_po
  );

  IF jsonb_array_length(v_rows) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: expected one candidate, got %', v_rows;
  END IF;

  v_row := v_rows -> 0;
  IF (v_row ->> 'goods_receipt_line_id')::uuid <> v_grl
     OR (v_row ->> 'accepted_qty_base')::numeric <> 48
     OR (v_row ->> 'allocated_qty_base')::numeric <> 10.5
     OR (v_row ->> 'remaining_qty_base')::numeric <> 37.5
     OR (v_row ->> 'conversion_factor_snapshot')::numeric <> 12
     OR (v_row ->> 'po_unit_price_base')::numeric <> 10
     OR (v_row ->> 'po_unit_price_entered')::numeric <> 120
     OR v_row ->> 'quality_status' <> 'accepted'
     OR v_row ->> 'goods_receipt_status' NOT IN ('confirmed','posted')
     OR v_row ->> 'purchase_order_status' <> 'fully_received' THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: candidate contract mismatch: %', v_row;
  END IF;
END $$;

-- Vendor and PO filters must stay tenant-scoped and consistent.
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_list_supplier_invoice_candidates(
      '48111111-1111-1111-1111-111111111111'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      NULL)$$,
  'AP_VENDOR_MISMATCH'
);
SELECT pg_temp.expect_error(
  $$SELECT public.rpc_list_supplier_invoice_candidates(
      '48111111-1111-1111-1111-111111111111'::uuid,
      NULL,
      '00000000-0000-0000-0000-000000000001'::uuid)$$,
  'AP_PO_NOT_FOUND'
);

-- ---------------------------------------------------------------------------
-- 4. Eligibility filters are fail-closed and leave no state changes.
-- Each negative probe is inside a transaction and rolled back.
-- ---------------------------------------------------------------------------
BEGIN;
UPDATE public.goods_receipts
SET status = 'draft'
WHERE idempotency_key = 'U148-GR-1';
DO $$
DECLARE v_rows jsonb; v_po uuid; v_vendor uuid;
BEGIN
  SELECT id, vendor_id INTO STRICT v_po, v_vendor
  FROM public.purchase_orders WHERE order_number = 'U148-PO-MAIN';
  v_rows := public.rpc_list_supplier_invoice_candidates(
    '48111111-1111-1111-1111-111111111111', v_vendor, v_po);
  IF jsonb_array_length(v_rows) <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: draft GRN leaked into candidates: %', v_rows;
  END IF;
END $$;
ROLLBACK;

BEGIN;
UPDATE public.goods_receipt_lines grl
SET quality_status = 'rejected'
FROM public.goods_receipts gr
WHERE gr.id = grl.goods_receipt_id
  AND gr.idempotency_key = 'U148-GR-1';
DO $$
DECLARE v_rows jsonb; v_po uuid; v_vendor uuid;
BEGIN
  SELECT id, vendor_id INTO STRICT v_po, v_vendor
  FROM public.purchase_orders WHERE order_number = 'U148-PO-MAIN';
  v_rows := public.rpc_list_supplier_invoice_candidates(
    '48111111-1111-1111-1111-111111111111', v_vendor, v_po);
  IF jsonb_array_length(v_rows) <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: rejected GRN line leaked: %', v_rows;
  END IF;
END $$;
ROLLBACK;

-- A fully consumed receipt line is excluded. Add only the remaining 37.5 inside
-- this transaction, then rollback; no permanent fixture mutation survives.
BEGIN;
INSERT INTO public.supplier_invoice_receipt_allocations (
  org_id, supplier_invoice_id, supplier_invoice_line_id,
  goods_receipt_line_id, purchase_order_line_id, quantity_base,
  idempotency_key, created_by
)
SELECT
  a.org_id,
  a.supplier_invoice_id,
  a.supplier_invoice_line_id,
  a.goods_receipt_line_id,
  a.purchase_order_line_id,
  37.5,
  'u181-full-consumption-probe',
  '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
FROM public.supplier_invoice_receipt_allocations a
JOIN public.goods_receipt_lines grl ON grl.id = a.goods_receipt_line_id
JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
WHERE gr.idempotency_key = 'U148-GR-1'
  AND a.reversal_of_allocation_id IS NULL
LIMIT 1;
DO $$
DECLARE v_rows jsonb; v_po uuid; v_vendor uuid;
BEGIN
  SELECT id, vendor_id INTO STRICT v_po, v_vendor
  FROM public.purchase_orders WHERE order_number = 'U148-PO-MAIN';
  v_rows := public.rpc_list_supplier_invoice_candidates(
    '48111111-1111-1111-1111-111111111111', v_vendor, v_po);
  IF jsonb_array_length(v_rows) <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: fully consumed line leaked: %', v_rows;
  END IF;
END $$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- 5. Append-only reversal arithmetic is executable, not just inspected.
-- Add a temporary 5-unit allocation and a second row that reverses it. The net
-- allocation must return to the original 10.5, the remaining balance to 37.5,
-- and the candidate must remain visible. Roll back both rows afterward.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_original_allocation_id uuid;
  v_org uuid;
  v_invoice uuid;
  v_invoice_line uuid;
  v_grl uuid;
  v_pol uuid;
  v_po uuid;
  v_vendor uuid;
  v_rows jsonb;
  v_row jsonb;
  v_helper_remaining numeric;
BEGIN
  SELECT
    a.org_id,
    a.supplier_invoice_id,
    a.supplier_invoice_line_id,
    a.goods_receipt_line_id,
    a.purchase_order_line_id,
    po.id,
    po.vendor_id
  INTO STRICT
    v_org,
    v_invoice,
    v_invoice_line,
    v_grl,
    v_pol,
    v_po,
    v_vendor
  FROM public.supplier_invoice_receipt_allocations a
  JOIN public.goods_receipt_lines grl ON grl.id = a.goods_receipt_line_id
  JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
  JOIN public.purchase_order_lines pol ON pol.id = a.purchase_order_line_id
  JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
  WHERE gr.idempotency_key = 'U148-GR-1'
    AND a.reversal_of_allocation_id IS NULL
  ORDER BY a.created_at, a.id
  LIMIT 1;

  INSERT INTO public.supplier_invoice_receipt_allocations (
    org_id, supplier_invoice_id, supplier_invoice_line_id,
    goods_receipt_line_id, purchase_order_line_id, quantity_base,
    idempotency_key, created_by
  ) VALUES (
    v_org, v_invoice, v_invoice_line,
    v_grl, v_pol, 5,
    'u181-reversal-origin-probe',
    '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  )
  RETURNING id INTO v_original_allocation_id;

  INSERT INTO public.supplier_invoice_receipt_allocations (
    org_id, supplier_invoice_id, supplier_invoice_line_id,
    goods_receipt_line_id, purchase_order_line_id, quantity_base,
    reversal_of_allocation_id, reversal_reason,
    idempotency_key, created_by
  ) VALUES (
    v_org, v_invoice, v_invoice_line,
    v_grl, v_pol, 5,
    v_original_allocation_id, 'Acceptance 181 reversal probe',
    'u181-reversal-row-probe',
    '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  );

  v_rows := public.rpc_list_supplier_invoice_candidates(
    v_org, v_vendor, v_po
  );

  IF jsonb_array_length(v_rows) <> 1 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_181_FAIL: reversed allocation did not restore candidate visibility: %',
      v_rows;
  END IF;

  v_row := v_rows -> 0;
  IF (v_row ->> 'goods_receipt_line_id')::uuid <> v_grl
     OR (v_row ->> 'allocated_qty_base')::numeric <> 10.5
     OR (v_row ->> 'remaining_qty_base')::numeric <> 37.5 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_181_FAIL: reversal arithmetic mismatch in candidate read: %',
      v_row;
  END IF;

  v_helper_remaining := public.wardah_receipt_line_uninvoiced_base(v_grl);
  IF v_helper_remaining <> 37.5 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_181_FAIL: 149/151 helper disagrees after reversal: %',
      v_helper_remaining;
  END IF;
END $$;
ROLLBACK;

-- Final proof that every negative/reversal probe rolled back and did not mutate
-- the durable 148/149 fixture.
DO $$
DECLARE v_remaining numeric;
BEGIN
  SELECT public.wardah_receipt_line_uninvoiced_base(grl.id)
    INTO STRICT v_remaining
  FROM public.goods_receipt_lines grl
  JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
  WHERE gr.idempotency_key = 'U148-GR-1'
    AND grl.quality_status = 'accepted';
  IF v_remaining <> 37.5 THEN
    RAISE EXCEPTION 'ACCEPTANCE_181_FAIL: probes changed remaining balance: %', v_remaining;
  END IF;
END $$;

SELECT 'AP_181_SUPPLIER_INVOICE_CANDIDATE_READ_PASS' AS result;
