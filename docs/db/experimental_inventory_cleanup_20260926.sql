-- One-off correction of explicitly identified pre-Staging demo fixtures in Production.
-- Project: Manufacturing Process / uutfztmqvajmsxnrqeiv. Never run on a different project.
-- Apply only after an independent review of this exact file and a fresh baseline readback.
-- Run as one transaction; a failed assertion rolls back every change including the audit.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $cleanup$
DECLARE
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_products constant uuid[] := ARRAY[
    'dfcfc164-2df9-4b14-9fe2-d40e4d5ae130', -- 001, already corrected
    '6abae4dd-d4c3-4c48-88fa-d2464642d448', -- RM-010
    'c23c93c8-5364-4b50-bc27-dcc36b1e69cf'  -- RM-042
  ]::uuid[];
  v_receipts constant uuid[] := ARRAY[
    '4b0c010f-e831-4f5f-9517-84d3da83b536',
    '5f9fd991-d424-4301-a4e0-fc5f1db46050',
    'b4a3e400-868b-4ac6-8fdb-b84cb5804114'
  ]::uuid[];
  v_orders constant uuid[] := ARRAY[
    '64b3d8da-20ce-4eb9-88c2-eb5456b02636',
    '07b821d3-340a-4828-99a0-49043fc75a60'
  ]::uuid[];
  v_adjustment constant uuid := 'f55f6888-852d-46be-8bb8-a218f2920735';
  v_pp uuid;
  v_before jsonb;
  v_after jsonb;
  v_audit_id uuid;
BEGIN
  -- This is a data repair, not a migration. Hold the exact affected rows while
  -- checking for intervening writes. Every source row is kept for auditability.
  SELECT id INTO STRICT v_pp FROM public.products WHERE org_id=v_org AND code='PP810837' FOR UPDATE;
  PERFORM 1 FROM public.products WHERE id=ANY(v_products[1:3]) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.bins WHERE product_id=ANY(v_products[2:3]) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.stock_ledger_entries
    WHERE product_id=ANY(ARRAY[v_products[2],v_products[3],v_pp]) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.goods_receipts WHERE id=ANY(v_receipts) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.purchase_orders WHERE id=ANY(v_orders) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.purchase_order_lines WHERE purchase_order_id=ANY(v_orders) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.gl_entries WHERE reference_type='GOODS_RECEIPT'
    AND reference_number=ANY(ARRAY[v_receipts[2]::text,v_receipts[3]::text]) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.stock_adjustments WHERE id=v_adjustment FOR UPDATE;

  IF (SELECT count(*) FROM public.products WHERE org_id=v_org AND id=ANY(v_products[1:3]))<>3
     OR (SELECT count(*) FROM public.products WHERE org_id=v_org AND id=v_pp)<>1
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_products[1] AND code='001' AND stock_quantity=0 AND stock_value=0)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_products[2] AND code='RM-010' AND stock_quantity=500 AND stock_value=0)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_products[3] AND code='RM-042' AND stock_quantity=500 AND stock_value=0)
     OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_pp AND stock_quantity=0 AND stock_value=0)
  THEN RAISE EXCEPTION 'DEMO_FIX_PRODUCTS_CHANGED'; END IF;

  IF (SELECT count(*) FROM public.bins WHERE product_id=ANY(ARRAY[v_products[1],v_products[2],v_products[3],v_pp]))<>2
     OR NOT EXISTS (SELECT 1 FROM public.bins WHERE org_id=v_org AND product_id=v_products[2] AND actual_qty=500 AND stock_value=1000)
     OR NOT EXISTS (SELECT 1 FROM public.bins WHERE org_id=v_org AND product_id=v_products[3] AND actual_qty=500 AND stock_value=3250)
     OR (SELECT count(*) FROM public.stock_ledger_entries WHERE product_id=ANY(ARRAY[v_products[1],v_products[2],v_products[3],v_pp]))<>5
     OR (SELECT count(*) FROM public.stock_ledger_entries WHERE org_id=v_org AND product_id=ANY(ARRAY[v_products[2],v_products[3],v_pp]) AND docstatus=1 AND COALESCE(is_cancelled,false)=false)<>5
     OR (SELECT coalesce(sum(stock_value_difference),0) FROM public.stock_ledger_entries WHERE product_id=ANY(ARRAY[v_products[2],v_products[3],v_pp]))<>14250
     OR (SELECT count(*) FROM public.stock_ledger_entries WHERE org_id=v_org AND product_id=v_pp
           AND voucher_type='Stock Adjustment' AND voucher_id=v_adjustment
           AND actual_qty=200 AND stock_value_difference=5000 AND stock_value=5000 AND source_line_id IS NULL)<>2
     OR (SELECT count(*) FROM public.stock_ledger_entries WHERE org_id=v_org AND product_id=v_products[2]
           AND voucher_type='Goods Receipt' AND voucher_id=v_receipts[2]
           AND actual_qty=250 AND stock_value_difference=500 AND stock_value=500 AND source_line_id IS NULL)<>1
     OR (SELECT count(*) FROM public.stock_ledger_entries WHERE org_id=v_org AND product_id=v_products[2]
           AND voucher_type='Goods Receipt' AND voucher_id=v_receipts[3]
           AND actual_qty=250 AND stock_value_difference=500 AND stock_value=1000 AND source_line_id IS NULL)<>1
     OR (SELECT count(*) FROM public.stock_ledger_entries WHERE org_id=v_org AND product_id=v_products[3]
           AND voucher_type='Goods Receipt' AND voucher_id=v_receipts[1]
           AND actual_qty=500 AND stock_value_difference=3250 AND stock_value=3250 AND source_line_id IS NULL)<>1
  THEN RAISE EXCEPTION 'DEMO_FIX_STOCK_CHANGED'; END IF;

  IF (SELECT count(*) FROM public.goods_receipts WHERE id=ANY(v_receipts) AND org_id=v_org)<>3
     OR (SELECT count(*) FROM public.goods_receipts WHERE id=v_receipts[1] AND status='draft')<>1
     OR (SELECT count(*) FROM public.goods_receipts WHERE id=ANY(v_receipts[2:3]) AND status='confirmed')<>2
     OR (SELECT count(*) FROM public.goods_receipt_lines WHERE goods_receipt_id=ANY(v_receipts))<>3
     OR (SELECT count(*) FROM public.supplier_invoices WHERE goods_receipt_id=ANY(v_receipts) OR purchase_order_id=ANY(v_orders))<>0
     OR (SELECT count(*) FROM public.purchase_orders WHERE id=ANY(v_orders) AND org_id=v_org AND status='fully_received')<>2
     OR (SELECT count(*) FROM public.purchase_order_lines WHERE purchase_order_id=ANY(v_orders) AND received_quantity=500 AND accepted_quantity=500 AND rejected_quantity=0)<>2
     OR (SELECT count(*) FROM public.gl_entries WHERE reference_type='GOODS_RECEIPT' AND reference_number=ANY(ARRAY[v_receipts[2]::text,v_receipts[3]::text]) AND status='draft')<>2
     OR NOT EXISTS (SELECT 1 FROM public.stock_adjustments WHERE id=v_adjustment AND status='SUBMITTED' AND canonical_gl_entry_id IS NULL AND journal_entry_id IS NULL AND total_value_difference=5000)
  THEN RAISE EXCEPTION 'DEMO_FIX_DOCUMENTS_CHANGED'; END IF;

  SELECT jsonb_build_object(
    'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t WHERE id=ANY(ARRAY[v_products[2],v_products[3],v_pp])),
    'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t WHERE product_id=ANY(ARRAY[v_products[2],v_products[3]])),
    'stock_ledger_entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t WHERE product_id=ANY(ARRAY[v_products[2],v_products[3],v_pp])),
    'goods_receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.goods_receipts t WHERE id=ANY(v_receipts)),
    'purchase_orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_orders t WHERE id=ANY(v_orders)),
    'purchase_order_lines',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_order_lines t WHERE purchase_order_id=ANY(v_orders)),
    'gl_entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.gl_entries t WHERE reference_type='GOODS_RECEIPT' AND reference_number=ANY(ARRAY[v_receipts[2]::text,v_receipts[3]::text])),
    'stock_adjustments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_adjustments t WHERE id=v_adjustment)
  ) INTO v_before;

  -- Retire orphaned/duplicated source movements without deleting their history.
  UPDATE public.stock_ledger_entries SET is_cancelled=true, modified_at=now()
    WHERE org_id=v_org AND product_id=ANY(ARRAY[v_products[2],v_products[3],v_pp]) AND COALESCE(is_cancelled,false)=false;
  UPDATE public.bins SET actual_qty=0,stock_value=0,valuation_rate=0,stock_queue='[]'::jsonb,updated_at=now()
    WHERE org_id=v_org AND product_id=ANY(v_products[2:3]);
  UPDATE public.products SET stock_quantity=0,stock_value=0,updated_at=now()
    WHERE org_id=v_org AND id=ANY(v_products[2:3]);
  UPDATE public.gl_entries SET status='cancelled'
    WHERE org_id=v_org AND reference_type='GOODS_RECEIPT'
      AND reference_number=ANY(ARRAY[v_receipts[2]::text,v_receipts[3]::text]) AND status='draft';
  UPDATE public.goods_receipts SET status='cancelled' WHERE org_id=v_org AND id=ANY(v_receipts);
  UPDATE public.purchase_order_lines SET received_quantity=0,accepted_quantity=0,rejected_quantity=0
    WHERE purchase_order_id=ANY(v_orders);
  UPDATE public.purchase_orders SET status='cancelled' WHERE org_id=v_org AND id=ANY(v_orders);
  UPDATE public.stock_adjustments SET status='CANCELLED',cancelled_at=now(),
      cancellation_reason='Owner-authorized cleanup of pre-Staging demo stock movements; historical rows retained',
      updated_at=now() WHERE id=v_adjustment;

  IF (SELECT count(*) FROM public.stock_ledger_entries WHERE org_id=v_org AND COALESCE(is_cancelled,false)=false)<>0
     OR (SELECT count(*) FROM public.bins WHERE org_id=v_org AND (COALESCE(actual_qty,0)<>0 OR COALESCE(stock_value,0)<>0))<>0
     OR (SELECT count(*) FROM public.products WHERE org_id=v_org AND (COALESCE(stock_quantity,0)<>0 OR COALESCE(stock_value,0)<>0))<>0
     OR (SELECT count(*) FROM public.goods_receipts WHERE id=ANY(v_receipts) AND status='cancelled')<>3
     OR (SELECT count(*) FROM public.purchase_orders WHERE id=ANY(v_orders) AND status='cancelled')<>2
     OR (SELECT count(*) FROM public.purchase_order_lines WHERE purchase_order_id=ANY(v_orders) AND received_quantity=0 AND accepted_quantity=0 AND rejected_quantity=0)<>2
     OR (SELECT count(*) FROM public.gl_entries WHERE reference_type='GOODS_RECEIPT' AND reference_number=ANY(ARRAY[v_receipts[2]::text,v_receipts[3]::text]) AND status='cancelled')<>2
     OR NOT EXISTS (SELECT 1 FROM public.stock_adjustments WHERE id=v_adjustment AND status='CANCELLED')
  THEN RAISE EXCEPTION 'DEMO_FIX_POSTFLIGHT_FAILED'; END IF;

  SELECT jsonb_build_object(
    'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.products t WHERE id=ANY(ARRAY[v_products[2],v_products[3],v_pp])),
    'bins',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.bins t WHERE product_id=ANY(ARRAY[v_products[2],v_products[3]])),
    'stock_ledger_entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_ledger_entries t WHERE product_id=ANY(ARRAY[v_products[2],v_products[3],v_pp])),
    'goods_receipts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.goods_receipts t WHERE id=ANY(v_receipts)),
    'purchase_orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_orders t WHERE id=ANY(v_orders)),
    'purchase_order_lines',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.purchase_order_lines t WHERE purchase_order_id=ANY(v_orders)),
    'gl_entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.gl_entries t WHERE reference_type='GOODS_RECEIPT' AND reference_number=ANY(ARRAY[v_receipts[2]::text,v_receipts[3]::text])),
    'stock_adjustments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.stock_adjustments t WHERE id=v_adjustment)
  ) INTO v_after;
  INSERT INTO public.audit_logs(org_id,action,entity_type,entity_id,old_data,new_data,changes,metadata)
  VALUES(v_org,'experimental_fixture_cleanup','inventory_fixture','2026-09-26-M191-preflight',
         v_before,v_after,jsonb_build_object('before',v_before,'after',v_after),
         jsonb_build_object('reason','Owner confirmed all identified inventory records predate Staging and are test fixtures',
                            'scope','3 goods receipts, 2 purchase orders, 2 draft GL entries, 5 SLE rows, 2 bins, 2 products, 1 stock adjustment',
                            'approach','Retain historical rows and cancel their active effects')) RETURNING id INTO v_audit_id;
  IF v_audit_id IS NULL THEN RAISE EXCEPTION 'DEMO_FIX_AUDIT_FAILED'; END IF;
END $cleanup$;

-- Replace COMMIT with ROLLBACK for a dry run; do not modify anything else.
COMMIT;
