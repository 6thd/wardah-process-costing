-- migration_number: 147
-- description: Add tenant-scoped read RPCs and atomic creation for UoM-aware purchase orders.
-- safety: additive only. No historical rows, tables, columns, policies, or functions are removed.

CREATE OR REPLACE FUNCTION public.rpc_list_uom_purchase_order_options(p_org_id uuid)
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

  RETURN jsonb_build_object(
    'vendors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', v.id,
        'code', v.code,
        'name', v.name
      ) ORDER BY v.name, v.id)
      FROM public.vendors v
      WHERE v.org_id = v_org
        AND COALESCE(v.is_active, true)
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'code', p.code,
        'name', p.name,
        'name_ar', p.name_ar,
        'cost_price', p.cost_price,
        'uom_migration_status', p.uom_migration_status
      ) ORDER BY p.code, p.id)
      FROM public.products p
      JOIN public.uoms base_uom ON base_uom.id = p.base_uom_id
      WHERE p.org_id = v_org
        AND p.is_active
        AND p.uom_migration_status = 'MAPPED'
        AND base_uom.is_active
        AND (base_uom.org_id IS NULL OR base_uom.org_id = v_org)
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_get_purchase_product_uoms(
  p_org_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_base_uom uuid;
BEGIN
  v_org := public.wardah_org_id(p_org_id);
  PERFORM public.wardah_assert_org_member(v_org);

  SELECT p.base_uom_id
  INTO v_base_uom
  FROM public.products p
  WHERE p.id = p_product_id
    AND p.org_id = v_org
    AND p.is_active
    AND p.uom_migration_status = 'MAPPED';

  IF NOT FOUND OR v_base_uom IS NULL THEN
    RAISE EXCEPTION 'PO_PRODUCT_NOT_MAPPED_OR_WRONG_ORG';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY is_base DESC, code)
    FROM (
      SELECT
        jsonb_build_object(
          'id', u.id,
          'code', u.code,
          'name', u.name,
          'name_ar', u.name_ar,
          'symbol', u.symbol,
          'category_id', u.category_id,
          'is_category_base', u.is_category_base,
          'is_product_specific', u.is_product_specific,
          'decimal_places', u.decimal_places,
          'factor_to_base', 1,
          'is_base', true,
          'use_for_purchase', true,
          'use_for_sale', true,
          'barcode', NULL
        ) AS row_data,
        true AS is_base,
        u.code
      FROM public.uoms u
      WHERE u.id = v_base_uom
        AND u.is_active
        AND (u.org_id IS NULL OR u.org_id = v_org)

      UNION ALL

      SELECT
        jsonb_build_object(
          'id', u.id,
          'code', u.code,
          'name', u.name,
          'name_ar', u.name_ar,
          'symbol', u.symbol,
          'category_id', u.category_id,
          'is_category_base', u.is_category_base,
          'is_product_specific', u.is_product_specific,
          'decimal_places', u.decimal_places,
          'factor_to_base', c.factor_to_base,
          'is_base', false,
          'use_for_purchase', c.use_for_purchase,
          'use_for_sale', c.use_for_sale,
          'barcode', c.barcode
        ) AS row_data,
        false AS is_base,
        u.code
      FROM public.product_uom_conversions c
      JOIN public.uoms u ON u.id = c.uom_id
      WHERE c.org_id = v_org
        AND c.product_id = p_product_id
        AND c.is_active
        AND c.valid_from <= now()
        AND (c.valid_to IS NULL OR c.valid_to > now())
        AND u.is_active
        AND (u.org_id IS NULL OR u.org_id = v_org)
    ) options
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_create_uom_purchase_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_order_id uuid := gen_random_uuid();
  v_order_number text;
  v_vendor_id uuid;
  v_order_date date;
  v_expected_date date;
  v_lines jsonb;
  v_line jsonb;
  v_line_count integer;
  v_line_number integer := 0;
  v_product_id uuid;
  v_uom_id uuid;
  v_qty_entered numeric;
  v_price_entered numeric;
  v_discount numeric;
  v_tax numeric;
  v_description text;
  v_enabled boolean := false;
  v_gross numeric := 0;
  v_discount_amount numeric := 0;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total numeric := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'PO_PAYLOAD_OBJECT_REQUIRED';
  END IF;

  v_org := public.wardah_org_id(NULLIF(p_payload ->> 'org_id', '')::uuid);
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

  v_vendor_id := NULLIF(p_payload ->> 'vendor_id', '')::uuid;
  IF v_vendor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = v_vendor_id
      AND v.org_id = v_org
      AND COALESCE(v.is_active, true)
  ) THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  v_order_date := COALESCE(NULLIF(p_payload ->> 'order_date', '')::date, CURRENT_DATE);
  v_expected_date := NULLIF(p_payload ->> 'expected_delivery_date', '')::date;
  IF v_expected_date IS NOT NULL AND v_expected_date < v_order_date THEN
    RAISE EXCEPTION 'EXPECTED_DELIVERY_BEFORE_ORDER_DATE';
  END IF;

  v_lines := COALESCE(p_payload -> 'lines', '[]'::jsonb);
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'PO_LINES_ARRAY_REQUIRED';
  END IF;

  v_line_count := jsonb_array_length(v_lines);
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'PO_REQUIRES_LINES';
  END IF;
  IF v_line_count > 500 THEN
    RAISE EXCEPTION 'PO_LINE_LIMIT_EXCEEDED';
  END IF;

  v_order_number := COALESCE(
    NULLIF(trim(p_payload ->> 'order_number'), ''),
    'PO-' || to_char(v_order_date, 'YYYYMMDD') || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8))
  );

  INSERT INTO public.purchase_orders (
    id, org_id, order_number, vendor_id, order_date, expected_delivery_date,
    status, subtotal, discount_amount, tax_amount, total_amount, notes, created_by
  ) VALUES (
    v_order_id, v_org, v_order_number, v_vendor_id, v_order_date, v_expected_date,
    'draft', 0, 0, 0, 0, NULLIF(trim(p_payload ->> 'notes'), ''), auth.uid()
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_line_number := v_line_number + 1;
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'PO_LINE_OBJECT_REQUIRED: line=%', v_line_number;
    END IF;

    v_product_id := NULLIF(v_line ->> 'product_id', '')::uuid;
    v_uom_id := NULLIF(v_line ->> 'uom_id', '')::uuid;
    v_qty_entered := NULLIF(v_line ->> 'qty_entered', '')::numeric;
    v_price_entered := NULLIF(v_line ->> 'unit_price_entered', '')::numeric;
    v_discount := COALESCE(NULLIF(v_line ->> 'discount_percentage', '')::numeric, 0);
    v_tax := COALESCE(NULLIF(v_line ->> 'tax_percentage', '')::numeric, 0);
    v_description := NULLIF(trim(v_line ->> 'description'), '');

    IF v_product_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.uoms base_uom ON base_uom.id = p.base_uom_id
      WHERE p.id = v_product_id
        AND p.org_id = v_org
        AND p.is_active
        AND p.uom_migration_status = 'MAPPED'
        AND base_uom.is_active
        AND (base_uom.org_id IS NULL OR base_uom.org_id = v_org)
    ) THEN
      RAISE EXCEPTION 'PO_PRODUCT_NOT_MAPPED_OR_WRONG_ORG: line=%', v_line_number;
    END IF;

    IF v_uom_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.products p
      JOIN public.uoms u ON u.id = v_uom_id
      WHERE p.id = v_product_id
        AND p.org_id = v_org
        AND u.is_active
        AND (u.org_id IS NULL OR u.org_id = v_org)
        AND (
          u.id = p.base_uom_id
          OR EXISTS (
            SELECT 1 FROM public.product_uom_conversions c
            WHERE c.org_id = v_org
              AND c.product_id = v_product_id
              AND c.uom_id = v_uom_id
              AND c.is_active
              AND c.use_for_purchase
              AND c.valid_from <= now()
              AND (c.valid_to IS NULL OR c.valid_to > now())
          )
        )
    ) THEN
      RAISE EXCEPTION 'PO_UOM_NOT_LEGAL_FOR_PURCHASE: line=%', v_line_number;
    END IF;

    IF v_qty_entered IS NULL OR v_qty_entered <= 0 THEN
      RAISE EXCEPTION 'PO_LINE_QUANTITY_MUST_BE_POSITIVE: line=%', v_line_number;
    END IF;
    IF v_price_entered IS NULL OR v_price_entered < 0 THEN
      RAISE EXCEPTION 'PO_LINE_PRICE_MUST_BE_NONNEGATIVE: line=%', v_line_number;
    END IF;
    IF v_discount < 0 OR v_discount > 100 THEN
      RAISE EXCEPTION 'PO_LINE_DISCOUNT_OUT_OF_RANGE: line=%', v_line_number;
    END IF;
    IF v_tax < 0 OR v_tax > 100 THEN
      RAISE EXCEPTION 'PO_LINE_TAX_OUT_OF_RANGE: line=%', v_line_number;
    END IF;

    INSERT INTO public.purchase_order_lines (
      org_id, purchase_order_id, line_number, product_id, description,
      uom_id, qty_entered, unit_price_entered,
      discount_percentage, tax_percentage
    ) VALUES (
      v_org, v_order_id, v_line_number, v_product_id, v_description,
      v_uom_id, v_qty_entered, v_price_entered,
      v_discount, v_tax
    );
  END LOOP;

  SELECT
    COALESCE(SUM(round(l.quantity * l.unit_price, 2)), 0),
    COALESCE(SUM(round(l.quantity * l.unit_price * (1 - l.discount_percentage / 100), 2)), 0),
    COALESCE(SUM(l.line_total), 0)
  INTO v_gross, v_subtotal, v_total
  FROM public.purchase_order_lines l
  WHERE l.purchase_order_id = v_order_id
    AND l.org_id = v_org;

  v_discount_amount := round(v_gross - v_subtotal, 2);
  v_tax_amount := round(v_total - v_subtotal, 2);

  UPDATE public.purchase_orders
  SET subtotal = v_subtotal,
      discount_amount = v_discount_amount,
      tax_amount = v_tax_amount,
      total_amount = v_total,
      updated_at = now()
  WHERE id = v_order_id
    AND org_id = v_org;

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', v_order_id,
    'order_number', v_order_number,
    'line_count', v_line_count,
    'subtotal', v_subtotal,
    'discount_amount', v_discount_amount,
    'tax_amount', v_tax_amount,
    'total_amount', v_total
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_list_uom_purchase_order_options(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_get_purchase_product_uoms(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_create_uom_purchase_order(jsonb)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_uom_purchase_order_options(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_purchase_product_uoms(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_uom_purchase_order(jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.rpc_list_uom_purchase_order_options(uuid) IS
  'Returns active vendors and mapped purchase products for one explicitly selected member organization.';
COMMENT ON FUNCTION public.rpc_get_purchase_product_uoms(uuid, uuid) IS
  'Returns legal current UoM options for one product inside one explicitly selected member organization.';
COMMENT ON FUNCTION public.rpc_create_uom_purchase_order(jsonb) IS
  'Atomically validates and creates one tenant-scoped UoM-aware purchase-order header and all lines. Header amounts sum persisted two-decimal line amounts, so subtotal plus tax always equals total; any failure rolls back the complete document.';
