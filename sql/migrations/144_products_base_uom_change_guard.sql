-- migration_number: 144
-- description: Database guard that forbids changing products.base_uom_id once any
--              stock ledger movement exists, plus the legal admin write path for
--              assigning/repairing a base unit and resolving/ignoring UoM backfill
--              issues. Replaces reliance on a disabled UI button with a fail-closed
--              server rule. Enforces tenant isolation on every unit reference so a
--              SECURITY DEFINER path cannot bind a product to another org's unit.
-- safety: additive only. New trigger + CREATE OR REPLACE functions. No historical
--         row, column, or migration is deleted or overwritten. base_uom_id already
--         seeded by migration 130 remains untouched; the guard only rejects an
--         illegal *change* after inventory movements are recorded in the base unit.

-- 1) Hard backstop: block any base-unit redefinition that would silently reinterpret
--    historical quantities, independent of the frontend. SECURITY INVOKER: when the
--    admin RPC below (SECURITY DEFINER) drives the UPDATE the check runs with the
--    definer's RLS bypass; a direct user UPDATE sees that user's own-org movements.
CREATE OR REPLACE FUNCTION public.wardah_guard_products_base_uom_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_product_specific boolean;
BEGIN
  IF NEW.base_uom_id IS NOT DISTINCT FROM OLD.base_uom_id THEN
    RETURN NEW;
  END IF;

  -- Once movements exist, the base unit is frozen. All SLE/bin quantities are
  -- already stored in the current base unit; any change reinterprets them.
  IF EXISTS (
    SELECT 1 FROM public.stock_ledger_entries sle
    WHERE sle.product_id = NEW.id AND sle.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS: product=%', NEW.id;
  END IF;

  -- Clearing the base unit is never legal on an existing product.
  IF NEW.base_uom_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED: product=%', NEW.id;
  END IF;

  -- The unit must be active, and either a shared system unit (org_id IS NULL) or
  -- owned by THIS product's organization. A product-specific unit is never a base.
  SELECT u.is_product_specific INTO v_is_product_specific
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

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_products_base_uom_change_guard ON public.products;
CREATE TRIGGER trg_products_base_uom_change_guard
  BEFORE UPDATE OF base_uom_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.wardah_guard_products_base_uom_change();

-- 2) Legal write path for assigning/repairing a base unit. Admin-guarded and
--    fail-closed; enforces the same tenant + product-specific + movement rules as
--    the trigger, marks the product MAPPED, and auto-closes any open products
--    backfill issue for it.
CREATE OR REPLACE FUNCTION public.rpc_assign_product_base_uom(
  p_org_id uuid,
  p_product_id uuid,
  p_uom_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_current_base uuid;
  v_is_product_specific boolean;
  v_has_movements boolean;
  v_resolved_issues int;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

  IF p_product_id IS NULL OR p_uom_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_AND_UOM_REQUIRED';
  END IF;

  SELECT base_uom_id INTO v_current_base
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  IF p_uom_id IS NOT DISTINCT FROM v_current_base THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_UNCHANGED';
  END IF;

  -- Tenant isolation: only a shared system unit or this org's own unit is eligible.
  SELECT u.is_product_specific INTO v_is_product_specific
  FROM public.uoms u
  WHERE u.id = p_uom_id
    AND u.is_active
    AND (u.org_id IS NULL OR u.org_id = p_org_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UOM_NOT_FOUND_OR_INACTIVE: uom=%', p_uom_id;
  END IF;
  IF v_is_product_specific THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC: product=%', p_product_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_ledger_entries sle
    WHERE sle.product_id = p_product_id AND sle.org_id = p_org_id
  ) INTO v_has_movements;
  IF v_has_movements THEN
    RAISE EXCEPTION 'PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS: product=%', p_product_id;
  END IF;

  UPDATE public.products
  SET base_uom_id = p_uom_id,
      uom_migration_status = 'MAPPED',
      updated_at = v_now
  WHERE id = p_product_id AND org_id = p_org_id;

  -- Close any open products backfill issue for this product; the base unit is now set.
  WITH resolved AS (
    UPDATE public.uom_backfill_issues
    SET status = 'RESOLVED',
        resolved_uom_id = p_uom_id,
        resolved_by = auth.uid(),
        resolved_at = v_now,
        details = COALESCE(details, '{}'::jsonb)
          || jsonb_build_object('resolution', 'auto_on_base_uom_assign')
    WHERE org_id = p_org_id
      AND source_table = 'products'
      AND source_id = p_product_id
      AND status = 'OPEN'
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved_issues FROM resolved;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'org_id', p_org_id,
    'base_uom_id', p_uom_id,
    'previous_base_uom_id', v_current_base,
    'uom_migration_status', 'MAPPED',
    'resolved_issue_count', v_resolved_issues
  );
END;
$function$;

-- 3) Resolve an open backfill issue only after its source data is actually fixed,
--    recording the acting admin and an optional note.
CREATE OR REPLACE FUNCTION public.rpc_resolve_uom_backfill_issue(
  p_org_id uuid,
  p_issue_id uuid,
  p_resolved_uom_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_source_table text;
  v_source_id uuid;
  v_ok boolean;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

  IF p_issue_id IS NULL THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_REQUIRED';
  END IF;

  SELECT status, source_table, source_id
  INTO v_status, v_source_table, v_source_id
  FROM public.uom_backfill_issues
  WHERE id = p_issue_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_NOT_FOUND: issue=%', p_issue_id;
  END IF;
  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_NOT_OPEN: issue=%, status=%', p_issue_id, v_status;
  END IF;

  -- Tenant isolation on any provided resolution unit.
  IF p_resolved_uom_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.uoms u
    WHERE u.id = p_resolved_uom_id AND u.is_active
      AND (u.org_id IS NULL OR u.org_id = p_org_id)
  ) THEN
    RAISE EXCEPTION 'UOM_NOT_FOUND_OR_INACTIVE: uom=%', p_resolved_uom_id;
  END IF;

  -- Fail-closed: an issue may be resolved only once its source row is genuinely fixed.
  IF v_source_table = 'products' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_source_id AND p.org_id = p_org_id
        AND p.uom_migration_status = 'MAPPED'
        AND p.base_uom_id IS NOT NULL
        AND (p_resolved_uom_id IS NULL OR p.base_uom_id = p_resolved_uom_id)
    ) INTO v_ok;
  ELSIF v_source_table = 'items' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = v_source_id AND i.org_id = p_org_id
        AND i.uom_migration_status = 'MAPPED'
        AND i.base_uom_id IS NOT NULL
    ) OR EXISTS (
      SELECT 1
      FROM public.item_product_map m
      JOIN public.products p ON p.id = m.product_id AND p.org_id = p_org_id
      WHERE m.item_id = v_source_id AND m.org_id = p_org_id
        AND m.is_active AND m.valid_to IS NULL
        AND p.uom_migration_status = 'MAPPED'
        AND p.base_uom_id IS NOT NULL
    ) INTO v_ok;
  ELSIF v_source_table = 'bom_lines' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bom_lines bl
      WHERE bl.id = v_source_id AND bl.org_id = p_org_id
        AND bl.uom_id IS NOT NULL
        AND bl.product_id IS NOT NULL
    ) INTO v_ok;
  ELSE
    -- Unknown source: require an explicit resolution unit as evidence of a fix.
    v_ok := p_resolved_uom_id IS NOT NULL;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'UOM_BACKFILL_SOURCE_NOT_RESOLVED: issue=%, source=%', p_issue_id, v_source_table;
  END IF;

  UPDATE public.uom_backfill_issues
  SET status = 'RESOLVED',
      resolved_uom_id = p_resolved_uom_id,
      resolved_by = auth.uid(),
      resolved_at = v_now,
      details = COALESCE(details, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('resolution_note', NULLIF(trim(p_note), '')))
  WHERE id = p_issue_id AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'issue_id', p_issue_id,
    'status', 'RESOLVED',
    'resolved_uom_id', p_resolved_uom_id
  );
END;
$function$;

-- 4) Ignore an open backfill issue (deliberate no-fix). The reason note is mandatory
--    on the server, not only in the UI, so a direct client cannot ignore silently.
CREATE OR REPLACE FUNCTION public.rpc_ignore_uom_backfill_issue(
  p_org_id uuid,
  p_issue_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_status text;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

  IF p_issue_id IS NULL THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_REQUIRED';
  END IF;
  IF NULLIF(trim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'UOM_BACKFILL_IGNORE_NOTE_REQUIRED';
  END IF;

  SELECT status INTO v_status
  FROM public.uom_backfill_issues
  WHERE id = p_issue_id AND org_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_NOT_FOUND: issue=%', p_issue_id;
  END IF;
  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_NOT_OPEN: issue=%, status=%', p_issue_id, v_status;
  END IF;

  UPDATE public.uom_backfill_issues
  SET status = 'IGNORED',
      resolved_by = auth.uid(),
      resolved_at = v_now,
      details = COALESCE(details, '{}'::jsonb)
        || jsonb_build_object('ignore_note', trim(p_note))
  WHERE id = p_issue_id AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'issue_id', p_issue_id,
    'status', 'IGNORED'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_assign_product_base_uom(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_assign_product_base_uom(uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rpc_resolve_uom_backfill_issue(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_uom_backfill_issue(uuid, uuid, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rpc_ignore_uom_backfill_issue(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_ignore_uom_backfill_issue(uuid, uuid, text) TO authenticated;

-- The trigger backstop function is internal and never invoked directly by clients.
REVOKE EXECUTE ON FUNCTION public.wardah_guard_products_base_uom_change() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.wardah_guard_products_base_uom_change() IS
  'BEFORE UPDATE OF base_uom_id backstop: forbids clearing the base unit, product-specific or cross-org units, and any base-unit change once stock_ledger_entries exist for the product.';
COMMENT ON FUNCTION public.rpc_assign_product_base_uom(uuid, uuid, uuid) IS
  'Admin-only legal write path to assign or repair a product base unit. Fail-closed: rejects cross-org or product-specific units and any change after inventory movements; marks the product MAPPED and auto-resolves its open products backfill issue.';
COMMENT ON FUNCTION public.rpc_resolve_uom_backfill_issue(uuid, uuid, uuid, text) IS
  'Admin-only resolution of an open uom_backfill_issue, allowed only after the source row (products/items/bom_lines) is genuinely fixed; records resolver, timestamp, tenant-checked unit and note.';
COMMENT ON FUNCTION public.rpc_ignore_uom_backfill_issue(uuid, uuid, text) IS
  'Admin-only deliberate ignore of an open uom_backfill_issue; the reason note is mandatory server-side.';
