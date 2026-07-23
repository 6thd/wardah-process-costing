-- migration_number: 144
-- description: Fail-closed product base-UoM assignment and backfill resolution.
--              A base unit may be assigned for the first time, but an existing base
--              unit may not be redefined without a future atomic remap workflow that
--              versions every dependent conversion and physical-weight fact.
-- safety: additive/replace-only. No operational row is deleted. The migration aborts
--         if pre-existing products violate the MAPPED <=> base_uom_id invariant.

-- -----------------------------------------------------------------------------
-- 0) Product master-data invariant
-- -----------------------------------------------------------------------------
-- A product is MAPPED exactly when it owns a legal base-unit reference. Failing the
-- preflight is safer than validating a false invariant or silently rewriting master
-- data during rollout.
DO $preflight$
DECLARE
  v_inconsistent bigint;
BEGIN
  SELECT count(*)
  INTO v_inconsistent
  FROM public.products p
  WHERE (p.base_uom_id IS NOT NULL) IS DISTINCT FROM (p.uom_migration_status = 'MAPPED');

  IF v_inconsistent > 0 THEN
    RAISE EXCEPTION
      'PRODUCT_UOM_INVARIANT_PREFLIGHT_FAILED: inconsistent_products=%',
      v_inconsistent;
  END IF;
END
$preflight$;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_base_uom_mapping_invariant'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_base_uom_mapping_invariant
      CHECK ((base_uom_id IS NOT NULL) = (uom_migration_status = 'MAPPED'))
      NOT VALID;
  END IF;
END
$constraint$;

ALTER TABLE public.products
  VALIDATE CONSTRAINT products_base_uom_mapping_invariant;

-- -----------------------------------------------------------------------------
-- 1) Hard backstop for INSERT/UPDATE
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER is intentional: the trigger must be able to call the internal
-- admin guard whose EXECUTE privilege is revoked from clients. auth.uid() remains the
-- authenticated caller, so direct writes by ordinary members are rejected.
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
  -- New products may start unresolved. A caller that supplies a base unit at INSERT
  -- time must be an org admin and the unit is normalized to MAPPED atomically.
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_uom_id IS NULL THEN
      IF NEW.uom_migration_status = 'MAPPED' THEN
        RAISE EXCEPTION 'PRODUCT_BASE_UOM_REQUIRED: product=%', NEW.id;
      END IF;
      RETURN NEW;
    END IF;

    PERFORM public.wardah_assert_org_admin(NEW.org_id);
  ELSE
    IF NEW.base_uom_id IS NOT DISTINCT FROM OLD.base_uom_id THEN
      RETURN NEW;
    END IF;

    PERFORM public.wardah_assert_org_admin(NEW.org_id);

    -- Reinterpreting an existing conversion/weight model is not a simple field edit.
    -- It requires a future atomic remap RPC that versions every dependent fact.
    IF OLD.base_uom_id IS NOT NULL THEN
      RAISE EXCEPTION
        'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP: product=%, current=%, requested=%',
        NEW.id, OLD.base_uom_id, NEW.base_uom_id;
    END IF;

    -- A legacy-inconsistent product with movements but no base unit must not be
    -- repaired by guessing a new interpretation after quantities already exist.
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

  -- Keep the direct admin path semantically equivalent to the RPC path: no legal
  -- assignment may leave a stale open product issue behind.
  UPDATE public.uom_backfill_issues
  SET status = 'RESOLVED',
      resolved_uom_id = NEW.base_uom_id,
      resolved_by = auth.uid(),
      resolved_at = v_now,
      details = COALESCE(details, '{}'::jsonb)
        || jsonb_build_object('resolution', 'auto_on_base_uom_assign')
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

-- -----------------------------------------------------------------------------
-- 2) Legal admin write path
-- -----------------------------------------------------------------------------
-- Idempotent for the existing unit: passing the current legal base unit reconciles
-- status/issue metadata without reinterpreting conversions or weights.
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
  v_current_status text;
  v_is_product_specific boolean;
  v_has_movements boolean;
  v_resolved_issues int := 0;
  v_reconciled boolean := false;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

  IF p_product_id IS NULL OR p_uom_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_AND_UOM_REQUIRED';
  END IF;

  SELECT base_uom_id, uom_migration_status
  INTO v_current_base, v_current_status
  FROM public.products
  WHERE id = p_product_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  SELECT u.is_product_specific
  INTO v_is_product_specific
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

  IF v_current_base IS NOT NULL AND v_current_base IS DISTINCT FROM p_uom_id THEN
    RAISE EXCEPTION
      'PRODUCT_BASE_UOM_CHANGE_REQUIRES_ATOMIC_REMAP: product=%, current=%, requested=%',
      p_product_id, v_current_base, p_uom_id;
  END IF;

  IF v_current_base IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.stock_ledger_entries sle
      WHERE sle.product_id = p_product_id
        AND sle.org_id = p_org_id
    )
    INTO v_has_movements;

    IF v_has_movements THEN
      RAISE EXCEPTION 'PRODUCT_BASE_UOM_LOCKED_HAS_MOVEMENTS: product=%', p_product_id;
    END IF;
  ELSE
    v_reconciled := true;
  END IF;

  SELECT count(*)
  INTO v_resolved_issues
  FROM public.uom_backfill_issues
  WHERE org_id = p_org_id
    AND source_table = 'products'
    AND source_id = p_product_id
    AND status = 'OPEN';

  UPDATE public.products
  SET base_uom_id = p_uom_id,
      uom_migration_status = 'MAPPED',
      updated_at = v_now
  WHERE id = p_product_id
    AND org_id = p_org_id;

  -- When the base was already identical the base-UoM trigger returns early, so the
  -- RPC closes the issue explicitly as an idempotent reconciliation operation.
  UPDATE public.uom_backfill_issues
  SET status = 'RESOLVED',
      resolved_uom_id = p_uom_id,
      resolved_by = auth.uid(),
      resolved_at = v_now,
      details = COALESCE(details, '{}'::jsonb)
        || jsonb_build_object(
          'resolution',
          CASE WHEN v_reconciled
            THEN 'reconciled_existing_base_uom'
            ELSE 'auto_on_base_uom_assign'
          END
        )
  WHERE org_id = p_org_id
    AND source_table = 'products'
    AND source_id = p_product_id
    AND status = 'OPEN';

  RETURN jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'org_id', p_org_id,
    'base_uom_id', p_uom_id,
    'previous_base_uom_id', v_current_base,
    'previous_uom_migration_status', v_current_status,
    'uom_migration_status', 'MAPPED',
    'reconciled_existing_base_uom', v_reconciled,
    'resolved_issue_count', v_resolved_issues
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3) Resolve an issue only from the source row's effective legal unit
-- -----------------------------------------------------------------------------
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
  v_effective_uom uuid;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

  IF p_issue_id IS NULL THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_REQUIRED';
  END IF;

  SELECT status, source_table, source_id
  INTO v_status, v_source_table, v_source_id
  FROM public.uom_backfill_issues
  WHERE id = p_issue_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_NOT_FOUND: issue=%', p_issue_id;
  END IF;
  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'UOM_BACKFILL_ISSUE_NOT_OPEN: issue=%, status=%', p_issue_id, v_status;
  END IF;

  IF v_source_table = 'products' THEN
    SELECT p.base_uom_id
    INTO v_effective_uom
    FROM public.products p
    WHERE p.id = v_source_id
      AND p.org_id = p_org_id
      AND p.uom_migration_status = 'MAPPED'
      AND p.base_uom_id IS NOT NULL;

  ELSIF v_source_table = 'items' THEN
    SELECT i.base_uom_id
    INTO v_effective_uom
    FROM public.items i
    WHERE i.id = v_source_id
      AND i.org_id = p_org_id
      AND i.uom_migration_status = 'MAPPED'
      AND i.base_uom_id IS NOT NULL;

    IF NOT FOUND THEN
      SELECT p.base_uom_id
      INTO v_effective_uom
      FROM public.item_product_map m
      JOIN public.products p
        ON p.id = m.product_id
       AND p.org_id = p_org_id
      WHERE m.item_id = v_source_id
        AND m.org_id = p_org_id
        AND m.is_active
        AND m.valid_to IS NULL
        AND p.uom_migration_status = 'MAPPED'
        AND p.base_uom_id IS NOT NULL
      LIMIT 1;
    END IF;

  ELSIF v_source_table = 'bom_lines' THEN
    SELECT bl.uom_id
    INTO v_effective_uom
    FROM public.bom_lines bl
    WHERE bl.id = v_source_id
      AND bl.org_id = p_org_id
      AND bl.uom_id IS NOT NULL
      AND bl.product_id IS NOT NULL;

  ELSE
    RAISE EXCEPTION
      'UOM_BACKFILL_SOURCE_UNSUPPORTED: issue=%, source=%',
      p_issue_id, v_source_table;
  END IF;

  IF v_effective_uom IS NULL THEN
    RAISE EXCEPTION
      'UOM_BACKFILL_SOURCE_NOT_RESOLVED: issue=%, source=%',
      p_issue_id, v_source_table;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.uoms u
    WHERE u.id = v_effective_uom
      AND u.is_active
      AND (u.org_id IS NULL OR u.org_id = p_org_id)
  ) THEN
    RAISE EXCEPTION
      'UOM_BACKFILL_SOURCE_NOT_RESOLVED: issue=%, source=%, uom=%',
      p_issue_id, v_source_table, v_effective_uom;
  END IF;

  IF p_resolved_uom_id IS NOT NULL
     AND p_resolved_uom_id IS DISTINCT FROM v_effective_uom THEN
    RAISE EXCEPTION
      'UOM_BACKFILL_RESOLUTION_UOM_MISMATCH: issue=%, expected=%, provided=%',
      p_issue_id, v_effective_uom, p_resolved_uom_id;
  END IF;

  UPDATE public.uom_backfill_issues
  SET status = 'RESOLVED',
      resolved_uom_id = v_effective_uom,
      resolved_by = auth.uid(),
      resolved_at = v_now,
      details = COALESCE(details, '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object(
          'resolution_note', NULLIF(trim(p_note), ''),
          'resolution_source', v_source_table
        ))
  WHERE id = p_issue_id
    AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'issue_id', p_issue_id,
    'status', 'RESOLVED',
    'resolved_uom_id', v_effective_uom
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4) Deliberate ignore requires a recorded reason
-- -----------------------------------------------------------------------------
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

  SELECT status
  INTO v_status
  FROM public.uom_backfill_issues
  WHERE id = p_issue_id
    AND org_id = p_org_id
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
  WHERE id = p_issue_id
    AND org_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'issue_id', p_issue_id,
    'status', 'IGNORED'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_assign_product_base_uom(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_assign_product_base_uom(uuid, uuid, uuid)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rpc_resolve_uom_backfill_issue(uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_uom_backfill_issue(uuid, uuid, uuid, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.rpc_ignore_uom_backfill_issue(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_ignore_uom_backfill_issue(uuid, uuid, text)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.wardah_guard_products_base_uom_change()
  FROM PUBLIC, anon, authenticated;

COMMENT ON CONSTRAINT products_base_uom_mapping_invariant ON public.products IS
  'Fail-closed invariant: a product is MAPPED exactly when base_uom_id is present.';
COMMENT ON FUNCTION public.wardah_guard_products_base_uom_change() IS
  'Admin-enforced INSERT/UPDATE backstop. Allows first legal base-UoM assignment only, normalizes status to MAPPED, resolves product issues, and rejects existing-base reinterpretation until an atomic remap workflow exists.';
COMMENT ON FUNCTION public.rpc_assign_product_base_uom(uuid, uuid, uuid) IS
  'Admin-only first assignment or same-unit reconciliation. Existing base-UoM changes are rejected because conversions and physical-weight facts require an atomic versioned remap.';
COMMENT ON FUNCTION public.rpc_resolve_uom_backfill_issue(uuid, uuid, uuid, text) IS
  'Admin-only source-aware resolution. The recorded resolved_uom_id is derived from and must match the repaired products/items/item_product_map/bom_lines source; unsupported sources fail closed.';
COMMENT ON FUNCTION public.rpc_ignore_uom_backfill_issue(uuid, uuid, text) IS
  'Admin-only deliberate ignore of an open UoM backfill issue; a nonblank reason is mandatory server-side.';
