-- migration_number: 140
-- description: Support tenant-scoped custom units while retaining shared system UoMs.
-- safety: additive tenant ownership + guarded admin RPC. Direct catalog writes remain revoked.

ALTER TABLE public.uoms
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.uom_aliases
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.uoms DROP CONSTRAINT IF EXISTS uoms_code_key;
ALTER TABLE public.uom_aliases DROP CONSTRAINT IF EXISTS uom_aliases_alias_normalized_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_uoms_system_code
  ON public.uoms(code) WHERE org_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_uoms_org_code
  ON public.uoms(org_id,code) WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_uom_aliases_system_alias
  ON public.uom_aliases(alias_normalized) WHERE org_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_uom_aliases_org_alias
  ON public.uom_aliases(org_id,alias_normalized) WHERE org_id IS NOT NULL;

DROP POLICY IF EXISTS uoms_read ON public.uoms;
CREATE POLICY uoms_read ON public.uoms FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id=public.wardah_org_id(NULL::uuid));
DROP POLICY IF EXISTS uom_aliases_read ON public.uom_aliases;
CREATE POLICY uom_aliases_read ON public.uom_aliases FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id=public.wardah_org_id(NULL::uuid));

REVOKE INSERT,UPDATE,DELETE ON public.uoms,public.uom_aliases FROM authenticated,anon;
GRANT SELECT ON public.uoms,public.uom_aliases TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_create_org_uom(
  p_org_id uuid,
  p_category_id uuid,
  p_code text,
  p_name text,
  p_name_ar text,
  p_symbol text,
  p_factor_to_category_base numeric DEFAULT NULL,
  p_is_product_specific boolean DEFAULT false,
  p_decimal_places smallint DEFAULT 6,
  p_aliases text[] DEFAULT ARRAY[]::text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_code text; v_id uuid; v_alias text; v_normalized text;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);
  v_code:=upper(regexp_replace(trim(COALESCE(p_code,'')),'[^A-Za-z0-9_]+','_','g'));
  IF v_code='' OR v_code!~'^[A-Z][A-Z0-9_]*$' THEN RAISE EXCEPTION 'UOM_CODE_INVALID'; END IF;
  IF NULLIF(trim(p_name),'') IS NULL OR NULLIF(trim(p_symbol),'') IS NULL THEN RAISE EXCEPTION 'UOM_NAME_AND_SYMBOL_REQUIRED'; END IF;
  IF p_decimal_places NOT BETWEEN 0 AND 12 THEN RAISE EXCEPTION 'UOM_DECIMAL_PLACES_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.uom_categories WHERE id=p_category_id) THEN RAISE EXCEPTION 'UOM_CATEGORY_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.uoms WHERE org_id IS NULL AND code=v_code) THEN
    RAISE EXCEPTION 'SYSTEM_UOM_CODE_RESERVED: %',v_code;
  END IF;
  IF COALESCE(p_is_product_specific,false) THEN
    IF p_factor_to_category_base IS NOT NULL THEN RAISE EXCEPTION 'PRODUCT_SPECIFIC_UOM_FACTOR_MUST_BE_NULL'; END IF;
  ELSIF p_factor_to_category_base IS NULL OR p_factor_to_category_base<=0 THEN
    RAISE EXCEPTION 'STANDARD_UOM_FACTOR_MUST_BE_POSITIVE';
  END IF;

  INSERT INTO public.uoms(
    org_id,category_id,code,name,name_ar,symbol,factor_to_category_base,
    is_category_base,is_product_specific,decimal_places,is_active
  ) VALUES (
    p_org_id,p_category_id,v_code,trim(p_name),NULLIF(trim(p_name_ar),''),trim(p_symbol),
    p_factor_to_category_base,false,COALESCE(p_is_product_specific,false),p_decimal_places,true
  ) RETURNING id INTO v_id;

  FOREACH v_alias IN ARRAY COALESCE(p_aliases,ARRAY[]::text[]) LOOP
    v_normalized:=public.uom_normalize_alias(v_alias);
    IF v_normalized<>'' THEN
      IF EXISTS (SELECT 1 FROM public.uom_aliases WHERE org_id IS NULL AND alias_normalized=v_normalized) THEN
        RAISE EXCEPTION 'SYSTEM_UOM_ALIAS_RESERVED: %',v_alias;
      END IF;
      INSERT INTO public.uom_aliases(org_id,alias_normalized,alias_display,uom_id,source)
      VALUES(p_org_id,v_normalized,trim(v_alias),v_id,'tenant_admin');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success',true,'uom_id',v_id,'org_id',p_org_id,
    'code',v_code,'is_product_specific',COALESCE(p_is_product_specific,false));
END;
$function$;

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
  FROM public.uoms u
  WHERE u.id=v_base_uom AND u.is_active AND (u.org_id IS NULL OR u.org_id=p_org);
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_INVALID_OR_WRONG_ORG: product=%',p_product; END IF;
  IF v_base_product_specific THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC'; END IF;

  SELECT u.category_id,u.factor_to_category_base,u.is_product_specific
  INTO v_target_category,v_target_factor,v_target_product_specific
  FROM public.uoms u
  WHERE u.id=p_uom AND u.is_active AND (u.org_id IS NULL OR u.org_id=p_org);
  IF NOT FOUND THEN RAISE EXCEPTION 'UOM_NOT_FOUND_IN_ORG_OR_INACTIVE: uom=%',p_uom; END IF;

  SELECT c.factor_to_base,c.allow_cross_dimension
  INTO v_product_factor,v_allow_cross
  FROM public.product_uom_conversions c
  WHERE c.org_id=p_org AND c.product_id=p_product AND c.uom_id=p_uom AND c.is_active
    AND c.valid_from<=COALESCE(p_at,now())
    AND (c.valid_to IS NULL OR c.valid_to>COALESCE(p_at,now()))
  ORDER BY c.valid_from DESC,c.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_product_factor<=0 THEN RAISE EXCEPTION 'UOM_FACTOR_MUST_BE_POSITIVE'; END IF;
    IF v_target_category<>v_base_category AND NOT v_allow_cross THEN RAISE EXCEPTION 'UOM_CROSS_DIMENSION_NOT_ALLOWED'; END IF;
    RETURN v_product_factor;
  END IF;

  IF v_target_category<>v_base_category THEN RAISE EXCEPTION 'UOM_CATEGORY_MISMATCH'; END IF;
  IF v_target_product_specific THEN RAISE EXCEPTION 'PRODUCT_UOM_CONVERSION_MISSING: product=%, uom=%',p_product,p_uom; END IF;
  IF v_target_factor IS NULL OR v_base_factor IS NULL OR v_target_factor<=0 OR v_base_factor<=0 THEN RAISE EXCEPTION 'STANDARD_UOM_FACTOR_INVALID'; END IF;
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
  WHERE p.id=NEW.product_id AND (base.org_id IS NULL OR base.org_id=p.org_id);
  IF NOT FOUND OR v_product_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'PRODUCT_UOM_WRONG_ORG_OR_BASE_MISSING'; END IF;
  SELECT category_id INTO v_target_category FROM public.uoms
  WHERE id=NEW.uom_id AND is_active AND (org_id IS NULL OR org_id=NEW.org_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_UOM_TARGET_INVALID_OR_WRONG_ORG'; END IF;
  IF v_target_category<>v_base_category AND NOT COALESCE(NEW.allow_cross_dimension,false) THEN
    RAISE EXCEPTION 'PRODUCT_UOM_CROSS_DIMENSION_REQUIRES_EXPLICIT_FLAG';
  END IF;
  NEW.updated_at:=now(); RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_org_uom(
  uuid,uuid,text,text,text,text,numeric,boolean,smallint,text[]
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_org_uom(
  uuid,uuid,text,text,text,text,numeric,boolean,smallint,text[]
) TO authenticated;

COMMENT ON COLUMN public.uoms.org_id IS
  'NULL means shared system unit; non-NULL means tenant-owned custom unit visible only inside that organization.';
