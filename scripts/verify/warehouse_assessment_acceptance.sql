-- Acceptance checks for migrations 128-141.
-- Run after applying the migrations in a disposable/staging database.
-- Every failing condition raises an exception; this script changes no data.

DO $$
DECLARE v_definition text; v_count bigint; v_view_options text[];
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='calculate_wip_equivalent_units' LIMIT 1;
  IF v_definition IS NULL
     OR v_definition NOT LIKE '%v_completed + (v_ending * v_material_pct)%'
     OR v_definition NOT LIKE '%equivalent_units_transferred_in%'
     OR v_definition LIKE '%NEW.cost_total :=%' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: weighted-average EUP v2 invalid';
  END IF;

  SELECT count(*) INTO v_count FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN(
    'uom_categories','uoms','uom_aliases','product_uom_conversions',
    'item_product_map','uom_backfill_issues');
  IF v_count<>6 THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: UoM foundation incomplete (%/6)',v_count; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_uom_conversions'
      AND column_name='allow_cross_dimension'
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: cross-dimension flag missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products'
      AND column_name='net_weight'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='products'
      AND column_name='weight_uom_id'
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: product physical-weight fields missing'; END IF;

  IF to_regprocedure('public.rpc_set_product_physical_weight(uuid,numeric,numeric,uuid)') IS NULL
     OR to_regprocedure('public.rpc_get_product_weight(uuid,numeric,uuid,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: product-weight RPCs missing';
  END IF;

  IF to_regprocedure('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: atomic material/WIP consumption RPC missing';
  END IF;

  IF to_regprocedure('public.rpc_create_org_uom(uuid,uuid,text,text,text,text,numeric,boolean,smallint,text[])') IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: tenant UoM RPC missing';
  END IF;

  IF to_regprocedure('public.wardah_require_positive_bom_quantity(uuid,numeric)') IS NULL THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: nested BOM quantity guard missing';
  END IF;

  IF EXISTS(SELECT 1 FROM public.stock_ledger_entries WHERE org_id IS NULL) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: SLE org_id null'; END IF;
  IF EXISTS(SELECT 1 FROM public.stock_reposting_queue WHERE org_id IS NULL) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: reposting org_id null'; END IF;

  IF EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bins' AND column_name='projected_qty'
      AND (is_generated<>'ALWAYS' OR numeric_precision<>18 OR numeric_scale<>6)
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: bins.projected_qty generated precision invalid'; END IF;

  IF EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND ((table_name='purchase_order_lines' AND column_name='line_total')
        OR (table_name='sales_invoice_lines' AND column_name IN ('line_total','cogs')))
      AND is_generated<>'ALWAYS'
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: dependent generated document totals not restored'; END IF;

  SELECT c.reloptions INTO v_view_options
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='vw_stock_valuation_by_method' AND c.relkind='v';
  IF v_view_options IS NULL OR NOT ('security_invoker=true'=ANY(v_view_options)) THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: valuation view must preserve security_invoker=true';
  END IF;

  SELECT pg_get_functiondef('public.rpc_post_delivery_note(jsonb)'::regprocedure)
  INTO v_definition;
  IF v_definition ~* 'SET[[:space:]]+[^;]*cogs[[:space:]]*=' THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: delivery RPC assigns generated sales_invoice_lines.cogs';
  END IF;

  IF has_table_privilege('authenticated','public.product_uom_conversions','INSERT')
     OR has_table_privilege('authenticated','public.product_uom_conversions','UPDATE')
     OR has_table_privilege('authenticated','public.product_uom_conversions','DELETE') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAILED: authenticated may mutate versioned UoM conversion history directly';
  END IF;

  IF EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='product_uom_conversions'
      AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: product UoM conversion write policy remains'; END IF;

  IF EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND (COALESCE(qual,'') LIKE '%(SELECT (SELECT auth.uid()))%'
        OR COALESCE(with_check,'') LIKE '%(SELECT (SELECT auth.uid()))%')
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: nested auth.uid initplan wrapper remains'; END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.bom_lines
    WHERE line_type<>'REFERENCE' AND product_id IS NOT NULL AND uom_id IS NOT NULL
      AND quantity_base IS NULL
  ) THEN RAISE EXCEPTION 'ACCEPTANCE_FAILED: resolved BOM line missing quantity_base'; END IF;
END
$$;

SELECT 'warehouse_assessment_acceptance' AS suite,'PASS' AS result,now() AS checked_at;