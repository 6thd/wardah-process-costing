-- migration_number: 133
-- description: Make goods receipt and delivery UoM-aware and route both through
--              the legal atomic stock ledger. COGS is taken from actual SLE valuation.
-- safety: replace-only RPCs + additive snapshot columns. No client-side valuation.

ALTER TABLE public.delivery_notes
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS request_hash text;

CREATE OR REPLACE FUNCTION public.rpc_post_goods_receipt(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_uid uuid; v_gr_id uuid; v_gr_number text; v_po_id uuid;
  v_po_status text; v_po_vendor uuid; v_vendor_id uuid; v_wh_id uuid;
  v_idem_key text; v_req_hash text; v_existing_id uuid; v_existing_no text; v_existing_hash text;
  v_line jsonb; v_line_no integer:=0; v_product uuid; v_uom uuid;
  v_qty_entered numeric; v_qty_base numeric; v_ordered_entered numeric; v_ordered_base numeric;
  v_factor numeric; v_cost_entered numeric; v_cost_base numeric; v_quality text;
  v_total numeric:=0; v_pol record; v_pol_id uuid; v_recv_date date; v_stock jsonb;
BEGIN
  v_org:=public.wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  v_uid:=auth.uid(); PERFORM public.wardah_assert_org_member(v_org);
  v_vendor_id:=NULLIF(p_payload->>'vendor_id','')::uuid;
  IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: vendor_id required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id=v_vendor_id AND org_id=v_org) THEN RAISE EXCEPTION 'VENDOR_NOT_FOUND'; END IF;
  IF jsonb_typeof(COALESCE(p_payload->'lines','[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_payload->'lines','[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: receipt lines required'; END IF;
  v_wh_id:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  IF v_wh_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id=v_wh_id AND org_id=v_org) THEN
    RAISE EXCEPTION 'WAREHOUSE_REQUIRED_OR_WRONG_ORG'; END IF;

  v_po_id:=NULLIF(p_payload->>'purchase_order_id','')::uuid;
  IF v_po_id IS NOT NULL THEN
    SELECT status,vendor_id INTO v_po_status,v_po_vendor FROM public.purchase_orders WHERE id=v_po_id AND org_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
    IF v_po_status NOT IN ('approved','submitted','partially_received') THEN RAISE EXCEPTION 'PO_NOT_RECEIVABLE: %',v_po_status; END IF;
    IF v_po_vendor IS NOT NULL AND v_po_vendor<>v_vendor_id THEN RAISE EXCEPTION 'VENDOR_MISMATCH'; END IF;
  END IF;

  v_recv_date:=COALESCE(NULLIF(p_payload->>'receipt_date','')::date,CURRENT_DATE);
  PERFORM public.assert_period_open(v_org,v_recv_date);
  PERFORM pg_advisory_xact_lock(hashtext('goods_receipts:'||v_org::text));
  v_req_hash:=md5((p_payload-'idempotency_key')::text); v_idem_key:=NULLIF(p_payload->>'idempotency_key','');
  IF v_idem_key IS NOT NULL THEN
    SELECT id,receipt_number,request_hash INTO v_existing_id,v_existing_no,v_existing_hash
    FROM public.goods_receipts WHERE org_id=v_org AND idempotency_key=v_idem_key;
    IF FOUND THEN
      IF v_existing_hash IS NULL OR v_existing_hash<>v_req_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
      RETURN jsonb_build_object('success',true,'goods_receipt_id',v_existing_id,'receipt_number',v_existing_no,
        'idempotent_replay',true,'inventory_atomic',true,'uom_atomic',true);
    END IF;
  END IF;

  SELECT 'GR-'||lpad((COALESCE(max(NULLIF(regexp_replace(receipt_number,'\D','','g'),''))::bigint,0)+1)::text,6,'0')
  INTO v_gr_number FROM public.goods_receipts WHERE org_id=v_org AND receipt_number~'^GR-\d+$';
  v_gr_number:=COALESCE(v_gr_number,'GR-000001');
  INSERT INTO public.goods_receipts(org_id,receipt_number,purchase_order_id,vendor_id,receipt_date,warehouse_id,
    warehouse_location,receiver_name,status,notes,idempotency_key,request_hash,created_by)
  VALUES(v_org,v_gr_number,v_po_id,v_vendor_id,v_recv_date,v_wh_id,NULLIF(p_payload->>'warehouse_location',''),
    NULLIF(p_payload->>'receiver_name',''),'confirmed',NULLIF(p_payload->>'notes',''),v_idem_key,v_req_hash,v_uid)
  RETURNING id INTO v_gr_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    v_line_no:=v_line_no+1; v_product:=NULLIF(v_line->>'product_id','')::uuid;
    IF v_product IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id=v_product AND org_id=v_org) THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: line=%',v_line_no; END IF;
    SELECT COALESCE(NULLIF(v_line->>'uom_id','')::uuid,p.base_uom_id) INTO v_uom
    FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=COALESCE(NULLIF(v_line->>'qty_entered','')::numeric,NULLIF(v_line->>'received_quantity','')::numeric);
    v_ordered_entered:=COALESCE(NULLIF(v_line->>'ordered_qty_entered','')::numeric,
      NULLIF(v_line->>'ordered_quantity','')::numeric,v_qty_entered);
    v_cost_entered:=COALESCE(NULLIF(v_line->>'unit_cost_entered','')::numeric,NULLIF(v_line->>'unit_cost','')::numeric);
    IF v_qty_entered IS NULL OR v_qty_entered<0 OR v_ordered_entered IS NULL OR v_ordered_entered<0
       OR v_cost_entered IS NULL OR v_cost_entered<0 THEN RAISE EXCEPTION 'INVALID_LINE: line=%',v_line_no; END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,v_recv_date::timestamptz);
    v_qty_base:=round(v_qty_entered*v_factor,6); v_ordered_base:=round(v_ordered_entered*v_factor,6);
    v_cost_base:=round(v_cost_entered/v_factor,6); v_quality:=COALESCE(NULLIF(v_line->>'quality_status',''),'accepted');

    v_pol_id:=NULLIF(v_line->>'purchase_order_line_id','')::uuid;
    IF v_pol_id IS NOT NULL THEN
      IF v_po_id IS NULL THEN RAISE EXCEPTION 'PO_REQUIRED: line=%',v_line_no; END IF;
      SELECT purchase_order_id,product_id,quantity,COALESCE(received_quantity,0) AS received INTO v_pol
      FROM public.purchase_order_lines WHERE id=v_pol_id AND org_id=v_org FOR UPDATE;
      IF NOT FOUND OR v_pol.purchase_order_id<>v_po_id THEN RAISE EXCEPTION 'INVALID_PO_LINE: line=%',v_line_no; END IF;
      IF v_pol.product_id<>v_product THEN RAISE EXCEPTION 'PRODUCT_MISMATCH'; END IF;
      IF v_pol.received+v_qty_base>v_pol.quantity THEN RAISE EXCEPTION 'OVER_RECEIPT: remaining=%, requested_base=%',v_pol.quantity-v_pol.received,v_qty_base; END IF;
      v_ordered_base:=v_pol.quantity;
      UPDATE public.purchase_order_lines SET received_quantity=v_pol.received+v_qty_base WHERE id=v_pol_id;
    END IF;

    INSERT INTO public.goods_receipt_lines(org_id,goods_receipt_id,purchase_order_line_id,product_id,
      ordered_quantity,received_quantity,unit_cost,quality_status,notes,uom_id,qty_entered,conversion_factor_snapshot,unit_cost_entered)
    VALUES(v_org,v_gr_id,v_pol_id,v_product,v_ordered_base,v_qty_base,v_cost_base,v_quality,NULLIF(v_line->>'notes',''),
      v_uom,v_qty_entered,v_factor,v_cost_entered);
    IF v_quality='accepted' AND v_qty_base>0 THEN
      v_stock:=public.wardah_apply_stock_incoming(v_org,v_product,v_wh_id,v_qty_base,v_cost_base,
        'Goods Receipt',v_gr_id,v_gr_number,v_recv_date);
      IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN RAISE EXCEPTION 'STOCK_IN_NOT_APPLIED: %',v_stock; END IF;
      v_total:=v_total+(v_qty_base*v_cost_base);
    END IF;
  END LOOP;

  IF v_po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po SET status=CASE WHEN NOT EXISTS(
      SELECT 1 FROM public.purchase_order_lines l WHERE l.purchase_order_id=po.id AND COALESCE(l.received_quantity,0)<l.quantity
    ) THEN 'fully_received' ELSE 'partially_received' END WHERE po.id=v_po_id;
  END IF;
  IF v_total>0 THEN PERFORM public.rpc_post_event_journal('GR_RECEIPT',v_total,'استلام بضاعة '||v_gr_number,
    'GOODS_RECEIPT',v_gr_id,v_org,'GR_RECEIPT:'||v_gr_id::text,NULL); END IF;
  RETURN jsonb_build_object('success',true,'goods_receipt_id',v_gr_id,'receipt_number',v_gr_number,
    'total_value',round(v_total,6),'lines_processed',v_line_no,'inventory_atomic',true,'uom_atomic',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_post_delivery_note(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_uid uuid; v_dn_id uuid; v_dn_number text; v_invoice_id uuid;
  v_inv_customer uuid; v_payload_customer uuid; v_idem_key text; v_req_hash text;
  v_existing_id uuid; v_existing_no text; v_existing_hash text; v_allow_over boolean;
  v_line jsonb; v_inv_line record; v_product uuid; v_uom uuid; v_qty_entered numeric;
  v_qty_base numeric; v_factor numeric; v_root_warehouse uuid; v_warehouse uuid; v_bin_count integer;
  v_stock jsonb; v_line_cogs numeric; v_unit_cost numeric; v_total_cogs numeric:=0; v_line_no integer:=0; v_date date;
BEGIN
  v_org:=public.wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  v_uid:=auth.uid(); PERFORM public.wardah_assert_org_member(v_org);
  v_invoice_id:=NULLIF(p_payload->>'sales_invoice_id','')::uuid;
  IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: sales_invoice_id required'; END IF;
  IF jsonb_typeof(COALESCE(p_payload->'lines','[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_payload->'lines','[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: delivery lines required'; END IF;
  v_allow_over:=COALESCE(NULLIF(p_payload->>'allow_over_delivery','')::boolean,false);
  IF v_allow_over AND NOT public.wardah_is_org_admin(v_org) THEN v_allow_over:=false; END IF;
  v_date:=COALESCE(NULLIF(p_payload->>'delivery_date','')::date,CURRENT_DATE); PERFORM public.assert_period_open(v_org,v_date);
  v_root_warehouse:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  IF v_root_warehouse IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=v_root_warehouse AND org_id=v_org) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND_OR_WRONG_ORG'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('delivery_notes:'||v_org::text));
  v_req_hash:=md5((p_payload-'idempotency_key')::text); v_idem_key:=NULLIF(p_payload->>'idempotency_key','');
  IF v_idem_key IS NOT NULL THEN
    SELECT id,delivery_number,request_hash INTO v_existing_id,v_existing_no,v_existing_hash
    FROM public.delivery_notes WHERE org_id=v_org AND idempotency_key=v_idem_key;
    IF FOUND THEN
      IF v_existing_hash IS NULL OR v_existing_hash<>v_req_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
      SELECT COALESCE(sum(quantity_delivered*unit_cost_at_delivery),0) INTO v_total_cogs
      FROM public.delivery_note_lines WHERE delivery_note_id=v_existing_id;
      RETURN jsonb_build_object('success',true,'delivery_id',v_existing_id,'delivery_number',v_existing_no,
        'total_cogs',round(v_total_cogs,6),'idempotent_replay',true,'inventory_atomic',true,'uom_atomic',true);
    END IF;
  END IF;

  SELECT customer_id INTO v_inv_customer FROM public.sales_invoices WHERE id=v_invoice_id AND org_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  v_payload_customer:=NULLIF(p_payload->>'customer_id','')::uuid;
  IF v_payload_customer IS NOT NULL AND v_payload_customer<>v_inv_customer THEN RAISE EXCEPTION 'CUSTOMER_MISMATCH'; END IF;
  SELECT 'DN-'||lpad((COALESCE(max(NULLIF(regexp_replace(delivery_number,'\D','','g'),''))::bigint,0)+1)::text,6,'0')
    INTO v_dn_number FROM public.delivery_notes WHERE org_id=v_org AND delivery_number~'^DN-\d+$';
  v_dn_number:=COALESCE(v_dn_number,'DN-000001');
  INSERT INTO public.delivery_notes(org_id,delivery_number,sales_invoice_id,customer_id,delivery_date,warehouse_id,
    vehicle_number,driver_name,status,notes,idempotency_key,request_hash,created_by)
  VALUES(v_org,v_dn_number,v_invoice_id,v_inv_customer,v_date,v_root_warehouse,NULLIF(p_payload->>'vehicle_number',''),
    NULLIF(p_payload->>'driver_name',''),'delivered',NULLIF(p_payload->>'notes',''),v_idem_key,v_req_hash,v_uid)
  RETURNING id INTO v_dn_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    v_line_no:=v_line_no+1;
    IF NULLIF(v_line->>'sales_invoice_line_id','') IS NULL THEN RAISE EXCEPTION 'LINE_REQUIRED: sales_invoice_line_id line=%',v_line_no; END IF;
    SELECT id,product_id,quantity,unit_price,COALESCE(delivered_quantity,0) AS delivered INTO v_inv_line
    FROM public.sales_invoice_lines WHERE id=(v_line->>'sales_invoice_line_id')::uuid AND invoice_id=v_invoice_id AND org_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INVOICE_LINE: line=%',v_line_no; END IF;
    v_product:=v_inv_line.product_id;
    IF NULLIF(v_line->>'item_id','') IS NOT NULL AND (v_line->>'item_id')::uuid<>v_product THEN RAISE EXCEPTION 'PRODUCT_MISMATCH: line=%',v_line_no; END IF;
    SELECT COALESCE(NULLIF(v_line->>'uom_id','')::uuid,p.base_uom_id) INTO v_uom FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=COALESCE(NULLIF(v_line->>'qty_entered','')::numeric,NULLIF(v_line->>'delivered_quantity','')::numeric);
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN RAISE EXCEPTION 'INVALID_DELIVERY_QUANTITY: line=%',v_line_no; END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,v_date::timestamptz); v_qty_base:=round(v_qty_entered*v_factor,6);
    IF NOT v_allow_over AND v_inv_line.delivered+v_qty_base>v_inv_line.quantity THEN
      RAISE EXCEPTION 'OVER_DELIVERY: remaining=%, requested_base=%',v_inv_line.quantity-v_inv_line.delivered,v_qty_base; END IF;
    v_warehouse:=COALESCE(NULLIF(v_line->>'warehouse_id','')::uuid,v_root_warehouse);
    IF v_warehouse IS NULL THEN
      SELECT count(*),min(warehouse_id) INTO v_bin_count,v_warehouse FROM public.bins
      WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_bin_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_DELIVERY'; END IF;
    END IF;
    v_stock:=public.wardah_apply_stock_outgoing(v_org,v_product,v_warehouse,v_qty_base,
      'Delivery Note',v_dn_id,v_dn_number,v_date);
    IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN RAISE EXCEPTION 'STOCK_OUT_NOT_APPLIED: %',v_stock; END IF;
    v_line_cogs:=COALESCE((v_stock->>'cogs')::numeric,0); v_unit_cost:=CASE WHEN v_qty_base>0 THEN v_line_cogs/v_qty_base ELSE 0 END;
    v_total_cogs:=v_total_cogs+v_line_cogs;
    INSERT INTO public.delivery_note_lines(org_id,delivery_note_id,sales_invoice_line_id,product_id,invoiced_quantity,
      delivered_quantity,quantity_delivered,unit_price,unit_cost_at_delivery,notes,uom_id,qty_entered,
      conversion_factor_snapshot,unit_price_entered,warehouse_id)
    VALUES(v_org,v_dn_id,v_inv_line.id,v_product,v_inv_line.quantity,v_qty_base,v_qty_base,v_inv_line.unit_price,
      v_unit_cost,NULLIF(v_line->>'notes',''),v_uom,v_qty_entered,v_factor,
      COALESCE(NULLIF(v_line->>'unit_price_entered','')::numeric,v_inv_line.unit_price*v_factor),v_warehouse);
    UPDATE public.sales_invoice_lines
    SET delivered_quantity=v_inv_line.delivered+v_qty_base,
        unit_cost_at_sale=v_unit_cost
    WHERE id=v_inv_line.id;
  END LOOP;

  IF v_total_cogs>0 THEN PERFORM public.rpc_post_event_journal('COGS_DELIVERY',v_total_cogs,
    'تكلفة بضاعة مباعة - '||v_dn_number,'DELIVERY_NOTE',v_dn_id,v_org,'COGS_DELIVERY:'||v_dn_id::text,NULL); END IF;
  UPDATE public.sales_invoices si SET delivery_status=CASE WHEN NOT EXISTS(
    SELECT 1 FROM public.sales_invoice_lines l WHERE l.invoice_id=si.id AND COALESCE(l.delivered_quantity,0)<l.quantity
  ) THEN 'fully_delivered' ELSE 'partially_delivered' END WHERE si.id=v_invoice_id;
  RETURN jsonb_build_object('success',true,'delivery_id',v_dn_id,'delivery_number',v_dn_number,
    'total_cogs',round(v_total_cogs,6),'lines_processed',v_line_no,'inventory_atomic',true,'uom_atomic',true,'warnings','[]'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_post_delivery_note(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_delivery_note(jsonb) TO authenticated;
COMMENT ON FUNCTION public.rpc_post_delivery_note(jsonb) IS
  'Atomic UoM-aware delivery. Actual per-delivery COGS remains authoritative in delivery_note_lines and SLE; the generated invoice-line cogs column is not assigned.';