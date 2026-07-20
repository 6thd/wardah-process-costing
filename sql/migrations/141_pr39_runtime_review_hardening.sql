-- migration_number: 141
-- description: Runtime hardening identified by semantic review: explicit nested-BOM
--              quantity validation and replacement of explode_bom with a guarded divisor.
-- safety: function-only. No data rewrite.

CREATE OR REPLACE FUNCTION public.wardah_require_positive_bom_quantity(
  p_bom_id uuid,
  p_quantity numeric
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'BOM_CHILD_QUANTITY_INVALID: bom_id=%, quantity=%', p_bom_id, p_quantity;
  END IF;
  RETURN p_quantity;
END;
$function$;

CREATE OR REPLACE FUNCTION public.explode_bom(
  p_bom_id uuid,p_quantity numeric DEFAULT 1,p_org_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  level_number integer,item_id uuid,item_code varchar,item_name varchar,
  quantity_required numeric,unit_of_measure varchar,is_critical boolean,
  scrap_factor numeric,line_type varchar
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_org uuid; v_header_qty numeric;
BEGIN
  SELECT org_id,quantity INTO v_org,v_header_qty
  FROM public.bom_headers WHERE id=p_bom_id AND (p_org_id IS NULL OR org_id=p_org_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'BOM_NOT_FOUND_OR_WRONG_ORG'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR COALESCE(v_header_qty,0)<=0 THEN
    RAISE EXCEPTION 'BOM_EXPLOSION_QUANTITY_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bom_lines WHERE bom_id=p_bom_id AND quantity_base IS NULL AND line_type<>'REFERENCE') THEN
    RAISE EXCEPTION 'BOM_HAS_UNRESOLVED_UOM_LINES';
  END IF;

  RETURN QUERY
  WITH RECURSIVE bom_tree AS (
    SELECT 1 AS level,
           bl.item_id,bl.product_id,
           round((p_quantity/v_header_qty)*bl.quantity_base*(1+COALESCE(bl.scrap_factor,0)/100),6) AS qty_required,
           COALESCE(bl.is_critical,false) AS critical,
           COALESCE(bl.scrap_factor,0) AS scrap,
           COALESCE(bl.line_type,'COMPONENT')::text AS kind,
           ARRAY[bl.item_id]::uuid[] AS path
    FROM public.bom_lines bl
    WHERE bl.bom_id=p_bom_id AND bl.line_type<>'REFERENCE'

    UNION ALL

    SELECT bt.level+1,
           child.item_id,child.product_id,
           round((bt.qty_required/public.wardah_require_positive_bom_quantity(
                    child_header.id,child_header.quantity
                  ))*child.quantity_base*
                 (1+COALESCE(child.scrap_factor,0)/100),6),
           COALESCE(child.is_critical,false),COALESCE(child.scrap_factor,0),
           COALESCE(child.line_type,'COMPONENT')::text,
           bt.path||child.item_id
    FROM bom_tree bt
    JOIN LATERAL (
      SELECT bh.id,bh.quantity
      FROM public.bom_headers bh
      WHERE bh.org_id=v_org AND bh.item_id=bt.item_id AND COALESCE(bh.is_active,true)
        AND COALESCE(bh.effective_date,CURRENT_DATE)<=CURRENT_DATE
      ORDER BY COALESCE(bh.bom_version,1) DESC,bh.effective_date DESC NULLS LAST,bh.created_at DESC
      LIMIT 1
    ) child_header ON true
    JOIN public.bom_lines child ON child.bom_id=child_header.id AND child.line_type<>'REFERENCE'
    WHERE bt.level<20
      AND child.quantity_base IS NOT NULL
      AND NOT child.item_id=ANY(bt.path)
  )
  SELECT min(bt.level)::integer,
         bt.item_id,
         COALESCE(i.code,i.item_code)::varchar,
         COALESCE(i.name,i.item_name)::varchar,
         round(sum(bt.qty_required),6),
         u.symbol::varchar,
         bool_or(bt.critical),
         max(bt.scrap),
         min(bt.kind)::varchar
  FROM bom_tree bt
  LEFT JOIN public.items i ON i.id=bt.item_id
  LEFT JOIN public.products p ON p.id=bt.product_id
  LEFT JOIN public.uoms u ON u.id=p.base_uom_id
  GROUP BY bt.item_id,i.code,i.item_code,i.name,i.item_name,u.symbol
  ORDER BY min(bt.level),COALESCE(i.code,i.item_code);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.wardah_require_positive_bom_quantity(uuid,numeric)
  FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public.wardah_require_positive_bom_quantity(uuid,numeric) IS
  'Internal nested-BOM divisor guard. Raises BOM_CHILD_QUANTITY_INVALID instead of raw division-by-zero.';