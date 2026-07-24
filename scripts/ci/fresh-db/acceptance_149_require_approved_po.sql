-- Acceptance for migration 149.
-- Proves that submission is not approval: a plain member may submit an order,
-- but neither the receivable list nor the atomic GRN path exposes it until an
-- organization admin approves it.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error_149(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected [%], got [%]', p_needle, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected error [%], but call succeeded', p_needle;
  END IF;
END $$;

-- Reuse the legal fixtures established by acceptance 148.
SELECT set_config('request.jwt.claim.sub', '48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

SELECT public.rpc_create_uom_purchase_order(
  jsonb_build_object(
    'org_id', '48111111-1111-1111-1111-111111111111',
    'vendor_id', '48f00000-0000-0000-0000-000000000001',
    'order_number', 'U149-PO-APPROVAL-GATE',
    'order_date', '2026-07-24',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', '48d00000-0000-0000-0000-000000000001',
      'uom_id', '48400000-0000-0000-0000-000000000002',
      'qty_entered', 1,
      'unit_price_entered', 120,
      'discount_percentage', 0,
      'tax_percentage', 15
    ))
  )
);

CREATE TEMP TABLE t149 AS
SELECT po.id AS po_id, pol.id AS pol_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
WHERE po.org_id = '48111111-1111-1111-1111-111111111111'
  AND po.order_number = 'U149-PO-APPROVAL-GATE';

SELECT public.rpc_submit_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid,
  (SELECT po_id FROM t149)
);

DO $$
DECLARE v_status text; v_orders jsonb; v_po uuid;
BEGIN
  SELECT po_id INTO v_po FROM t149;
  SELECT status INTO STRICT v_status FROM public.purchase_orders WHERE id = v_po;
  IF v_status <> 'submitted' THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected submitted, got %', v_status;
  END IF;

  v_orders := public.rpc_list_uom_receivable_purchase_orders(
    '48111111-1111-1111-1111-111111111111'
  );
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_orders) item
    WHERE item ->> 'id' = v_po::text
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: submitted order leaked into receivable list';
  END IF;
END $$;

DO $$
DECLARE v_po uuid; v_pol uuid;
BEGIN
  SELECT po_id, pol_id INTO v_po, v_pol FROM t149;
  PERFORM pg_temp.expect_error_149(format(
    $q$ SELECT public.rpc_post_goods_receipt(jsonb_build_object(
      'tenant_id','48111111-1111-1111-1111-111111111111',
      'vendor_id','48f00000-0000-0000-0000-000000000001',
      'purchase_order_id',%L,
      'warehouse_id','48a00000-0000-0000-0000-000000000001',
      'receipt_date','2026-07-24',
      'idempotency_key','U149-SUBMITTED-MUST-FAIL',
      'lines',jsonb_build_array(jsonb_build_object(
        'product_id','48d00000-0000-0000-0000-000000000001',
        'purchase_order_line_id',%L,
        'uom_id','48400000-0000-0000-0000-000000000002',
        'qty_entered',1,
        'unit_cost_entered',120,
        'quality_status','accepted'))))$q$,
    v_po, v_pol),
    'PO_NOT_RECEIVABLE: submitted'
  );
END $$;

-- Admin approval is the event that opens inventory/GRNI receiving.
SELECT set_config('request.jwt.claim.sub', '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT public.rpc_approve_purchase_order(
  '48111111-1111-1111-1111-111111111111'::uuid,
  (SELECT po_id FROM t149)
);

DO $$
DECLARE v_orders jsonb; v_po uuid;
BEGIN
  SELECT po_id INTO v_po FROM t149;
  v_orders := public.rpc_list_uom_receivable_purchase_orders(
    '48111111-1111-1111-1111-111111111111'
  );
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_orders) item
    WHERE item ->> 'id' = v_po::text
      AND item ->> 'status' = 'approved'
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: approved order missing from receivable list';
  END IF;
END $$;

-- The internal implementation is not a client API.
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.rpc_post_goods_receipt_148_internal(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_post_goods_receipt_148_internal(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: internal receipt implementation is executable by clients';
  END IF;
END $$;

SELECT 'ACCEPTANCE_149_PASS' AS result;
