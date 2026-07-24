-- migration_number: 145
-- description: Server-side, flag-gated UoM and tenant-consistency backstop for
--              stock-adjustment lines and stock-ledger writes.
-- safety: additive/replace-only. No operational data is changed. The UoM gate remains
--         dormant while the rollout flag is absent or false; tenant consistency is
--         always enforced because cross-org stock rows are never a valid legacy path.

CREATE OR REPLACE FUNCTION public.wardah_guard_mapped_product_uom_stock_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_org uuid;
  v_product uuid;
  v_warehouse uuid;
  v_adjustment uuid;
  v_enabled boolean := false;
BEGIN
  v_org := COALESCE(
    NULLIF(v_row ->> 'org_id', '')::uuid,
    NULLIF(v_row ->> 'organization_id', '')::uuid
  );
  v_product := NULLIF(v_row ->> 'product_id', '')::uuid;
  v_warehouse := NULLIF(v_row ->> 'warehouse_id', '')::uuid;
  v_adjustment := NULLIF(v_row ->> 'adjustment_id', '')::uuid;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORG_CONTEXT_REQUIRED: table=%', TG_TABLE_NAME;
  END IF;

  -- Always validate structural tenant consistency, even before UoM rollout. A child
  -- line may never claim a different organization than its adjustment header, and a
  -- warehouse reference must belong to the row organization.
  IF TG_TABLE_NAME = 'stock_adjustment_items' THEN
    IF v_adjustment IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.stock_adjustments sa
      WHERE sa.id = v_adjustment
        AND COALESCE(sa.org_id, sa.organization_id) = v_org
        AND sa.organization_id = v_org
    ) THEN
      RAISE EXCEPTION
        'ADJUSTMENT_ORG_MISMATCH: adjustment=%, org=%',
        v_adjustment, v_org;
    END IF;
  END IF;

  IF v_warehouse IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = v_warehouse
      AND w.org_id = v_org
  ) THEN
    RAISE EXCEPTION
      'WAREHOUSE_NOT_FOUND_OR_WRONG_ORG: table=%, warehouse=%, org=%',
      TG_TABLE_NAME, v_warehouse, v_org;
  END IF;

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
    RETURN NEW;
  END IF;

  PERFORM public.wardah_assert_org_member(v_org);

  IF v_product IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.uoms u
      ON u.id = p.base_uom_id
    WHERE p.id = v_product
      AND p.org_id = v_org
      AND p.uom_migration_status = 'MAPPED'
      AND u.is_active
      AND NOT u.is_product_specific
      AND (u.org_id IS NULL OR u.org_id = v_org)
  ) THEN
    RAISE EXCEPTION
      'PRODUCT_UOM_NOT_MAPPED: table=%, product=%, org=%',
      TG_TABLE_NAME, v_product, v_org;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.wardah_guard_mapped_product_uom_stock_write()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stock_adjustment_items_require_mapped_uom
  ON public.stock_adjustment_items;
CREATE TRIGGER trg_stock_adjustment_items_require_mapped_uom
  BEFORE INSERT OR UPDATE
  ON public.stock_adjustment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_mapped_product_uom_stock_write();

DROP TRIGGER IF EXISTS trg_stock_ledger_entries_require_mapped_uom
  ON public.stock_ledger_entries;
CREATE TRIGGER trg_stock_ledger_entries_require_mapped_uom
  BEFORE INSERT OR UPDATE OF product_id, org_id, warehouse_id
  ON public.stock_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_mapped_product_uom_stock_write();

COMMENT ON FUNCTION public.wardah_guard_mapped_product_uom_stock_write() IS
  'Always enforces stock row/header/warehouse tenant consistency. When uom_engine_enabled is true, every adjustment-line insert/update and every SLE insert or identity rewrite additionally requires a same-org MAPPED product with a legal active base UoM.';
