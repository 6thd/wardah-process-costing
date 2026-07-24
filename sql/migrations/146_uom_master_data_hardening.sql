-- migration_number: 146
-- description: Final hardening for UoM master data and stock-write guards.
-- safety: trigger/function replacement only. No operational data is rewritten or deleted.

-- Product seeds and trusted service-role imports may run without auth.uid(), but they
-- still must obey structural UoM legality. Authenticated direct writes additionally
-- require organization-admin authorization.
CREATE OR REPLACE FUNCTION public.wardah_guard_products_base_uom_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_product_specific boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_uom_id IS NULL THEN
      IF NEW.uom_migration_status = 'MAPPED' THEN
        RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED: product=%', NEW.id;
      END IF;
      RETURN NEW;
    END IF;

    -- A user-session insert is an administrative master-data action. A trusted
    -- service-role/seed session has no auth.uid(), but is never exempt from legality.
    IF auth.uid() IS NOT NULL THEN
      PERFORM public.wardah_assert_org_admin(NEW.org_id);
    END IF;
  ELSE
    IF NEW.base_uom_id IS NOT DISTINCT FROM OLD.base_uom_id THEN
      RETURN NEW;
    END IF;

    PERFORM public.wardah_assert_org_admin(NEW.org_id);

    -- Existing conversions and physical-weight facts are expressed relative to the
    -- current base unit. Replacing it in-place would reinterpret those facts.
    IF OLD.base_uom_id IS NOT NULL THEN
      RAISE EXCEPTION
        'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP: product=%, current=%, requested=%',
        NEW.id, OLD.base_uom_id, NEW.base_uom_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.stock_ledger_entries sle
      WHERE sle.product_id = NEW.id
        AND sle.org_id = NEW.org_id
    ) THEN
      RAISE EXCEPTION 'PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS: product=%', NEW.id;
    END IF;
  END IF;

  IF NEW.base_uom_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED: product=%', NEW.id;
  END IF;

  SELECT u.is_product_specific
  INTO v_is_product_specific
  FROM public.uoms u
  WHERE u.id = NEW.base_uom_id
    AND u.is_active
    AND (u.org_id IS NULL OR u.org_id = NEW.org_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_INVALID: product=%, uom=%', NEW.id, NEW.base_uom_id;
  END IF;
  IF v_is_product_specific THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC: product=%', NEW.id;
  END IF;

  NEW.uom_migration_status := 'MAPPED';
  NEW.updated_at := v_now;

  UPDATE public.uom_backfill_issues
  SET status = 'RESOLVED',
      resolved_uom_id = NEW.base_uom_id,
      resolved_by = auth.uid(),
      resolved_at = v_now,
      details = COALESCE(details, '{}'::jsonb)
        || jsonb_build_object(
          'resolution',
          CASE WHEN TG_OP = 'INSERT'
            THEN 'validated_on_product_insert'
            ELSE 'auto_on_base_uom_assign'
          END
        )
  WHERE org_id = NEW.org_id
    AND source_table = 'products'
    AND source_id = NEW.id
    AND status = 'OPEN';

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_products_base_uom_insert_guard ON public.products;
CREATE TRIGGER trg_products_base_uom_insert_guard
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_products_base_uom_change();

DROP TRIGGER IF EXISTS trg_products_base_uom_change_guard ON public.products;
CREATE TRIGGER trg_products_base_uom_change_guard
  BEFORE UPDATE OF base_uom_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_products_base_uom_change();

-- Re-run the mapped-product eligibility check on every adjustment-line update, not
-- only when product_id/organization_id changes. Quantity/UoM edits on an old draft
-- must not bypass a product status change that happened after the draft was created.
DROP TRIGGER IF EXISTS trg_stock_adjustment_items_require_mapped_uom
  ON public.stock_adjustment_items;
CREATE TRIGGER trg_stock_adjustment_items_require_mapped_uom
  BEFORE INSERT OR UPDATE
  ON public.stock_adjustment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_mapped_product_uom_stock_write();

-- SLE is append-oriented. INSERT is the authoritative movement boundary; updates
-- such as cancellation are governed by their dedicated workflows and should not be
-- blocked because a product was later quarantined for master-data repair.
DROP TRIGGER IF EXISTS trg_stock_ledger_entries_require_mapped_uom
  ON public.stock_ledger_entries;
CREATE TRIGGER trg_stock_ledger_entries_require_mapped_uom
  BEFORE INSERT
  ON public.stock_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_mapped_product_uom_stock_write();

REVOKE EXECUTE ON FUNCTION public.wardah_guard_products_base_uom_change()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.wardah_guard_products_base_uom_change() IS
  'INSERT/UPDATE backstop. Trusted no-JWT inserts remain possible but must use a legal active shared/same-org non-product-specific base UoM; authenticated writes require org admin. Existing base reinterpretation is rejected until an atomic remap exists.';
