-- migration_number: 148
-- description: Add tenant-scoped receivable-PO reads, a guarded purchase-order
--              approval gate, and make PO-linked goods receipts use the immutable
--              purchase-order UoM snapshots while separating physically received
--              quantity from the accepted quantity that closes the vendor contract.
-- safety: replace-only RPCs plus additive nullable columns and additive read/gate
--         RPCs. No historical row, table, column, policy, or trigger is removed,
--         and no historical quantity is reinterpreted.
--
-- Feature-flag contract (uom_engine_enabled):
--   The organization flag governs *creation* paths and the new UI reads:
--   rpc_create_uom_purchase_order (147) and rpc_list_uom_receivable_purchase_orders
--   below are fail-closed on it. It deliberately does NOT gate
--   rpc_post_goods_receipt: a purchase-order line that already carries a legal
--   UoM snapshot is a stored accounting fact, and turning the rollout flag off
--   must never change how an existing document is interpreted or block receiving
--   it. Legacy receipts with no snapshot keep the historical base-unit path.
--
-- Quantity contract on purchase_order_lines:
--   quantity          — ordered quantity in base units (unchanged).
--   received_quantity — physically received in base units, every quality status.
--   accepted_quantity — quality-accepted base units; this is what closes the
--                       vendor contract and drives partially/fully_received.
--   rejected_quantity — quality-rejected base units; releases contract balance so
--                       a replacement delivery is legal.
--   pending           — derived: received - accepted - rejected. Pending units
--                       still hold contract balance (they may yet be accepted).

-- ---------------------------------------------------------------------------
-- 1. Additive quality-aware quantity columns.
-- ---------------------------------------------------------------------------
-- Existing rows are preserved exactly as the system already interprets them:
-- everything received so far was treated as contract-closing, so accepted is
-- seeded from received. History is not reinterpreted, only made explicit.
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS accepted_quantity numeric(18,6),
  ADD COLUMN IF NOT EXISTS rejected_quantity numeric(18,6);

UPDATE public.purchase_order_lines
SET accepted_quantity = COALESCE(received_quantity, 0)
WHERE accepted_quantity IS NULL;

UPDATE public.purchase_order_lines
SET rejected_quantity = 0
WHERE rejected_quantity IS NULL;

ALTER TABLE public.purchase_order_lines
  ALTER COLUMN accepted_quantity SET DEFAULT 0,
  ALTER COLUMN rejected_quantity SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.purchase_order_lines'::regclass
      AND conname = 'purchase_order_lines_quality_quantity_check'
  ) THEN
    ALTER TABLE public.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_quality_quantity_check
      CHECK (
        COALESCE(accepted_quantity, 0) >= 0
        AND COALESCE(rejected_quantity, 0) >= 0
        AND COALESCE(accepted_quantity, 0) + COALESCE(rejected_quantity, 0)
            <= COALESCE(received_quantity, 0)
      ) NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN public.purchase_order_lines.accepted_quantity IS
  'Quality-accepted quantity in base units. Closes the vendor contract and drives purchase-order receipt status.';
COMMENT ON COLUMN public.purchase_order_lines.rejected_quantity IS
  'Quality-rejected quantity in base units. Released back to the contract balance so a replacement delivery stays legal.';

-- ---------------------------------------------------------------------------
-- 2. Purchase-order approval gate.
-- ---------------------------------------------------------------------------
-- Migration 147 creates every UoM purchase order as 'draft', and a draft order is
-- not receivable. Without a guarded server-side transition the only path was a
-- direct client UPDATE, which carries no membership or state validation.

CREATE OR REPLACE FUNCTION public.rpc_submit_purchase_order(
  p_org_id uuid,
  p_purchase_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_status text;
  v_lines integer;
BEGIN
  v_org := public.wardah_org_id(p_org_id);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);

  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'PO_ID_REQUIRED';
  END IF;

  SELECT status INTO v_status
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id AND org_id = v_org
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'PO_NOT_SUBMITTABLE: %', v_status;
  END IF;

  SELECT count(*) INTO v_lines
  FROM public.purchase_order_lines
  WHERE purchase_order_id = p_purchase_order_id AND org_id = v_org;

  IF v_lines = 0 THEN RAISE EXCEPTION 'PO_HAS_NO_LINES'; END IF;

  UPDATE public.purchase_orders
  SET status = 'submitted'
  WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'status', 'submitted'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_approve_purchase_order(
  p_org_id uuid,
  p_purchase_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_status text;
  v_lines integer;
BEGIN
  v_org := public.wardah_org_id(p_org_id);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  -- Approval releases an order for receiving and therefore for inventory and GL
  -- impact: organization-admin only, never a plain member.
  PERFORM public.wardah_assert_org_admin(v_org);

  IF p_purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'PO_ID_REQUIRED';
  END IF;

  SELECT status INTO v_status
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id AND org_id = v_org
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
  IF v_status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'PO_NOT_APPROVABLE: %', v_status;
  END IF;

  SELECT count(*) INTO v_lines
  FROM public.purchase_order_lines
  WHERE purchase_order_id = p_purchase_order_id AND org_id = v_org;

  IF v_lines = 0 THEN RAISE EXCEPTION 'PO_HAS_NO_LINES'; END IF;

  UPDATE public.purchase_orders
  SET status = 'approved'
  WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'status', 'approved'
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Tenant-scoped receivable purchase-order read.
-- ---------------------------------------------------------------------------

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
              'accepted_qty_base', COALESCE(pol.accepted_quantity, 0),
              'rejected_qty_base', COALESCE(pol.rejected_quantity, 0),
              'pending_qty_base', GREATEST(
                COALESCE(pol.received_quantity, 0)
                - COALESCE(pol.accepted_quantity, 0)
                - COALESCE(pol.rejected_quantity, 0),
                0
              ),
              -- Remaining is contract balance, not physical balance: rejected
              -- units are released so the vendor can redeliver against them.
              'remaining_qty_entered', round(
                GREATEST(
                  pol.quantity
                  - COALESCE(pol.accepted_quantity, 0)
                  - GREATEST(
                      COALESCE(pol.received_quantity, 0)
                      - COALESCE(pol.accepted_quantity, 0)
                      - COALESCE(pol.rejected_quantity, 0),
                      0
                    ),
                  0
                )
                / COALESCE(NULLIF(pol.conversion_factor_snapshot, 0), 1),
                6
              ),
              'remaining_qty_base', GREATEST(
                pol.quantity
                - COALESCE(pol.accepted_quantity, 0)
                - GREATEST(
                    COALESCE(pol.received_quantity, 0)
                    - COALESCE(pol.accepted_quantity, 0)
                    - COALESCE(pol.rejected_quantity, 0),
                    0
                  ),
                0
              ),
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
            AND COALESCE(pol.accepted_quantity, 0)
                + GREATEST(
                    COALESCE(pol.received_quantity, 0)
                    - COALESCE(pol.accepted_quantity, 0)
                    - COALESCE(pol.rejected_quantity, 0),
                    0
                  ) < pol.quantity
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
          AND COALESCE(open_line.accepted_quantity, 0)
              + GREATEST(
                  COALESCE(open_line.received_quantity, 0)
                  - COALESCE(open_line.accepted_quantity, 0)
                  - COALESCE(open_line.rejected_quantity, 0),
                  0
                ) < open_line.quantity
      )
  ), '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Atomic goods receipt on immutable purchase-order snapshots.
-- ---------------------------------------------------------------------------

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
  v_cost_entered numeric; v_cost_base numeric; v_payload_cost numeric;
  v_payload_cost_base numeric; v_quality text;
  v_total numeric:=0; v_pol record; v_pol_id uuid; v_recv_date date; v_stock jsonb;
  v_pending numeric; v_committed numeric; v_consumes boolean;
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
        'po_snapshot_atomic',true,
        'quality_aware_contract',true
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

    v_quality:=COALESCE(NULLIF(v_line->>'quality_status',''),'accepted');
    IF v_quality NOT IN ('accepted','rejected','pending_inspection') THEN
      RAISE EXCEPTION 'INVALID_QUALITY_STATUS: line=%',v_line_no;
    END IF;

    v_pol_id:=NULLIF(v_line->>'purchase_order_line_id','')::uuid;
    v_payload_uom:=NULLIF(v_line->>'uom_id','')::uuid;
    v_payload_cost:=NULLIF(v_line->>'unit_cost_entered','')::numeric;
    v_payload_cost_base:=NULLIF(v_line->>'unit_cost','')::numeric;

    IF v_pol_id IS NOT NULL THEN
      IF v_po_id IS NULL THEN RAISE EXCEPTION 'PO_REQUIRED: line=%',v_line_no; END IF;

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

      -- Contract balance, not physical balance. Accepted units are final and
      -- pending units are still claimable, so both hold the balance; rejected
      -- units release it so a replacement delivery does not trip OVER_RECEIPT.
      v_pending:=GREATEST(v_pol.received-v_pol.accepted-v_pol.rejected,0);
      v_committed:=v_pol.accepted+v_pending;
      v_consumes:=(v_quality IN ('accepted','pending_inspection'));

      IF v_consumes AND v_committed+v_qty_base>v_pol.quantity THEN
        RAISE EXCEPTION 'OVER_RECEIPT: remaining=%, requested_base=%',
          v_pol.quantity-v_committed,v_qty_base;
      END IF;

      -- received_quantity keeps its physical meaning for every quality status.
      -- Only the accepted/rejected split is quality driven.
      UPDATE public.purchase_order_lines
      SET received_quantity=v_pol.received+v_qty_base,
          accepted_quantity=v_pol.accepted+CASE WHEN v_quality='accepted' THEN v_qty_base ELSE 0 END,
          rejected_quantity=v_pol.rejected+CASE WHEN v_quality='rejected' THEN v_qty_base ELSE 0 END
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

REVOKE ALL ON FUNCTION public.rpc_submit_purchase_order(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_submit_purchase_order(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_purchase_order(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_approve_purchase_order(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_approve_purchase_order(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_approve_purchase_order(uuid,uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_uom_receivable_purchase_orders(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_goods_receipt(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_post_goods_receipt(jsonb) TO authenticated;
