-- Wardah ERP / F2 / M191 Slice 12
-- Self-acceptance for the aggregate static gate.
-- REVIEW/TEST ARTIFACT ONLY. Do not run on Production.
--
-- A static gate that cannot fail is worth nothing, and this slice's own §3
-- warns that "a dead pattern that never fires can look green in a weak
-- fixture". This file proves the opposite for the shapes that were shown to
-- slip past the first revision of the gate, and for the one correct shape that
-- the first revision wrongly rejected.
--
-- It touches no catalog object: the assertions under test take body text as a
-- parameter, so synthetic bodies are passed directly. Running this file cannot
-- mutate the assembled candidate, and it needs none of the thirteen M191
-- objects to be installed.
--
-- Run order in the acceptance bundle:
--   1) \ir 12_acceptance_gate_selftest.sql   -- proves the gate discriminates
--   2) \ir 12_acceptance_static_gates.sql    -- the candidate verdict
--
-- VERDICT: the psql exit code under \set ON_ERROR_STOP on, exactly as for the
-- gate itself. exit 0 => PASS. The closing notice is supplementary evidence.

\set ON_ERROR_STOP on

\ir 12_acceptance_gate_defs.sql

-- Expect a specific failure from the lock-order assertion.
CREATE OR REPLACE FUNCTION pg_temp.m191_selftest_expect_order_failure(
  p_case text,
  p_body text,
  p_expected_error text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.m191_assert_prefix_before_bins(p_case, p_body);
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected_error IN SQLERRM) = 0 THEN
      RAISE EXCEPTION
        'M191_GATE_SELFTEST_WRONG_ERROR: case=% expected=% actual=%',
        p_case, p_expected_error, SQLERRM;
    END IF;
    RETURN;
  END;

  RAISE EXCEPTION 'M191_GATE_SELFTEST_MUTANT_NOT_CAUGHT: case=%', p_case;
END
$$;

-- Expect a specific failure from the helper contract assertion.
CREATE OR REPLACE FUNCTION pg_temp.m191_selftest_expect_helper_failure(
  p_case text,
  p_body text,
  p_expected_error text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.m191_assert_helper_contract(p_case, p_body);
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected_error IN SQLERRM) = 0 THEN
      RAISE EXCEPTION
        'M191_GATE_SELFTEST_WRONG_ERROR: case=% expected=% actual=%',
        p_case, p_expected_error, SQLERRM;
    END IF;
    RETURN;
  END;

  RAISE EXCEPTION 'M191_GATE_SELFTEST_MUTANT_NOT_CAUGHT: case=%', p_case;
END
$$;

-- Expect a specific failure from the Fix G capture contract assertion.
CREATE OR REPLACE FUNCTION pg_temp.m191_selftest_expect_fix_g_failure(
  p_case text,
  p_body text,
  p_expected_error text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.m191_assert_fix_g_capture_contract(p_case, p_body);
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected_error IN SQLERRM) = 0 THEN
      RAISE EXCEPTION
        'M191_GATE_SELFTEST_WRONG_ERROR: case=% expected=% actual=%',
        p_case, p_expected_error, SQLERRM;
    END IF;
    RETURN;
  END;

  RAISE EXCEPTION 'M191_GATE_SELFTEST_MUTANT_NOT_CAUGHT: case=%', p_case;
END
$$;

-- Expect a specific failure from the S1 header assertion.
CREATE OR REPLACE FUNCTION pg_temp.m191_selftest_expect_s1_failure(
  p_case text,
  p_body text,
  p_pattern text,
  p_expected_error text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.m191_assert_s1_header(p_case, p_body, p_pattern);
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected_error IN SQLERRM) = 0 THEN
      RAISE EXCEPTION
        'M191_GATE_SELFTEST_WRONG_ERROR: case=% expected=% actual=%',
        p_case, p_expected_error, SQLERRM;
    END IF;
    RETURN;
  END;

  RAISE EXCEPTION 'M191_GATE_SELFTEST_MUTANT_NOT_CAUGHT: case=%', p_case;
END
$$;

DO $m191_gate_selftest$
DECLARE
  -- The real pattern used by the gate.
  c_adj_pattern constant text :=
    E'FROM PUBLIC\\.STOCK_ADJUSTMENTS WHERE ID *= *P_ADJUSTMENT_ID FOR UPDATE';
  -- A deliberately weakened pattern. It still matches the correct body, but it
  -- would also accept a downgraded lock. Catching this is the entire purpose of
  -- the mutant half of the S1 assertion.
  c_weak_pattern constant text :=
    E'FROM PUBLIC\\.STOCK_ADJUSTMENTS WHERE ID *= *P_ADJUSTMENT_ID FOR.*UPDATE';

  -- ---- lock-order fixtures -------------------------------------------------

  c_body_good constant text := $body$
    BEGIN
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
      UPDATE public.bins SET actual_qty = actual_qty + 1 WHERE org_id = v_org;
    END
  $body$;

  -- The assignment call form used by goods receipt, delivery note, adjustment
  -- submit and consumption. Must pass: requiring PERFORM would fail all four.
  c_body_good_assignment_form constant text := $body$
    BEGIN
      v_locked_products :=
        public.wardah_lock_products_for_stock_write(v_org, v_products);
      SELECT COALESCE(SUM(actual_qty), 0) INTO v_on_hand
      FROM public.bins WHERE org_id = v_org;
    END
  $body$;

  -- A body that legitimately never touches bins, as goods receipt and
  -- adjustment submit do not. Must pass on the prefix call alone.
  c_body_good_no_bins constant text := $body$
    BEGIN
      v_locked_products :=
        public.wardah_lock_products_for_stock_write(v_org, v_products);
      PERFORM public.wardah_apply_stock_incoming(v_org, v_product, v_warehouse);
    END
  $body$;

  -- MUTANT 1 — proven false GREEN against the first revision, which located the
  -- first bins touch with position('from public.bins'). The bin row is taken
  -- before the product prefix through UPDATE, and a later harmless FROM read
  -- restored the appearance of correct ordering.
  c_mutant_update_before_prefix constant text := $body$
    BEGIN
      UPDATE public.bins SET reserved_qty = reserved_qty + 1 WHERE org_id = v_org;
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
      SELECT COALESCE(SUM(actual_qty), 0) INTO v_on_hand
      FROM public.bins WHERE org_id = v_org;
    END
  $body$;

  -- MUTANT 2 — proven false GREEN against the first revision, which located the
  -- prefix with position() over the raw definition. pg_get_functiondef keeps
  -- body comments, so an explanatory comment naming the helper satisfied the
  -- ordering check while the real call ran after the bins read.
  c_mutant_comment_before_bins constant text := $body$
    BEGIN
      -- prefix is taken by public.wardah_lock_products_for_stock_write(...) below
      SELECT COALESCE(SUM(actual_qty), 0) INTO v_on_hand
      FROM public.bins WHERE org_id = v_org;
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
    END
  $body$;

  -- Same evasion through a block comment, which the stripper handles on a
  -- different code path than line comments.
  c_mutant_block_comment_before_bins constant text := $body$
    BEGIN
      /* prefix via public.wardah_lock_products_for_stock_write(v_org, v_products)
         is taken further down */
      SELECT COALESCE(SUM(actual_qty), 0) INTO v_on_hand
      FROM public.bins WHERE org_id = v_org;
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
    END
  $body$;

  -- The other three DML shapes the widened pattern now covers.
  c_mutant_insert_before_prefix constant text := $body$
    BEGIN
      INSERT INTO public.bins (org_id, product_id) VALUES (v_org, v_product);
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
    END
  $body$;

  c_mutant_delete_before_prefix constant text := $body$
    BEGIN
      DELETE FROM public.bins WHERE org_id = v_org AND actual_qty = 0;
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
    END
  $body$;

  c_mutant_join_before_prefix constant text := $body$
    BEGIN
      SELECT b.actual_qty INTO v_on_hand
      FROM public.products p
      JOIN public.bins b ON b.product_id = p.id
      WHERE p.org_id = v_org;
      PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);
    END
  $body$;

  -- The prefix is absent entirely; only a comment mentions it.
  c_mutant_prefix_only_mentioned constant text := $body$
    BEGIN
      -- wardah_lock_products_for_stock_write is intentionally skipped here
      UPDATE public.bins SET actual_qty = actual_qty + 1 WHERE org_id = v_org;
    END
  $body$;

  -- The helper name appears only inside a string literal, with no call at all.
  -- Comment stripping does not lex strings, so the statement-position
  -- requirement is what rejects this.
  c_mutant_prefix_in_string_literal constant text := $body$
    BEGIN
      RAISE NOTICE 'public.wardah_lock_products_for_stock_write(';
      UPDATE public.bins SET actual_qty = actual_qty + 1 WHERE org_id = v_org;
    END
  $body$;

  -- ---- helper contract fixtures --------------------------------------------

  c_helper_good constant text := $body$
    BEGIN
      FOR v_id IN
        SELECT p.id
        FROM public.products p
        WHERE p.org_id = p_org AND p.id = ANY(v_wanted)
        ORDER BY p.id
        FOR NO KEY UPDATE
      LOOP
        v_locked := array_append(v_locked, v_id);
      END LOOP;
    END
  $body$;

  -- The ordering clause is gone from the query and survives only as a comment.
  -- This is the single most dangerous helper mutation: ORDER BY p.id is what
  -- makes the lock order global, and a gate that reads comment-bearing text
  -- accepts the note in place of the clause.
  c_mutant_helper_order_in_comment constant text := $body$
    BEGIN
      FOR v_id IN
        -- ORDER BY p.id FOR NO KEY UPDATE
        SELECT p.id
        FROM public.products p
        WHERE p.org_id = p_org AND p.id = ANY(v_wanted)
        FOR NO KEY UPDATE
      LOOP
        v_locked := array_append(v_locked, v_id);
      END LOOP;
    END
  $body$;

  -- ---- Fix G capture contract fixtures -------------------------------------

  c_fix_g_good constant text := $body$
    BEGIN
      v_product_id := public.wardah_resolve_product_id(v_org, v_item_id, now());
      INSERT INTO public.material_reservations (org_id, product_id)
      VALUES (v_org, v_product_id)
      RETURNING product_id INTO v_persisted_product_id;

      IF v_persisted_product_id IS DISTINCT FROM v_product_id THEN
        RAISE EXCEPTION
          'ITEM_PRODUCT_MAPPING_DRIFT: item=%, captured=%, persisted=%',
          v_item_id, v_product_id, v_persisted_product_id;
      END IF;
    END
  $body$;

  -- RETURNING is intact and the drift error name is still present, but the
  -- exact comparison is gone and the RAISE sits under an unrelated, effectively
  -- dead condition. Two independent presence checks both pass on this body.
  c_mutant_fix_g_comparison_removed constant text := $body$
    BEGIN
      v_product_id := public.wardah_resolve_product_id(v_org, v_item_id, now());
      INSERT INTO public.material_reservations (org_id, product_id)
      VALUES (v_org, v_product_id)
      RETURNING product_id INTO v_persisted_product_id;

      IF v_persisted_product_id IS NULL AND v_product_id IS NOT NULL THEN
        RAISE EXCEPTION
          'ITEM_PRODUCT_MAPPING_DRIFT: item=%, captured=%, persisted=%',
          v_item_id, v_product_id, v_persisted_product_id;
      END IF;
    END
  $body$;

  -- ---- S1 fixtures ---------------------------------------------------------

  c_s1_body_upper constant text := $body$
    BEGIN
      SELECT * INTO v_adj
      FROM public.stock_adjustments
      WHERE id = p_adjustment_id
      FOR UPDATE;
    END
  $body$;

  -- Correct order and correct lock, written entirely in lower case. This must
  -- PASS: the case-sensitive mutant construction of the first revision reported
  -- it as MUTANT_FALSE_PASS, blaming the pattern for a body that was never
  -- wrong.
  c_s1_body_lower constant text := $body$
    begin
      select * into v_adj
      from public.stock_adjustments
      where id = p_adjustment_id
      for update;
    end
  $body$;

  c_s1_body_downgraded constant text := $body$
    BEGIN
      SELECT * INTO v_adj
      FROM public.stock_adjustments
      WHERE id = p_adjustment_id
      FOR NO KEY UPDATE;
    END
  $body$;
BEGIN
  -- -------------------------------------------------------------------------
  -- A) Positive controls. None of these may raise.
  -- -------------------------------------------------------------------------
  PERFORM pg_temp.m191_assert_prefix_before_bins(
    'selftest.good_perform_form', c_body_good);
  PERFORM pg_temp.m191_assert_prefix_before_bins(
    'selftest.good_assignment_form', c_body_good_assignment_form);
  PERFORM pg_temp.m191_assert_prefix_before_bins(
    'selftest.good_no_bins_touch', c_body_good_no_bins);

  PERFORM pg_temp.m191_assert_helper_contract(
    'selftest.helper_good', c_helper_good);
  PERFORM pg_temp.m191_assert_fix_g_capture_contract(
    'selftest.fix_g_good', c_fix_g_good);

  PERFORM pg_temp.m191_assert_s1_header(
    'selftest.s1_upper', c_s1_body_upper, c_adj_pattern);
  PERFORM pg_temp.m191_assert_s1_header(
    'selftest.s1_lower', c_s1_body_lower, c_adj_pattern);

  -- -------------------------------------------------------------------------
  -- B) Required mutants. Each must be caught, with the expected error.
  -- -------------------------------------------------------------------------
  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_update_bins_before_prefix',
    c_mutant_update_before_prefix,
    'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_helper_named_in_comment_only_before_bins',
    c_mutant_comment_before_bins,
    'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_helper_named_in_block_comment_only_before_bins',
    c_mutant_block_comment_before_bins,
    'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_insert_bins_before_prefix',
    c_mutant_insert_before_prefix,
    'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_delete_bins_before_prefix',
    c_mutant_delete_before_prefix,
    'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_join_bins_before_prefix',
    c_mutant_join_before_prefix,
    'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_prefix_only_mentioned',
    c_mutant_prefix_only_mentioned,
    'M191_ACCEPTANCE_PREFIX_CALL_MISSING');

  PERFORM pg_temp.m191_selftest_expect_order_failure(
    'selftest.mutant_prefix_in_string_literal',
    c_mutant_prefix_in_string_literal,
    'M191_ACCEPTANCE_PREFIX_CALL_MISSING');

  PERFORM pg_temp.m191_selftest_expect_helper_failure(
    'selftest.mutant_helper_order_by_only_in_comment',
    c_mutant_helper_order_in_comment,
    'M191_ACCEPTANCE_HELPER_ORDER_OR_MODE_MISSING');

  PERFORM pg_temp.m191_selftest_expect_fix_g_failure(
    'selftest.mutant_fix_g_exact_comparison_removed',
    c_mutant_fix_g_comparison_removed,
    'M191_ACCEPTANCE_FIX_G_EXACT_DRIFT_GUARD_MISSING');

  PERFORM pg_temp.m191_selftest_expect_s1_failure(
    'selftest.mutant_s1_downgraded_lock',
    c_s1_body_downgraded,
    c_adj_pattern,
    'M191_ACCEPTANCE_S1_POSITIVE_REGEX_FAIL');

  -- The mutant half of the S1 assertion earns its place only here: a weakened
  -- pattern that still matches the correct body must be rejected.
  PERFORM pg_temp.m191_selftest_expect_s1_failure(
    'selftest.weakened_s1_pattern',
    c_s1_body_upper,
    c_weak_pattern,
    'M191_ACCEPTANCE_S1_PATTERN_ACCEPTS_MUTANT');

  RAISE NOTICE 'M191_GATE_SELFTEST_PASS: positive=7 mutants=12';
END
$m191_gate_selftest$;
