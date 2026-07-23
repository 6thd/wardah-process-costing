-- migration_number: 145
-- description: Server-side, flag-gated UoM backstop for stock-adjustment lines and
--              stock-ledger writes. When uom_engine_enabled is true for the row's
--              organization, only a same-org MAPPED product with a legal active base
--              unit may be written. This closes stale-client/cache races at the DB edge.
-- safety: additive only. One trigger function and two triggers; no data or historical
--         migration is deleted or overwritten. The guard is dormant while the rollout
--         flag is absent or false.

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
  v_enabled boolean := false;
BEGIN
  v_org := COALESCE(
    NULLIF(v_row ->> 'org_id', '')::uuid,
    NULLIF(v_row ->> 'organization_id', '')::uuid
  );
  v_product := NULLIF(v_row ->> 'product_id', '')::uuid;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'ORG_CONTEXT_REQUIRED: table=%', TG_TABLE_NAME;
  END IF;

  -- Explicit org read under SECURITY DEFINER so a multi-org user's selected org is
  -- not replaced by wardah_org_id(NULL). Missing/false keeps the legacy rollout path.
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

  -- Required both as authorization and as a guard against a crafted cross-org row.
  PERFORM public.wardah_assert_org_member(v_org);

  IF v_product IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.uoms u ON u.id = p.base_uom_id
    WHERE p.id = v_product
      AND p.org_id = v_org
      AND p.uom_migration_status = 'MAPPED'
      AND u.is_active
      AND NOT u.is_product_specific
      AND (u.org_id IS NULL OR u.org_id = v_org)
  ) THEN
    RAISE EXCEPTION 'PRODUCT_UOM_NOT_MAPPED: table=%, product=%, org=%',
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
  -- Revalidate every draft-line update, not only product/org changes. A legal line can
  -- become stale after its base UoM is deactivated between initial save and editing.
  BEFORE INSERT OR UPDATE
  ON public.stock_adjustment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_mapped_product_uom_stock_write();

DROP TRIGGER IF EXISTS trg_stock_ledger_entries_require_mapped_uom
  ON public.stock_ledger_entries;
CREATE TRIGGER trg_stock_ledger_entries_require_mapped_uom
  -- Ledger rows are append-oriented; INSERT is the authoritative posting boundary.
  -- Product/org rewrites are revalidated, while cancellation metadata updates remain
  -- possible even if master data is subsequently quarantined.
  BEFORE INSERT OR UPDATE OF product_id, org_id
  ON public.stock_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_mapped_product_uom_stock_write();

COMMENT ON FUNCTION public.wardah_guard_mapped_product_uom_stock_write() IS
  'Flag-gated DB backstop: when uom_engine_enabled is true, every stock-adjustment line insert/update and every SLE insert/product-org rewrite accepts only a same-org MAPPED product with a legal active base UoM.';
