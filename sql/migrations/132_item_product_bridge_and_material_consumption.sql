-- migration_number: 132
-- description: Replace implicit items.id = products.id assumptions with an explicit,
--              tenant-scoped bridge and fail-closed material consumption.
-- safety: additive bridge and replace-only RPC. Legacy identifiers remain readable.

CREATE TABLE IF NOT EXISTS public.item_product_map (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  item_id uuid NOT NULL REFERENCES public.items(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  mapping_source text NOT NULL DEFAULT 'MANUAL',
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_product_map_validity CHECK (valid_to IS NULL OR valid_to>valid_from),
  CONSTRAINT item_product_map_source CHECK (mapping_source IN ('MANUAL','CODE_MATCH','LEGACY_SHARED_ID'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_item_product_map_current_item
  ON public.item_product_map(org_id,item_id) WHERE is_active AND valid_to IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_product_map_current_product
  ON public.item_product_map(org_id,product_id) WHERE is_active AND valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_item_product_map_product ON public.item_product_map(org_id,product_id);

ALTER TABLE public.item_product_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_product_map_read ON public.item_product_map;
CREATE POLICY item_product_map_read ON public.item_product_map
  FOR SELECT TO authenticated USING (org_id=public.wardah_org_id(NULL::uuid));
DROP POLICY IF EXISTS item_product_map_admin ON public.item_product_map;
CREATE POLICY item_product_map_admin ON public.item_product_map
  FOR ALL TO authenticated
  USING (public.wardah_is_org_admin(org_id))
  WITH CHECK (
    public.wardah_is_org_admin(org_id)
    AND EXISTS (SELECT 1 FROM public.items i WHERE i.id=item_id AND i.org_id=org_id)
    AND EXISTS (SELECT 1 FROM public.products p WHERE p.id=product_id AND p.org_id=org_id)
  );
GRANT SELECT,INSERT,UPDATE,DELETE ON public.item_product_map TO authenticated;

-- Only deterministic code matches are backfilled. No name/fuzzy matching is permitted.
INSERT INTO public.item_product_map(org_id,item_id,product_id,mapping_source)
SELECT i.org_id,i.id,p.id,'CODE_MATCH'
FROM public.items i
JOIN public.products p ON p.org_id=i.org_id AND p.code=i.code
WHERE NOT EXISTS (
  SELECT 1 FROM public.item_product_map m
  WHERE m.org_id=i.org_id AND m.item_id=i.id AND m.is_active AND m.valid_to IS NULL
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.wardah_resolve_product_id(
  p_org uuid,p_item_or_product uuid,p_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_product uuid;
BEGIN
  IF p_org IS NULL OR p_item_or_product IS NULL THEN RAISE EXCEPTION 'ITEM_PRODUCT_CONTEXT_REQUIRED'; END IF;

  SELECT m.product_id INTO v_product
  FROM public.item_product_map m
  WHERE m.org_id=p_org AND m.item_id=p_item_or_product AND m.is_active
    AND m.valid_from<=COALESCE(p_at,now()) AND (m.valid_to IS NULL OR m.valid_to>COALESCE(p_at,now()))
  ORDER BY m.valid_from DESC LIMIT 1;
  IF FOUND THEN RETURN v_product; END IF;

  -- Compatibility is accepted only when the supplied UUID is a real product in the same org.
  SELECT p.id INTO v_product FROM public.products p
  WHERE p.id=p_item_or_product AND p.org_id=p_org;
  IF FOUND THEN RETURN v_product; END IF;

  RAISE EXCEPTION 'ITEM_PRODUCT_MAP_MISSING: org=%, item=%',p_org,p_item_or_product;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.wardah_resolve_product_id(uuid,uuid,timestamptz)
  FROM PUBLIC,anon,authenticated;

UPDATE public.bom_lines bl
SET product_id=public.wardah_resolve_product_id(bl.org_id,bl.item_id,COALESCE(bl.created_at,now()))
WHERE bl.product_id IS NULL;

UPDATE public.material_reservations mr
SET product_id=public.wardah_resolve_product_id(mr.org_id,mr.item_id,COALESCE(mr.created_at,now())),
    uom_id=COALESCE(mr.uom_id,p.base_uom_id),
    qty_entered=COALESCE(mr.qty_entered,mr.quantity_reserved),
    conversion_factor_snapshot=COALESCE(mr.conversion_factor_snapshot,1)
FROM public.products p
WHERE mr.product_id IS NULL
  AND p.id=public.wardah_resolve_product_id(mr.org_id,mr.item_id,COALESCE(mr.created_at,now()));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.bom_lines'::regclass AND conname='bom_lines_product_id_fkey') THEN
    ALTER TABLE public.bom_lines ADD CONSTRAINT bom_lines_product_id_fkey
      FOREIGN KEY(product_id) REFERENCES public.products(id) NOT VALID;
  END IF;
  ALTER TABLE public.bom_lines VALIDATE CONSTRAINT bom_lines_product_id_fkey;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.material_reservations'::regclass AND conname='material_reservations_product_id_fkey') THEN
    ALTER TABLE public.material_reservations ADD CONSTRAINT material_reservations_product_id_fkey
      FOREIGN KEY(product_id) REFERENCES public.products(id) NOT VALID;
  END IF;
  ALTER TABLE public.material_reservations VALIDATE CONSTRAINT material_reservations_product_id_fkey;
END
$$;

CREATE OR REPLACE FUNCTION public.trg_resolve_item_product_reference()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF NEW.item_id IS NOT NULL THEN
    NEW.product_id:=public.wardah_resolve_product_id(NEW.org_id,NEW.item_id,COALESCE(NEW.created_at,now()));
  ELSIF NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_OR_PRODUCT_REQUIRED';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS resolve_bom_line_product ON public.bom_lines;
CREATE TRIGGER resolve_bom_line_product BEFORE INSERT OR UPDATE OF org_id,item_id,product_id
ON public.bom_lines FOR EACH ROW EXECUTE FUNCTION public.trg_resolve_item_product_reference();
DROP TRIGGER IF EXISTS resolve_material_reservation_product ON public.material_reservations;
CREATE TRIGGER resolve_material_reservation_product BEFORE INSERT OR UPDATE OF org_id,item_id,product_id
ON public.material_reservations FOR EACH ROW EXECUTE FUNCTION public.trg_resolve_item_product_reference();
REVOKE EXECUTE ON FUNCTION public.trg_resolve_item_product_reference() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials(p_mo_id uuid,p_consumptions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_mo_number text; v_row jsonb; v_res public.material_reservations%rowtype;
  v_product uuid; v_uom uuid; v_qty_entered numeric; v_qty_base numeric; v_factor numeric;
  v_warehouse uuid; v_count integer; v_remaining numeric;
BEGIN
  SELECT org_id,order_number INTO v_org,v_mo_number
  FROM public.manufacturing_orders WHERE id=p_mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF jsonb_typeof(p_consumptions)<>'array' OR jsonb_array_length(p_consumptions)=0 THEN RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED'; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_consumptions) LOOP
    SELECT * INTO v_res FROM public.material_reservations
    WHERE org_id=v_org AND mo_id=p_mo_id
      AND item_id=(v_row->>'item_id')::uuid AND status='reserved' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_RESERVATION_NOT_FOUND'; END IF;

    v_product:=COALESCE(v_res.product_id,public.wardah_resolve_product_id(v_org,v_res.item_id,now()));
    SELECT COALESCE(NULLIF(v_row->>'uom_id','')::uuid,v_res.uom_id,p.base_uom_id)
      INTO v_uom FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=NULLIF(v_row->>'quantity','')::numeric;
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN RAISE EXCEPTION 'INVALID_CONSUMPTION_QUANTITY'; END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
    v_qty_base:=round(v_qty_entered*v_factor,6);

    v_remaining:=v_res.quantity_reserved-COALESCE(v_res.quantity_consumed,0)-COALESCE(v_res.quantity_released,0);
    IF v_qty_base>v_remaining THEN RAISE EXCEPTION 'CONSUMPTION_EXCEEDS_RESERVATION: remaining=%, requested_base=%',v_remaining,v_qty_base; END IF;

    v_warehouse:=NULLIF(COALESCE(v_row->>'warehouse_id',v_row->>'location_id'),'')::uuid;
    IF v_warehouse IS NULL THEN
      SELECT count(*),min(warehouse_id) INTO v_count,v_warehouse
      FROM public.bins WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_CONSUMPTION'; END IF;
    END IF;

    PERFORM public.wardah_apply_stock_outgoing(v_org,v_product,v_warehouse,v_qty_base,
      'Material Consumption',p_mo_id,v_mo_number,CURRENT_DATE);

    UPDATE public.material_reservations
    SET product_id=v_product,uom_id=v_uom,qty_entered=COALESCE(qty_entered,quantity_reserved),
        conversion_factor_snapshot=COALESCE(conversion_factor_snapshot,1),
        quantity_consumed=COALESCE(quantity_consumed,0)+v_qty_base,
        status=CASE WHEN COALESCE(quantity_consumed,0)+v_qty_base+COALESCE(quantity_released,0)>=quantity_reserved
                    THEN 'consumed' ELSE 'reserved' END,
        consumed_at=now(),updated_at=now()
    WHERE id=v_res.id;
  END LOOP;
  RETURN jsonb_build_object('success',true,'mo_id',p_mo_id,'consumption_count',jsonb_array_length(p_consumptions),'uom_atomic',true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_consume_reserved_materials(uuid,jsonb) TO authenticated;
