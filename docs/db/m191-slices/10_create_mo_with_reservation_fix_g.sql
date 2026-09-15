-- Wardah ERP / F2 / M191 review slice 10
-- Object 12 only: rpc_create_mo_with_reservation(jsonb,jsonb,uuid) — Fix G.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 186, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the predecessor's complete material-validation pass and before any
--     stock lock, capture one ordered resolved-demand snapshot containing one
--     row per original material line;
--   * derive the complete distinct product prefix from that snapshot only and
--     acquire it through wardah_lock_products_for_stock_write before any bins
--     lock;
--   * drive bins/availability grouping and reservation persistence from the
--     captured snapshot, with no later resolver deciding product identity;
--   * after each material_reservations INSERT, compare RETURNING product_id
--     (after the live BEFORE trigger) to that line's exact captured identity and
--     fail closed with ITEM_PRODUCT_MAPPING_DRIFT on any mismatch.
--
-- Preserved deliberately:
--   * tenant derivation, org-member authorization and INVALID_MATERIALS behavior;
--   * the complete predecessor validation pass and its INVALID_MATERIAL errors;
--   * wardah_resolve_product_id(v_org,item_id,now()) semantics at capture time;
--   * per-product availability math, ordered all-bin FOR UPDATE footprint and
--     INSUFFICIENT_STOCK payload/error shape;
--   * MO status/number derivation and MO creation placement after availability;
--   * exactly one reservation INSERT per original input line, in input order;
--   * base-UoM lookup, quantity/expires_at persistence and reservation count;
--   * return shape, SECURITY DEFINER and search_path;
--   * existing authenticated + service_role client-facing ACL is unchanged and
--     intentionally not restated in this review fragment;
--   * no production advisory/test gates are introduced.
--
-- Important: a membership-only check against the prelocked product set is NOT a
-- mapping-drift check. A legal X<->Y mapping swap can stay entirely inside that
-- set. The authoritative comparison is captured per-line identity versus the
-- post-trigger product_id returned by INSERT.

CREATE OR REPLACE FUNCTION public.rpc_create_mo_with_reservation(
  p_order jsonb,
  p_materials jsonb DEFAULT '[]'::jsonb,
  p_tenant uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_mo_id uuid;
  v_mo_number text;
  v_mat jsonb;
  v_item_id uuid;
  v_item_ids jsonb;
  v_product_id uuid;
  v_persisted_product_id uuid;
  v_uom_id uuid;
  v_qty numeric;
  v_on_hand numeric;
  v_bin_reserved numeric;
  v_mo_reserved numeric;
  v_avail numeric;
  v_insufficient jsonb := '[]'::jsonb;
  v_reserved integer := 0;
  v_init_status text;
  v_ordinal bigint;
  v_demand_snapshot jsonb := '[]'::jsonb;
  v_products uuid[];
BEGIN
  v_org := public.wardah_org_id(
    COALESCE(NULLIF(p_order ->> 'org_id', '')::uuid, p_tenant)
  );
  PERFORM public.wardah_assert_org_member(v_org);

  IF jsonb_typeof(COALESCE(p_materials, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_MATERIALS: p_materials must be a JSON array';
  END IF;

  -- Preserve Migration 186's complete validation pass before resolution/locks.
  FOR v_mat IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    BEGIN
      v_item_id := NULLIF(v_mat ->> 'item_id', '')::uuid;
      v_qty := NULLIF(v_mat ->> 'quantity', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_MATERIAL: item_id and quantity must be valid values';
    END;

    IF jsonb_typeof(v_mat) <> 'object' OR v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_MATERIAL: item_id and a positive quantity are required';
    END IF;
  END LOOP;

  -- M191 Fix G: resolve every original line exactly once, after all predecessor
  -- validation and before any products/bins lock. Keep fields needed later by
  -- the reservation INSERT without moving their predecessor casts earlier.
  FOR v_ordinal, v_mat IN
    SELECT ordinality::bigint, entry
    FROM jsonb_array_elements(p_materials)
      WITH ORDINALITY AS materials(entry, ordinality)
    ORDER BY ordinality
  LOOP
    v_item_id := (v_mat ->> 'item_id')::uuid;
    v_qty := (v_mat ->> 'quantity')::numeric;
    v_product_id := public.wardah_resolve_product_id(v_org, v_item_id, now());

    v_demand_snapshot := v_demand_snapshot || jsonb_build_array(
      jsonb_build_object(
        'ordinal', v_ordinal,
        'item_id', v_item_id,
        'quantity', v_qty,
        'resolved_product_id', v_product_id,
        'expires_at', v_mat ->> 'expires_at'
      )
    );
  END LOOP;

  -- Complete transaction-wide product prefix, derived only from the captured
  -- identities. The shared helper canonicalizes/deduplicates and locks products
  -- ascending by id using FOR NO KEY UPDATE.
  v_products := ARRAY(
    SELECT DISTINCT (entry ->> 'resolved_product_id')::uuid
    FROM jsonb_array_elements(v_demand_snapshot) AS snapshot(entry)
    ORDER BY (entry ->> 'resolved_product_id')::uuid
  );
  PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);

  -- Availability is grouped from the same captured snapshot. No resolver is
  -- called here, so a mapping change after capture cannot redirect bins work.
  FOR v_product_id, v_qty, v_item_ids IN
    SELECT
      (entry ->> 'resolved_product_id')::uuid AS product_id,
      SUM((entry ->> 'quantity')::numeric),
      to_jsonb(array_agg(
        DISTINCT (entry ->> 'item_id')::uuid
        ORDER BY (entry ->> 'item_id')::uuid
      ))
    FROM jsonb_array_elements(v_demand_snapshot) AS snapshot(entry)
    GROUP BY (entry ->> 'resolved_product_id')::uuid
    ORDER BY (entry ->> 'resolved_product_id')::uuid
  LOOP
    PERFORM 1
    FROM public.bins
    WHERE org_id = v_org AND product_id = v_product_id
    ORDER BY warehouse_id, id
    FOR UPDATE;

    SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(reserved_qty), 0)
    INTO v_on_hand, v_bin_reserved
    FROM public.bins
    WHERE org_id = v_org AND product_id = v_product_id;

    SELECT COALESCE(SUM(
      GREATEST(
        quantity_reserved - COALESCE(quantity_consumed, 0) - COALESCE(quantity_released, 0),
        0
      )
    ), 0)
    INTO v_mo_reserved
    FROM public.material_reservations
    WHERE org_id = v_org
      AND product_id = v_product_id
      AND status = 'reserved';

    v_avail := v_on_hand - v_bin_reserved - v_mo_reserved;
    IF v_avail < v_qty THEN
      v_insufficient := v_insufficient || jsonb_build_object(
        'item_ids', v_item_ids,
        'product_id', v_product_id,
        'required', v_qty,
        'available', v_avail
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_insufficient) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: مواد غير كافية: %', v_insufficient::text;
  END IF;

  v_init_status := public.normalize_mo_status(COALESCE(p_order ->> 'status', 'draft'));
  v_mo_number := COALESCE(
    NULLIF(p_order ->> 'order_number', ''),
    'MO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.mo_seq')::text, 4, '0')
  );

  INSERT INTO public.manufacturing_orders (
    org_id, order_number, product_id, item_id, quantity,
    status, notes, start_date, due_date
  )
  VALUES (
    v_org,
    v_mo_number,
    NULLIF(p_order ->> 'product_id', '')::uuid,
    NULLIF(p_order ->> 'item_id', '')::uuid,
    COALESCE(NULLIF(p_order ->> 'quantity', '')::numeric, 0),
    v_init_status,
    NULLIF(p_order ->> 'notes', ''),
    NULLIF(p_order ->> 'start_date', '')::date,
    NULLIF(p_order ->> 'due_date', '')::date
  )
  RETURNING id INTO v_mo_id;

  -- Persist one reservation per original line, in captured ordinal order. The
  -- live BEFORE trigger may re-resolve product_id from item_id; RETURNING sees
  -- that post-trigger identity, so compare it exactly to the captured product.
  FOR v_mat IN
    SELECT entry
    FROM jsonb_array_elements(v_demand_snapshot) AS snapshot(entry)
    ORDER BY (entry ->> 'ordinal')::bigint
  LOOP
    v_item_id := (v_mat ->> 'item_id')::uuid;
    v_qty := (v_mat ->> 'quantity')::numeric;
    v_product_id := (v_mat ->> 'resolved_product_id')::uuid;

    SELECT base_uom_id INTO v_uom_id
    FROM public.products
    WHERE id = v_product_id AND org_id = v_org;

    INSERT INTO public.material_reservations (
      org_id, mo_id, item_id, product_id,
      quantity_reserved, status, expires_at,
      uom_id, qty_entered, conversion_factor_snapshot
    )
    VALUES (
      v_org, v_mo_id, v_item_id, v_product_id,
      v_qty, 'reserved', NULLIF(v_mat ->> 'expires_at', '')::timestamptz,
      v_uom_id, v_qty, 1
    )
    RETURNING product_id INTO v_persisted_product_id;

    IF v_persisted_product_id IS DISTINCT FROM v_product_id THEN
      RAISE EXCEPTION
        'ITEM_PRODUCT_MAPPING_DRIFT: item=%, captured=%, persisted=%',
        v_item_id, v_product_id, v_persisted_product_id;
    END IF;

    v_reserved := v_reserved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mo_id', v_mo_id,
    'mo_number', v_mo_number,
    'status', v_init_status,
    'materials_reserved', v_reserved
  );
END;
$function$;