-- Wardah ERP / F2 / M191 review slice 06
-- Object 8 only: rpc_post_delivery_note(jsonb) — Fix E (delivery note).
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 133, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the existing invoice header/customer gates, lock every payload-
--     referenced same-org sales_invoice_lines row in deterministic sil.id order;
--   * extract the distinct product set from those already-locked rows and acquire
--     the shared deterministic whole-call product prefix once;
--   * inside the unchanged sequential loop, after resolving v_product from the
--     freshly re-read invoice line, fail closed if it is outside the prelocked set.
--
-- Preserved deliberately:
--   * idempotent replay and advisory-lock placement;
--   * invoice/customer/period/warehouse validation and their error order;
--   * delivery-number allocation and delivery-note insert;
--   * the loop's own per-occurrence SELECT ... FOR UPDATE and fresh reads of
--     quantity, unit_price, and delivered_quantity;
--   * duplicate sales_invoice_line_id behavior and cumulative weighted-average
--     unit_cost_at_sale calculation;
--   * UoM conversion, over-delivery, warehouse inference, canonical outgoing,
--     delivery-note line write, COGS journal, invoice delivery status, return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- The pre-pass is intentionally non-throwing for malformed/missing line ids.
-- DISTINCT is outside the row-locking subquery: PostgreSQL rejects DISTINCT and
-- FOR UPDATE in the same query level. ORDER BY sil.id precedes FOR UPDATE OF sil.
-- The pre-pass supplies identity/locking only; it does not replace the loop's
-- fresh business-state read.

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
  v_products uuid[];
  v_locked_products uuid[];
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

  -- M191 Fix E: freeze the payload-referenced invoice-line identity rows before
  -- acquiring products. Invalid/missing ids are excluded without raising so the
  -- unchanged loop remains authoritative for LINE_REQUIRED/INVALID_INVOICE_LINE
  -- and raw-cast ordering. The inner query locks rows deterministically; DISTINCT
  -- is deliberately applied only after those rows have been locked.
  v_products := ARRAY(
    SELECT DISTINCT product_id
    FROM (
      SELECT sil.product_id
      FROM jsonb_array_elements(p_payload->'lines') AS line(value)
      JOIN public.sales_invoice_lines sil
        ON sil.invoice_id = v_invoice_id
       AND sil.org_id = v_org
       AND sil.id = CASE
                      WHEN pg_input_is_valid(
                        line.value->>'sales_invoice_line_id', 'uuid')
                      THEN (line.value->>'sales_invoice_line_id')::uuid
                      ELSE NULL
                    END
      ORDER BY sil.id
      FOR UPDATE OF sil
    ) locked
  );
  v_locked_products :=
    public.wardah_lock_products_for_stock_write(v_org, v_products);

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
    IF v_product IS NULL
       OR NOT COALESCE(v_product = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_product;
    END IF;
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
    -- Cumulative weighted average across partial deliveries, so the generated
    -- invoice-line cogs equals the exact summed delivery COGS once fully delivered.
    UPDATE public.sales_invoice_lines
    SET delivered_quantity=v_inv_line.delivered+v_qty_base,
        unit_cost_at_sale=round(
          (v_inv_line.delivered*COALESCE(unit_cost_at_sale,0)+v_line_cogs)
          /(v_inv_line.delivered+v_qty_base),6)
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
