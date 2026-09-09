-- Wardah ERP / F2 / M191 Slice 12
-- Aggregate static acceptance gates for the fully assembled candidate.
-- REVIEW/TEST ARTIFACT ONLY. Do not run on Production.
--
-- Run after all thirteen M191 objects are installed in the disposable test DB
-- and before deterministic concurrency scenarios.
--
-- This file deliberately includes both positive and negative S1 regex checks.
-- A previous Slice 11 revision used a syntactically valid but over-escaped
-- regular expression that rejected a correct function body on PostgreSQL 16.13.

\set ON_ERROR_STOP on

DO $m191_acceptance_static$
DECLARE
  v_sig text;
  v_missing text[] := '{}'::text[];
  v_count integer := 0;
  v_def text;
  v_mutant text;
  v_helper text;
  v_fix_g text;
  v_resolver_calls integer;
  v_prefix_pos integer;
  v_bins_pos integer;
  c_adj_header_pattern constant text := E'FROM public\\.stock_adjustments WHERE id *= *p_adjustment_id FOR UPDATE';
  c_mo_header_pattern constant text := E'FROM public\\.manufacturing_orders WHERE id *= *p_mo_id FOR UPDATE';
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Exact 13-object inventory.
  -- ---------------------------------------------------------------------------
  FOREACH v_sig IN ARRAY ARRAY[
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
  ]
  LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      v_missing := array_append(v_missing, v_sig);
    ELSE
      v_count := v_count + 1;
    END IF;
  END LOOP;

  IF v_count <> 13 OR cardinality(v_missing) <> 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_OBJECT_INVENTORY_FAIL: count=% missing=%',
      v_count, v_missing;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2) S1 header-lock regex: positive match on real body AND negative match on
  --    an explicit FOR NO KEY UPDATE mutant. Both directions are required.
  -- ---------------------------------------------------------------------------
  v_def := regexp_replace(
    pg_get_functiondef('public.rpc_submit_stock_adjustment(uuid)'::regprocedure),
    E'[\\n\\r\\t ]+', ' ', 'g'
  );

  IF v_def !~* c_adj_header_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_ADJUSTMENT_POSITIVE_REGEX_FAIL';
  END IF;

  v_mutant := replace(v_def, 'FOR UPDATE', 'FOR NO KEY UPDATE');
  IF v_mutant ~* c_adj_header_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_ADJUSTMENT_MUTANT_FALSE_PASS';
  END IF;

  v_def := regexp_replace(
    pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure),
    E'[\\n\\r\\t ]+', ' ', 'g'
  );

  IF v_def !~* c_mo_header_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_MO_POSITIVE_REGEX_FAIL';
  END IF;

  v_mutant := replace(v_def, 'FOR UPDATE', 'FOR NO KEY UPDATE');
  IF v_mutant ~* c_mo_header_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_MO_MUTANT_FALSE_PASS';
  END IF;

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
  v_helper := lower(regexp_replace(
    pg_get_functiondef(
      'public.wardah_lock_products_for_stock_write(uuid,uuid[])'::regprocedure
    ),
    E'[\\n\\r\\t ]+', ' ', 'g'
  ));

  IF position('order by p.id for no key update' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_ORDER_OR_MODE_MISSING';
  END IF;

  IF v_helper ~ E'(^|[^a-z])for[ ]+update([^a-z]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_FOR_UPDATE_REINTRODUCED';
  END IF;

  IF position('from public.products p' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_PRODUCTS_NOT_SCHEMA_QUALIFIED';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5) Fix G: one capture-time resolver call, prefix before first bins read,
  --    exact RETURNING comparison, and no production advisory test gate.
  -- ---------------------------------------------------------------------------
  v_fix_g := lower(regexp_replace(
    pg_get_functiondef(
      'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'::regprocedure
    ),
    E'[\\n\\r\\t ]+', ' ', 'g'
  ));

  SELECT count(*) INTO v_resolver_calls
  FROM regexp_matches(v_fix_g, 'wardah_resolve_product_id[ ]*\\(', 'g');

  IF v_resolver_calls <> 1 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_RESOLVER_CALL_COUNT: %', v_resolver_calls;
  END IF;

  v_prefix_pos := position('wardah_lock_products_for_stock_write' IN v_fix_g);
  v_bins_pos := position('from public.bins' IN v_fix_g);

  IF v_prefix_pos = 0 OR v_bins_pos = 0 OR v_prefix_pos >= v_bins_pos THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_PREFIX_NOT_BEFORE_BINS: prefix=% bins=%',
      v_prefix_pos, v_bins_pos;
  END IF;

  IF position('returning product_id into v_persisted_product_id' IN v_fix_g) = 0
     OR position('item_product_mapping_drift' IN v_fix_g) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_EXACT_RETURNING_DRIFT_CHECK_MISSING';
  END IF;

  IF position('pg_advisory_' IN v_fix_g) > 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_TEST_GATE_IN_PRODUCTION_BODY';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6) Migration 190 authorization boundary must still be visible in the final
  --    assembled consumption body.
  -- ---------------------------------------------------------------------------
  v_def := lower(pg_get_functiondef(
    'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure
  ));
  IF position('manufacturing.material_consumption.consume' IN v_def) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_M190_PERMISSION_GUARD_MISSING';
  END IF;

  RAISE NOTICE 'M191_ACCEPTANCE_STATIC_PASS: objects=13 s1_regex=positive+mutant fks=2 helper=ordered_no_key_update fix_g=captured_exact m190_guard=present';
END
$m191_acceptance_static$;
