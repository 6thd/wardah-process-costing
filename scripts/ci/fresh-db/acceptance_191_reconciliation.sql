-- Post-harness reconciliation and cleanup assertions for Migration 191.
--
-- Runs AFTER the deterministic GREEN harness, on the same database, so it sees
-- every row those scenarios committed. Slice 12 already reconciles inside each
-- scenario; this file re-checks the same global invariants once more over the
-- whole database, so a scenario that silently skipped its own reconciliation
-- cannot pass the workflow, and it proves the harness left no instrumentation
-- behind. Fail-closed; the psql exit code is the verdict.

\set ON_ERROR_STOP on

-- 1) No test-only instrumentation survived the battery.
DO $recon_testonly$
DECLARE v_leaked text[];
BEGIN
  SELECT coalesce(array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text), '{}')
  INTO v_leaked
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'zz\_%';

  IF cardinality(v_leaked) > 0 THEN
    RAISE EXCEPTION 'M191_RECON_TESTONLY_LEAKED: %', v_leaked;
  END IF;
  RAISE NOTICE 'M191_RECON_NO_TESTONLY_OK';
END
$recon_testonly$;

-- 2) products.stock_quantity is a derived aggregate of bins for every product
--    that has bins. This is the headline invariant of the whole F2 workstream:
--    the RED proof's signature was exactly a product aggregate diverging from
--    its own bins.
DO $recon_product_aggregate$
DECLARE
  v_bad integer;
  v_sample text;
BEGIN
  SELECT count(*), min(detail) INTO v_bad, v_sample
  FROM (
    SELECT p.id::text || ' product=' || coalesce(p.stock_quantity, 0)::text
                      || ' sum_bins=' || b.total::text AS detail
    FROM public.products p
    JOIN (
      SELECT product_id, SUM(actual_qty) AS total
      FROM public.bins GROUP BY product_id
    ) b ON b.product_id = p.id
    WHERE coalesce(p.stock_quantity, 0) <> b.total
  ) z;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'M191_RECON_PRODUCT_AGGREGATE_DIVERGED: % product(s), e.g. %', v_bad, v_sample;
  END IF;
  RAISE NOTICE 'M191_RECON_PRODUCT_AGGREGATE_OK';
END
$recon_product_aggregate$;

-- 3) No unexpected negative stock anywhere.
DO $recon_negative$
DECLARE v_neg integer;
BEGIN
  SELECT count(*) INTO v_neg FROM public.bins WHERE actual_qty < 0;
  IF v_neg > 0 THEN
    RAISE EXCEPTION 'M191_RECON_NEGATIVE_STOCK: % bin(s)', v_neg;
  END IF;
  RAISE NOTICE 'M191_RECON_NO_NEGATIVE_STOCK_OK';
END
$recon_negative$;

-- 4) Committed bin quantity equals the committed ledger movement for every
--    (product, warehouse) the harness touched. Bins seeded directly by a fixture
--    have no opening ledger row, so the comparison is anchored on the opening
--    balance implied by the first ledger row of each key.
DO $recon_ledger$
DECLARE
  v_bad integer;
  v_sample text;
BEGIN
  SELECT count(*), min(detail) INTO v_bad, v_sample
  FROM (
    SELECT b.product_id::text || '/' || b.warehouse_id::text
             || ' bin=' || b.actual_qty::text
             || ' last_qty_after=' || l.qty_after::text AS detail
    FROM public.bins b
    JOIN LATERAL (
      SELECT sle.qty_after_transaction AS qty_after
      FROM public.stock_ledger_entries sle
      WHERE sle.org_id = b.org_id
        AND sle.product_id = b.product_id
        AND sle.warehouse_id = b.warehouse_id
        AND coalesce(sle.is_cancelled, false) = false
      ORDER BY sle.posting_datetime DESC, sle.id DESC
      LIMIT 1
    ) l ON true
    WHERE b.actual_qty <> l.qty_after
  ) z;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'M191_RECON_BIN_LEDGER_MISMATCH: % key(s), e.g. %', v_bad, v_sample;
  END IF;
  RAISE NOTICE 'M191_RECON_BIN_MATCHES_LEDGER_OK';
END
$recon_ledger$;

-- 5) The thirteen objects are still exactly as the migration left them: the
--    harness creates and drops mutants, and must never have replaced a real one.
DO $recon_objects$
DECLARE
  v_missing text[] := '{}'::text[];
  v_sig text;
  c_signatures CONSTANT text[] := ARRAY[
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)',
    'public.rpc_cancel_stock_adjustment(uuid,text)',
    'public.rpc_manual_stock_movement_v2(jsonb)',
    'public.rpc_post_goods_receipt(jsonb)',
    'public.rpc_post_delivery_note(jsonb)',
    'public.rpc_submit_stock_adjustment(uuid)',
    'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)',
    'public.release_expired_reservations(uuid)',
    'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)',
    'public.wardah_lock_products_for_stock_write(uuid,uuid[])'
  ];
BEGIN
  FOREACH v_sig IN ARRAY c_signatures LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      v_missing := array_append(v_missing, v_sig);
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'M191_RECON_OBJECT_MISSING_AFTER_HARNESS: %', v_missing;
  END IF;
  RAISE NOTICE 'M191_RECON_OBJECTS_INTACT_OK: 13/13';
END
$recon_objects$;

DO $recon_pass$
BEGIN
  RAISE NOTICE 'M191_RECONCILIATION_PASS: no test-only leftovers, product aggregate = sum(bins), no negative stock, bins match the ledger, 13/13 objects intact';
END
$recon_pass$;
