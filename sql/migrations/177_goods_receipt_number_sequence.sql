-- Migration 177: collision-safe goods receipt number allocation.
--
-- Production Pilot for Issue #45 exposed a deterministic collision after the
-- first Migration-148 receipt. Historical receipt numbers contain 13-digit
-- timestamp suffixes; the old max(...)+lpad(..., 6) allocator truncated the
-- candidate back to six characters and repeatedly produced the same number.
--
-- This additive migration preserves the full UoM/PO/quality/idempotency contract
-- from Migration 148 and changes only number allocation:
--   * one global sequence matches goods_receipts_receipt_number_key (global);
--   * existing canonical six-digit GR numbers seed the sequence;
--   * legacy 13-digit numbers are not mistaken for canonical counters;
--   * values beyond six digits are never truncated.
--
-- Migration 176 remains reserved for the RBAC direct-write closure documented
-- in CLAUDE.md; it is intentionally not reused for this production blocker.

CREATE SEQUENCE IF NOT EXISTS public.goods_receipt_number_seq
  AS bigint
  MINVALUE 1
  START WITH 1
  INCREMENT BY 1
  CACHE 1;

DO $migration$
DECLARE
  c_sequence regclass CONSTANT := 'public.goods_receipt_number_seq'::regclass;
  v_canonical_max bigint;
  v_last_value bigint;
BEGIN
  SELECT max(substring(receipt_number FROM '^GR-([0-9]{6})$')::bigint)
  INTO v_canonical_max
  FROM public.goods_receipts
  WHERE receipt_number ~ '^GR-[0-9]{6}$';

  SELECT last_value INTO v_last_value
  FROM public.goods_receipt_number_seq;

  IF v_canonical_max IS NULL AND v_last_value = 1 THEN
    PERFORM setval(c_sequence, 1, false);
  ELSE
    PERFORM setval(
      c_sequence,
      greatest(coalesce(v_canonical_max, 1), v_last_value),
      true
    );
  END IF;
END;
$migration$;

REVOKE ALL ON SEQUENCE public.goods_receipt_number_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.goods_receipt_number_seq FROM anon;
REVOKE ALL ON SEQUENCE public.goods_receipt_number_seq FROM authenticated;

CREATE OR REPLACE FUNCTION public.rpc_post_goods_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_lines_key text CONSTANT := 'lines';
  c_quality_accepted text CONSTANT := 'accepted';
  c_quality_rejected text CONSTANT := 'rejected';
  c_receipt_sequence regclass CONSTANT := 'public.goods_receipt_number_seq'::regclass;
  v_org uuid; v_uid uuid; v_gr_id uuid; v_gr_number text; v_po_id uuid;
  v_po_status text; v_po_vendor uuid; v_vendor_id uuid; v_wh_id uuid;
  v_idem_key text; v_req_hash text; v_existing_id uuid; v_existing_no text; v_existing_hash text;
  v_line jsonb; v_line_no integer:=0; v_product uuid; v_uom uuid; v_base_uom uuid;
  v_payload_uom uuid; v_qty_entered numeric; v_qty_base numeric;
  v_ordered_entered numeric; v_ordered_base numeric; v_factor numeric;
  v_cost_entered numeric; v_cost_base numeric; v_payload_cost numeric;
  v_payload_cost_base numeric; v_quality text;
  v_total numeric:=0; v_pol record; v_pol_id uuid; v_recv_date date; v_stock jsonb;
  v_pending numeric; v_committed numeric; v_consumes boolean;
  v_receipt_sequence bigint;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GR_PAYLOAD_OBJECT_REQUIRED';
  END IF;

  v_org:=public.wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  v_uid:=auth.uid(); PERFORM public.wardah_assert_org_member(v_org);

  -- Idempotent replay is resolved before every business gate below.
  -- A retry of the receipt that closed a purchase order must return the original
  -- document, not PO_NOT_RECEIVABLE: by then the order is legitimately
  -- 'fully_received', and the same is true once a period closes or a line is
  -- exhausted. Gating a replay on state that the original call itself produced
  -- makes the final receipt of every order unconfirmable after a timeout.
  -- The lock is taken first so a concurrent duplicate serializes here and finds
  -- the committed row instead of racing past this check into a second insert.
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
        'po_snapshot_atomic',true,
        'quality_aware_contract',true
      );
    END IF;
  END IF;

  v_vendor_id:=NULLIF(p_payload->>'vendor_id','')::uuid;
  IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: vendor_id required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id=v_vendor_id AND org_id=v_org) THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->c_lines_key,'[]'::jsonb))<>'array'
     OR jsonb_array_length(COALESCE(p_payload->c_lines_key,'[]'::jsonb))=0 THEN
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
    -- 'submitted' is not receivable: receiving an unapproved order would bypass
    -- the approval gate that governs inventory and GL impact.
    IF v_po_status NOT IN ('approved','partially_received') THEN
      RAISE EXCEPTION 'PO_NOT_RECEIVABLE: %',v_po_status;
    END IF;
    IF v_po_vendor IS NOT NULL AND v_po_vendor<>v_vendor_id THEN
      RAISE EXCEPTION 'VENDOR_MISMATCH';
    END IF;
  END IF;

  v_recv_date:=COALESCE(NULLIF(p_payload->>'receipt_date','')::date,CURRENT_DATE);
  PERFORM public.assert_period_open(v_org,v_recv_date);

  -- Migration 177: a database sequence is global (matching the global UNIQUE
  -- constraint), concurrency-safe, and never truncates legacy timestamp-shaped
  -- receipt numbers through lpad(..., 6).
  SELECT nextval(c_receipt_sequence) INTO v_receipt_sequence;
  v_gr_number := 'GR-' || CASE
    WHEN v_receipt_sequence < 1000000
      THEN lpad(v_receipt_sequence::text, 6, '0')
    ELSE v_receipt_sequence::text
  END;

  INSERT INTO public.goods_receipts(
    org_id,receipt_number,purchase_order_id,vendor_id,receipt_date,warehouse_id,
    warehouse_location,receiver_name,status,notes,idempotency_key,request_hash,created_by
  ) VALUES(
    v_org,v_gr_number,v_po_id,v_vendor_id,v_recv_date,v_wh_id,
    NULLIF(p_payload->>'warehouse_location',''),NULLIF(p_payload->>'receiver_name',''),
    'confirmed',NULLIF(p_payload->>'notes',''),v_idem_key,v_req_hash,v_uid
  ) RETURNING id INTO v_gr_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->c_lines_key) LOOP
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

    v_quality:=COALESCE(NULLIF(v_line->>'quality_status',''),c_quality_accepted);
    IF v_quality NOT IN (c_quality_accepted,c_quality_rejected,'pending_inspection') THEN
      RAISE EXCEPTION 'INVALID_QUALITY_STATUS: line=%',v_line_no;
    END IF;

    v_pol_id:=NULLIF(v_line->>'purchase_order_line_id','')::uuid;
    v_payload_uom:=NULLIF(v_line->>'uom_id','')::uuid;
    v_payload_cost:=NULLIF(v_line->>'unit_cost_entered','')::numeric;
    v_payload_cost_base:=NULLIF(v_line->>'unit_cost','')::numeric;

    IF v_pol_id IS NOT NULL THEN
      IF v_po_id IS NULL THEN RAISE EXCEPTION 'PO_REQUIRED: line=%',v_line_no; END IF;

      -- No resolution flow exists to move a pending quantity to accepted or
      -- rejected, so accepting one here would strand the contract balance
      -- permanently: no inventory, no GRNI, and no way to close or reopen the
      -- order. Refuse at the entry point instead of creating unresolvable state.
      IF v_quality='pending_inspection' THEN
        RAISE EXCEPTION 'PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW: line=%',v_line_no;
      END IF;

      SELECT
        purchase_order_id,
        product_id,
        quantity,
        COALESCE(received_quantity,0) AS received,
        COALESCE(accepted_quantity,0) AS accepted,
        COALESCE(rejected_quantity,0) AS rejected,
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

      v_uom:=COALESCE(v_pol.uom_id,v_base_uom);

      -- Fail closed instead of silently assuming factor 1. A line denominated in a
      -- non-base unit with no legal snapshot cannot be converted without guessing,
      -- and guessing writes a wrong base quantity and cost with no error at all.
      IF v_pol.conversion_factor_snapshot IS NULL OR v_pol.conversion_factor_snapshot<=0 THEN
        IF v_uom IS DISTINCT FROM v_base_uom THEN
          RAISE EXCEPTION 'PO_LINE_SNAPSHOT_MISSING: line=%',v_line_no;
        END IF;
        -- Base unit and no snapshot: entered and base are the same quantity by
        -- definition, so factor 1 is a fact here rather than an assumption.
        v_factor:=1;
      ELSE
        v_factor:=v_pol.conversion_factor_snapshot;
      END IF;

      v_ordered_base:=v_pol.quantity;
      v_ordered_entered:=COALESCE(v_pol.qty_entered,round(v_pol.quantity/v_factor,6));
      v_cost_base:=v_pol.unit_price;
      v_cost_entered:=COALESCE(v_pol.unit_price_entered,round(v_pol.unit_price*v_factor,6));

      v_qty_entered:=NULLIF(v_line->>'qty_entered','')::numeric;
      IF v_qty_entered IS NULL THEN
        -- Legacy callers send received_quantity/unit_cost in base units while the
        -- snapshot contract is expressed in entered units. The two are provably
        -- identical only at factor 1; anywhere else the payload is ambiguous and
        -- must be refused rather than silently inflated by the factor.
        IF v_factor<>1 THEN
          RAISE EXCEPTION 'RECEIPT_SNAPSHOT_CONTRACT_REQUIRED: line=%',v_line_no;
        END IF;
        v_qty_entered:=NULLIF(v_line->>'received_quantity','')::numeric;
      END IF;
      IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
        RAISE EXCEPTION 'RECEIPT_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;

      IF v_payload_uom IS NOT NULL AND v_payload_uom<>v_uom THEN
        RAISE EXCEPTION 'RECEIPT_UOM_MISMATCH: line=%',v_line_no;
      END IF;
      IF v_payload_cost IS NOT NULL AND abs(v_payload_cost-v_cost_entered)>0.000001 THEN
        RAISE EXCEPTION 'RECEIPT_COST_MISMATCH: line=%',v_line_no;
      END IF;
      -- Legacy base-unit cost is only unambiguous at factor 1, where entered and
      -- base rates coincide. Beyond that the explicit field is mandatory above.
      IF v_payload_cost IS NULL AND v_payload_cost_base IS NOT NULL
         AND abs(v_payload_cost_base-v_cost_base)>0.000001 THEN
        RAISE EXCEPTION 'RECEIPT_COST_MISMATCH: line=%',v_line_no;
      END IF;

      v_qty_base:=round(v_qty_entered*v_factor,6);
      IF v_qty_base<=0 THEN
        RAISE EXCEPTION 'RECEIPT_BASE_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;

      -- Contract balance, not physical balance. Accepted units are final and any
      -- pending units are still claimable, so both hold the balance; rejected
      -- units release it so a replacement delivery does not trip OVER_RECEIPT.
      v_pending:=GREATEST(v_pol.received-v_pol.accepted-v_pol.rejected,0);
      v_committed:=v_pol.accepted+v_pending;
      v_consumes:=(v_quality=c_quality_accepted);

      IF v_consumes AND v_committed+v_qty_base>v_pol.quantity THEN
        RAISE EXCEPTION 'OVER_RECEIPT: remaining=%, requested_base=%',
          v_pol.quantity-v_committed,v_qty_base;
      END IF;

      -- A rejected quantity releases balance rather than consuming it, so it is
      -- not covered by OVER_RECEIPT above. Without its own ceiling a vendor could
      -- be recorded as delivering — and the buyer as rejecting — an unbounded
      -- quantity against a finite order. A single shipment may not exceed the
      -- balance that was open when it arrived.
      IF v_quality=c_quality_rejected THEN
        IF v_qty_base>v_pol.quantity-v_committed THEN
          RAISE EXCEPTION 'REJECTED_QUANTITY_EXCEEDS_OPEN_BALANCE: remaining=%, requested_base=%',
            v_pol.quantity-v_committed,v_qty_base;
        END IF;
      END IF;

      -- received_quantity keeps its physical meaning for every quality status.
      -- Only the accepted/rejected split is quality driven.
      UPDATE public.purchase_order_lines
      SET received_quantity=v_pol.received+v_qty_base,
          accepted_quantity=v_pol.accepted+CASE WHEN v_quality=c_quality_accepted THEN v_qty_base ELSE 0 END,
          rejected_quantity=v_pol.rejected+CASE WHEN v_quality=c_quality_rejected THEN v_qty_base ELSE 0 END
      WHERE id=v_pol_id;
    ELSE
      v_qty_entered:=COALESCE(
        NULLIF(v_line->>'qty_entered','')::numeric,
        NULLIF(v_line->>'received_quantity','')::numeric
      );
      IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
        RAISE EXCEPTION 'RECEIPT_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;
      v_uom:=COALESCE(v_payload_uom,v_base_uom);
      v_ordered_entered:=COALESCE(
        NULLIF(v_line->>'ordered_qty_entered','')::numeric,
        NULLIF(v_line->>'ordered_quantity','')::numeric,
        v_qty_entered
      );
      v_cost_entered:=COALESCE(v_payload_cost,v_payload_cost_base);
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

    IF v_quality=c_quality_accepted AND v_qty_base>0 THEN
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

  -- Receipt status follows the accepted quantity: a rejected delivery must never
  -- close a purchase order that produced no inventory and no GRNI value.
  IF v_po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po
    SET status=CASE WHEN NOT EXISTS(
      SELECT 1
      FROM public.purchase_order_lines l
      WHERE l.purchase_order_id=po.id
        AND COALESCE(l.accepted_quantity,0)<l.quantity
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
    'po_snapshot_atomic',true,
    'quality_aware_contract',true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_post_goods_receipt(jsonb) IS
'Migration 177: Migration-148 atomic UoM goods receipt contract with collision-safe global receipt numbering. Uses goods_receipt_number_seq seeded from canonical six-digit GR numbers; legacy timestamp-shaped numbers cannot be truncated into duplicates.';
