-- Wardah ERP / F2 / M191 Slice 12
-- Aggregate static acceptance gates for the fully assembled candidate.
-- REVIEW/TEST ARTIFACT ONLY. Do not run on Production.
--
-- Run after all thirteen M191 objects are installed in the disposable test DB
-- and before deterministic concurrency scenarios.
--
-- VERDICT CONTRACT
-- ----------------
-- The verdict is the psql exit code under \set ON_ERROR_STOP on:
--   exit 0 => PASS, exit non-zero => CANDIDATE_FAIL / HARNESS_FAIL.
-- The closing M191_ACCEPTANCE_STATIC_PASS notice is supplementary evidence for
-- the bundle, not the verdict: NOTICE output is suppressed whenever
-- client_min_messages is above 'notice', so a missing notice line must never be
-- read as a failure and a present notice line must never be read as a pass.
--
-- REGEX CONVENTION
-- ----------------
-- Every regular expression in this file is written as an E'' string with
-- doubled backslashes. Mixing E'' and plain literals across slices is what
-- produced both prior escaping defects: Slice 11's over-escaped pattern that
-- rejected a correct body, and this file's own earlier
-- 'wardah_resolve_product_id[ ]*\\(' which, as a plain literal under
-- standard_conforming_strings=on, reached the regex engine as an unbalanced
-- group and made the whole gate un-runnable on PostgreSQL 16.13.
--
-- COMMENT STRIPPING
-- -----------------
-- Ordering and executable-shape checks run against comment-stripped code so a
-- doc comment that merely names the helper cannot be mistaken for the call.
-- The stripper is textual and does not parse string literals, so it is used
-- only where removing text can make a gate stricter, never where it could hide
-- a required token.
--
-- SELF-ACCEPTANCE
-- ---------------
-- The reusable assertions live in 12_acceptance_gate_defs.sql as pg_temp
-- functions taking body text, precisely so that 12_acceptance_gate_selftest.sql
-- can feed them synthetic bodies and prove the gate fails on known-bad shapes.
-- Run the selftest first; a PASS here means nothing without it.

\set ON_ERROR_STOP on

-- Shared normalization + assertions. Kept in a separate file so that
-- 12_acceptance_gate_selftest.sql can exercise the same assertions against
-- synthetic bodies without installing or mutating any candidate object.
\ir 12_acceptance_gate_defs.sql

-- ---------------------------------------------------------------------------
-- Gate run
-- ---------------------------------------------------------------------------

DO $m191_acceptance_static$
DECLARE
  v_sig text;
  v_missing text[];
  v_unexpected text[];
  v_expected oid[];
  v_norm text;
  v_code text;
  v_resolver_calls integer;
  -- Patterns are matched against UPPERCASED normalized text (see
  -- pg_temp.m191_upper_norm), so they are written in upper case and applied
  -- with the case-sensitive operator.
  c_adj_header_pattern constant text :=
    E'FROM PUBLIC\\.STOCK_ADJUSTMENTS WHERE ID *= *P_ADJUSTMENT_ID FOR UPDATE';
  c_mo_header_pattern constant text :=
    E'FROM PUBLIC\\.MANUFACTURING_ORDERS WHERE ID *= *P_MO_ID FOR UPDATE';

  -- The exact thirteen. Also the closed set: any other overload of these
  -- eleven proname values is a stale predecessor left callable.
  c_expected_signatures constant text[] := ARRAY[
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

  c_target_names constant text[] := ARRAY[
    'wardah_apply_stock_incoming',
    'wardah_apply_stock_outgoing',
    'rpc_cancel_stock_adjustment',
    'rpc_manual_stock_movement_v2',
    'rpc_post_goods_receipt',
    'rpc_post_delivery_note',
    'rpc_submit_stock_adjustment',
    'rpc_consume_reserved_materials_v2',
    'release_expired_reservations',
    'rpc_create_mo_with_reservation',
    'wardah_lock_products_for_stock_write'
  ];

  -- Every body that must own the shared product prefix. Nine of them touch
  -- public.bins directly; rpc_post_goods_receipt and rpc_submit_stock_adjustment
  -- delegate their bins work to the incoming/outgoing helpers and so only have
  -- to prove the prefix call. release_expired_reservations is deliberately
  -- absent: Fix F reorders reservation locks and takes no product prefix.
  c_prefix_bodies constant text[] := ARRAY[
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
    'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'
  ];
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Closed 13-object inventory: nothing missing AND nothing extra.
  --    Presence alone is not enough. A forgotten predecessor overload of a
  --    target name stays resolvable by callers that pass the old argument
  --    shape, so M191's closure would not actually be closed.
  -- ---------------------------------------------------------------------------
  SELECT array_agg(s ORDER BY s)
  INTO v_missing
  FROM unnest(c_expected_signatures) AS s
  WHERE to_regprocedure(s) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_OBJECT_INVENTORY_MISSING: %', v_missing;
  END IF;

  SELECT array_agg(to_regprocedure(s)::oid)
  INTO v_expected
  FROM unnest(c_expected_signatures) AS s;

  SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
  INTO v_unexpected
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prokind = 'f'
    AND p.proname = ANY(c_target_names)
    AND NOT (p.oid = ANY(v_expected));

  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_UNEXPECTED_OVERLOAD: %', v_unexpected;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2) S1 header locks: positive match on the real bodies, plus the pattern
  --    strength regression described on m191_assert_s1_header.
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.m191_assert_s1_header(
    'rpc_submit_stock_adjustment',
    pg_get_functiondef('public.rpc_submit_stock_adjustment(uuid)'::regprocedure),
    c_adj_header_pattern
  );

  PERFORM pg_temp.m191_assert_s1_header(
    'rpc_consume_reserved_materials_v2',
    pg_get_functiondef(
      'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure
    ),
    c_mo_header_pattern
  );

  -- ---------------------------------------------------------------------------
  -- 3) S1 child foreign keys are the second half of the phantom-insert closure.
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.stock_adjustment_items'::regclass
      AND c.confrelid = 'public.stock_adjustments'::regclass
      AND c.conkey = ARRAY[(
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.stock_adjustment_items'::regclass
          AND a.attname = 'adjustment_id'
          AND NOT a.attisdropped
      )]
      AND c.confkey = ARRAY[(
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.stock_adjustments'::regclass
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )]
  ) THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_ADJUSTMENT_FK_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.material_reservations'::regclass
      AND c.confrelid = 'public.manufacturing_orders'::regclass
      AND c.conkey = ARRAY[(
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.material_reservations'::regclass
          AND a.attname = 'mo_id'
          AND NOT a.attisdropped
      )]
      AND c.confkey = ARRAY[(
        SELECT a.attnum
        FROM pg_attribute a
        WHERE a.attrelid = 'public.manufacturing_orders'::regclass
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )]
  ) THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_MO_FK_MISSING';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4) Shared helper static order/mode contract.
  -- ---------------------------------------------------------------------------
  v_norm := pg_temp.m191_norm(
    pg_get_functiondef(
      'public.wardah_lock_products_for_stock_write(uuid,uuid[])'::regprocedure
    )
  );
  v_code := pg_temp.m191_code_norm(
    pg_get_functiondef(
      'public.wardah_lock_products_for_stock_write(uuid,uuid[])'::regprocedure
    )
  );

  IF position('order by p.id for no key update' IN v_norm) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_ORDER_OR_MODE_MISSING';
  END IF;

  -- Checked on comment-stripped code so the design note explaining why
  -- FOR UPDATE was rejected cannot fail the body that correctly avoids it.
  IF v_code ~ E'(^|[^a-z])for +update([^a-z]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_FOR_UPDATE_REINTRODUCED';
  END IF;

  IF position('from public.products p' IN v_code) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_PRODUCTS_NOT_SCHEMA_QUALIFIED';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5) Product-prefix lock order across every body that takes the prefix.
  --    This is the check that the per-slice PASSes cannot give: assembly can
  --    reorder statements inside a body without changing any slice file.
  -- ---------------------------------------------------------------------------
  FOREACH v_sig IN ARRAY c_prefix_bodies
  LOOP
    PERFORM pg_temp.m191_assert_prefix_before_bins(
      v_sig,
      pg_get_functiondef(v_sig::regprocedure)
    );
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 6) Fix G capture identity: one capture-time resolver call, exact RETURNING
  --    comparison, and no test-only advisory gate in the production body.
  --    Counted on comment-stripped code so neither a comment naming the
  --    resolver nor a comment naming pg_advisory_* can move the result.
  -- ---------------------------------------------------------------------------
  v_code := pg_temp.m191_code_norm(
    pg_get_functiondef(
      'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'::regprocedure
    )
  );
  SELECT count(*) INTO v_resolver_calls
  FROM regexp_matches(v_code, E'wardah_resolve_product_id *\\(', 'g');

  IF v_resolver_calls <> 1 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_RESOLVER_CALL_COUNT: %', v_resolver_calls;
  END IF;

  -- Both tokens are required in executable code. They live in a RAISE literal
  -- and an INTO target, so comment stripping cannot hide them, and matching on
  -- stripped code stops a comment that merely names the drift error from
  -- standing in for the check itself.
  IF position('returning product_id into v_persisted_product_id' IN v_code) = 0
     OR position('item_product_mapping_drift' IN v_code) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_EXACT_RETURNING_DRIFT_CHECK_MISSING';
  END IF;

  IF position('pg_advisory_' IN v_code) > 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_TEST_GATE_IN_PRODUCTION_BODY';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 7) Migration 190 authorization boundary must still be visible in the final
  --    assembled consumption body.
  -- ---------------------------------------------------------------------------
  --    Matched on stripped code: the key must be in the executable guard, not
  --    merely named in a comment that survived a removed guard.
  v_code := pg_temp.m191_code_norm(pg_get_functiondef(
    'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure
  ));
  IF position('manufacturing.material_consumption.consume' IN v_code) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_M190_PERMISSION_GUARD_MISSING';
  END IF;

  RAISE NOTICE 'M191_ACCEPTANCE_STATIC_PASS: objects=13/closed s1_regex=positive+pattern_regression fks=2 helper=ordered_no_key_update prefix_order=% bodies fix_g=captured_exact m190_guard=present',
    cardinality(c_prefix_bodies);
END
$m191_acceptance_static$;
