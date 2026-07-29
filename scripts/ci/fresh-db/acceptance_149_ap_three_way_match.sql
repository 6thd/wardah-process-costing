-- Acceptance for migrations 149 + 150.
-- acceptance_148_uom_partial_receipts.sql must run first: it creates legal PO/GRN
-- snapshots through the production RPCs, and this suite consumes those facts.
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
      RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected [%], got [%] for [%]',
        p_needle, SQLERRM, p_sql;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected error [%], but succeeded: %',
      p_needle, p_sql;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ap_payload(
  p_number text, p_idem text, p_vendor uuid, p_grl uuid,
  p_qty numeric, p_price numeric, p_tax numeric DEFAULT 15
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'org_id','48111111-1111-1111-1111-111111111111',
    'vendor_id',p_vendor,
    'invoice_number',p_number,
    'invoice_date','2026-07-29',
    'due_date','2026-08-29',
    'idempotency_key',p_idem,
    'lines',jsonb_build_array(jsonb_build_object(
      'goods_receipt_line_id',p_grl,
      'quantity_base',p_qty,
      'unit_price',p_price,
      'discount_percentage',0,
      'tax_percentage',p_tax))
  )
$$;

CREATE TEMP TABLE t149_fixture AS
SELECT po.id po_id, pol.id pol_id, gr.id gr_id, grl.id accepted_grl_id,
       po.vendor_id, pol.product_id, pol.unit_price
FROM public.purchase_orders po
JOIN public.purchase_order_lines pol ON pol.purchase_order_id=po.id
JOIN public.goods_receipts gr ON gr.purchase_order_id=po.id
JOIN public.goods_receipt_lines grl
  ON grl.goods_receipt_id=gr.id AND grl.purchase_order_line_id=pol.id
WHERE po.order_number='U148-PO-MAIN'
  AND gr.idempotency_key='U148-GR-1'
  AND grl.quality_status='accepted';

CREATE TEMP TABLE t149_rejected AS
SELECT grl.id rejected_grl_id
FROM public.goods_receipts gr
JOIN public.goods_receipt_lines grl ON grl.goods_receipt_id=gr.id
WHERE gr.idempotency_key='U148-GR-2' AND grl.quality_status='rejected';

DO $$
BEGIN
  IF (SELECT count(*) FROM t149_fixture) <> 1
     OR (SELECT count(*) FROM t149_rejected) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: migration 148 fixtures missing or ambiguous';
  END IF;
  IF (SELECT unit_price FROM t149_fixture) <> 10 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected base unit price 10';
  END IF;
END $$;

INSERT INTO public.gl_accounts
  (org_id,code,name,category,subtype,normal_balance,allow_posting)
VALUES
  ('48111111-1111-1111-1111-111111111111','141510','Input VAT U149',
   'ASSET','CURRENT_ASSET','DEBIT',true),
  ('48111111-1111-1111-1111-111111111111','211100','Accounts payable U149',
   'LIABILITY','CURRENT_LIABILITY','CREDIT',true)
ON CONFLICT DO NOTHING;

DELETE FROM public.gl_event_mappings
WHERE org_id='48111111-1111-1111-1111-111111111111'
  AND event_code IN ('AP_MATCHED_INVOICE_GOODS','AP_MATCHED_INVOICE_VAT');
INSERT INTO public.gl_event_mappings
  (org_id,event_code,work_center_code,debit_account_code,credit_account_code,is_active)
VALUES
  ('48111111-1111-1111-1111-111111111111','AP_MATCHED_INVOICE_GOODS',NULL,
   '210150','211100',true),
  ('48111111-1111-1111-1111-111111111111','AP_MATCHED_INVOICE_VAT',NULL,
   '141510','211100',true);

-- Execute surface: wrapper is client-facing; v149 core is internal only.
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.rpc_create_matched_supplier_invoice(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.rpc_create_matched_supplier_invoice(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: wrapper execute contract broken';
  END IF;
  IF has_function_privilege('authenticated',
       'public.rpc_create_matched_supplier_invoice_v149(jsonb)','EXECUTE')
     OR has_function_privilege('service_role',
       'public.rpc_create_matched_supplier_invoice_v149(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: internal core remains client executable';
  END IF;
END $$;

-- Ordinary member cannot approve+post.
SELECT set_config('request.jwt.claim.sub','48aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-NO-PERM','u149-no-perm',
    (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),1,10)),
  'AP_POST_PERMISSION_DENIED');

SELECT set_config('request.jwt.claim.sub','48bbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);

-- Happy path: 10.5 × 10 = 105.00; VAT 15.75; payable 120.75.
CREATE TEMP TABLE t149_result AS
SELECT public.rpc_create_matched_supplier_invoice(
  pg_temp.ap_payload('U149-INV-001','u149-happy-001',
    (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),10.5,10)
) result;

DO $$
DECLARE
  v_result jsonb; v_invoice uuid; v_entry uuid;
  v_status text; v_debit numeric; v_credit numeric; v_count int; v_remaining numeric;
BEGIN
  SELECT result INTO STRICT v_result FROM t149_result;
  v_invoice := (v_result->>'invoice_id')::uuid;
  v_entry := (v_result->>'journal_entry_id')::uuid;

  IF NOT COALESCE((v_result->>'success')::boolean,false)
     OR COALESCE((v_result->>'idempotent_replay')::boolean,true)
     OR (v_result->>'subtotal')::numeric <> 105.00
     OR (v_result->>'tax_amount')::numeric <> 15.75
     OR (v_result->>'total_amount')::numeric <> 120.75 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: happy result mismatch: %',v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_invoices
    WHERE id=v_invoice AND status='approved' AND match_status='matched'
      AND journal_entry_id=v_entry AND request_hash IS NOT NULL
      AND idempotency_key='u149-happy-001'
      AND subtotal=105.00 AND tax_amount=15.75 AND total_amount=120.75
  ) THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: persisted invoice mismatch';
  END IF;

  IF (SELECT count(*) FROM public.supplier_invoice_lines
      WHERE supplier_invoice_id=v_invoice) <> 1
     OR (SELECT quantity FROM public.supplier_invoice_lines
         WHERE supplier_invoice_id=v_invoice) <> 10.5 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: invoice line mismatch';
  END IF;

  IF (SELECT count(*) FROM public.supplier_invoice_receipt_allocations
      WHERE supplier_invoice_id=v_invoice) <> 1
     OR (SELECT quantity_base FROM public.supplier_invoice_receipt_allocations
         WHERE supplier_invoice_id=v_invoice) <> 10.5 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: allocation mismatch';
  END IF;

  v_remaining := public.wardah_receipt_line_uninvoiced_base(
    (SELECT accepted_grl_id FROM t149_fixture));
  IF v_remaining <> 37.5 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: expected remaining 37.5, got %',v_remaining;
  END IF;

  SELECT status,total_debit,total_credit INTO STRICT v_status,v_debit,v_credit
  FROM public.gl_entries WHERE id=v_entry;
  SELECT count(*) INTO v_count FROM public.gl_entry_lines WHERE entry_id=v_entry;
  IF v_status <> 'posted' OR v_debit <> 120.75 OR v_credit <> 120.75 OR v_count <> 3 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: journal mismatch status=% %=% lines=%',
      v_status,v_debit,v_credit,v_count;
  END IF;
END $$;

-- Exact replay returns the same persisted result and creates nothing else.
DO $$
DECLARE v_first jsonb; v_replay jsonb; v_i int; v_l int; v_a int; v_g int;
BEGIN
  SELECT result INTO v_first FROM t149_result;
  SELECT count(*) INTO v_i FROM public.supplier_invoices;
  SELECT count(*) INTO v_l FROM public.supplier_invoice_lines;
  SELECT count(*) INTO v_a FROM public.supplier_invoice_receipt_allocations;
  SELECT count(*) INTO v_g FROM public.gl_entries;

  v_replay := public.rpc_create_matched_supplier_invoice(
    pg_temp.ap_payload('U149-INV-001','u149-happy-001',
      (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),10.5,10));
  IF NOT COALESCE((v_replay->>'idempotent_replay')::boolean,false)
     OR v_replay->>'invoice_id' <> v_first->>'invoice_id' THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: exact replay mismatch: %',v_replay;
  END IF;
  IF (SELECT count(*) FROM public.supplier_invoices) <> v_i
     OR (SELECT count(*) FROM public.supplier_invoice_lines) <> v_l
     OR (SELECT count(*) FROM public.supplier_invoice_receipt_allocations) <> v_a
     OR (SELECT count(*) FROM public.gl_entries) <> v_g THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: replay duplicated state';
  END IF;
END $$;

SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-INV-001','u149-happy-001',
    (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),10.6,10)),
  'AP_IDEMPOTENCY_KEY_REUSED');
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-INV-001','u149-other-key',
    (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),1,10)),
  'AP_DUPLICATE_VENDOR_INVOICE_NUMBER');

-- Quantity, price, quality, GRN-header and duplicate-line guards.
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-OVER','u149-over',(SELECT vendor_id FROM t149_fixture),
    (SELECT accepted_grl_id FROM t149_fixture),40,10)),
  'AP_QUANTITY_EXCEEDS_RECEIPT');
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-PRICE','u149-price',(SELECT vendor_id FROM t149_fixture),
    (SELECT accepted_grl_id FROM t149_fixture),1,11)),
  'AP_PRICE_VARIANCE_REQUIRES_APPROVAL');
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-PREC','u149-precision',(SELECT vendor_id FROM t149_fixture),
    (SELECT accepted_grl_id FROM t149_fixture),1.1234567,10)),
  'AP_QUANTITY_PRECISION');
SELECT pg_temp.expect_error(format(
  'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',
  pg_temp.ap_payload('U149-REJECTED','u149-rejected',(SELECT vendor_id FROM t149_fixture),
    (SELECT rejected_grl_id FROM t149_rejected),1,10)),
  'AP_GRN_LINE_NOT_ACCEPTED');

DO $$
DECLARE v_payload jsonb; v_gr uuid;
BEGIN
  SELECT gr_id INTO v_gr FROM t149_fixture;
  UPDATE public.goods_receipts SET status='draft' WHERE id=v_gr;
  v_payload := pg_temp.ap_payload('U149-DRAFT-GRN','u149-draft-grn',
    (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),1,10);
  PERFORM pg_temp.expect_error(format(
    'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',v_payload),
    'AP_GRN_NOT_INVOICEABLE');
  UPDATE public.goods_receipts SET status='confirmed' WHERE id=v_gr;
END $$;

DO $$
DECLARE v_line jsonb; v_payload jsonb;
BEGIN
  v_line := jsonb_build_object(
    'goods_receipt_line_id',(SELECT accepted_grl_id FROM t149_fixture),
    'quantity_base',1,'unit_price',10,'discount_percentage',0,'tax_percentage',15);
  v_payload := jsonb_build_object(
    'org_id','48111111-1111-1111-1111-111111111111',
    'vendor_id',(SELECT vendor_id FROM t149_fixture),
    'invoice_number','U149-DUP-LINE','invoice_date','2026-07-29',
    'idempotency_key','u149-dup-line','lines',jsonb_build_array(v_line,v_line));
  PERFORM pg_temp.expect_error(format(
    'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',v_payload),
    'AP_DUPLICATE_GRN_LINE');
END $$;

-- Missing accounting map must roll back every table touched by the transaction.
DO $$
DECLARE v_i int; v_l int; v_a int; v_g int; v_payload jsonb;
BEGIN
  SELECT count(*) INTO v_i FROM public.supplier_invoices;
  SELECT count(*) INTO v_l FROM public.supplier_invoice_lines;
  SELECT count(*) INTO v_a FROM public.supplier_invoice_receipt_allocations;
  SELECT count(*) INTO v_g FROM public.gl_entries;
  DELETE FROM public.gl_event_mappings
  WHERE org_id='48111111-1111-1111-1111-111111111111'
    AND event_code='AP_MATCHED_INVOICE_VAT';
  v_payload := pg_temp.ap_payload('U149-NO-MAP','u149-no-map',
    (SELECT vendor_id FROM t149_fixture),(SELECT accepted_grl_id FROM t149_fixture),1,10);
  PERFORM pg_temp.expect_error(format(
    'SELECT public.rpc_create_matched_supplier_invoice(%L::jsonb)',v_payload),
    'AP_ACCOUNT_MAPPING_MISSING');
  IF (SELECT count(*) FROM public.supplier_invoices) <> v_i
     OR (SELECT count(*) FROM public.supplier_invoice_lines) <> v_l
     OR (SELECT count(*) FROM public.supplier_invoice_receipt_allocations) <> v_a
     OR (SELECT count(*) FROM public.gl_entries) <> v_g THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: journal failure left partial state';
  END IF;
  INSERT INTO public.gl_event_mappings
    (org_id,event_code,work_center_code,debit_account_code,credit_account_code,is_active)
  VALUES ('48111111-1111-1111-1111-111111111111','AP_MATCHED_INVOICE_VAT',NULL,
          '141510','211100',true);
END $$;

-- Zero VAT is a legal two-line balanced journal.
CREATE TEMP TABLE t149_zero AS
SELECT public.rpc_create_matched_supplier_invoice(
  pg_temp.ap_payload('U149-ZERO-VAT','u149-zero-vat',(SELECT vendor_id FROM t149_fixture),
    (SELECT accepted_grl_id FROM t149_fixture),1,10,0)) result;
DO $$
DECLARE v_entry uuid; v_lines int; v_debit numeric; v_credit numeric;
BEGIN
  SELECT (result->>'journal_entry_id')::uuid INTO v_entry FROM t149_zero;
  SELECT count(*) INTO v_lines FROM public.gl_entry_lines WHERE entry_id=v_entry;
  SELECT total_debit,total_credit INTO v_debit,v_credit FROM public.gl_entries WHERE id=v_entry;
  IF v_lines <> 2 OR v_debit <> 10 OR v_credit <> 10 THEN
    RAISE EXCEPTION 'ACCEPTANCE_149_FAIL: zero-VAT journal mismatch lines=% %=%',
      v_lines,v_debit,v_credit;
  END IF;
END $$;

-- Ledger is append-only at the database boundary.
SELECT pg_temp.expect_error(format(
  'UPDATE public.supplier_invoice_receipt_allocations SET quantity_base=99 WHERE id=%L',
  (SELECT id FROM public.supplier_invoice_receipt_allocations LIMIT 1)),
  'AP_ALLOCATION_IMMUTABLE');
SELECT pg_temp.expect_error(format(
  'DELETE FROM public.supplier_invoice_receipt_allocations WHERE id=%L',
  (SELECT id FROM public.supplier_invoice_receipt_allocations LIMIT 1)),
  'AP_ALLOCATION_IMMUTABLE');

SELECT 'ACCEPTANCE_149_PASS' AS result;
