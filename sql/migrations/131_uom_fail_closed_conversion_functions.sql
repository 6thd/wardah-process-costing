-- migration_number: 131
-- description: Add fail-closed UoM conversion functions and a guarded public
--              conversion RPC. Internal helpers are not executable by clients.
-- safety: function-only; no operational data is changed.

CREATE OR REPLACE FUNCTION public.wardah_uom_factor(
  p_org uuid, p_product uuid, p_uom uuid, p_at timestamptz DEFAULT now()
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_product_org uuid; v_base_uom uuid; v_base_category uuid;
  v_base_factor numeric; v_base_product_specific boolean;
  v_target_category uuid; v_target_factor numeric; v_target_product_specific boolean;
  v_product_factor numeric;
BEGIN
  IF p_org IS NULL OR p_product IS NULL THEN RAISE EXCEPTION 'UOM_INVALID_PRODUCT_CONTEXT'; END IF;
  SELECT p.org_id,p.base_uom_id INTO v_product_org,v_base_uom FROM public.products p WHERE p.id=p_product;
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
  IF v_target_category<>v_base_category THEN RAISE EXCEPTION 'UOM_CATEGORY_MISMATCH'; END IF;

  SELECT c.factor_to_base INTO v_product_factor
  FROM public.product_uom_conversions c
  WHERE c.org_id=p_org AND c.product_id=p_product AND c.uom_id=p_uom AND c.is_active
    AND c.valid_from<=COALESCE(p_at,now()) AND (c.valid_to IS NULL OR c.valid_to>COALESCE(p_at,now()))
  ORDER BY c.valid_from DESC,c.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_product_factor<=0 THEN RAISE EXCEPTION 'UOM_FACTOR_MUST_BE_POSITIVE'; END IF;
    RETURN v_product_factor;
  END IF;
  IF v_target_product_specific THEN RAISE EXCEPTION 'PRODUCT_UOM_CONVERSION_MISSING: product=%, uom=%',p_product,p_uom; END IF;
  IF v_target_factor IS NULL OR v_base_factor IS NULL OR v_target_factor<=0 OR v_base_factor<=0 THEN
    RAISE EXCEPTION 'STANDARD_UOM_FACTOR_INVALID';
  END IF;
  RETURN v_target_factor/v_base_factor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wardah_uom_to_base(
  p_org uuid,p_product uuid,p_quantity numeric,p_uom uuid,p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_factor numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'UOM_QUANTITY_MUST_BE_NONNEGATIVE'; END IF;
  v_factor:=public.wardah_uom_factor(p_org,p_product,p_uom,p_at);
  RETURN round(p_quantity*v_factor,6);
END;
$function$;

CREATE OR REPLACE FUNCTION public.wardah_uom_cost_to_base(
  p_org uuid,p_product uuid,p_unit_cost_entered numeric,p_uom uuid,p_at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_factor numeric;
BEGIN
  IF p_unit_cost_entered IS NULL OR p_unit_cost_entered<0 THEN RAISE EXCEPTION 'UOM_UNIT_COST_MUST_BE_NONNEGATIVE'; END IF;
  v_factor:=public.wardah_uom_factor(p_org,p_product,p_uom,p_at);
  RETURN round(p_unit_cost_entered/v_factor,6);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_convert_product_uom(
  p_product_id uuid,p_quantity numeric,p_uom_id uuid,p_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid; v_base_uom uuid; v_factor numeric; v_base_quantity numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'UOM_QUANTITY_MUST_BE_NONNEGATIVE'; END IF;
  SELECT org_id,base_uom_id INTO v_org,v_base_uom FROM public.products WHERE id=p_product_id;
  IF NOT FOUND OR v_org IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  v_factor:=public.wardah_uom_factor(v_org,p_product_id,p_uom_id,p_at);
  v_base_quantity:=round(p_quantity*v_factor,6);
  RETURN jsonb_build_object('success',true,'product_id',p_product_id,'uom_id',COALESCE(p_uom_id,v_base_uom),
    'base_uom_id',v_base_uom,'quantity_entered',p_quantity,'conversion_factor',v_factor,'base_quantity',v_base_quantity);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_validate_product_uom_conversion()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_product_org uuid; v_base_category uuid; v_target_category uuid;
BEGIN
  SELECT p.org_id,base.category_id INTO v_product_org,v_base_category
  FROM public.products p JOIN public.uoms base ON base.id=p.base_uom_id WHERE p.id=NEW.product_id;
  IF NOT FOUND OR v_product_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'PRODUCT_UOM_WRONG_ORG_OR_BASE_MISSING'; END IF;
  SELECT category_id INTO v_target_category FROM public.uoms WHERE id=NEW.uom_id AND is_active;
  IF NOT FOUND OR v_target_category<>v_base_category THEN RAISE EXCEPTION 'PRODUCT_UOM_CATEGORY_MISMATCH'; END IF;
  NEW.updated_at:=now(); RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_product_uom_conversion ON public.product_uom_conversions;
CREATE TRIGGER validate_product_uom_conversion BEFORE INSERT OR UPDATE ON public.product_uom_conversions
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_product_uom_conversion();

REVOKE EXECUTE ON FUNCTION public.wardah_uom_factor(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.wardah_uom_to_base(uuid,uuid,numeric,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.wardah_uom_cost_to_base(uuid,uuid,numeric,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_validate_product_uom_conversion() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_convert_product_uom(uuid,numeric,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_convert_product_uom(uuid,numeric,uuid,timestamptz) TO authenticated;

COMMENT ON FUNCTION public.wardah_uom_factor(uuid,uuid,uuid,timestamptz) IS
  'Internal fail-closed product UoM factor resolver. Returns base quantity per entered UoM.';
