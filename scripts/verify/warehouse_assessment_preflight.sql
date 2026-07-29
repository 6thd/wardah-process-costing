-- Read-only production preflight for migrations 128-141.
-- Run before the maintenance window. Any exception blocks deployment.

DO $$
DECLARE v_table text; v_count bigint; v_unresolved bigint; v_timezone text;
BEGIN
  v_timezone:=current_setting('TimeZone');
  IF upper(v_timezone) NOT IN ('UTC','ETC/UTC') THEN
    RAISE EXCEPTION 'PREFLIGHT_BLOCKED: database TimeZone must be UTC before timestamp normalization; current=%',v_timezone;
  END IF;

  SELECT count(*) INTO v_count FROM public.stock_ledger_entries WHERE org_id IS NULL;
  IF v_count>0 THEN RAISE EXCEPTION 'PREFLIGHT_BLOCKED: stock_ledger_entries has % NULL org_id rows',v_count; END IF;

  SELECT count(*) INTO v_count FROM public.stock_reposting_queue WHERE org_id IS NULL;
  IF v_count>0 THEN RAISE EXCEPTION 'PREFLIGHT_BLOCKED: stock_reposting_queue has % NULL org_id rows',v_count; END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'bill_of_materials_20250905_1900','cost_entries_20250905_1900',
    'cost_predictions_20250905_1900','final_products_20250905_1900',
    'notifications_20250905_1900','product_categories_20250905_1900',
    'project_stages_20250905_1900','projects_20250905_1900',
    'risk_assessments_20250905_1900','users_profiles_20250905_1900'
  ] LOOP
    IF to_regclass('public.'||v_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I',v_table) INTO v_count;
      IF v_count>0 THEN RAISE EXCEPTION 'PREFLIGHT_BLOCKED: legacy table % has % rows',v_table,v_count; END IF;
    END IF;
  END LOOP;

  -- Blocking after the UoM issue table exists.
  IF to_regclass('public.uom_backfill_issues') IS NOT NULL THEN
    SELECT count(*) INTO v_unresolved
    FROM public.uom_backfill_issues
    WHERE status='OPEN' AND source_table IN ('products','items','bom_lines');
    IF v_unresolved>0 THEN
      RAISE EXCEPTION 'PREFLIGHT_BLOCKED: % unresolved active UoM/backfill issues require review',v_unresolved;
    END IF;
  END IF;

  -- Legacy reservations must be proven to be stored in product base UoM. A non-base
  -- unit with a missing/identity snapshot is ambiguous and cannot be consumed safely.
  IF to_regclass('public.material_reservations') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='material_reservations'
         AND column_name='conversion_factor_snapshot'
     ) THEN
    SELECT count(*) INTO v_count
    FROM public.material_reservations mr
    JOIN public.products p ON p.id=mr.product_id AND p.org_id=mr.org_id
    WHERE mr.status='reserved'
      AND mr.uom_id IS NOT NULL
      AND p.base_uom_id IS NOT NULL
      AND mr.uom_id<>p.base_uom_id
      AND (
        mr.conversion_factor_snapshot IS NULL
        OR mr.conversion_factor_snapshot=1
        OR mr.qty_entered IS NULL
      );
    IF v_count>0 THEN
      RAISE EXCEPTION 'PREFLIGHT_BLOCKED: % active legacy reservations have ambiguous non-base UoM quantities',v_count;
    END IF;
  END IF;
END
$$;

SELECT 'warehouse_assessment_preflight' AS suite,'PASS' AS result,now() AS checked_at;