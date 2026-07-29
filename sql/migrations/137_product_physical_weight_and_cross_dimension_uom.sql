-- migration_number: 137
-- description: Allow explicit product-specific cross-dimension conversions and
--              model declared net/gross product weight with a guarded admin RPC.
-- safety: additive columns + replace-only functions. No factor is inferred without
--         an explicit product physical-weight declaration.

ALTER TABLE public.product_uom_conversions
  ADD COLUMN IF NOT EXISTS allow_cross_dimension boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS net_weight numeric(18,6),
  ADD COLUMN IF NOT EXISTS gross_weight numeric(18,6),
  ADD COLUMN IF NOT EXISTS weight_uom_id uuid REFERENCES public.uoms(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.products'::regclass
      AND conname='products_physical_weight_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_physical_weight_check CHECK (
        (net_weight IS NULL AND gross_weight IS NULL AND weight_uom_id IS NULL)
        OR (
          net_weight > 0
          AND weight_uom_id IS NOT NULL
          AND (gross_weight IS NULL OR gross_weight >= net_weight)
        )
      ) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.wardah_uom_factor(
  p_org uuid, p_product uuid, p_uom uuid, p_at timestamptz DEFAULT now()
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_product_org uuid; v_base_uom uuid; v_base_category uuid;
  v_base_factor numeric; v_base_product_specific boolean;
  v_target_category uuid; v_target_factor numeric; v_target_product_specific boolean;
  v_product_factor numeric; v_allow_cross boolean;
BEGIN
  IF p_org IS NULL OR p_product IS NULL THEN RAISE EXCEPTION 'UOM_INVALID_PRODUCT_CONTEXT'; END IF;
  SELECT p.org_id,p.base_uom_id INTO v_product_org,v_base_uom
  FROM public.products p WHERE p.id=p_product;
  IF NOT FOUND OR v_product_org IS DISTINCT FROM p_org THEN RAISE EXCEPTION 'UOM_PRODUCT_NOT_FOUND_OR_WRONG_ORG'; END IF;
  IF v_base_uom IS NULL THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED: product=%',p_product; END IF;
  IF p_uom IS NULL OR p_uom=v_base_uom THEN RETURN 1; END IF;

  SELECT u.category_id,u.factor_to_category_base,u.is_product_specific
  INTO v_base_category,v_base_factor,v_base_product_specific
  FROM public.uoms u WHERE u.id=v_base_uom AND u.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_INVALID: product=%',p_product; END IF;
  IF v_base_product_specific THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC'; END IF;

  SELECT u.category_id,u.factor_to_category_base,u.is_product_specific
  INTO v_target_category,v_target_factor,v_target_product_specific
  FROM public.uoms u WHERE u.id=p_uom AND u.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'UOM_NOT_FOUND_OR_INACTIVE: uom=%',p_uom; END IF;

  -- A product-specific physical fact is evaluated before generic category rules.
  SELECT c.factor_to_base,c.allow_cross_dimension
  INTO v_product_factor,v_allow_cross
  FROM public.product_uom_conversions c
  WHERE c.org_id=p_org AND c.product_id=p_product AND c.uom_id=p_uom AND c.is_active
    AND c.valid_from<=COALESCE(p_at,now())
    AND (c.valid_to IS NULL OR c.valid_to>COALESCE(p_at,now()))
  ORDER BY c.valid_from DESC,c.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_product_factor<=0 THEN RAISE EXCEPTION 'UOM_FACTOR_MUST_BE_POSITIVE'; END IF;
    IF v_target_category<>v_base_category AND NOT v_allow_cross THEN
      RAISE EXCEPTION 'UOM_CROSS_DIMENSION_NOT_ALLOWED';
    END IF;
    RETURN v_product_factor;
  END IF;

  IF v_target_category<>v_base_category THEN RAISE EXCEPTION 'UOM_CATEGORY_MISMATCH'; END IF;
  IF v_target_product_specific THEN RAISE EXCEPTION 'PRODUCT_UOM_CONVERSION_MISSING: product=%, uom=%',p_product,p_uom; END IF;
  IF v_target_factor IS NULL OR v_base_factor IS NULL OR v_target_factor<=0 OR v_base_factor<=0 THEN
    RAISE EXCEPTION 'STANDARD_UOM_FACTOR_INVALID';
  END IF;
  RETURN v_target_factor/v_base_factor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_validate_product_uom_conversion()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_product_org uuid; v_base_category uuid; v_target_category uuid;
BEGIN
  SELECT p.org_id,base.category_id INTO v_product_org,v_base_category
  FROM public.products p JOIN public.uoms base ON base.id=p.base_uom_id
  WHERE p.id=NEW.product_id;
  IF NOT FOUND OR v_product_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'PRODUCT_UOM_WRONG_ORG_OR_BASE_MISSING'; END IF;
  SELECT category_id INTO v_target_category FROM public.uoms WHERE id=NEW.uom_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_UOM_TARGET_INVALID'; END IF;
  IF v_target_category<>v_base_category AND NOT COALESCE(NEW.allow_cross_dimension,false) THEN
    RAISE EXCEPTION 'PRODUCT_UOM_CROSS_DIMENSION_REQUIRES_EXPLICIT_FLAG';
  END IF;
  NEW.updated_at:=now(); RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.rpc_set_product_uom_conversion(
  uuid,uuid,uuid,numeric,boolean,boolean,text,text
);
CREATE FUNCTION public.rpc_set_product_uom_conversion(
  p_org_id uuid,
  p_product_id uuid,
  p_uom_id uuid,
  p_factor_to_base numeric,
  p_use_for_purchase boolean DEFAULT false,
  p_use_for_sale boolean DEFAULT false,
  p_barcode text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_allow_cross_dimension boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_now timestamptz:=clock_timestamp(); v_id uuid; v_base_uom uuid;
  v_base_category uuid; v_target_category uuid;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);
  IF p_product_id IS NULL OR p_uom_id IS NULL THEN RAISE EXCEPTION 'PRODUCT_AND_UOM_REQUIRED'; END IF;
  IF p_factor_to_base IS NULL OR p_factor_to_base<=0 THEN RAISE EXCEPTION 'UOM_FACTOR_MUST_BE_POSITIVE'; END IF;

  SELECT p.base_uom_id,b.category_id INTO v_base_uom,v_base_category
  FROM public.products p LEFT JOIN public.uoms b ON b.id=p.base_uom_id
  WHERE p.id=p_product_id AND p.org_id=p_org_id FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG'; END IF;
  IF v_base_uom IS NULL OR v_base_category IS NULL THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED'; END IF;
  SELECT category_id INTO v_target_category FROM public.uoms WHERE id=p_uom_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'UOM_NOT_FOUND_OR_INACTIVE'; END IF;
  IF p_uom_id=v_base_uom AND abs(p_factor_to_base-1)>0.000000000001 THEN RAISE EXCEPTION 'BASE_UOM_FACTOR_MUST_EQUAL_ONE'; END IF;
  IF v_target_category<>v_base_category AND NOT COALESCE(p_allow_cross_dimension,false) THEN
    RAISE EXCEPTION 'PRODUCT_UOM_CROSS_DIMENSION_REQUIRES_EXPLICIT_FLAG';
  END IF;

  UPDATE public.product_uom_conversions
  SET is_active=false,valid_to=v_now,updated_at=v_now
  WHERE org_id=p_org_id AND product_id=p_product_id AND uom_id=p_uom_id
    AND is_active AND valid_to IS NULL;

  INSERT INTO public.product_uom_conversions(
    org_id,product_id,uom_id,factor_to_base,valid_from,valid_to,is_active,
    use_for_purchase,use_for_sale,barcode,notes,allow_cross_dimension,
    created_by,created_at,updated_at
  ) VALUES (
    p_org_id,p_product_id,p_uom_id,p_factor_to_base,v_now,NULL,true,
    COALESCE(p_use_for_purchase,false),COALESCE(p_use_for_sale,false),
    NULLIF(trim(p_barcode),''),NULLIF(trim(p_notes),''),
    COALESCE(p_allow_cross_dimension,false),auth.uid(),v_now,v_now
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success',true,'conversion_id',v_id,'org_id',p_org_id,
    'product_id',p_product_id,'uom_id',p_uom_id,'factor_to_base',p_factor_to_base,
    'allow_cross_dimension',COALESCE(p_allow_cross_dimension,false),'valid_from',v_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_set_product_physical_weight(
  p_product_id uuid,p_net_weight numeric,p_gross_weight numeric,p_weight_uom_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_base_uom uuid; v_base_category uuid; v_weight_category uuid;
  v_now timestamptz:=clock_timestamp(); v_conversion_id uuid; v_factor numeric;
BEGIN
  SELECT p.org_id,p.base_uom_id,b.category_id INTO v_org,v_base_uom,v_base_category
  FROM public.products p LEFT JOIN public.uoms b ON b.id=p.base_uom_id
  WHERE p.id=p_product_id FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_admin(v_org);
  IF p_net_weight IS NULL OR p_net_weight<=0 THEN RAISE EXCEPTION 'NET_WEIGHT_MUST_BE_POSITIVE'; END IF;
  IF p_gross_weight IS NOT NULL AND p_gross_weight<p_net_weight THEN RAISE EXCEPTION 'GROSS_WEIGHT_BELOW_NET_WEIGHT'; END IF;
  SELECT u.category_id INTO v_weight_category
  FROM public.uoms u JOIN public.uom_categories c ON c.id=u.category_id
  WHERE u.id=p_weight_uom_id AND u.is_active AND c.dimension='mass';
  IF NOT FOUND THEN RAISE EXCEPTION 'WEIGHT_UOM_MUST_BE_ACTIVE_MASS_UNIT'; END IF;
  IF v_base_uom IS NULL THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED'; END IF;

  UPDATE public.products
  SET net_weight=p_net_weight,gross_weight=p_gross_weight,
      weight_uom_id=p_weight_uom_id,updated_at=v_now
  WHERE id=p_product_id AND org_id=v_org;

  IF p_weight_uom_id<>v_base_uom THEN
    v_factor:=round(1/p_net_weight,12);
    UPDATE public.product_uom_conversions
    SET is_active=false,valid_to=v_now,updated_at=v_now
    WHERE org_id=v_org AND product_id=p_product_id AND uom_id=p_weight_uom_id
      AND is_active AND valid_to IS NULL;
    INSERT INTO public.product_uom_conversions(
      org_id,product_id,uom_id,factor_to_base,valid_from,is_active,
      use_for_purchase,use_for_sale,notes,allow_cross_dimension,
      created_by,created_at,updated_at
    ) VALUES (
      v_org,p_product_id,p_weight_uom_id,v_factor,v_now,true,
      false,false,'Generated from declared net product weight',
      v_weight_category<>v_base_category,auth.uid(),v_now,v_now
    ) RETURNING id INTO v_conversion_id;
  END IF;

  RETURN jsonb_build_object('success',true,'product_id',p_product_id,
    'net_weight',p_net_weight,'gross_weight',p_gross_weight,
    'weight_uom_id',p_weight_uom_id,'generated_conversion_id',v_conversion_id,
    'weight_uom_to_base_factor',v_factor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_get_product_weight(
  p_product_id uuid,p_quantity numeric,p_uom_id uuid,p_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid; v_net numeric; v_gross numeric; v_weight_uom uuid;
  v_factor numeric; v_base_qty numeric;
BEGIN
  SELECT org_id,net_weight,gross_weight,weight_uom_id
  INTO v_org,v_net,v_gross,v_weight_uom FROM public.products WHERE id=p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'UOM_QUANTITY_MUST_BE_NONNEGATIVE'; END IF;
  IF v_net IS NULL OR v_weight_uom IS NULL THEN RAISE EXCEPTION 'PRODUCT_WEIGHT_NOT_DECLARED'; END IF;
  v_factor:=public.wardah_uom_factor(v_org,p_product_id,p_uom_id,p_at);
  v_base_qty:=round(p_quantity*v_factor,6);
  RETURN jsonb_build_object('success',true,'product_id',p_product_id,
    'quantity_entered',p_quantity,'uom_id',p_uom_id,'base_quantity',v_base_qty,
    'weight_uom_id',v_weight_uom,'net_weight',round(v_base_qty*v_net,6),
    'gross_weight',CASE WHEN v_gross IS NULL THEN NULL ELSE round(v_base_qty*v_gross,6) END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_set_product_uom_conversion(
  uuid,uuid,uuid,numeric,boolean,boolean,text,text,boolean
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_product_uom_conversion(
  uuid,uuid,uuid,numeric,boolean,boolean,text,text,boolean
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_set_product_physical_weight(uuid,numeric,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_product_physical_weight(uuid,numeric,numeric,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_get_product_weight(uuid,numeric,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_product_weight(uuid,numeric,uuid,timestamptz) TO authenticated;

COMMENT ON COLUMN public.products.net_weight IS
  'Declared net mass of one legal base-UoM unit, expressed in weight_uom_id.';
COMMENT ON COLUMN public.product_uom_conversions.allow_cross_dimension IS
  'Explicit product-physical conversion permission; generic cross-dimension conversion remains prohibited.';
