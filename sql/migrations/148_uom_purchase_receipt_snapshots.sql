-- migration_number: 148
-- description: Add tenant-scoped receivable-PO reads and make PO-linked goods
--              receipts use the immutable purchase-order UoM snapshots.
-- safety: replace-only RPCs plus one additive read RPC. No historical rows,
--         tables, columns, policies, or triggers are removed.

CREATE OR REPLACE FUNCTION public.rpc_list_uom_receivable_purchase_orders(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_enabled boolean := false;
BEGIN
  v_org := public.wardah_org_id(p_org_id);
  PERFORM public.wardah_assert_org_member(v_org);

  SELECT CASE
    WHEN jsonb_typeof(os.value -> 'enabled') = 'boolean'
      THEN (os.value ->> 'enabled')::boolean
    WHEN lower(COALESCE(os.value ->> 'enabled', '')) IN ('true', 'false')
      THEN (os.value ->> 'enabled')::boolean
    ELSE false
  END
  INTO v_enabled
  FROM public.org_settings os
  WHERE os.org_id = v_org
    AND os.key = 'uom_engine_enabled'
  LIMIT 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'UOM_ENGINE_NOT_ENABLED_FOR_ORG';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', po.id,
        'order_number', po.order_number,
        'vendor_id', po.vendor_id,
        'vendor', jsonb_build_object(
          'id', v.id,
          'code', v.code,
          'name', v.name
        ),
        'order_date', po.order_date,
        'expected_delivery_date', po.expected_delivery_date,
        'status', po.status,
        'total_amount', COALESCE(po.total_amount, 0),
        'lines', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', pol.id,
              'line_number', pol.line_number,
              'product_id', pol.product_id,
              'product', jsonb_build_object(
                'code', p.code,
                'name', p.name,
                'name_ar', p.name_ar
              ),
              'uom_id', COALESCE(pol.uom_id, p.base_uom_id),
              'uom', jsonb_build_object(
                'id', u.id,
                'code', u.code,
                'name', u.name,
                'name_ar', u.name_ar,
                'symbol', u.symbol,
                'decimal_places', u.decimal_places
              ),
              'conversion_factor_snapshot',
                COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
              'ordered_qty_entered', COALESCE(
                pol.qty_entered,
                round(pol.quantity / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1), 6)
              ),
              'ordered_qty_base', pol.quantity,
              'received_qty_entered', round(
                COALESCE(pol.received_quantity, 0)
                / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
                6
              ),
              'received_qty_base', COALESCE(pol.received_quantity, 0),
              'remaining_qty_entered', round(
                GREATEST(pol.quantity - COALESCE(pol.received_quantity, 0), 0)
                / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
                6
              ),
              'remaining_qty_base',
                GREATEST(pol.quantity - COALESCE(pol.received_quantity, 0), 0),
              'unit_cost_entered', COALESCE(
                pol.unit_price_entered,
                round(pol.unit_price * COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1), 6)
              ),
              'unit_cost_base', pol.unit_price
            ) ORDER BY pol.line_number, pol.id
          )
          FROM public.purchase_order_lines pol
          JOIN public.products p
            ON p.id = pol.product_id
           AND p.org_id = v_org
          LEFT JOIN public.uoms u
            ON u.id = COALESCE(pol.uom_id, p.base_uom_id)
           AND (u.org_id IS NULL OR u.org_id = v_org)
          WHERE pol.purchase_order_id = po.id
            AND pol.org_id = v_org
            AND COALESCE(pol.received_quantity, 0) < pol.quantity
        ), '[]'::jsonb)
      ) ORDER BY po.order_date DESC, po.order_number DESC, po.id
    )
    FROM public.purchase_orders po
    JOIN public.vendors v
      ON v.id = po.vendor_id
     AND v.org_id = v_org
    WHERE po.org_id = v_org
      AND po.status IN ('approved', 'submitted', 'partially_received')
      AND EXISTS (
        SELECT 1
        FROM public.purchase_order_lines open_line
        WHERE open_line.purchase_order_id = po.id
          AND open_line.org_id = v_org
          AND COALESCE(open_line.received_quantity, 0) < open_line.quantity
      )
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_post_goods_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid; v_uid uuid; v_gr_id uuid; v_gr_number text; v_po_id uuid;
  v_po_status text; v_po_vendor uuid; v_vendor_id uuid; v_wh_id uuid;
  v_idem_key text; v_req_hash text; v_existing_id uuid; v_existing_no text; v_existing_hash text;
  v_line jsonb; v_line_no integer:=0; v_product uuid; v_uom uuid; v_base_uom uuid;
  v_payload_uom uuid; v_qty_entered numeric; v_qty_base numeric;
  v_ordered_entered numeric; v_ordered_base numeric; v_factor numeric;
  v_cost_entered numeric; v_cost_base numeric; v_payload_cost numeric; v_quality text;
  v_total numeric:=0; v_pol record; v_pol_id uuid; v_recv_date date; v_stock jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GR_PAYLOAD_OBJECT_REQUIRED';
  END IF;

  v_org:=public.wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  v_uid:=auth.uid(); PERFORM public.wardah_assert_org_member(v_org);
  v_vendor_id:=NULLIF(p_payload->>'vendor_id','')::uuid;
  IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: vendor_id required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id=v_vendor_id AND org_id=v_org) THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->'lines','[]'::jsonb))<>'array'
     OR jsonb_array_length(COALESCE(p_payload->'lines','[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: receipt lines required';
  END IF;
  v_wh_id:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  IF v_wh_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses WHERE id=v_wh_id AND org_id=v_org
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_REQUIRED_OR_WRONG_ORG';
  END IF;

  v_po_id:=NULLIF(p_payload->>'purchase_order_id','')::uuid;
  IF v_po_id IS NOT NULL THEN
    SELECT status,vendor_id INTO v_po_status,v_po_vendor
    FROM public.purchase_orders
    WHERE id=v_po_id AND org_id=v_org
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
    IF v_po_status NOT IN ('approved','submitted','partially_received') THEN
      RAISE EXCEPTION 'PO_NOT_RECEIVABLE: %',v_po_status;
    END IF;
    IF v_po_vendor IS NOT NULL AND v_po_vendor<>v_vendor_id THEN
      RAISE EXCEPTION 'VENDOR_MISMATCH';
    END IF;
  END IF;

  v_recv_date:=COALESCE(NULLIF(p_payload->>'receipt_date','')::date,CURRENT_DATE);
  PERFORM public.assert_period_open(v_org,v_recv_date);
  PERFORM pg_advisory_xact_lock(hashtext('goods_receipts:'||v_org::text));
  v_req_hash:=md5((p_payload-'idempotency_key')::text);
  v_idem_key:=NULLIF(p_payload->>'idempotency_key','');
  IF v_idem_key IS NOT NULL THEN
    SELECT id,receipt_number,request_hash INTO v_existing_id,v_existing_no,v_existing_hash
    FROM public.goods_receipts
    WHERE org_id=v_org AND idempotency_key=v_idem_key;
    IF FOUND THEN
      IF v_existing_hash IS NULL OR v_existing_hash<>v_req_hash THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
      END IF;
      RETURN jsonb_build_object(
        'success',true,
        'goods_receipt_id',v_existing_id,
        'receipt_number',v_existing_no,
        'idempotent_replay',true,
        'inventory_atomic',true,
        'uom_atomic',true,
        'po_snapshot_atomic',true
      );
    END IF;
  END IF;

  SELECT 'GR-'||lpad((COALESCE(max(NULLIF(regexp_replace(receipt_number,'\D','','g'),''))::bigint,0)+1)::text,6,'0')
  INTO v_gr_number
  FROM public.goods_receipts
  WHERE org_id=v_org AND receipt_number~'^GR-\d+$';
  v_gr_number:=COALESCE(v_gr_number,'GR-000001');

  INSERT INTO public.goods_receipts(
    org_id,receipt_number,purchase_order_id,vendor_id,receipt_date,warehouse_id,
    warehouse_location,receiver_name,status,notes,idempotency_key,request_hash,created_by
  ) VALUES(
    v_org,v_gr_number,v_po_id,v_vendor_id,v_recv_date,v_wh_id,
    NULLIF(p_payload->>'warehouse_location',''),NULLIF(p_payload->>'receiver_name',''),
    'confirmed',NULLIF(p_payload->>'notes',''),v_idem_key,v_req_hash,v_uid
  ) RETURNING id INTO v_gr_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    v_line_no:=v_line_no+1;
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'GR_LINE_OBJECT_REQUIRED: line=%',v_line_no;
    END IF;

    v_product:=NULLIF(v_line->>'product_id','')::uuid;
    SELECT p.base_uom_id INTO v_base_uom
    FROM public.products p
    WHERE p.id=v_product AND p.org_id=v_org;
    IF v_product IS NULL OR NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: line=%',v_line_no;
    END IF;

    v_qty_entered:=NULLIF(v_line->>'qty_entered','')::numeric;
    IF v_qty_entered IS NULL THEN
      v_qty_entered:=NULLIF(v_line->>'received_quantity','')::numeric;
    END IF;
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
      RAISE EXCEPTION 'RECEIPT_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
    END IF;

    v_quality:=COALESCE(NULLIF(v_line->>'quality_status',''),'accepted');
    IF v_quality NOT IN ('accepted','rejected','pending_inspection') THEN
      RAISE EXCEPTION 'INVALID_QUALITY_STATUS: line=%',v_line_no;
    END IF;

    v_pol_id:=NULLIF(v_line->>'purchase_order_line_id','')::uuid;
    v_payload_uom:=NULLIF(v_line->>'uom_id','')::uuid;
    v_payload_cost:=NULLIF(v_line->>'unit_cost_entered','')::numeric;

    IF v_pol_id IS NOT NULL THEN
      IF v_po_id IS NULL THEN RAISE EXCEPTION 'PO_REQUIRED: line=%',v_line_no; END IF;

      SELECT
        purchase_order_id,
        product_id,
        quantity,
        COALESCE(received_quantity,0) AS received,
        uom_id,
        qty_entered,
        conversion_factor_snapshot,
        unit_price,
        unit_price_entered
      INTO v_pol
      FROM public.purchase_order_lines
      WHERE id=v_pol_id AND org_id=v_org
      FOR UPDATE;

      IF NOT FOUND OR v_pol.purchase_order_id<>v_po_id THEN
        RAISE EXCEPTION 'INVALID_PO_LINE: line=%',v_line_no;
      END IF;
      IF v_pol.product_id<>v_product THEN RAISE EXCEPTION 'PRODUCT_MISMATCH'; END IF;

      v_factor:=COALESCE(NULLIF(v_pol.conversion_factor_snapshot,0),1);
      v_uom:=COALESCE(v_pol.uom_id,v_base_uom);
      v_ordered_base:=v_pol.quantity;
      v_ordered_entered:=COALESCE(v_pol.qty_entered,round(v_pol.quantity/v_factor,6));
      v_cost_base:=v_pol.unit_price;
      v_cost_entered:=COALESCE(v_pol.unit_price_entered,round(v_pol.unit_price*v_factor,6));

      IF v_payload_uom IS NOT NULL AND v_payload_uom<>v_uom THEN
        RAISE EXCEPTION 'RECEIPT_UOM_MISMATCH: line=%',v_line_no;
      END IF;
      IF v_payload_cost IS NOT NULL AND abs(v_payload_cost-v_cost_entered)>0.000001 THEN
        RAISE EXCEPTION 'RECEIPT_COST_MISMATCH: line=%',v_line_no;
      END IF;

      v_qty_base:=round(v_qty_entered*v_factor,6);
      IF v_qty_base<=0 THEN
        RAISE EXCEPTION 'RECEIPT_BASE_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;
      IF v_pol.received+v_qty_base>v_pol.quantity THEN
        RAISE EXCEPTION 'OVER_RECEIPT: remaining=%, requested_base=%',
          v_pol.quantity-v_pol.received,v_qty_base;
      END IF;

      UPDATE public.purchase_order_lines
      SET received_quantity=v_pol.received+v_qty_base
      WHERE id=v_pol_id;
    ELSE
      v_uom:=COALESCE(v_payload_uom,v_base_uom);
      v_ordered_entered:=COALESCE(
        NULLIF(v_line->>'ordered_qty_entered','')::numeric,
        NULLIF(v_line->>'ordered_quantity','')::numeric,
        v_qty_entered
      );
      v_cost_entered:=COALESCE(v_payload_cost,NULLIF(v_line->>'unit_cost','')::numeric);
      IF v_ordered_entered IS NULL OR v_ordered_entered<0
         OR v_cost_entered IS NULL OR v_cost_entered<0 THEN
        RAISE EXCEPTION 'INVALID_LINE: line=%',v_line_no;
      END IF;
      v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,v_recv_date::timestamptz);
      v_qty_base:=round(v_qty_entered*v_factor,6);
      v_ordered_base:=round(v_ordered_entered*v_factor,6);
      v_cost_base:=round(v_cost_entered/v_factor,6);
    END IF;

    INSERT INTO public.goods_receipt_lines(
      org_id,goods_receipt_id,purchase_order_line_id,product_id,
      ordered_quantity,received_quantity,unit_cost,quality_status,notes,
      uom_id,qty_entered,conversion_factor_snapshot,unit_cost_entered
    ) VALUES(
      v_org,v_gr_id,v_pol_id,v_product,
      v_ordered_base,v_qty_base,v_cost_base,v_quality,NULLIF(v_line->>'notes',''),
      v_uom,v_qty_entered,v_factor,v_cost_entered
    );

    IF v_quality='accepted' AND v_qty_base>0 THEN
      v_stock:=public.wardah_apply_stock_incoming(
        v_org,v_product,v_wh_id,v_qty_base,v_cost_base,
        'Goods Receipt',v_gr_id,v_gr_number,v_recv_date
      );
      IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN
        RAISE EXCEPTION 'STOCK_IN_NOT_APPLIED: %',v_stock;
      END IF;
      v_total:=v_total+(v_qty_base*v_cost_base);
    END IF;
  END LOOP;

  IF v_po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po
    SET status=CASE WHEN NOT EXISTS(
      SELECT 1
      FROM public.purchase_order_lines l
      WHERE l.purchase_order_id=po.id
        AND COALESCE(l.received_quantity,0)<l.quantity
    ) THEN 'fully_received' ELSE 'partially_received' END
    WHERE po.id=v_po_id;
  END IF;

  IF v_total>0 THEN
    PERFORM public.rpc_post_event_journal(
      'GR_RECEIPT',v_total,'استلام بضاعة '||v_gr_number,
      'GOODS_RECEIPT',v_gr_id,v_org,'GR_RECEIPT:'||v_gr_id::text,NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'goods_receipt_id',v_gr_id,
    'receipt_number',v_gr_number,
    'total_value',round(v_total,6),
    'lines_processed',v_line_no,
    'inventory_atomic',true,
    'uom_atomic',true,
    'po_snapshot_atomic',true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(jsonb) TO authenticated;
