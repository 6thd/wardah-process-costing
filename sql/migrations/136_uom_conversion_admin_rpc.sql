-- migration_number: 136
-- description: Add a guarded, transactional RPC for time-versioned product UoM
--              conversions. Avoids PostgREST upsert against a partial unique index.
-- safety: function-only; existing factors are closed, never overwritten or deleted.

CREATE OR REPLACE FUNCTION public.rpc_set_product_uom_conversion(
  p_org_id uuid,
  p_product_id uuid,
  p_uom_id uuid,
  p_factor_to_base numeric,
  p_use_for_purchase boolean DEFAULT false,
  p_use_for_sale boolean DEFAULT false,
  p_barcode text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_base_uom uuid;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

  IF p_product_id IS NULL OR p_uom_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_AND_UOM_REQUIRED';
  END IF;
  IF p_factor_to_base IS NULL OR p_factor_to_base <= 0 THEN
    RAISE EXCEPTION 'UOM_FACTOR_MUST_BE_POSITIVE';
  END IF;

  SELECT base_uom_id INTO v_base_uom
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;
  IF v_base_uom IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED';
  END IF;
  IF p_uom_id = v_base_uom AND abs(p_factor_to_base - 1) > 0.000000000001 THEN
    RAISE EXCEPTION 'BASE_UOM_FACTOR_MUST_EQUAL_ONE';
  END IF;

  -- Reuse the canonical resolver for category and product-context validation.
  PERFORM public.wardah_uom_factor(p_org_id, p_product_id, p_uom_id, v_now)
  FROM public.uoms u
  WHERE u.id = p_uom_id AND NOT u.is_product_specific;

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.uoms target
      JOIN public.uoms base ON base.id = v_base_uom
      WHERE target.id = p_uom_id
        AND target.is_active
        AND target.category_id = base.category_id
    ) THEN
      RAISE EXCEPTION 'PRODUCT_UOM_CATEGORY_MISMATCH';
    END IF;
  END IF;

  UPDATE public.product_uom_conversions
  SET is_active = false,
      valid_to = v_now,
      updated_at = v_now
  WHERE org_id = p_org_id
    AND product_id = p_product_id
    AND uom_id = p_uom_id
    AND is_active
    AND valid_to IS NULL;

  INSERT INTO public.product_uom_conversions(
    org_id, product_id, uom_id, factor_to_base,
    valid_from, valid_to, is_active,
    use_for_purchase, use_for_sale, barcode, notes,
    created_by, created_at, updated_at
  ) VALUES (
    p_org_id, p_product_id, p_uom_id, p_factor_to_base,
    v_now, NULL, true,
    COALESCE(p_use_for_purchase, false),
    COALESCE(p_use_for_sale, false),
    NULLIF(trim(p_barcode), ''), NULLIF(trim(p_notes), ''),
    auth.uid(), v_now, v_now
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'conversion_id', v_id,
    'org_id', p_org_id,
    'product_id', p_product_id,
    'uom_id', p_uom_id,
    'factor_to_base', p_factor_to_base,
    'valid_from', v_now
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_set_product_uom_conversion(
  uuid, uuid, uuid, numeric, boolean, boolean, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_product_uom_conversion(
  uuid, uuid, uuid, numeric, boolean, boolean, text, text
) TO authenticated;

COMMENT ON FUNCTION public.rpc_set_product_uom_conversion(
  uuid, uuid, uuid, numeric, boolean, boolean, text, text
) IS 'Admin-only time-versioned product UoM conversion. Closes the current factor and inserts an immutable successor.';
