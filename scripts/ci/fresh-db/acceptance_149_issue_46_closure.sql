-- Closure evidence for GitHub issue #46.
-- Runs after acceptance_149_ap_three_way_match.sql on the same fresh database.
-- Proves explicit cross-org/vendor rejection, snapshot stability after a live
-- conversion-catalog change, and a second invoice that completes the same GRN line.
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
      RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: expected [%], got [%] for [%]',
        p_needle, SQLERRM, p_sql;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: expected error [%], but succeeded: %',
      p_needle, p_sql;
  END IF;
END $$;

CREATE TEMP TABLE t46_fixture AS
SELECT po.org_id,
       po.vendor_id,
       pol.product_id,
       pol.uom_id,
       pol.conversion_factor_snapshot,
       pol.unit_price,
       grl.id AS accepted_grl_id
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id = po.id
JOIN public.goods_receipts gr ON gr.purchase_order_id = po.id
JOIN public.goods_receipt_lines grl
  ON grl.goods_receipt_id = gr.id
 AND grl.purchase_order_line_id = pol.id
WHERE po.order_number = 'U148-PO-MAIN'
  AND gr.idempotency_key = 'U148-GR-1'
  AND grl.quality_status = 'accepted';

DO $$
BEGIN
  IF (SELECT count(*) FROM t46_fixture) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: expected exactly one accepted fixture';
  END IF;
  IF (SELECT conversion_factor_snapshot FROM t46_fixture) <> 12
     OR (SELECT unit_price FROM t46_fixture) <> 10 THEN
    RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: unexpected legal PO snapshot';
  END IF;
END $$;

INSERT INTO public.vendors (id, org_id, code, name, is_active) VALUES
  ('46a00000-0000-0000-0000-000000000001',
   '48111111-1111-1111-1111-111111111111', 'U149-ALT-A', 'Alternate Vendor A', true),
  ('46b00000-0000-0000-0000-000000000001',
   '48222222-2222-2222-2222-222222222222', 'U149-ALT-B', 'Alternate Vendor B', true)
ON CONFLICT DO NOTHING;

-- Explicit wrong-vendor reference inside the correct organization.
SELECT set_config('request.jwt.claim.sub',
                  '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
SELECT pg_temp.expect_error(format(
  $q$SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)$q$,
  jsonb_build_object(
    'org_id','48111111-1111-1111-1111-111111111111',
    'vendor_id','46a00000-0000-0000-0000-000000000001',
    'invoice_number','U149-WRONG-VENDOR',
    'invoice_date','2026-07-30',
    'idempotency_key','u149-wrong-vendor',
    'lines',jsonb_build_array(jsonb_build_object(
      'goods_receipt_line_id',(SELECT accepted_grl_id FROM t46_fixture),
      'quantity_base',1,
      'unit_price',10,
      'discount_percentage',0,
      'tax_percentage',15)))),
  'AP_VENDOR_MISMATCH');

-- Explicit cross-organization reference by a valid Org B admin and Org B vendor.
SELECT set_config('request.jwt.claim.sub',
                  '48cccccc-cccc-cccc-cccc-cccccccccccc', false);
SELECT pg_temp.expect_error(format(
  $q$SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)$q$,
  jsonb_build_object(
    'org_id','48222222-2222-2222-2222-222222222222',
    'vendor_id','46b00000-0000-0000-0000-000000000001',
    'invoice_number','U149-CROSS-ORG',
    'invoice_date','2026-07-30',
    'idempotency_key','u149-cross-org',
    'lines',jsonb_build_array(jsonb_build_object(
      'goods_receipt_line_id',(SELECT accepted_grl_id FROM t46_fixture),
      'quantity_base',1,
      'unit_price',10,
      'discount_percentage',0,
      'tax_percentage',15)))),
  'AP_CROSS_ORG_REFERENCE');

-- Change the current catalog conversion after the legal PO/GRN snapshots exist.
-- The matched invoice must continue using the stored factor 12 and stored base price 10.
UPDATE public.product_uom_conversions
SET factor_to_base = 24,
    updated_at = now()
WHERE org_id = '48111111-1111-1111-1111-111111111111'
  AND product_id = (SELECT product_id FROM t46_fixture)
  AND uom_id = (SELECT uom_id FROM t46_fixture);

SELECT set_config('request.jwt.claim.sub',
                  '48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

CREATE TEMP TABLE t46_completion AS
WITH remaining AS (
  SELECT public.wardah_receipt_line_uninvoiced_base(
           (SELECT accepted_grl_id FROM t46_fixture)) AS qty
), created AS (
  SELECT public.rpc_create_matched_supplier_invoice(
    jsonb_build_object(
      'org_id','48111111-1111-1111-1111-111111111111',
      'vendor_id',(SELECT vendor_id FROM t46_fixture),
      'invoice_number','U149-INV-COMPLETE',
      'invoice_date','2026-07-30',
      'due_date','2026-08-30',
      'idempotency_key','u149-complete-same-grn',
      'lines',jsonb_build_array(jsonb_build_object(
        'goods_receipt_line_id',(SELECT accepted_grl_id FROM t46_fixture),
        'quantity_base',(SELECT qty FROM remaining),
        'unit_price',10,
        'discount_percentage',0,
        'tax_percentage',15)))) AS result,
    (SELECT qty FROM remaining) AS prior_remaining
)
SELECT result, prior_remaining FROM created;

DO $$
DECLARE
  v_result jsonb;
  v_invoice uuid;
  v_prior numeric;
  v_remaining numeric;
  v_factor numeric;
  v_qty numeric;
  v_qty_entered numeric;
  v_price_snapshot numeric;
BEGIN
  SELECT result, prior_remaining INTO STRICT v_result, v_prior FROM t46_completion;
  v_invoice := (v_result ->> 'invoice_id')::uuid;

  IF v_prior <= 0 OR NOT COALESCE((v_result ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: completion invoice result invalid: %', v_result;
  END IF;

  SELECT quantity, qty_entered, conversion_factor_snapshot, po_unit_price_snapshot
  INTO STRICT v_qty, v_qty_entered, v_factor, v_price_snapshot
  FROM public.supplier_invoice_lines
  WHERE supplier_invoice_id = v_invoice;

  IF v_qty <> v_prior
     OR v_factor <> 12
     OR v_qty_entered <> round(v_prior / 12, 6)
     OR v_price_snapshot <> 10 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_46_FAIL: stored snapshot drift qty=% entered=% factor=% price=% prior=%',
      v_qty, v_qty_entered, v_factor, v_price_snapshot, v_prior;
  END IF;

  v_remaining := public.wardah_receipt_line_uninvoiced_base(
    (SELECT accepted_grl_id FROM t46_fixture));
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: second invoice did not complete GRN; remaining=%',
      v_remaining;
  END IF;

  IF (SELECT factor_to_base FROM public.product_uom_conversions
      WHERE org_id='48111111-1111-1111-1111-111111111111'
        AND product_id=(SELECT product_id FROM t46_fixture)
        AND uom_id=(SELECT uom_id FROM t46_fixture)) <> 24 THEN
    RAISE EXCEPTION 'ACCEPTANCE_46_FAIL: catalog mutation was not applied';
  END IF;
END $$;

SELECT 'ACCEPTANCE_46_CLOSURE_PASS' AS result;
