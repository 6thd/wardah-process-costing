-- Acceptance checks for migrations 128-135.
-- Run after applying the migrations in a disposable/staging database.
-- Every failing condition raises an exception; this script changes no data.

DO $$
DECLARE v_definition text; v_count bigint;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='calculate_wip_equivalent_units' LIMIT 1;
  IF v_definition IS NULL
     OR v_definition NOT LIKE '%v_completed + (v_ending * v_material_pct)%'
     OR v_definition NOT LIKE '%equivalent_units_transferred_in%' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: weighted-average EUP v2 missing';
  END IF;

  SELECT count(*) INTO v_count FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN(
    'uom_categories','uoms','uom_aliases','product_uom_conversions','item_product_map','uom_backfill_issues');
  IF v_count<>6 THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: UoM foundation incomplete (%/6)',v_count; END IF;
  IF EXISTS(SELECT 1 FROM public.stock_ledger_entries WHERE org_id IS NULL) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: SLE org_id null'; END IF;
  IF EXISTS(SELECT 1 FROM public.stock_reposting_queue WHERE org_id IS NULL) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: reposting org_id null'; END IF;

  IF EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND (COALESCE(qual,'')~'(^|[^A-Za-z])auth\.uid\(\)' OR COALESCE(with_check,'')~'(^|[^A-Za-z])auth\.uid\(\)')
      AND (COALESCE(qual,'') NOT LIKE '%SELECT auth.uid()%' OR COALESCE(with_check,'') NOT LIKE '%SELECT auth.uid()%')
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: uncached auth.uid() policy remains'; END IF;

  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname~'_20250905_1900$') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: dated snapshots still public';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='stock_adjustments'
    AND indexname='idx_stock_adjustments_canonical_gl_entry') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: stock adjustment FK indexes missing';
  END IF;
  IF has_function_privilege('anon','public.generate_entry_number(uuid,date)'::regprocedure,'EXECUTE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: anonymous generate_entry_number execute';
  END IF;
END
$$;

SELECT 'warehouse_assessment_acceptance' AS suite,'PASS' AS result,now() AS checked_at;
