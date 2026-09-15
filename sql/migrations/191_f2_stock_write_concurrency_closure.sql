-- 191_f2_stock_write_concurrency_closure
--
-- F2 stock-write concurrency closure (Issue #228). Promoted verbatim from the
-- reviewed candidate docs/db/M191_CANDIDATE_ASSEMBLED.sql; the ten
-- implementation slices are inlined here byte-for-byte instead of being pulled
-- in with psql \ir, because a migration is applied as plain SQL and must carry
-- no client meta-commands.
--
-- Assembly source head: e5f2908ab27ebf0077a503682f63d81d49870c17
-- Acceptance candidate SHA: 6aa93b083a68bd47c90ea47aaeb3df6a147095d6
--
-- Order invariant (unchanged from the accepted candidate):
--   preflight -> Slice 11/A -> helper -> slices 01..10 (including their exact
--   slice-local ACL restatements) -> Slice 11/B -> COMMIT
--
-- Thirteen objects: twelve predecessor bodies acquire a deterministic ascending
-- product prefix through the new internal helper
-- wardah_lock_products_for_stock_write(uuid,uuid[]), which locks
-- FOR NO KEY UPDATE so foreign-key FOR KEY SHARE readers are not blocked.
-- Slice 11/A captures the pre-replace security contract and Slice 11/B asserts
-- it again after every definition and ACL statement, inside this transaction.
--
-- Evidence: docs/db/m191-evidence/ (Slice 12 acceptance + rollback rehearsal).


BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '10min';

-- =============================================================================
-- PRE-IMPLEMENTATION PREFLIGHT
-- Source: docs/db/M191_IMPLEMENTATION_WORKING.sql @ e5f2908...
-- =============================================================================
DO $preflight$
DECLARE
  v_permission_count integer;
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.bins') IS NULL
     OR to_regclass('public.stock_ledger_entries') IS NULL
     OR to_regclass('public.material_reservations') IS NULL
     OR to_regclass('public.stock_adjustments') IS NULL
     OR to_regclass('public.stock_adjustment_items') IS NULL
     OR to_regclass('public.sales_invoice_lines') IS NULL
     OR to_regclass('public.manufacturing_orders') IS NULL
     OR to_regclass('public.stage_wip_log') IS NULL
     OR to_regclass('public.item_product_map') IS NULL THEN
    RAISE EXCEPTION 'M191_REQUIRED_RELATION_MISSING';
  END IF;

  IF to_regprocedure('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)') IS NULL
     OR to_regprocedure('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)') IS NULL
     OR to_regprocedure('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)') IS NULL
     OR to_regprocedure('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)') IS NULL
     OR to_regprocedure('public.rpc_cancel_stock_adjustment(uuid,text)') IS NULL
     OR to_regprocedure('public.rpc_manual_stock_movement_v2(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_post_goods_receipt(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_post_delivery_note(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_submit_stock_adjustment(uuid)') IS NULL
     OR to_regprocedure('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.release_expired_reservations(uuid)') IS NULL
     OR to_regprocedure('public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'M191_REQUIRED_PREDECESSOR_FUNCTION_MISSING';
  END IF;

  IF to_regprocedure('public.wardah_resolve_product_id(uuid,uuid,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL
     OR to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'M191_REQUIRED_CANONICAL_HELPER_MISSING';
  END IF;

  SELECT count(*)
  INTO v_permission_count
  FROM public.permissions p
  JOIN public.modules m ON m.id = p.module_id
  WHERE p.permission_key = 'manufacturing.material_consumption.consume'
    AND m.name = 'manufacturing'
    AND p.resource = 'material_consumption'
    AND p.action = 'consume';

  IF v_permission_count <> 1 THEN
    RAISE EXCEPTION 'M191_REQUIRES_M190_PERMISSION_CONTRACT: %', v_permission_count;
  END IF;

  IF position(
       'manufacturing.material_consumption.consume'
       IN pg_get_functiondef(
            'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure
          )
     ) = 0 THEN
    RAISE EXCEPTION 'M191_REQUIRES_M190_CONSUMPTION_GUARD';
  END IF;
END
$preflight$;

-- =============================================================================
-- SLICE 11/A — PRE-REPLACE SECURITY CAPTURE
-- Source: docs/db/m191-slices/11_acl_security_postflight.sql @ e5f2908...
-- Must precede the helper and every CREATE OR REPLACE below.
-- =============================================================================
CREATE TEMP TABLE m191_pre_function_security_contract (
  signature text PRIMARY KEY,
  function_oid oid NOT NULL,
  owner_oid oid NOT NULL,
  security_definer boolean NOT NULL,
  proconfig text[],
  acl_norm jsonb NOT NULL
) ON COMMIT DROP;

WITH targets(signature) AS (
  VALUES
    ('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)'),
    ('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)'),
    ('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)'),
    ('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'),
    ('public.rpc_cancel_stock_adjustment(uuid,text)'),
    ('public.rpc_manual_stock_movement_v2(jsonb)'),
    ('public.rpc_post_goods_receipt(jsonb)'),
    ('public.rpc_post_delivery_note(jsonb)'),
    ('public.rpc_submit_stock_adjustment(uuid)'),
    ('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'),
    ('public.release_expired_reservations(uuid)'),
    ('public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)')
), resolved AS (
  SELECT signature, to_regprocedure(signature) AS function_oid
  FROM targets
)
INSERT INTO m191_pre_function_security_contract (
  signature, function_oid, owner_oid, security_definer, proconfig, acl_norm
)
SELECT
  r.signature,
  p.oid,
  p.proowner,
  p.prosecdef,
  p.proconfig,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee', a.grantee,
          'grantor', a.grantor,
          'privilege_type', a.privilege_type,
          'is_grantable', a.is_grantable
        )
        ORDER BY a.grantee, a.grantor, a.privilege_type, a.is_grantable
      )
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
    ),
    '[]'::jsonb
  )
FROM resolved r
JOIN pg_proc p ON p.oid = r.function_oid;

DO $m191_security_capture_verify$
BEGIN
  IF (SELECT count(*) FROM pg_temp.m191_pre_function_security_contract) <> 12 THEN
    RAISE EXCEPTION 'M191_SECURITY_CAPTURE_INCOMPLETE';
  END IF;
END
$m191_security_capture_verify$;

CREATE TEMP TABLE m191_pre_table_acl_scope (
  table_oid oid PRIMARY KEY,
  relacl aclitem[]
) ON COMMIT DROP;

INSERT INTO m191_pre_table_acl_scope(table_oid, relacl)
SELECT c.oid, c.relacl
FROM pg_class c
WHERE c.oid = 'public.stock_adjustment_items'::regclass;

-- =============================================================================
-- OBJECT 13 — NEW SHARED HELPER
-- Source bytes: docs/db/M191_IMPLEMENTATION_WORKING.sql @ e5f2908...
-- =============================================================================
CREATE OR REPLACE FUNCTION public.wardah_lock_products_for_stock_write(
  p_org uuid,
  p_product_ids uuid[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_wanted uuid[];
  v_locked uuid[] := '{}'::uuid[];
  v_id uuid;
BEGIN
  v_wanted := ARRAY(
    SELECT DISTINCT u.id
    FROM unnest(COALESCE(p_product_ids, '{}'::uuid[])) AS u(id)
    WHERE u.id IS NOT NULL
    ORDER BY u.id
  );

  FOR v_id IN
    SELECT p.id
    FROM public.products p
    WHERE p.org_id = p_org
      AND p.id = ANY(v_wanted)
    ORDER BY p.id
    FOR NO KEY UPDATE
  LOOP
    v_locked := array_append(v_locked, v_id);
  END LOOP;

  IF cardinality(v_locked) <> cardinality(v_wanted) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG: wanted=%, locked=%',
      v_wanted, v_locked;
  END IF;

  RETURN v_locked;
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_lock_products_for_stock_write(uuid,uuid[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_lock_products_for_stock_write(uuid,uuid[])
  FROM anon;
REVOKE ALL ON FUNCTION public.wardah_lock_products_for_stock_write(uuid,uuid[])
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_lock_products_for_stock_write(uuid,uuid[])
  TO service_role;

COMMENT ON FUNCTION public.wardah_lock_products_for_stock_write(uuid,uuid[]) IS
  'M191 internal stock-write prefix: dedupe product ids, lock exact same-org products in ascending id order FOR NO KEY UPDATE, fail closed on partial match, and return the canonical locked set.';

-- =============================================================================
-- OBJECTS 1–12 — REVIEWED IMPLEMENTATION SLICES, EXECUTED VERBATIM
-- Each fragment contains its reviewed CREATE OR REPLACE body and any exact
-- slice-local ACL carry-forward. All ten includes execute inside this BEGIN.
-- =============================================================================
-- ===== BEGIN INLINED m191-slices/01_incoming_fix_a_b.sql =====
-- Wardah ERP / F2 / M191 review slice 01
-- Objects 1-2 only: wardah_apply_stock_incoming 9-arg + 10-arg.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority:
--   9-arg  <- Migration 97 + current ACL closure
--   10-arg <- Migration 187
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * complete single-product prefix before any bins work;
--   * Fix A: no stale absolute ON CONFLICT overwrite on first-bin creation;
--   * Fix B: fresh product projection while the product prefix is still held;
--   * bounded, target-index-specific retry for the defensive first-bin conflict;
--   * explicit re-issue of the live service_role-only helper ACL.
--
-- Preserved deliberately:
--   * incoming bin footprint remains target-bin-only;
--   * FIFO/LIFO/Weighted Average queue/rate behavior;
--   * incoming projection asymmetry: stock_quantity + cost_price only;
--   * SLE INSERT remains before the bin mutation, preserving predecessor trigger
--     evaluation order for mapped-UoM and source-line guards;
--   * 10-arg source_line_id validation/storage contract;
--   * no new wardah_assert_org_member inside incoming helpers.

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_incoming(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_rate numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_bin_retry_limit CONSTANT integer := 3;
  v_method text;
  v_prev_qty numeric := 0;
  v_prev_value numeric := 0;
  v_prev_queue jsonb := '[]'::jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_len integer;
  v_prod_qty numeric;
  v_prod_rate numeric;
  v_bin_exists boolean;
  v_bin_retry_count integer := 0;
  v_constraint_name text;
BEGIN
  IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NO_WAREHOUSE_OR_QTY');
  END IF;

  IF p_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  SELECT COALESCE(valuation_method, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  v_method := COALESCE(v_method, 'Weighted Average');

  LOOP
    v_prev_qty := 0;
    v_prev_value := 0;
    v_prev_queue := '[]'::jsonb;

    SELECT actual_qty, stock_value, stock_queue
    INTO v_prev_qty, v_prev_value, v_prev_queue
    FROM public.bins
    WHERE product_id = p_product
      AND warehouse_id = p_warehouse
    FOR UPDATE;

    v_bin_exists := FOUND;
    v_prev_qty := COALESCE(v_prev_qty, 0);
    v_prev_value := COALESCE(v_prev_value, 0);
    v_prev_queue := COALESCE(v_prev_queue, '[]'::jsonb);

    v_new_qty := v_prev_qty + p_qty;
    v_new_value := v_prev_value + (p_qty * p_rate);
    v_new_queue := v_prev_queue
      || jsonb_build_array(jsonb_build_object('qty', p_qty, 'rate', p_rate));

    IF v_method = 'FIFO' THEN
      v_new_rate := COALESCE((v_new_queue -> 0 ->> 'rate')::numeric, p_rate);
    ELSIF v_method = 'LIFO' THEN
      v_len := jsonb_array_length(v_new_queue);
      v_new_rate := COALESCE((v_new_queue -> (v_len - 1) ->> 'rate')::numeric, p_rate);
    ELSE
      v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
      v_new_queue := jsonb_build_array(
        jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate)
      );
    END IF;

    IF v_bin_exists THEN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid()
      );

      UPDATE public.bins
      SET actual_qty = v_new_qty,
          valuation_rate = v_new_rate,
          stock_value = v_new_value,
          stock_queue = v_new_queue,
          updated_at = now()
      WHERE product_id = p_product
        AND warehouse_id = p_warehouse;
      EXIT;
    END IF;

    BEGIN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid()
      );

      INSERT INTO public.bins (
        org_id, product_id, warehouse_id, actual_qty, valuation_rate,
        stock_value, stock_queue, updated_at
      ) VALUES (
        p_org, p_product, p_warehouse, v_new_qty, v_new_rate,
        v_new_value, v_new_queue, now()
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IS DISTINCT FROM 'idx_bins_product_warehouse' THEN
          RAISE;
        END IF;
        v_bin_retry_count := v_bin_retry_count + 1;
        IF v_bin_retry_count >= c_bin_retry_limit THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  SELECT COALESCE(SUM(actual_qty), 0),
         CASE
           WHEN COALESCE(SUM(actual_qty), 0) > 0
             THEN SUM(stock_value) / SUM(actual_qty)
           ELSE NULL
         END
  INTO v_prod_qty, v_prod_rate
  FROM public.bins
  WHERE product_id = p_product
    AND org_id = p_org;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      cost_price = COALESCE(v_prod_rate, cost_price),
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'method', v_method,
    'product_synced', jsonb_build_object(
      'stock_quantity', v_prod_qty,
      'cost_price', round(COALESCE(v_prod_rate, 0), 6)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date
) TO service_role;

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_incoming(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_rate numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date,
  p_source_line_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_bin_retry_limit CONSTANT integer := 3;
  v_method text;
  v_prev_qty numeric := 0;
  v_prev_value numeric := 0;
  v_prev_queue jsonb := '[]'::jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_len integer;
  v_prod_qty numeric;
  v_prod_rate numeric;
  v_bin_exists boolean;
  v_bin_retry_count integer := 0;
  v_constraint_name text;
BEGIN
  IF p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'NO_WAREHOUSE_OR_QTY');
  END IF;

  IF lower(btrim(COALESCE(p_voucher_type, ''))) = 'stock adjustment' THEN
    IF p_source_line_id IS NULL THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_REQUIRED';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.stock_adjustment_items sai
      JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
      WHERE sai.id = p_source_line_id
        AND sai.adjustment_id = p_voucher_id
        AND sai.organization_id = p_org
        AND sai.product_id = p_product
        AND COALESCE(sai.warehouse_id, sa.warehouse_id) = p_warehouse
        AND COALESCE(sa.org_id, sa.organization_id) = p_org
    ) THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_MISMATCH';
    END IF;
  END IF;

  IF p_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  SELECT COALESCE(valuation_method, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  v_method := COALESCE(v_method, 'Weighted Average');

  LOOP
    v_prev_qty := 0;
    v_prev_value := 0;
    v_prev_queue := '[]'::jsonb;

    SELECT actual_qty, stock_value, stock_queue
    INTO v_prev_qty, v_prev_value, v_prev_queue
    FROM public.bins
    WHERE product_id = p_product
      AND warehouse_id = p_warehouse
    FOR UPDATE;

    v_bin_exists := FOUND;
    v_prev_qty := COALESCE(v_prev_qty, 0);
    v_prev_value := COALESCE(v_prev_value, 0);
    v_prev_queue := COALESCE(v_prev_queue, '[]'::jsonb);

    v_new_qty := v_prev_qty + p_qty;
    v_new_value := v_prev_value + (p_qty * p_rate);
    v_new_queue := v_prev_queue
      || jsonb_build_array(jsonb_build_object('qty', p_qty, 'rate', p_rate));

    IF v_method = 'FIFO' THEN
      v_new_rate := COALESCE((v_new_queue -> 0 ->> 'rate')::numeric, p_rate);
    ELSIF v_method = 'LIFO' THEN
      v_len := jsonb_array_length(v_new_queue);
      v_new_rate := COALESCE((v_new_queue -> (v_len - 1) ->> 'rate')::numeric, p_rate);
    ELSE
      v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
      v_new_queue := jsonb_build_array(
        jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate)
      );
    END IF;

    IF v_bin_exists THEN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by, source_line_id
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid(), p_source_line_id
      );

      UPDATE public.bins
      SET actual_qty = v_new_qty,
          valuation_rate = v_new_rate,
          stock_value = v_new_value,
          stock_queue = v_new_queue,
          updated_at = now()
      WHERE product_id = p_product
        AND warehouse_id = p_warehouse;
      EXIT;
    END IF;

    BEGIN
      INSERT INTO public.stock_ledger_entries (
        voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
        posting_date, actual_qty, qty_after_transaction, incoming_rate,
        valuation_rate, stock_value, stock_value_difference, stock_queue,
        docstatus, org_id, created_by, source_line_id
      ) VALUES (
        p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
        COALESCE(p_posting_date, CURRENT_DATE), p_qty, v_new_qty, p_rate,
        v_new_rate, v_new_value, p_qty * p_rate, v_new_queue,
        1, p_org, auth.uid(), p_source_line_id
      );

      INSERT INTO public.bins (
        org_id, product_id, warehouse_id, actual_qty, valuation_rate,
        stock_value, stock_queue, updated_at
      ) VALUES (
        p_org, p_product, p_warehouse, v_new_qty, v_new_rate,
        v_new_value, v_new_queue, now()
      );
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IS DISTINCT FROM 'idx_bins_product_warehouse' THEN
          RAISE;
        END IF;
        v_bin_retry_count := v_bin_retry_count + 1;
        IF v_bin_retry_count >= c_bin_retry_limit THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  SELECT COALESCE(SUM(actual_qty), 0),
         CASE
           WHEN COALESCE(SUM(actual_qty), 0) > 0
             THEN SUM(stock_value) / SUM(actual_qty)
           ELSE NULL
         END
  INTO v_prod_qty, v_prod_rate
  FROM public.bins
  WHERE product_id = p_product
    AND org_id = p_org;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      cost_price = COALESCE(v_prod_rate, cost_price),
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'method', v_method,
    'source_line_id', p_source_line_id,
    'product_synced', jsonb_build_object(
      'stock_quantity', v_prod_qty,
      'cost_price', round(COALESCE(v_prod_rate, 0), 6)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
  uuid, uuid, uuid, numeric, numeric, text, uuid, text, date, uuid
) TO service_role;

-- Slice-local review assertions for the eventual executable M191 postflight:
-- 1. helper call before first public.bins reference;
-- 2. no stale absolute ON CONFLICT overwrite;
-- 3. target-bin-only footprint;
-- 4. SLE INSERT remains before bin mutation; defensive conflict rollback removes
--    the attempted SLE before retry;
-- 5. only idx_bins_product_warehouse may trigger retry, and retry is bounded;
-- 6. fresh product aggregate after bin mutation under held prefix;
-- 7. no incoming products.stock_value write;
-- 8. 10-arg source-line errors/storage preserved;
-- 9. PUBLIC/anon/authenticated EXECUTE=false, service_role EXECUTE=true by exact
--    signature using GRANT EXECUTE.
-- ===== END INLINED m191-slices/01_incoming_fix_a_b.sql =====
-- ===== BEGIN INLINED m191-slices/02_outgoing_8_9.sql =====
-- Wardah ERP / F2 / M191 review slice 02
-- Objects 3-4 only: wardah_apply_stock_outgoing 8-arg + 9-arg.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority:
--   8-arg <- Migration 186
--   9-arg <- Migration 187
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * take the shared single-product prefix before any bins stock work;
--   * explicitly re-issue the live service_role-only helper ACL.
--
-- Preserved deliberately:
--   * wardah_assert_org_member and parameter-validation ordering;
--   * 9-arg STOCK_SOURCE_LINE_REQUIRED / STOCK_SOURCE_LINE_MISMATCH ordering;
--   * all-bins FOR UPDATE reservation-floor choreography from Migration 186;
--   * target-bin valuation update and SLE-before-bin mutation ordering;
--   * FIFO/LIFO/Weighted Average COGS, queue, rate, and value arithmetic;
--   * outgoing product projection: stock_quantity + stock_value + cost_price;
--   * search_path = public,pg_temp for both overloads;
--   * no Fix A/B retry or incoming-only behavior is introduced here.

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_outgoing(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_method text;
  v_prev_qty numeric;
  v_prev_value numeric;
  v_prev_queue jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_remaining numeric;
  v_take numeric;
  v_batch_qty numeric;
  v_batch_rate numeric;
  v_cogs numeric := 0;
  v_idx integer;
  v_len integer;
  v_prod_qty numeric;
  v_prod_value numeric;
  v_prod_rate numeric;
  v_total_on_hand numeric;
  v_other_mo_reserved numeric;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org);

  IF p_product IS NULL OR p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK_OUT_PARAMETERS';
  END IF;

  SELECT COALESCE(valuation_method::text, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  PERFORM 1
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product
  ORDER BY warehouse_id, id
  FOR UPDATE;

  SELECT COALESCE(SUM(actual_qty), 0)
  INTO v_total_on_hand
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;

  SELECT COALESCE(SUM(GREATEST(
    quantity_reserved - COALESCE(quantity_consumed, 0) - COALESCE(quantity_released, 0),
    0
  )), 0)
  INTO v_other_mo_reserved
  FROM public.material_reservations
  WHERE org_id = p_org
    AND product_id = p_product
    AND status = 'reserved'
    AND NOT (
      lower(COALESCE(p_voucher_type, '')) = 'material consumption'
      AND p_voucher_id IS NOT NULL
      AND mo_id = p_voucher_id
    );

  IF v_total_on_hand - p_qty < v_other_mo_reserved THEN
    RAISE EXCEPTION
      'INSUFFICIENT_UNRESERVED_STOCK: on_hand=%, protected_mo=%, requested=%',
      v_total_on_hand, v_other_mo_reserved, p_qty;
  END IF;

  SELECT COALESCE(actual_qty, 0), COALESCE(stock_value, 0),
         COALESCE(stock_queue, '[]'::jsonb)
  INTO v_prev_qty, v_prev_value, v_prev_queue
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product AND warehouse_id = p_warehouse
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BIN_NOT_FOUND';
  END IF;
  IF v_prev_qty < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: available=%, required=%', v_prev_qty, p_qty;
  END IF;

  v_new_qty := v_prev_qty - p_qty;
  v_new_queue := v_prev_queue;

  IF v_method IN ('FIFO', 'LIFO') AND jsonb_array_length(v_new_queue) > 0 THEN
    v_remaining := p_qty;
    WHILE v_remaining > 0 LOOP
      v_len := jsonb_array_length(v_new_queue);
      IF v_len = 0 THEN
        RAISE EXCEPTION 'STOCK_QUEUE_INSUFFICIENT';
      END IF;
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_batch_qty := COALESCE((v_new_queue -> v_idx ->> 'qty')::numeric, 0);
      v_batch_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
      IF v_batch_qty <= 0 THEN
        v_new_queue := v_new_queue - v_idx;
        CONTINUE;
      END IF;
      v_take := LEAST(v_remaining, v_batch_qty);
      v_cogs := v_cogs + (v_take * v_batch_rate);
      v_remaining := v_remaining - v_take;
      IF v_take = v_batch_qty THEN
        v_new_queue := v_new_queue - v_idx;
      ELSE
        v_new_queue := jsonb_set(
          v_new_queue,
          ARRAY[v_idx::text, 'qty'],
          to_jsonb(v_batch_qty - v_take),
          false
        );
      END IF;
    END LOOP;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    IF v_new_qty = 0 THEN
      v_new_rate := 0;
      v_new_queue := '[]'::jsonb;
    ELSE
      v_len := jsonb_array_length(v_new_queue);
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_new_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
    END IF;
  ELSE
    v_batch_rate := CASE WHEN v_prev_qty > 0 THEN v_prev_value / v_prev_qty ELSE 0 END;
    v_cogs := p_qty * v_batch_rate;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
    v_new_queue := CASE WHEN v_new_qty > 0
      THEN jsonb_build_array(jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate))
      ELSE '[]'::jsonb END;
  END IF;

  INSERT INTO public.stock_ledger_entries (
    voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
    posting_date, actual_qty, qty_after_transaction, outgoing_rate,
    valuation_rate, stock_value, stock_value_difference, stock_queue,
    is_cancelled, docstatus, org_id, created_by
  ) VALUES (
    p_voucher_type, p_voucher_id, p_voucher_number, p_product, p_warehouse,
    COALESCE(p_posting_date, CURRENT_DATE), -p_qty, v_new_qty,
    CASE WHEN p_qty > 0 THEN v_cogs / p_qty ELSE 0 END,
    v_new_rate, v_new_value, -v_cogs, v_new_queue,
    false, 1, p_org, auth.uid()
  );

  UPDATE public.bins
  SET actual_qty = v_new_qty,
      valuation_rate = v_new_rate,
      stock_value = v_new_value,
      stock_queue = v_new_queue,
      updated_at = now()
  WHERE org_id = p_org AND product_id = p_product AND warehouse_id = p_warehouse;

  SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(stock_value), 0)
  INTO v_prod_qty, v_prod_value
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;
  v_prod_rate := CASE WHEN v_prod_qty > 0 THEN v_prod_value / v_prod_qty ELSE 0 END;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      stock_value = v_prod_value,
      cost_price = CASE WHEN v_prod_qty > 0 THEN v_prod_rate ELSE cost_price END,
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'cogs', round(v_cogs, 6),
    'method', v_method
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date
) TO service_role;

CREATE OR REPLACE FUNCTION public.wardah_apply_stock_outgoing(
  p_org uuid,
  p_product uuid,
  p_warehouse uuid,
  p_qty numeric,
  p_voucher_type text,
  p_voucher_id uuid,
  p_voucher_number text,
  p_posting_date date,
  p_source_line_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_method text;
  v_prev_qty numeric;
  v_prev_value numeric;
  v_prev_queue jsonb;
  v_new_qty numeric;
  v_new_value numeric;
  v_new_rate numeric;
  v_new_queue jsonb;
  v_remaining numeric;
  v_take numeric;
  v_batch_qty numeric;
  v_batch_rate numeric;
  v_cogs numeric := 0;
  v_idx integer;
  v_len integer;
  v_prod_qty numeric;
  v_prod_value numeric;
  v_prod_rate numeric;
  v_total_on_hand numeric;
  v_other_mo_reserved numeric;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org);

  IF p_product IS NULL OR p_warehouse IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_STOCK_OUT_PARAMETERS';
  END IF;

  IF lower(btrim(COALESCE(p_voucher_type, ''))) = 'stock adjustment' THEN
    IF p_source_line_id IS NULL THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_REQUIRED';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.stock_adjustment_items sai
      JOIN public.stock_adjustments sa ON sa.id = sai.adjustment_id
      WHERE sai.id = p_source_line_id
        AND sai.adjustment_id = p_voucher_id
        AND sai.organization_id = p_org
        AND sai.product_id = p_product
        AND COALESCE(sai.warehouse_id, sa.warehouse_id) = p_warehouse
        AND COALESCE(sa.org_id, sa.organization_id) = p_org
    ) THEN
      RAISE EXCEPTION 'STOCK_SOURCE_LINE_MISMATCH';
    END IF;
  END IF;

  SELECT COALESCE(valuation_method::text, 'Weighted Average')
  INTO v_method
  FROM public.products
  WHERE id = p_product AND org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_WRONG_ORG';
  END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    p_org,
    ARRAY[p_product]::uuid[]
  );

  PERFORM 1
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product
  ORDER BY warehouse_id, id
  FOR UPDATE;

  SELECT COALESCE(SUM(actual_qty), 0)
  INTO v_total_on_hand
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;

  SELECT COALESCE(SUM(GREATEST(
    quantity_reserved
      - COALESCE(quantity_consumed, 0)
      - COALESCE(quantity_released, 0),
    0
  )), 0)
  INTO v_other_mo_reserved
  FROM public.material_reservations
  WHERE org_id = p_org
    AND product_id = p_product
    AND status = 'reserved'
    AND NOT (
      lower(COALESCE(p_voucher_type, '')) = 'material consumption'
      AND p_voucher_id IS NOT NULL
      AND mo_id = p_voucher_id
    );

  IF v_total_on_hand - p_qty < v_other_mo_reserved THEN
    RAISE EXCEPTION
      'INSUFFICIENT_UNRESERVED_STOCK: on_hand=%, protected_mo=%, requested=%',
      v_total_on_hand,
      v_other_mo_reserved,
      p_qty;
  END IF;

  SELECT COALESCE(actual_qty, 0),
         COALESCE(stock_value, 0),
         COALESCE(stock_queue, '[]'::jsonb)
  INTO v_prev_qty, v_prev_value, v_prev_queue
  FROM public.bins
  WHERE org_id = p_org
    AND product_id = p_product
    AND warehouse_id = p_warehouse
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BIN_NOT_FOUND';
  END IF;
  IF v_prev_qty < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: available=%, required=%', v_prev_qty, p_qty;
  END IF;

  v_new_qty := v_prev_qty - p_qty;
  v_new_queue := v_prev_queue;

  IF v_method IN ('FIFO', 'LIFO') AND jsonb_array_length(v_new_queue) > 0 THEN
    v_remaining := p_qty;
    WHILE v_remaining > 0 LOOP
      v_len := jsonb_array_length(v_new_queue);
      IF v_len = 0 THEN
        RAISE EXCEPTION 'STOCK_QUEUE_INSUFFICIENT';
      END IF;
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_batch_qty := COALESCE((v_new_queue -> v_idx ->> 'qty')::numeric, 0);
      v_batch_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
      IF v_batch_qty <= 0 THEN
        v_new_queue := v_new_queue - v_idx;
        CONTINUE;
      END IF;
      v_take := LEAST(v_remaining, v_batch_qty);
      v_cogs := v_cogs + (v_take * v_batch_rate);
      v_remaining := v_remaining - v_take;
      IF v_take = v_batch_qty THEN
        v_new_queue := v_new_queue - v_idx;
      ELSE
        v_new_queue := jsonb_set(
          v_new_queue,
          ARRAY[v_idx::text, 'qty'],
          to_jsonb(v_batch_qty - v_take),
          false
        );
      END IF;
    END LOOP;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    IF v_new_qty = 0 THEN
      v_new_rate := 0;
      v_new_queue := '[]'::jsonb;
    ELSE
      v_len := jsonb_array_length(v_new_queue);
      v_idx := CASE WHEN v_method = 'FIFO' THEN 0 ELSE v_len - 1 END;
      v_new_rate := COALESCE((v_new_queue -> v_idx ->> 'rate')::numeric, 0);
    END IF;
  ELSE
    v_batch_rate := CASE WHEN v_prev_qty > 0 THEN v_prev_value / v_prev_qty ELSE 0 END;
    v_cogs := p_qty * v_batch_rate;
    v_new_value := GREATEST(v_prev_value - v_cogs, 0);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_value / v_new_qty ELSE 0 END;
    v_new_queue := CASE
      WHEN v_new_qty > 0
        THEN jsonb_build_array(jsonb_build_object('qty', v_new_qty, 'rate', v_new_rate))
      ELSE '[]'::jsonb
    END;
  END IF;

  INSERT INTO public.stock_ledger_entries (
    voucher_type,
    voucher_id,
    voucher_number,
    product_id,
    warehouse_id,
    posting_date,
    actual_qty,
    qty_after_transaction,
    outgoing_rate,
    valuation_rate,
    stock_value,
    stock_value_difference,
    stock_queue,
    is_cancelled,
    docstatus,
    org_id,
    created_by,
    source_line_id
  ) VALUES (
    p_voucher_type,
    p_voucher_id,
    p_voucher_number,
    p_product,
    p_warehouse,
    COALESCE(p_posting_date, CURRENT_DATE),
    -p_qty,
    v_new_qty,
    CASE WHEN p_qty > 0 THEN v_cogs / p_qty ELSE 0 END,
    v_new_rate,
    v_new_value,
    -v_cogs,
    v_new_queue,
    false,
    1,
    p_org,
    auth.uid(),
    p_source_line_id
  );

  UPDATE public.bins
  SET actual_qty = v_new_qty,
      valuation_rate = v_new_rate,
      stock_value = v_new_value,
      stock_queue = v_new_queue,
      updated_at = now()
  WHERE org_id = p_org
    AND product_id = p_product
    AND warehouse_id = p_warehouse;

  SELECT COALESCE(SUM(actual_qty), 0),
         COALESCE(SUM(stock_value), 0)
  INTO v_prod_qty, v_prod_value
  FROM public.bins
  WHERE org_id = p_org AND product_id = p_product;
  v_prod_rate := CASE WHEN v_prod_qty > 0 THEN v_prod_value / v_prod_qty ELSE 0 END;

  UPDATE public.products
  SET stock_quantity = v_prod_qty,
      stock_value = v_prod_value,
      cost_price = CASE WHEN v_prod_qty > 0 THEN v_prod_rate ELSE cost_price END,
      updated_at = now()
  WHERE id = p_product AND org_id = p_org;

  RETURN jsonb_build_object(
    'applied', true,
    'new_qty', v_new_qty,
    'new_rate', round(v_new_rate, 6),
    'new_value', round(v_new_value, 6),
    'cogs', round(v_cogs, 6),
    'method', v_method,
    'source_line_id', p_source_line_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.wardah_apply_stock_outgoing(
  uuid, uuid, uuid, numeric, text, uuid, text, date, uuid
) TO service_role;
-- ===== END INLINED m191-slices/02_outgoing_8_9.sql =====
-- ===== BEGIN INLINED m191-slices/03_cancel_fix_c.sql =====
-- Wardah ERP / F2 / M191 review slice 03
-- Object 5 only: rpc_cancel_stock_adjustment(uuid,text) — Fix C.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 124, confirmed as the live body.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized change in this slice only:
--   * before the existing per-line reversal loop, collect the complete distinct
--     product_id set from the same non-cancelled Stock Adjustment SLE rows the
--     loop is about to reverse, then acquire the shared deterministic product
--     prefix once for the whole call.
--
-- Preserved deliberately:
--   * stock_adjustments header FOR UPDATE placement;
--   * wardah_assert_org_admin and all validation/error ordering;
--   * LATER_STOCK_MOVEMENT_EXISTS fail-closed check;
--   * prior surviving SLE lookup and restoration semantics;
--   * original SLE cancellation, reversal SLE shape, bins restoration, and
--     per-product SUM/projection behavior;
--   * GL reversal and final stock_adjustments cancellation behavior;
--   * SECURITY DEFINER and search_path = public;
--   * existing client-facing ACL is not changed or restated in this fragment;
--     CREATE OR REPLACE preserves it and final M191 postflight must prove exact
--     pre/post ACL equivalence by signature.
--
-- No RED-A/RED-B logic, valuation formula, source-line rule, or authorization
-- change belongs in Fix C.

CREATE OR REPLACE FUNCTION public.rpc_cancel_stock_adjustment(p_adjustment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_adj public.stock_adjustments%rowtype;
  v_sle record;
  v_prev record;
  v_prod_qty numeric;
  v_prod_value numeric;
  v_gl jsonb;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_adj
  FROM public.stock_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND'; END IF;

  v_adj.org_id := COALESCE(v_adj.org_id, v_adj.organization_id);
  PERFORM public.wardah_assert_org_admin(v_adj.org_id);

  IF v_adj.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'adjustment_id', v_adj.id);
  END IF;
  IF v_adj.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_SUBMITTED'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED'; END IF;

  PERFORM public.wardah_lock_products_for_stock_write(
    v_adj.org_id,
    ARRAY(
      SELECT DISTINCT sle.product_id
      FROM public.stock_ledger_entries sle
      WHERE sle.voucher_type = 'Stock Adjustment'
        AND sle.voucher_id = v_adj.id
        AND COALESCE(sle.is_cancelled, false) = false
      ORDER BY sle.product_id
    )
  );

  -- Fail closed if a later active movement exists; exact restoration is then unsafe.
  FOR v_sle IN
    SELECT * FROM public.stock_ledger_entries
    WHERE voucher_type = 'Stock Adjustment'
      AND voucher_id = v_adj.id
      AND COALESCE(is_cancelled, false) = false
    ORDER BY posting_datetime DESC, id DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.stock_ledger_entries later
      WHERE later.org_id = v_adj.org_id
        AND later.product_id = v_sle.product_id
        AND later.warehouse_id = v_sle.warehouse_id
        AND COALESCE(later.is_cancelled, false) = false
        AND later.voucher_id <> v_adj.id
        AND (later.posting_datetime, later.id) > (v_sle.posting_datetime, v_sle.id)
    ) THEN
      RAISE EXCEPTION 'LATER_STOCK_MOVEMENT_EXISTS: product=% warehouse=%',
        v_sle.product_id, v_sle.warehouse_id;
    END IF;

    SELECT qty_after_transaction, valuation_rate, stock_value, stock_queue
    INTO v_prev
    FROM public.stock_ledger_entries prev
    WHERE prev.org_id = v_adj.org_id
      AND prev.product_id = v_sle.product_id
      AND prev.warehouse_id = v_sle.warehouse_id
      AND COALESCE(prev.is_cancelled, false) = false
      AND prev.voucher_id <> v_adj.id
      AND (prev.posting_datetime, prev.id) < (v_sle.posting_datetime, v_sle.id)
    ORDER BY prev.posting_datetime DESC, prev.id DESC
    LIMIT 1;

    UPDATE public.stock_ledger_entries
    SET is_cancelled = true, modified_at = now(), modified_by = auth.uid()
    WHERE id = v_sle.id;

    UPDATE public.bins
    SET actual_qty = COALESCE(v_prev.qty_after_transaction, 0),
        valuation_rate = COALESCE(v_prev.valuation_rate, 0),
        stock_value = COALESCE(v_prev.stock_value, 0),
        stock_queue = COALESCE(v_prev.stock_queue, '[]'::jsonb),
        updated_at = now()
    WHERE org_id = v_adj.org_id
      AND product_id = v_sle.product_id
      AND warehouse_id = v_sle.warehouse_id;

    INSERT INTO public.stock_ledger_entries (
      voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
      posting_date, actual_qty, qty_after_transaction, incoming_rate, outgoing_rate,
      valuation_rate, stock_value, stock_value_difference, stock_queue,
      batch_no, serial_nos, is_cancelled, docstatus, org_id, created_by
    ) VALUES (
      'Stock Adjustment Reversal', v_adj.id, 'CANCEL-' || v_adj.adjustment_number,
      v_sle.product_id, v_sle.warehouse_id, CURRENT_DATE,
      -v_sle.actual_qty, COALESCE(v_prev.qty_after_transaction, 0),
      v_sle.outgoing_rate, v_sle.incoming_rate,
      COALESCE(v_prev.valuation_rate, 0), COALESCE(v_prev.stock_value, 0),
      -v_sle.stock_value_difference, COALESCE(v_prev.stock_queue, '[]'::jsonb),
      v_sle.batch_no, v_sle.serial_nos, false, 1, v_adj.org_id, auth.uid()
    );

    SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(stock_value), 0)
    INTO v_prod_qty, v_prod_value
    FROM public.bins
    WHERE org_id = v_adj.org_id AND product_id = v_sle.product_id;

    UPDATE public.products
    SET stock_quantity = v_prod_qty,
        stock_value = v_prod_value,
        cost_price = CASE WHEN v_prod_qty > 0 THEN v_prod_value / v_prod_qty ELSE cost_price END,
        updated_at = now()
    WHERE id = v_sle.product_id AND org_id = v_adj.org_id;
  END LOOP;

  IF v_adj.canonical_gl_entry_id IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object(
      'line_number', line_number,
      'account_id', account_id,
      'debit', credit,
      'credit', debit,
      'currency_code', COALESCE(currency_code, 'SAR'),
      'description', 'Reversal: ' || COALESCE(description, '')
    ) ORDER BY line_number)
    INTO v_lines
    FROM public.gl_entry_lines
    WHERE entry_id = v_adj.canonical_gl_entry_id;

    IF jsonb_array_length(COALESCE(v_lines, '[]'::jsonb)) >= 2 THEN
      v_gl := public.rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_adj.org_id,
        'entry_date', CURRENT_DATE,
        'reference_type', 'Stock Adjustment Reversal',
        'reference_number', 'CANCEL-' || v_adj.adjustment_number,
        'description', 'Reversal: ' || p_reason,
        'idempotency_key', 'stock-adjustment-reversal:' || v_adj.id::text,
        'auto_post', true,
        'lines', v_lines
      ));
    END IF;
  END IF;

  UPDATE public.stock_adjustments
  SET status = 'CANCELLED',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancellation_reason = p_reason,
      canonical_reversal_gl_entry_id = NULLIF(v_gl ->> 'entry_id', '')::uuid,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_adj.id;

  RETURN jsonb_build_object(
    'success', true,
    'adjustment_id', v_adj.id,
    'reversal_gl_entry_id', NULLIF(v_gl ->> 'entry_id', '')::uuid
  );
END;
$function$;
-- ===== END INLINED m191-slices/03_cancel_fix_c.sql =====
-- ===== BEGIN INLINED m191-slices/04_manual_movement_fix_d.sql =====
-- Wardah ERP / F2 / M191 review slice 04
-- Object 6 only: rpc_manual_stock_movement_v2(jsonb) — Fix D.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 134, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized change in this slice only:
--   * after resolving v_org and preserving the existing quantity validation,
--     acquire the shared one-product prefix before the warehouse-inference
--     IF block and therefore before any bins read for this product.
--
-- Preserved deliberately:
--   * payload cast/parse order and PRODUCT_NOT_FOUND behavior;
--   * wardah_assert_org_member placement;
--   * INVALID_MOVEMENT_QUANTITY before the new prefix;
--   * UoM factor/base-quantity/base-rate calculations;
--   * warehouse inference, warehouse validation, and locked target-bin read;
--   * in/out/adjustment delta semantics and INVALID_MOVEMENT_TYPE;
--   * calls to the canonical incoming/outgoing helpers and return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- The prefix is unconditional with respect to movement_type: warehouse
-- inference may read bins for in/out/adjustment alike when warehouse_id is
-- omitted. No RED-A/RED-B logic or authorization change belongs in Fix D.

CREATE OR REPLACE FUNCTION public.rpc_manual_stock_movement_v2(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_product uuid; v_org uuid; v_warehouse uuid; v_uom uuid;
  v_qty_entered numeric; v_qty_base numeric; v_factor numeric; v_current numeric;
  v_delta numeric; v_rate_entered numeric; v_rate_base numeric;
  v_voucher uuid:=gen_random_uuid(); v_count integer; v_result jsonb;
BEGIN
  v_product:=NULLIF(p_payload->>'product_id','')::uuid;
  v_warehouse:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  v_qty_entered:=COALESCE(NULLIF(p_payload->>'qty_entered','')::numeric,NULLIF(p_payload->>'quantity','')::numeric);
  SELECT org_id,COALESCE(NULLIF(p_payload->>'uom_id','')::uuid,base_uom_id),
         COALESCE(NULLIF(p_payload->>'unit_cost_entered','')::numeric,cost_price,0)
  INTO v_org,v_uom,v_rate_entered FROM public.products WHERE id=v_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF v_qty_entered IS NULL OR v_qty_entered<0 THEN RAISE EXCEPTION 'INVALID_MOVEMENT_QUANTITY'; END IF;
  PERFORM public.wardah_lock_products_for_stock_write(v_org,ARRAY[v_product]::uuid[]);
  v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
  v_qty_base:=round(v_qty_entered*v_factor,6); v_rate_base:=round(v_rate_entered/v_factor,6);
  IF v_warehouse IS NULL THEN
    SELECT count(*),min(warehouse_id) INTO v_count,v_warehouse FROM public.bins WHERE org_id=v_org AND product_id=v_product;
    IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=v_warehouse AND org_id=v_org) THEN RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND_OR_WRONG_ORG'; END IF;
  SELECT COALESCE(actual_qty,0) INTO v_current FROM public.bins
  WHERE org_id=v_org AND product_id=v_product AND warehouse_id=v_warehouse FOR UPDATE;
  v_current:=COALESCE(v_current,0);
  CASE lower(COALESCE(p_payload->>'movement_type',''))
    WHEN 'in' THEN v_delta:=v_qty_base;
    WHEN 'out' THEN v_delta:=-v_qty_base;
    WHEN 'adjustment' THEN v_delta:=v_qty_base-v_current;
    ELSE RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE';
  END CASE;
  IF v_delta>0 THEN
    v_result:=public.wardah_apply_stock_incoming(v_org,v_product,v_warehouse,v_delta,v_rate_base,
      'Manual Stock Movement',v_voucher,'MAN-'||substr(v_voucher::text,1,8),CURRENT_DATE);
  ELSIF v_delta<0 THEN
    v_result:=public.wardah_apply_stock_outgoing(v_org,v_product,v_warehouse,abs(v_delta),
      'Manual Stock Movement',v_voucher,'MAN-'||substr(v_voucher::text,1,8),CURRENT_DATE);
  ELSE v_result:=jsonb_build_object('applied',false,'reason','NO_CHANGE'); END IF;
  RETURN v_result||jsonb_build_object('uom_atomic',true,'uom_id',v_uom,'qty_entered',v_qty_entered,
    'conversion_factor',v_factor,'base_quantity',v_qty_base,'notes',NULLIF(p_payload->>'notes',''));
END;
$function$;
-- ===== END INLINED m191-slices/04_manual_movement_fix_d.sql =====
-- ===== BEGIN INLINED m191-slices/05_goods_receipt_fix_e.sql =====
-- Wardah ERP / F2 / M191 review slice 05
-- Object 7 only: rpc_post_goods_receipt(jsonb) — Fix E (goods receipt).
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 177, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after all existing document-level gates, extract valid same-org product
--     candidates from payload lines without deciding or raising line errors;
--   * acquire the shared deterministic whole-call product prefix once;
--   * inside the unchanged sequential line loop, after the existing product
--     resolution/ITEM_NOT_FOUND check, fail closed if the resolved product is
--     outside the prelocked set.
--
-- Preserved deliberately:
--   * idempotent replay and advisory-lock placement;
--   * vendor/warehouse/PO/period validation and their error order;
--   * Migration 177 receipt-number sequence/retry behavior;
--   * every per-line business validation and sequential error order;
--   * PO-line snapshot/UoM/quality/over-receipt semantics;
--   * goods_receipt_lines write, canonical incoming call, PO status update,
--     GRNI event posting, and return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- The pre-pass is intentionally non-throwing: malformed, scalar, NULL, or
-- nonexistent product candidates are excluded rather than raised on. The
-- unchanged line loop remains authoritative for GR_LINE_OBJECT_REQUIRED,
-- ITEM_NOT_FOUND, INVALID_QUALITY_STATUS, and subsequent line errors.

CREATE OR REPLACE FUNCTION public.rpc_post_goods_receipt(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_lines_key CONSTANT text := 'lines';
  c_number_attempt_limit CONSTANT integer := 100;
  c_quality_accepted CONSTANT text := 'accepted';
  c_quality_rejected CONSTANT text := 'rejected';
  c_receipt_sequence CONSTANT regclass := 'public.goods_receipt_number_seq'::regclass;
  v_org uuid; v_uid uuid; v_gr_id uuid; v_gr_number text; v_po_id uuid;
  v_po_status text; v_po_vendor uuid; v_vendor_id uuid; v_wh_id uuid;
  v_idem_key text; v_req_hash text; v_existing_id uuid; v_existing_no text; v_existing_hash text;
  v_line jsonb; v_line_no integer:=0; v_product uuid; v_uom uuid; v_base_uom uuid;
  v_payload_uom uuid; v_qty_entered numeric; v_qty_base numeric;
  v_ordered_entered numeric; v_ordered_base numeric; v_factor numeric;
  v_cost_entered numeric; v_cost_base numeric; v_payload_cost numeric;
  v_payload_cost_base numeric; v_quality text;
  v_total numeric:=0; v_pol record; v_pol_id uuid; v_recv_date date; v_stock jsonb;
  v_pending numeric; v_committed numeric; v_consumes boolean;
  v_number_attempt integer:=0;
  v_receipt_sequence bigint;
  v_products uuid[];
  v_locked_products uuid[];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GR_PAYLOAD_OBJECT_REQUIRED';
  END IF;

  v_org:=public.wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  v_uid:=auth.uid(); PERFORM public.wardah_assert_org_member(v_org);

  -- Idempotent replay is resolved before every business gate below.
  -- A retry of the receipt that closed a purchase order must return the original
  -- document, not PO_NOT_RECEIVABLE: by then the order is legitimately
  -- 'fully_received', and the same is true once a period closes or a line is
  -- exhausted. Gating a replay on state that the original call itself produced
  -- makes the final receipt of every order unconfirmable after a timeout.
  -- The lock is taken first so a concurrent duplicate serializes here and finds
  -- the committed row instead of racing past this check into a second insert.
  PERFORM pg_advisory_xact_lock(hashtext('goods_receipts:'||v_org::text));
  v_req_hash:=md5((p_payload-'idempotency_key')::text);
  v_idem_key:=NULLIF(p_payload->>'idempotency_key','');
  IF v_idem_key IS NOT NULL THEN
    SELECT id,receipt_number,request_hash INTO v_existing_id,v_existing_no,v_existing_hash
    FROM public.goods_receipts
    WHERE org_id=v_org AND idempotency_key=v_idem_key;
    IF FOUND THEN
      IF v_existing_hash IS NULL OR v_existing_hash<>v_req_hash THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
      END IF;
      RETURN jsonb_build_object(
        'success',true,
        'goods_receipt_id',v_existing_id,
        'receipt_number',v_existing_no,
        'idempotent_replay',true,
        'inventory_atomic',true,
        'uom_atomic',true,
        'po_snapshot_atomic',true,
        'quality_aware_contract',true
      );
    END IF;
  END IF;

  v_vendor_id:=NULLIF(p_payload->>'vendor_id','')::uuid;
  IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: vendor_id required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id=v_vendor_id AND org_id=v_org) THEN
    RAISE EXCEPTION 'VENDOR_NOT_FOUND';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload->c_lines_key,'[]'::jsonb))<>'array'
     OR jsonb_array_length(COALESCE(p_payload->c_lines_key,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: receipt lines required';
  END IF;
  v_wh_id:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  IF v_wh_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses WHERE id=v_wh_id AND org_id=v_org
  ) THEN
    RAISE EXCEPTION 'WAREHOUSE_REQUIRED_OR_WRONG_ORG';
  END IF;

  v_po_id:=NULLIF(p_payload->>'purchase_order_id','')::uuid;
  IF v_po_id IS NOT NULL THEN
    SELECT status,vendor_id INTO v_po_status,v_po_vendor
    FROM public.purchase_orders
    WHERE id=v_po_id AND org_id=v_org
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PO_NOT_FOUND'; END IF;
    -- 'submitted' is not receivable: receiving an unapproved order would bypass
    -- the approval gate that governs inventory and GL impact.
    IF v_po_status NOT IN ('approved','partially_received') THEN
      RAISE EXCEPTION 'PO_NOT_RECEIVABLE: %',v_po_status;
    END IF;
    IF v_po_vendor IS NOT NULL AND v_po_vendor<>v_vendor_id THEN
      RAISE EXCEPTION 'VENDOR_MISMATCH';
    END IF;
  END IF;

  v_recv_date:=COALESCE(NULLIF(p_payload->>'receipt_date','')::date,CURRENT_DATE);
  PERFORM public.assert_period_open(v_org,v_recv_date);

  -- M191 Fix E: candidate extraction must not decide line validity or reorder
  -- Migration 177's sequential line errors. PostgreSQL's own UUID validator
  -- gates the cast; malformed/non-object/nonexistent candidates simply do not
  -- enter the prelock set and are left for the unchanged loop to reject.
  v_products := ARRAY(
    SELECT DISTINCT p.id
    FROM jsonb_array_elements(p_payload->c_lines_key) AS line(value)
    JOIN public.products p
      ON p.org_id = v_org
     AND p.id = CASE
                  WHEN pg_input_is_valid(line.value->>'product_id', 'uuid')
                  THEN (line.value->>'product_id')::uuid
                  ELSE NULL
                END
  );
  v_locked_products :=
    public.wardah_lock_products_for_stock_write(v_org, v_products);

  -- Migration 177: a database sequence is global (matching the global UNIQUE
  -- constraint), concurrency-safe, and never truncates legacy timestamp-shaped
  -- receipt numbers through lpad(..., 6). The retry closes the narrow upgrade
  -- race where an invocation of the old allocator commits after sequence seed.
  LOOP
    v_number_attempt:=v_number_attempt+1;
    SELECT nextval(c_receipt_sequence) INTO v_receipt_sequence;
    v_gr_number := 'GR-' || CASE
      WHEN v_receipt_sequence < 1000000
        THEN lpad(v_receipt_sequence::text, 6, '0')
      ELSE v_receipt_sequence::text
    END;

    BEGIN
      INSERT INTO public.goods_receipts(
        org_id,receipt_number,purchase_order_id,vendor_id,receipt_date,warehouse_id,
        warehouse_location,receiver_name,status,notes,idempotency_key,request_hash,created_by
      ) VALUES(
        v_org,v_gr_number,v_po_id,v_vendor_id,v_recv_date,v_wh_id,
        NULLIF(p_payload->>'warehouse_location',''),NULLIF(p_payload->>'receiver_name',''),
        'confirmed',NULLIF(p_payload->>'notes',''),v_idem_key,v_req_hash,v_uid
      ) RETURNING id INTO v_gr_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_number_attempt<c_number_attempt_limit AND EXISTS (
          SELECT 1
          FROM public.goods_receipts
          WHERE receipt_number=v_gr_number
        ) THEN
          CONTINUE;
        END IF;
        RAISE;
    END;
  END LOOP;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->c_lines_key) LOOP
    v_line_no:=v_line_no+1;
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'GR_LINE_OBJECT_REQUIRED: line=%',v_line_no;
    END IF;

    v_product:=NULLIF(v_line->>'product_id','')::uuid;
    SELECT p.base_uom_id INTO v_base_uom
    FROM public.products p
    WHERE p.id=v_product AND p.org_id=v_org;
    IF v_product IS NULL OR NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND: line=%',v_line_no;
    END IF;
    IF v_product IS NULL
       OR NOT COALESCE(v_product = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_product;
    END IF;

    v_quality:=COALESCE(NULLIF(v_line->>'quality_status',''),c_quality_accepted);
    IF v_quality NOT IN (c_quality_accepted,c_quality_rejected,'pending_inspection') THEN
      RAISE EXCEPTION 'INVALID_QUALITY_STATUS: line=%',v_line_no;
    END IF;

    v_pol_id:=NULLIF(v_line->>'purchase_order_line_id','')::uuid;
    v_payload_uom:=NULLIF(v_line->>'uom_id','')::uuid;
    v_payload_cost:=NULLIF(v_line->>'unit_cost_entered','')::numeric;
    v_payload_cost_base:=NULLIF(v_line->>'unit_cost','')::numeric;

    IF v_pol_id IS NOT NULL THEN
      IF v_po_id IS NULL THEN RAISE EXCEPTION 'PO_REQUIRED: line=%',v_line_no; END IF;

      -- No resolution flow exists to move a pending quantity to accepted or
      -- rejected, so accepting one here would strand the contract balance
      -- permanently: no inventory, no GRNI, and no way to close or reopen the
      -- order. Refuse at the entry point instead of creating unresolvable state.
      IF v_quality='pending_inspection' THEN
        RAISE EXCEPTION 'PENDING_INSPECTION_REQUIRES_RESOLUTION_FLOW: line=%',v_line_no;
      END IF;

      SELECT
        purchase_order_id,
        product_id,
        quantity,
        COALESCE(received_quantity,0) AS received,
        COALESCE(accepted_quantity,0) AS accepted,
        COALESCE(rejected_quantity,0) AS rejected,
        uom_id,
        qty_entered,
        conversion_factor_snapshot,
        unit_price,
        unit_price_entered
      INTO v_pol
      FROM public.purchase_order_lines
      WHERE id=v_pol_id AND org_id=v_org
      FOR UPDATE;

      IF NOT FOUND OR v_pol.purchase_order_id<>v_po_id THEN
        RAISE EXCEPTION 'INVALID_PO_LINE: line=%',v_line_no;
      END IF;
      IF v_pol.product_id<>v_product THEN RAISE EXCEPTION 'PRODUCT_MISMATCH'; END IF;

      v_uom:=COALESCE(v_pol.uom_id,v_base_uom);

      -- Fail closed instead of silently assuming factor 1. A line denominated in a
      -- non-base unit with no legal snapshot cannot be converted without guessing,
      -- and guessing writes a wrong base quantity and cost with no error at all.
      IF v_pol.conversion_factor_snapshot IS NULL OR v_pol.conversion_factor_snapshot<=0 THEN
        IF v_uom IS DISTINCT FROM v_base_uom THEN
          RAISE EXCEPTION 'PO_LINE_SNAPSHOT_MISSING: line=%',v_line_no;
        END IF;
        -- Base unit and no snapshot: entered and base are the same quantity by
        -- definition, so factor 1 is a fact here rather than an assumption.
        v_factor:=1;
      ELSE
        v_factor:=v_pol.conversion_factor_snapshot;
      END IF;

      v_ordered_base:=v_pol.quantity;
      v_ordered_entered:=COALESCE(v_pol.qty_entered,round(v_pol.quantity/v_factor,6));
      v_cost_base:=v_pol.unit_price;
      v_cost_entered:=COALESCE(v_pol.unit_price_entered,round(v_pol.unit_price*v_factor,6));

      v_qty_entered:=NULLIF(v_line->>'qty_entered','')::numeric;
      IF v_qty_entered IS NULL THEN
        -- Legacy callers send received_quantity/unit_cost in base units while the
        -- snapshot contract is expressed in entered units. The two are provably
        -- identical only at factor 1; anywhere else the payload is ambiguous and
        -- must be refused rather than silently inflated by the factor.
        IF v_factor<>1 THEN
          RAISE EXCEPTION 'RECEIPT_SNAPSHOT_CONTRACT_REQUIRED: line=%',v_line_no;
        END IF;
        v_qty_entered:=NULLIF(v_line->>'received_quantity','')::numeric;
      END IF;
      IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
        RAISE EXCEPTION 'RECEIPT_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;

      IF v_payload_uom IS NOT NULL AND v_payload_uom<>v_uom THEN
        RAISE EXCEPTION 'RECEIPT_UOM_MISMATCH: line=%',v_line_no;
      END IF;
      IF v_payload_cost IS NOT NULL AND abs(v_payload_cost-v_cost_entered)>0.000001 THEN
        RAISE EXCEPTION 'RECEIPT_COST_MISMATCH: line=%',v_line_no;
      END IF;
      -- Legacy base-unit cost is only unambiguous at factor 1, where entered and
      -- base rates coincide. Beyond that the explicit field is mandatory above.
      IF v_payload_cost IS NULL AND v_payload_cost_base IS NOT NULL
         AND abs(v_payload_cost_base-v_cost_base)>0.000001 THEN
        RAISE EXCEPTION 'RECEIPT_COST_MISMATCH: line=%',v_line_no;
      END IF;

      v_qty_base:=round(v_qty_entered*v_factor,6);
      IF v_qty_base<=0 THEN
        RAISE EXCEPTION 'RECEIPT_BASE_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;

      -- Contract balance, not physical balance. Accepted units are final and any
      -- pending units are still claimable, so both hold the balance; rejected
      -- units release it so a replacement delivery does not trip OVER_RECEIPT.
      v_pending:=GREATEST(v_pol.received-v_pol.accepted-v_pol.rejected,0);
      v_committed:=v_pol.accepted+v_pending;
      v_consumes:=(v_quality=c_quality_accepted);

      IF v_consumes AND v_committed+v_qty_base>v_pol.quantity THEN
        RAISE EXCEPTION 'OVER_RECEIPT: remaining=%, requested_base=%',
          v_pol.quantity-v_committed,v_qty_base;
      END IF;

      -- A rejected quantity releases balance rather than consuming it, so it is
      -- not covered by OVER_RECEIPT above. Without its own ceiling a vendor could
      -- be recorded as delivering — and the buyer as rejecting — an unbounded
      -- quantity against a finite order. A single shipment may not exceed the
      -- balance that was open when it arrived.
      IF v_quality=c_quality_rejected THEN
        IF v_qty_base>v_pol.quantity-v_committed THEN
          RAISE EXCEPTION 'REJECTED_QUANTITY_EXCEEDS_OPEN_BALANCE: remaining=%, requested_base=%',
            v_pol.quantity-v_committed,v_qty_base;
        END IF;
      END IF;

      -- received_quantity keeps its physical meaning for every quality status.
      -- Only the accepted/rejected split is quality driven.
      UPDATE public.purchase_order_lines
      SET received_quantity=v_pol.received+v_qty_base,
          accepted_quantity=v_pol.accepted+CASE WHEN v_quality=c_quality_accepted THEN v_qty_base ELSE 0 END,
          rejected_quantity=v_pol.rejected+CASE WHEN v_quality=c_quality_rejected THEN v_qty_base ELSE 0 END
      WHERE id=v_pol_id;
    ELSE
      v_qty_entered:=COALESCE(
        NULLIF(v_line->>'qty_entered','')::numeric,
        NULLIF(v_line->>'received_quantity','')::numeric
      );
      IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
        RAISE EXCEPTION 'RECEIPT_QUANTITY_MUST_BE_POSITIVE: line=%',v_line_no;
      END IF;
      v_uom:=COALESCE(v_payload_uom,v_base_uom);
      v_ordered_entered:=COALESCE(
        NULLIF(v_line->>'ordered_qty_entered','')::numeric,
        NULLIF(v_line->>'ordered_quantity','')::numeric,
        v_qty_entered
      );
      v_cost_entered:=COALESCE(v_payload_cost,v_payload_cost_base);
      IF v_ordered_entered IS NULL OR v_ordered_entered<0
         OR v_cost_entered IS NULL OR v_cost_entered<0 THEN
        RAISE EXCEPTION 'INVALID_LINE: line=%',v_line_no;
      END IF;
      v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,v_recv_date::timestamptz);
      v_qty_base:=round(v_qty_entered*v_factor,6);
      v_ordered_base:=round(v_ordered_entered*v_factor,6);
      v_cost_base:=round(v_cost_entered/v_factor,6);
    END IF;

    INSERT INTO public.goods_receipt_lines(
      org_id,goods_receipt_id,purchase_order_line_id,product_id,
      ordered_quantity,received_quantity,unit_cost,quality_status,notes,
      uom_id,qty_entered,conversion_factor_snapshot,unit_cost_entered
    ) VALUES(
      v_org,v_gr_id,v_pol_id,v_product,
      v_ordered_base,v_qty_base,v_cost_base,v_quality,NULLIF(v_line->>'notes',''),
      v_uom,v_qty_entered,v_factor,v_cost_entered
    );

    IF v_quality=c_quality_accepted AND v_qty_base>0 THEN
      v_stock:=public.wardah_apply_stock_incoming(
        v_org,v_product,v_wh_id,v_qty_base,v_cost_base,
        'Goods Receipt',v_gr_id,v_gr_number,v_recv_date
      );
      IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN
        RAISE EXCEPTION 'STOCK_IN_NOT_APPLIED: %',v_stock;
      END IF;
      v_total:=v_total+(v_qty_base*v_cost_base);
    END IF;
  END LOOP;

  -- Receipt status follows the accepted quantity: a rejected delivery must never
  -- close a purchase order that produced no inventory and no GRNI value.
  IF v_po_id IS NOT NULL THEN
    UPDATE public.purchase_orders po
    SET status=CASE WHEN NOT EXISTS(
      SELECT 1
      FROM public.purchase_order_lines l
      WHERE l.purchase_order_id=po.id
        AND COALESCE(l.accepted_quantity,0)<l.quantity
    ) THEN 'fully_received' ELSE 'partially_received' END
    WHERE po.id=v_po_id;
  END IF;

  IF v_total>0 THEN
    PERFORM public.rpc_post_event_journal(
      'GR_RECEIPT',v_total,'استلام بضاعة '||v_gr_number,
      'GOODS_RECEIPT',v_gr_id,v_org,'GR_RECEIPT:'||v_gr_id::text,NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'success',true,
    'goods_receipt_id',v_gr_id,
    'receipt_number',v_gr_number,
    'total_value',round(v_total,6),
    'lines_processed',v_line_no,
    'inventory_atomic',true,
    'uom_atomic',true,
    'po_snapshot_atomic',true,
    'quality_aware_contract',true
  );
END;
$function$;
-- ===== END INLINED m191-slices/05_goods_receipt_fix_e.sql =====
-- ===== BEGIN INLINED m191-slices/06_delivery_note_fix_e.sql =====
-- Wardah ERP / F2 / M191 review slice 06
-- Object 8 only: rpc_post_delivery_note(jsonb) — Fix E (delivery note).
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 133, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the existing invoice header/customer gates, lock every payload-
--     referenced same-org sales_invoice_lines row in deterministic sil.id order;
--   * extract the distinct product set from those already-locked rows and acquire
--     the shared deterministic whole-call product prefix once;
--   * inside the unchanged sequential loop, after resolving v_product from the
--     freshly re-read invoice line, fail closed if it is outside the prelocked set.
--
-- Preserved deliberately:
--   * idempotent replay and advisory-lock placement;
--   * invoice/customer/period/warehouse validation and their error order;
--   * delivery-number allocation and delivery-note insert;
--   * the loop's own per-occurrence SELECT ... FOR UPDATE and fresh reads of
--     quantity, unit_price, and delivered_quantity;
--   * duplicate sales_invoice_line_id behavior and cumulative weighted-average
--     unit_cost_at_sale calculation;
--   * UoM conversion, over-delivery, warehouse inference, canonical outgoing,
--     delivery-note line write, COGS journal, invoice delivery status, return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- The pre-pass is intentionally non-throwing for malformed/missing line ids.
-- DISTINCT is outside the row-locking subquery: PostgreSQL rejects DISTINCT and
-- FOR UPDATE in the same query level. ORDER BY sil.id precedes FOR UPDATE OF sil.
-- The pre-pass supplies identity/locking only; it does not replace the loop's
-- fresh business-state read.

CREATE OR REPLACE FUNCTION public.rpc_post_delivery_note(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_org uuid; v_uid uuid; v_dn_id uuid; v_dn_number text; v_invoice_id uuid;
  v_inv_customer uuid; v_payload_customer uuid; v_idem_key text; v_req_hash text;
  v_existing_id uuid; v_existing_no text; v_existing_hash text; v_allow_over boolean;
  v_line jsonb; v_inv_line record; v_product uuid; v_uom uuid; v_qty_entered numeric;
  v_qty_base numeric; v_factor numeric; v_root_warehouse uuid; v_warehouse uuid; v_bin_count integer;
  v_stock jsonb; v_line_cogs numeric; v_unit_cost numeric; v_total_cogs numeric:=0; v_line_no integer:=0; v_date date;
  v_products uuid[];
  v_locked_products uuid[];
BEGIN
  v_org:=public.wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
  IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
  v_uid:=auth.uid(); PERFORM public.wardah_assert_org_member(v_org);
  v_invoice_id:=NULLIF(p_payload->>'sales_invoice_id','')::uuid;
  IF v_invoice_id IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: sales_invoice_id required'; END IF;
  IF jsonb_typeof(COALESCE(p_payload->'lines','[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_payload->'lines','[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: delivery lines required'; END IF;
  v_allow_over:=COALESCE(NULLIF(p_payload->>'allow_over_delivery','')::boolean,false);
  IF v_allow_over AND NOT public.wardah_is_org_admin(v_org) THEN v_allow_over:=false; END IF;
  v_date:=COALESCE(NULLIF(p_payload->>'delivery_date','')::date,CURRENT_DATE); PERFORM public.assert_period_open(v_org,v_date);
  v_root_warehouse:=NULLIF(p_payload->>'warehouse_id','')::uuid;
  IF v_root_warehouse IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=v_root_warehouse AND org_id=v_org) THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND_OR_WRONG_ORG'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('delivery_notes:'||v_org::text));
  v_req_hash:=md5((p_payload-'idempotency_key')::text); v_idem_key:=NULLIF(p_payload->>'idempotency_key','');
  IF v_idem_key IS NOT NULL THEN
    SELECT id,delivery_number,request_hash INTO v_existing_id,v_existing_no,v_existing_hash
    FROM public.delivery_notes WHERE org_id=v_org AND idempotency_key=v_idem_key;
    IF FOUND THEN
      IF v_existing_hash IS NULL OR v_existing_hash<>v_req_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
      SELECT COALESCE(sum(quantity_delivered*unit_cost_at_delivery),0) INTO v_total_cogs
      FROM public.delivery_note_lines WHERE delivery_note_id=v_existing_id;
      RETURN jsonb_build_object('success',true,'delivery_id',v_existing_id,'delivery_number',v_existing_no,
        'total_cogs',round(v_total_cogs,6),'idempotent_replay',true,'inventory_atomic',true,'uom_atomic',true);
    END IF;
  END IF;

  SELECT customer_id INTO v_inv_customer FROM public.sales_invoices WHERE id=v_invoice_id AND org_id=v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  v_payload_customer:=NULLIF(p_payload->>'customer_id','')::uuid;
  IF v_payload_customer IS NOT NULL AND v_payload_customer<>v_inv_customer THEN RAISE EXCEPTION 'CUSTOMER_MISMATCH'; END IF;

  -- M191 Fix E: freeze the payload-referenced invoice-line identity rows before
  -- acquiring products. Invalid/missing ids are excluded without raising so the
  -- unchanged loop remains authoritative for LINE_REQUIRED/INVALID_INVOICE_LINE
  -- and raw-cast ordering. The inner query locks rows deterministically; DISTINCT
  -- is deliberately applied only after those rows have been locked.
  v_products := ARRAY(
    SELECT DISTINCT product_id
    FROM (
      SELECT sil.product_id
      FROM jsonb_array_elements(p_payload->'lines') AS line(value)
      JOIN public.sales_invoice_lines sil
        ON sil.invoice_id = v_invoice_id
       AND sil.org_id = v_org
       AND sil.id = CASE
                      WHEN pg_input_is_valid(
                        line.value->>'sales_invoice_line_id', 'uuid')
                      THEN (line.value->>'sales_invoice_line_id')::uuid
                      ELSE NULL
                    END
      ORDER BY sil.id
      FOR UPDATE OF sil
    ) locked
  );
  v_locked_products :=
    public.wardah_lock_products_for_stock_write(v_org, v_products);

  SELECT 'DN-'||lpad((COALESCE(max(NULLIF(regexp_replace(delivery_number,'\D','','g'),''))::bigint,0)+1)::text,6,'0')
    INTO v_dn_number FROM public.delivery_notes WHERE org_id=v_org AND delivery_number~'^DN-\d+$';
  v_dn_number:=COALESCE(v_dn_number,'DN-000001');
  INSERT INTO public.delivery_notes(org_id,delivery_number,sales_invoice_id,customer_id,delivery_date,warehouse_id,
    vehicle_number,driver_name,status,notes,idempotency_key,request_hash,created_by)
  VALUES(v_org,v_dn_number,v_invoice_id,v_inv_customer,v_date,v_root_warehouse,NULLIF(p_payload->>'vehicle_number',''),
    NULLIF(p_payload->>'driver_name',''),'delivered',NULLIF(p_payload->>'notes',''),v_idem_key,v_req_hash,v_uid)
  RETURNING id INTO v_dn_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->'lines') LOOP
    v_line_no:=v_line_no+1;
    IF NULLIF(v_line->>'sales_invoice_line_id','') IS NULL THEN RAISE EXCEPTION 'LINE_REQUIRED: sales_invoice_line_id line=%',v_line_no; END IF;
    SELECT id,product_id,quantity,unit_price,COALESCE(delivered_quantity,0) AS delivered INTO v_inv_line
    FROM public.sales_invoice_lines WHERE id=(v_line->>'sales_invoice_line_id')::uuid AND invoice_id=v_invoice_id AND org_id=v_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_INVOICE_LINE: line=%',v_line_no; END IF;
    v_product:=v_inv_line.product_id;
    IF v_product IS NULL
       OR NOT COALESCE(v_product = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_product;
    END IF;
    IF NULLIF(v_line->>'item_id','') IS NOT NULL AND (v_line->>'item_id')::uuid<>v_product THEN RAISE EXCEPTION 'PRODUCT_MISMATCH: line=%',v_line_no; END IF;
    SELECT COALESCE(NULLIF(v_line->>'uom_id','')::uuid,p.base_uom_id) INTO v_uom FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=COALESCE(NULLIF(v_line->>'qty_entered','')::numeric,NULLIF(v_line->>'delivered_quantity','')::numeric);
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN RAISE EXCEPTION 'INVALID_DELIVERY_QUANTITY: line=%',v_line_no; END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,v_date::timestamptz); v_qty_base:=round(v_qty_entered*v_factor,6);
    IF NOT v_allow_over AND v_inv_line.delivered+v_qty_base>v_inv_line.quantity THEN
      RAISE EXCEPTION 'OVER_DELIVERY: remaining=%, requested_base=%',v_inv_line.quantity-v_inv_line.delivered,v_qty_base; END IF;
    v_warehouse:=COALESCE(NULLIF(v_line->>'warehouse_id','')::uuid,v_root_warehouse);
    IF v_warehouse IS NULL THEN
      SELECT count(*),min(warehouse_id) INTO v_bin_count,v_warehouse FROM public.bins
      WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_bin_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_DELIVERY'; END IF;
    END IF;
    v_stock:=public.wardah_apply_stock_outgoing(v_org,v_product,v_warehouse,v_qty_base,
      'Delivery Note',v_dn_id,v_dn_number,v_date);
    IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN RAISE EXCEPTION 'STOCK_OUT_NOT_APPLIED: %',v_stock; END IF;
    v_line_cogs:=COALESCE((v_stock->>'cogs')::numeric,0); v_unit_cost:=CASE WHEN v_qty_base>0 THEN v_line_cogs/v_qty_base ELSE 0 END;
    v_total_cogs:=v_total_cogs+v_line_cogs;
    INSERT INTO public.delivery_note_lines(org_id,delivery_note_id,sales_invoice_line_id,product_id,invoiced_quantity,
      delivered_quantity,quantity_delivered,unit_price,unit_cost_at_delivery,notes,uom_id,qty_entered,
      conversion_factor_snapshot,unit_price_entered,warehouse_id)
    VALUES(v_org,v_dn_id,v_inv_line.id,v_product,v_inv_line.quantity,v_qty_base,v_qty_base,v_inv_line.unit_price,
      v_unit_cost,NULLIF(v_line->>'notes',''),v_uom,v_qty_entered,v_factor,
      COALESCE(NULLIF(v_line->>'unit_price_entered','')::numeric,v_inv_line.unit_price*v_factor),v_warehouse);
    -- Cumulative weighted average across partial deliveries, so the generated
    -- invoice-line cogs equals the exact summed delivery COGS once fully delivered.
    UPDATE public.sales_invoice_lines
    SET delivered_quantity=v_inv_line.delivered+v_qty_base,
        unit_cost_at_sale=round(
          (v_inv_line.delivered*COALESCE(unit_cost_at_sale,0)+v_line_cogs)
          /(v_inv_line.delivered+v_qty_base),6)
    WHERE id=v_inv_line.id;
  END LOOP;

  IF v_total_cogs>0 THEN PERFORM public.rpc_post_event_journal('COGS_DELIVERY',v_total_cogs,
    'تكلفة بضاعة مباعة - '||v_dn_number,'DELIVERY_NOTE',v_dn_id,v_org,'COGS_DELIVERY:'||v_dn_id::text,NULL); END IF;
  UPDATE public.sales_invoices si SET delivery_status=CASE WHEN NOT EXISTS(
    SELECT 1 FROM public.sales_invoice_lines l WHERE l.invoice_id=si.id AND COALESCE(l.delivered_quantity,0)<l.quantity
  ) THEN 'fully_delivered' ELSE 'partially_delivered' END WHERE si.id=v_invoice_id;
  RETURN jsonb_build_object('success',true,'delivery_id',v_dn_id,'delivery_number',v_dn_number,
    'total_cogs',round(v_total_cogs,6),'lines_processed',v_line_no,'inventory_atomic',true,'uom_atomic',true,'warnings','[]'::jsonb);
END;
$function$;
-- ===== END INLINED m191-slices/06_delivery_note_fix_e.sql =====
-- ===== BEGIN INLINED m191-slices/07_submit_stock_adjustment_fix_e.sql =====
-- Wardah ERP / F2 / M191 review slice 07
-- Object 9 only: rpc_submit_stock_adjustment(uuid) — Fix E (stock adjustment).
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 187, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the existing adjustment header/status/approval gates, lock all
--     stock_adjustment_items rows for the adjustment in deterministic id order;
--   * derive the distinct product set from those already-locked rows;
--   * preserve the existing item-count/duplicate-line errors before invoking
--     the shared product helper, then acquire the complete product prefix once;
--   * inside the unchanged ordered item loop, fail closed if the row's product
--     is outside the prelocked set.
--
-- Preserved deliberately:
--   * adjustment header FOR UPDATE and org-admin authorization;
--   * SUBMITTED replay, status and approval validation/error order;
--   * ADJUSTMENT_REQUIRES_ITEMS and DUPLICATE_PRODUCT_WAREHOUSE_LINES semantics;
--   * ordered item loop, warehouse resolution, difference_qty behavior;
--   * M187 source-line-aware incoming/outgoing calls with v_item.id;
--   * ledger-derived actual/value totals, canonical GL mapping/posting;
--   * final adjustment status/totals/GL fields and return shape;
--   * SECURITY DEFINER and search_path = public,pg_temp;
--   * existing client-facing ACL is unchanged and is not restated here.
--
-- DISTINCT is deliberately outside the locking subquery: PostgreSQL rejects a
-- locking clause with DISTINCT in the same query level. The row locks are taken
-- first in ascending sai.id order. The product helper is intentionally delayed
-- until after the predecessor's count/duplicate validations so the new helper
-- cannot preempt those existing errors, while the validations themselves read a
-- row set already frozen by the pre-pass.

CREATE OR REPLACE FUNCTION public.rpc_submit_stock_adjustment(
  p_adjustment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_adj public.stock_adjustments%rowtype;
  v_item record;
  v_warehouse uuid;
  v_result jsonb;
  v_gl jsonb;
  v_debit uuid;
  v_credit uuid;
  v_amount numeric;
  v_signed_value numeric;
  v_actual_qty numeric;
  v_item_count integer;
  v_distinct_count integer;
  v_products uuid[];
  v_locked_products uuid[];
BEGIN
  SELECT * INTO v_adj
  FROM public.stock_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND'; END IF;

  v_adj.org_id := COALESCE(v_adj.org_id, v_adj.organization_id);
  PERFORM public.wardah_assert_org_admin(v_adj.org_id);

  IF v_adj.status = 'SUBMITTED' THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', true,
      'adjustment_id', v_adj.id,
      'gl_entry_id', v_adj.canonical_gl_entry_id
    );
  END IF;
  IF v_adj.status <> 'DRAFT' THEN RAISE EXCEPTION 'ADJUSTMENT_NOT_DRAFT'; END IF;
  IF COALESCE(v_adj.requires_approval, false) AND v_adj.approved_by IS NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_APPROVAL_REQUIRED';
  END IF;

  -- M191 Fix E: freeze the complete adjustment-item row set before any later
  -- product-sensitive work. DISTINCT is applied only after individual rows have
  -- been locked in deterministic id order.
  v_products := ARRAY(
    SELECT DISTINCT product_id
    FROM (
      SELECT sai.id, sai.product_id
      FROM public.stock_adjustment_items sai
      WHERE sai.adjustment_id = v_adj.id
      ORDER BY sai.id
      FOR UPDATE
    ) locked
  );

  SELECT count(*),
         count(DISTINCT ROW(product_id, COALESCE(warehouse_id, v_adj.warehouse_id)))
  INTO v_item_count, v_distinct_count
  FROM public.stock_adjustment_items
  WHERE adjustment_id = v_adj.id;

  IF v_item_count = 0 THEN RAISE EXCEPTION 'ADJUSTMENT_REQUIRES_ITEMS'; END IF;
  IF v_item_count <> v_distinct_count THEN
    RAISE EXCEPTION 'DUPLICATE_PRODUCT_WAREHOUSE_LINES';
  END IF;

  v_locked_products :=
    public.wardah_lock_products_for_stock_write(v_adj.org_id, v_products);

  FOR v_item IN
    SELECT *
    FROM public.stock_adjustment_items
    WHERE adjustment_id = v_adj.id
    ORDER BY id
  LOOP
    IF v_item.product_id IS NULL
       OR NOT COALESCE(v_item.product_id = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_item.product_id;
    END IF;

    v_warehouse := COALESCE(v_item.warehouse_id, v_adj.warehouse_id);
    IF v_warehouse IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;

    IF v_item.difference_qty > 0 THEN
      v_result := public.wardah_apply_stock_incoming(
        v_adj.org_id,
        v_item.product_id,
        v_warehouse,
        v_item.difference_qty,
        COALESCE(v_item.new_rate, v_item.current_rate, 0),
        'Stock Adjustment',
        v_adj.id,
        v_adj.adjustment_number,
        v_adj.posting_date,
        v_item.id
      );
      IF NOT COALESCE((v_result ->> 'applied')::boolean, false) THEN
        RAISE EXCEPTION 'STOCK_IN_NOT_APPLIED: %', v_result;
      END IF;
    ELSIF v_item.difference_qty < 0 THEN
      PERFORM public.wardah_apply_stock_outgoing(
        v_adj.org_id,
        v_item.product_id,
        v_warehouse,
        abs(v_item.difference_qty),
        'Stock Adjustment',
        v_adj.id,
        v_adj.adjustment_number,
        v_adj.posting_date,
        v_item.id
      );
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(actual_qty), 0),
         COALESCE(SUM(stock_value_difference), 0)
  INTO v_actual_qty, v_signed_value
  FROM public.stock_ledger_entries
  WHERE org_id = v_adj.org_id
    AND voucher_type = 'Stock Adjustment'
    AND voucher_id = v_adj.id
    AND COALESCE(is_cancelled, false) = false;

  v_amount := abs(v_signed_value);
  IF v_amount > 0 THEN
    IF v_adj.inventory_account_id IS NULL THEN
      RAISE EXCEPTION 'INVENTORY_ACCOUNT_REQUIRED';
    END IF;
    IF v_signed_value > 0 THEN
      IF v_adj.increase_account_id IS NULL THEN
        RAISE EXCEPTION 'INCREASE_ACCOUNT_REQUIRED';
      END IF;
      v_debit := v_adj.inventory_account_id;
      v_credit := v_adj.increase_account_id;
    ELSE
      IF v_adj.decrease_account_id IS NULL THEN
        RAISE EXCEPTION 'DECREASE_ACCOUNT_REQUIRED';
      END IF;
      v_debit := v_adj.decrease_account_id;
      v_credit := v_adj.inventory_account_id;
    END IF;

    v_gl := public.rpc_create_journal_entry(jsonb_build_object(
      'org_id', v_adj.org_id,
      'entry_date', v_adj.posting_date,
      'reference_type', 'Stock Adjustment',
      'reference_number', v_adj.adjustment_number,
      'description', v_adj.reason,
      'idempotency_key', 'stock-adjustment:' || v_adj.id::text,
      'auto_post', true,
      'lines', jsonb_build_array(
        jsonb_build_object(
          'line_number', 1,
          'account_id', v_debit,
          'debit', v_amount,
          'credit', 0,
          'description', v_adj.reason
        ),
        jsonb_build_object(
          'line_number', 2,
          'account_id', v_credit,
          'debit', 0,
          'credit', v_amount,
          'description', v_adj.reason
        )
      )
    ));
  END IF;

  UPDATE public.stock_adjustments
  SET status = 'SUBMITTED',
      total_qty_difference = v_actual_qty,
      total_value_difference = v_signed_value,
      submitted_by = auth.uid(),
      submitted_at = now(),
      canonical_gl_entry_id = NULLIF(v_gl ->> 'entry_id', '')::uuid,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = v_adj.id;

  RETURN jsonb_build_object(
    'success', true,
    'adjustment_id', v_adj.id,
    'actual_qty_difference', v_actual_qty,
    'actual_value_difference', v_signed_value,
    'gl_entry_id', NULLIF(v_gl ->> 'entry_id', '')::uuid
  );
END;
$function$;
-- ===== END INLINED m191-slices/07_submit_stock_adjustment_fix_e.sql =====
-- ===== BEGIN INLINED m191-slices/08_consume_reserved_materials_fix_e.sql =====
-- Wardah ERP / F2 / M191 review slice 08
-- Object 10 only: rpc_consume_reserved_materials_v2(uuid,uuid,jsonb) — Fix E.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 190, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the existing MO / exact-permission / stage-WIP gates, lock every
--     material_reservations row for the MO regardless of status, ascending id,
--     FOR NO KEY UPDATE;
--   * derive the product prefix from the now-frozen rows whose status is
--     'reserved', resolving the effective product with a NON-THROWING mirror of
--     wardah_resolve_product_id's own two lookups (see the C1 correction below);
--   * acquire the shared deterministic product prefix once before the loop;
--   * change both existing per-line reservation re-acquisitions from FOR UPDATE
--     to FOR NO KEY UPDATE so they match the superset lock instead of upgrading;
--   * after each line resolves v_product, fail closed if it is NULL or outside
--     the canonical prelocked product set.
--
-- Preserved deliberately:
--   * Migration 190 exact permission key and denial behavior;
--   * MO header FOR UPDATE and org-member guard;
--   * CONSUMPTIONS_REQUIRED, stage inference, stage-WIP validation/error order;
--   * per-line reservation selection rules (reservation_id branch vs item_id /
--     created_at,id first-reserved branch) and ACTIVE_RESERVATION_NOT_FOUND;
--   * live effective product expression COALESCE(product_id,
--     wardah_resolve_product_id(...)) AT ITS ORIGINAL M190 CALL SITE inside the
--     per-line loop — including its ITEM_PRODUCT_MAP_MISSING raise and that
--     error's original position relative to every other per-line error;
--
-- C1 correction (found by independent review, reproduced on PostgreSQL with a
-- positive control). An earlier revision of this slice called
-- wardah_resolve_product_id directly inside the superset. That function never
-- returns NULL: it raises ITEM_PRODUCT_MAP_MISSING when neither an active,
-- time-valid item_product_map row nor a same-org compatibility product exists.
-- Because the superset deliberately covers reservations the caller never named,
-- one unrelated 'reserved' row with a NULL product_id and no resolvable item was
-- enough to abort every consumption call for that MO — before any per-line
-- validation, so ACTIVE_RESERVATION_NOT_FOUND and the rest of M190's error order
-- could no longer be reached. The prefix must therefore resolve without raising.
-- The mirror below reproduces Migration 132's two lookups in its exact order and
-- with its exact predicates; it is deliberately NOT an EXCEPTION WHEN OTHERS
-- wrapper, which would also swallow ITEM_PRODUCT_CONTEXT_REQUIRED and unrelated
-- failures. An unresolvable reservation contributes nothing to the prefix and is
-- left entirely to the unchanged loop.
--   * UoM, quantity, remaining-reservation, warehouse/work-order validation;
--   * canonical outgoing stock helper call and COGS valuation;
--   * material_consumption insert, stage WIP accumulation, reservation update;
--   * return shape, SECURITY DEFINER, and search_path;
--   * existing client-facing ACL / wrapper behavior is unchanged here.

CREATE OR REPLACE FUNCTION public.rpc_consume_reserved_materials_v2(
  p_mo_id uuid,
  p_stage_id uuid,
  p_consumptions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid; v_mo_number text; v_stage uuid:=p_stage_id; v_wip_id uuid;
  v_row jsonb; v_res public.material_reservations%rowtype; v_product uuid;
  v_uom uuid; v_qty_entered numeric; v_qty_base numeric; v_factor numeric;
  v_warehouse uuid; v_count integer; v_remaining numeric; v_work_order uuid;
  v_stock jsonb; v_cogs numeric; v_total_cogs numeric:=0; v_unit_cost numeric;
  v_lock_res record;
  v_prefix_product uuid;
  v_products uuid[] := '{}'::uuid[];
  v_locked_products uuid[];
BEGIN
  SELECT org_id,order_number INTO v_org,v_mo_number
  FROM public.manufacturing_orders WHERE id=p_mo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;

  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT public.has_permission(
    auth.uid(), v_org, 'manufacturing.material_consumption.consume'
  ) THEN
    RAISE EXCEPTION 'MATERIAL_CONSUMPTION_PERMISSION_DENIED';
  END IF;

  IF jsonb_typeof(p_consumptions)<>'array' OR jsonb_array_length(p_consumptions)=0 THEN
    RAISE EXCEPTION 'CONSUMPTIONS_REQUIRED';
  END IF;

  IF v_stage IS NULL THEN
    v_stage:=NULLIF(p_consumptions->0->>'stage_id','')::uuid;
  END IF;
  IF v_stage IS NULL THEN
    SELECT count(*),(array_agg(stage_id ORDER BY stage_id))[1]
      INTO v_count,v_stage
    FROM public.stage_wip_log
    WHERE org_id=v_org AND mo_id=p_mo_id AND COALESCE(is_closed,false)=false
      AND CURRENT_DATE BETWEEN period_start AND period_end;
    IF v_count<>1 THEN RAISE EXCEPTION 'STAGE_REQUIRED_FOR_MATERIAL_CONSUMPTION'; END IF;
  END IF;

  SELECT id INTO v_wip_id FROM public.stage_wip_log
  WHERE org_id=v_org AND mo_id=p_mo_id AND stage_id=v_stage
    AND COALESCE(is_closed,false)=false
    AND CURRENT_DATE BETWEEN period_start AND period_end
  ORDER BY period_end DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OPEN_STAGE_WIP_LOG_NOT_FOUND'; END IF;

  -- M191 Fix E: freeze the complete existing reservation universe for this MO
  -- before deriving which products the unchanged per-line lookup can later use.
  -- Do not filter status in the locking query: an existing non-reserved row must
  -- not be able to flip to reserved after this snapshot and enter the loop.
  FOR v_lock_res IN
    SELECT id,mo_id,item_id,product_id,status
    FROM public.material_reservations
    WHERE org_id=v_org AND mo_id=p_mo_id
    ORDER BY id
    FOR NO KEY UPDATE
  LOOP
    IF v_lock_res.status<>'reserved' THEN
      CONTINUE;
    END IF;

    IF v_lock_res.product_id IS NOT NULL THEN
      v_products:=array_append(v_products,v_lock_res.product_id);
      CONTINUE;
    END IF;

    -- Non-throwing mirror of Migration 132's wardah_resolve_product_id: the
    -- active, time-valid mapping with the newest valid_from first, then the
    -- same-org compatibility product. Where the resolver would raise, this
    -- contributes nothing and the unchanged loop keeps the raise.
    SELECT m.product_id INTO v_prefix_product
    FROM public.item_product_map m
    WHERE m.org_id=v_org AND m.item_id=v_lock_res.item_id AND m.is_active
      AND m.valid_from<=now() AND (m.valid_to IS NULL OR m.valid_to>now())
    ORDER BY m.valid_from DESC
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT p.id INTO v_prefix_product
      FROM public.products p
      WHERE p.id=v_lock_res.item_id AND p.org_id=v_org;
    END IF;

    IF FOUND THEN
      v_products:=array_append(v_products,v_prefix_product);
    END IF;
  END LOOP;

  v_locked_products:=
    public.wardah_lock_products_for_stock_write(v_org,v_products);

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_consumptions) LOOP
    IF NULLIF(v_row->>'reservation_id','') IS NOT NULL THEN
      SELECT * INTO v_res FROM public.material_reservations
      WHERE id=(v_row->>'reservation_id')::uuid AND org_id=v_org
        AND mo_id=p_mo_id AND status='reserved' FOR NO KEY UPDATE;
    ELSE
      SELECT * INTO v_res FROM public.material_reservations
      WHERE org_id=v_org AND mo_id=p_mo_id
        AND item_id=(v_row->>'item_id')::uuid AND status='reserved'
      ORDER BY created_at,id LIMIT 1 FOR NO KEY UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_RESERVATION_NOT_FOUND'; END IF;

    v_product:=COALESCE(
      v_res.product_id,
      public.wardah_resolve_product_id(v_org,v_res.item_id,now())
    );
    IF v_product IS NULL
       OR NOT COALESCE(v_product = ANY(v_locked_products), false) THEN
      RAISE EXCEPTION 'PRODUCT_NOT_PRELOCKED: %', v_product;
    END IF;

    SELECT COALESCE(NULLIF(v_row->>'uom_id','')::uuid,v_res.uom_id,p.base_uom_id)
      INTO v_uom FROM public.products p WHERE p.id=v_product AND p.org_id=v_org;
    v_qty_entered:=NULLIF(v_row->>'quantity','')::numeric;
    IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN
      RAISE EXCEPTION 'INVALID_CONSUMPTION_QUANTITY';
    END IF;
    v_factor:=public.wardah_uom_factor(v_org,v_product,v_uom,now());
    v_qty_base:=round(v_qty_entered*v_factor,6);

    v_remaining:=v_res.quantity_reserved-COALESCE(v_res.quantity_consumed,0)-COALESCE(v_res.quantity_released,0);
    IF v_qty_base>v_remaining THEN
      RAISE EXCEPTION 'CONSUMPTION_EXCEEDS_RESERVATION: remaining=%, requested_base=%',
        v_remaining,v_qty_base;
    END IF;

    v_warehouse:=NULLIF(v_row->>'warehouse_id','')::uuid;
    IF v_warehouse IS NULL THEN
      SELECT count(*),(array_agg(warehouse_id ORDER BY warehouse_id))[1]
        INTO v_count,v_warehouse
      FROM public.bins
      WHERE org_id=v_org AND product_id=v_product AND actual_qty>=v_qty_base;
      IF v_count<>1 THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED_FOR_CONSUMPTION'; END IF;
    END IF;

    v_work_order:=NULLIF(v_row->>'work_order_id','')::uuid;
    IF v_work_order IS NULL THEN
      SELECT count(*),(array_agg(id ORDER BY id))[1]
        INTO v_count,v_work_order
      FROM public.work_orders
      WHERE org_id=v_org AND mo_id=p_mo_id AND status NOT IN ('COMPLETED','CANCELLED');
      IF v_count<>1 THEN RAISE EXCEPTION 'WORK_ORDER_REQUIRED_FOR_CONSUMPTION'; END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.work_orders
      WHERE id=v_work_order AND org_id=v_org AND mo_id=p_mo_id
    ) THEN
      RAISE EXCEPTION 'WORK_ORDER_NOT_FOUND_OR_WRONG_MO';
    END IF;

    v_stock:=public.wardah_apply_stock_outgoing(
      v_org,v_product,v_warehouse,v_qty_base,
      'Material Consumption',p_mo_id,v_mo_number,CURRENT_DATE
    );
    IF NOT COALESCE((v_stock->>'applied')::boolean,false) THEN
      RAISE EXCEPTION 'STOCK_OUT_NOT_APPLIED';
    END IF;
    v_cogs:=COALESCE((v_stock->>'cogs')::numeric,0);
    v_unit_cost:=CASE WHEN v_qty_base>0 THEN v_cogs/v_qty_base ELSE 0 END;

    INSERT INTO public.material_consumption(
      org_id,work_order_id,mo_id,item_id,product_id,reservation_id,stage_id,
      planned_quantity,consumed_quantity,consumption_type,warehouse_id,
      unit_cost,total_cost,status,consumption_date,notes,created_by,
      uom_id,qty_entered,conversion_factor_snapshot,stock_valuation_result
    ) VALUES (
      v_org,v_work_order,p_mo_id,v_res.item_id,v_product,v_res.id,v_stage,
      v_res.quantity_reserved,v_qty_base,COALESCE(NULLIF(v_row->>'consumption_type',''),'MANUAL'),v_warehouse,
      v_unit_cost,v_cogs,'POSTED',now(),NULLIF(v_row->>'notes',''),auth.uid(),
      v_uom,v_qty_entered,v_factor,v_stock
    );

    UPDATE public.stage_wip_log
    SET cost_material=COALESCE(cost_material,0)+v_cogs,updated_at=now(),updated_by=auth.uid()
    WHERE id=v_wip_id;

    UPDATE public.material_reservations
    SET product_id=v_product,uom_id=v_uom,
        qty_entered=COALESCE(qty_entered,quantity_reserved),
        conversion_factor_snapshot=COALESCE(conversion_factor_snapshot,1),
        quantity_consumed=COALESCE(quantity_consumed,0)+v_qty_base,
        status=CASE
          WHEN COALESCE(quantity_consumed,0)+v_qty_base+COALESCE(quantity_released,0)>=quantity_reserved
          THEN 'consumed' ELSE 'reserved' END,
        consumed_at=now(),updated_at=now()
    WHERE id=v_res.id;

    v_total_cogs:=v_total_cogs+v_cogs;
  END LOOP;

  RETURN jsonb_build_object(
    'success',true,'mo_id',p_mo_id,'stage_id',v_stage,
    'stage_wip_log_id',v_wip_id,
    'consumption_count',jsonb_array_length(p_consumptions),
    'material_cost_posted',round(v_total_cogs,6),
    'inventory_atomic',true,'wip_cost_atomic',true,'uom_atomic',true
  );
END;
$function$;
-- ===== END INLINED m191-slices/08_consume_reserved_materials_fix_e.sql =====
-- ===== BEGIN INLINED m191-slices/09_release_expired_reservations_fix_f.sql =====
-- Wardah ERP / F2 / M191 review slice 09
-- Object 11 only: release_expired_reservations(uuid) — Fix F.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 61 plus the current out-of-band
-- search_path hardening, as fixed by the M191 source/evidence matrix.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized change in this slice only:
--   * replace the predecessor's unordered multi-row UPDATE acquisition with an
--     ordered lock-then-update: first capture every row that qualifies at this
--     call's lock snapshot in ascending material_reservations.id order using
--     FOR NO KEY UPDATE, then update exactly those locked ids.
--
-- Preserved deliberately:
--   * SECURITY INVOKER (no SECURITY DEFINER is introduced);
--   * current search_path = public,pg_temp hardening;
--   * p_org_id NULL means all organizations; a non-NULL value scopes by org_id;
--   * eligibility remains status='reserved', expires_at IS NOT NULL, expires_at
--     < now();
--   * status/released_at/quantity_released/updated_at assignments are unchanged;
--   * quantity_released remains exactly quantity_reserved - quantity_consumed,
--     including the predecessor's existing NULL propagation;
--   * return value remains the number of rows updated;
--   * no SKIP LOCKED / best-effort semantics;
--   * existing PUBLIC/anon/authenticated/service_role ACL is unchanged and is
--     intentionally not restated in this review fragment.

CREATE OR REPLACE FUNCTION public.release_expired_reservations(
  p_org_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
BEGIN
  -- M191 Fix F: consume and release must acquire material_reservations rows in
  -- the same deterministic id order. Lock the complete qualifying set first;
  -- do not use SKIP LOCKED, because this function remains an exact sweep rather
  -- than a best-effort cron pass.
  FOR v_id IN
    SELECT mr.id
    FROM public.material_reservations mr
    WHERE mr.status = 'reserved'
      AND mr.expires_at IS NOT NULL
      AND mr.expires_at < now()
      AND (p_org_id IS NULL OR mr.org_id = p_org_id)
    ORDER BY mr.id
    FOR NO KEY UPDATE
  LOOP
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  -- Update the frozen, already-locked id set. Do not re-run the eligibility
  -- predicate here: the ordered locking pass is the authoritative snapshot for
  -- this call, and no other transaction can mutate a captured row before this
  -- update completes.
  UPDATE public.material_reservations
  SET status = 'expired',
      released_at = now(),
      quantity_released = quantity_reserved - quantity_consumed,
      updated_at = now()
  WHERE id = ANY(v_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
-- ===== END INLINED m191-slices/09_release_expired_reservations_fix_f.sql =====
-- ===== BEGIN INLINED m191-slices/10_create_mo_with_reservation_fix_g.sql =====
-- Wardah ERP / F2 / M191 review slice 10
-- Object 12 only: rpc_create_mo_with_reservation(jsonb,jsonb,uuid) — Fix G.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. Source authority: Migration 186, confirmed by the M191
-- design/source matrix as the live predecessor.
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
--
-- Authorized changes in this slice only:
--   * after the predecessor's complete material-validation pass and before any
--     stock lock, capture one ordered resolved-demand snapshot containing one
--     row per original material line;
--   * derive the complete distinct product prefix from that snapshot only and
--     acquire it through wardah_lock_products_for_stock_write before any bins
--     lock;
--   * drive bins/availability grouping and reservation persistence from the
--     captured snapshot, with no later resolver deciding product identity;
--   * after each material_reservations INSERT, compare RETURNING product_id
--     (after the live BEFORE trigger) to that line's exact captured identity and
--     fail closed with ITEM_PRODUCT_MAPPING_DRIFT on any mismatch.
--
-- Preserved deliberately:
--   * tenant derivation, org-member authorization and INVALID_MATERIALS behavior;
--   * the complete predecessor validation pass and its INVALID_MATERIAL errors;
--   * wardah_resolve_product_id(v_org,item_id,now()) semantics at capture time;
--   * per-product availability math, ordered all-bin FOR UPDATE footprint and
--     INSUFFICIENT_STOCK payload/error shape;
--   * MO status/number derivation and MO creation placement after availability;
--   * exactly one reservation INSERT per original input line, in input order;
--   * base-UoM lookup, quantity/expires_at persistence and reservation count;
--   * return shape, SECURITY DEFINER and search_path;
--   * existing authenticated + service_role client-facing ACL is unchanged and
--     intentionally not restated in this review fragment;
--   * no production advisory/test gates are introduced.
--
-- Important: a membership-only check against the prelocked product set is NOT a
-- mapping-drift check. A legal X<->Y mapping swap can stay entirely inside that
-- set. The authoritative comparison is captured per-line identity versus the
-- post-trigger product_id returned by INSERT.

CREATE OR REPLACE FUNCTION public.rpc_create_mo_with_reservation(
  p_order jsonb,
  p_materials jsonb DEFAULT '[]'::jsonb,
  p_tenant uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_mo_id uuid;
  v_mo_number text;
  v_mat jsonb;
  v_item_id uuid;
  v_item_ids jsonb;
  v_product_id uuid;
  v_persisted_product_id uuid;
  v_uom_id uuid;
  v_qty numeric;
  v_on_hand numeric;
  v_bin_reserved numeric;
  v_mo_reserved numeric;
  v_avail numeric;
  v_insufficient jsonb := '[]'::jsonb;
  v_reserved integer := 0;
  v_init_status text;
  v_ordinal bigint;
  v_demand_snapshot jsonb := '[]'::jsonb;
  v_products uuid[];
BEGIN
  v_org := public.wardah_org_id(
    COALESCE(NULLIF(p_order ->> 'org_id', '')::uuid, p_tenant)
  );
  PERFORM public.wardah_assert_org_member(v_org);

  IF jsonb_typeof(COALESCE(p_materials, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_MATERIALS: p_materials must be a JSON array';
  END IF;

  -- Preserve Migration 186's complete validation pass before resolution/locks.
  FOR v_mat IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    BEGIN
      v_item_id := NULLIF(v_mat ->> 'item_id', '')::uuid;
      v_qty := NULLIF(v_mat ->> 'quantity', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_MATERIAL: item_id and quantity must be valid values';
    END;

    IF jsonb_typeof(v_mat) <> 'object' OR v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_MATERIAL: item_id and a positive quantity are required';
    END IF;
  END LOOP;

  -- M191 Fix G: resolve every original line exactly once, after all predecessor
  -- validation and before any products/bins lock. Keep fields needed later by
  -- the reservation INSERT without moving their predecessor casts earlier.
  FOR v_ordinal, v_mat IN
    SELECT ordinality::bigint, entry
    FROM jsonb_array_elements(p_materials)
      WITH ORDINALITY AS materials(entry, ordinality)
    ORDER BY ordinality
  LOOP
    v_item_id := (v_mat ->> 'item_id')::uuid;
    v_qty := (v_mat ->> 'quantity')::numeric;
    v_product_id := public.wardah_resolve_product_id(v_org, v_item_id, now());

    v_demand_snapshot := v_demand_snapshot || jsonb_build_array(
      jsonb_build_object(
        'ordinal', v_ordinal,
        'item_id', v_item_id,
        'quantity', v_qty,
        'resolved_product_id', v_product_id,
        'expires_at', v_mat ->> 'expires_at'
      )
    );
  END LOOP;

  -- Complete transaction-wide product prefix, derived only from the captured
  -- identities. The shared helper canonicalizes/deduplicates and locks products
  -- ascending by id using FOR NO KEY UPDATE.
  v_products := ARRAY(
    SELECT DISTINCT (entry ->> 'resolved_product_id')::uuid
    FROM jsonb_array_elements(v_demand_snapshot) AS snapshot(entry)
    ORDER BY (entry ->> 'resolved_product_id')::uuid
  );
  PERFORM public.wardah_lock_products_for_stock_write(v_org, v_products);

  -- Availability is grouped from the same captured snapshot. No resolver is
  -- called here, so a mapping change after capture cannot redirect bins work.
  FOR v_product_id, v_qty, v_item_ids IN
    SELECT
      (entry ->> 'resolved_product_id')::uuid AS product_id,
      SUM((entry ->> 'quantity')::numeric),
      to_jsonb(array_agg(
        DISTINCT (entry ->> 'item_id')::uuid
        ORDER BY (entry ->> 'item_id')::uuid
      ))
    FROM jsonb_array_elements(v_demand_snapshot) AS snapshot(entry)
    GROUP BY (entry ->> 'resolved_product_id')::uuid
    ORDER BY (entry ->> 'resolved_product_id')::uuid
  LOOP
    PERFORM 1
    FROM public.bins
    WHERE org_id = v_org AND product_id = v_product_id
    ORDER BY warehouse_id, id
    FOR UPDATE;

    SELECT COALESCE(SUM(actual_qty), 0), COALESCE(SUM(reserved_qty), 0)
    INTO v_on_hand, v_bin_reserved
    FROM public.bins
    WHERE org_id = v_org AND product_id = v_product_id;

    SELECT COALESCE(SUM(
      GREATEST(
        quantity_reserved - COALESCE(quantity_consumed, 0) - COALESCE(quantity_released, 0),
        0
      )
    ), 0)
    INTO v_mo_reserved
    FROM public.material_reservations
    WHERE org_id = v_org
      AND product_id = v_product_id
      AND status = 'reserved';

    v_avail := v_on_hand - v_bin_reserved - v_mo_reserved;
    IF v_avail < v_qty THEN
      v_insufficient := v_insufficient || jsonb_build_object(
        'item_ids', v_item_ids,
        'product_id', v_product_id,
        'required', v_qty,
        'available', v_avail
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_insufficient) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: مواد غير كافية: %', v_insufficient::text;
  END IF;

  v_init_status := public.normalize_mo_status(COALESCE(p_order ->> 'status', 'draft'));
  v_mo_number := COALESCE(
    NULLIF(p_order ->> 'order_number', ''),
    'MO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.mo_seq')::text, 4, '0')
  );

  INSERT INTO public.manufacturing_orders (
    org_id, order_number, product_id, item_id, quantity,
    status, notes, start_date, due_date
  )
  VALUES (
    v_org,
    v_mo_number,
    NULLIF(p_order ->> 'product_id', '')::uuid,
    NULLIF(p_order ->> 'item_id', '')::uuid,
    COALESCE(NULLIF(p_order ->> 'quantity', '')::numeric, 0),
    v_init_status,
    NULLIF(p_order ->> 'notes', ''),
    NULLIF(p_order ->> 'start_date', '')::date,
    NULLIF(p_order ->> 'due_date', '')::date
  )
  RETURNING id INTO v_mo_id;

  -- Persist one reservation per original line, in captured ordinal order. The
  -- live BEFORE trigger may re-resolve product_id from item_id; RETURNING sees
  -- that post-trigger identity, so compare it exactly to the captured product.
  FOR v_mat IN
    SELECT entry
    FROM jsonb_array_elements(v_demand_snapshot) AS snapshot(entry)
    ORDER BY (entry ->> 'ordinal')::bigint
  LOOP
    v_item_id := (v_mat ->> 'item_id')::uuid;
    v_qty := (v_mat ->> 'quantity')::numeric;
    v_product_id := (v_mat ->> 'resolved_product_id')::uuid;

    SELECT base_uom_id INTO v_uom_id
    FROM public.products
    WHERE id = v_product_id AND org_id = v_org;

    INSERT INTO public.material_reservations (
      org_id, mo_id, item_id, product_id,
      quantity_reserved, status, expires_at,
      uom_id, qty_entered, conversion_factor_snapshot
    )
    VALUES (
      v_org, v_mo_id, v_item_id, v_product_id,
      v_qty, 'reserved', NULLIF(v_mat ->> 'expires_at', '')::timestamptz,
      v_uom_id, v_qty, 1
    )
    RETURNING product_id INTO v_persisted_product_id;

    IF v_persisted_product_id IS DISTINCT FROM v_product_id THEN
      RAISE EXCEPTION
        'ITEM_PRODUCT_MAPPING_DRIFT: item=%, captured=%, persisted=%',
        v_item_id, v_product_id, v_persisted_product_id;
    END IF;

    v_reserved := v_reserved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'mo_id', v_mo_id,
    'mo_number', v_mo_number,
    'status', v_init_status,
    'materials_reserved', v_reserved
  );
END;
$function$;
-- ===== END INLINED m191-slices/10_create_mo_with_reservation_fix_g.sql =====

-- =============================================================================
-- SLICE 11/B — SECURITY / ACL / S1 POSTFLIGHT
-- Source: docs/db/m191-slices/11_acl_security_postflight.sql @ e5f2908...
-- Runs after all thirteen object definitions and all slice-local ACL statements.
-- =============================================================================
DO $m191_security_postflight$
DECLARE
  v_pre record;
  v_sig text;
  v_oid oid;
  v_helper_oid oid;
  v_caller_owner oid;
  v_current_owner oid;
  v_current_definer boolean;
  v_current_config text[];
  v_current_acl jsonb;
  v_def text;
BEGIN
  -- 1) Exact catalog carry-forward for all twelve predecessor signatures.
  FOR v_pre IN
    SELECT *
    FROM pg_temp.m191_pre_function_security_contract
    ORDER BY signature
  LOOP
    v_oid := to_regprocedure(v_pre.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'M191_SECURITY_FUNCTION_MISSING_POST: %', v_pre.signature;
    END IF;
    IF v_oid IS DISTINCT FROM v_pre.function_oid THEN
      RAISE EXCEPTION 'M191_SECURITY_FUNCTION_OID_DRIFT: % pre=% post=%',
        v_pre.signature, v_pre.function_oid, v_oid;
    END IF;

    SELECT
      p.proowner,
      p.prosecdef,
      p.proconfig,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'grantee', a.grantee,
              'grantor', a.grantor,
              'privilege_type', a.privilege_type,
              'is_grantable', a.is_grantable
            )
            ORDER BY a.grantee, a.grantor, a.privilege_type, a.is_grantable
          )
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
        ),
        '[]'::jsonb
      )
    INTO v_current_owner, v_current_definer, v_current_config, v_current_acl
    FROM pg_proc p
    WHERE p.oid = v_oid;

    IF v_current_owner IS DISTINCT FROM v_pre.owner_oid THEN
      RAISE EXCEPTION 'M191_SECURITY_OWNER_DRIFT: %', v_pre.signature;
    END IF;
    IF v_current_definer IS DISTINCT FROM v_pre.security_definer THEN
      RAISE EXCEPTION 'M191_SECURITY_MODE_DRIFT: %', v_pre.signature;
    END IF;
    IF v_current_config IS DISTINCT FROM v_pre.proconfig THEN
      RAISE EXCEPTION 'M191_SECURITY_CONFIG_DRIFT: % pre=% post=%',
        v_pre.signature, v_pre.proconfig, v_current_config;
    END IF;
    IF v_current_acl IS DISTINCT FROM v_pre.acl_norm THEN
      RAISE EXCEPTION 'M191_SECURITY_ACL_DRIFT: % pre=% post=%',
        v_pre.signature, v_pre.acl_norm, v_current_acl;
    END IF;
  END LOOP;

  -- 2) Four canonical stock helpers remain client-closed/service_role-only.
  FOREACH v_sig IN ARRAY ARRAY[
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)',
    'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
  ]
  LOOP
    v_oid := to_regprocedure(v_sig);
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'M191_STOCK_HELPER_ACL_VIOLATION: %', v_sig;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) AS a
      WHERE p.oid = v_oid
        AND a.grantee = 0
        AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'M191_STOCK_HELPER_PUBLIC_EXECUTE_REMAINS: %', v_sig;
    END IF;
  END LOOP;

  -- 3) New helper contract and caller-owner executability.
  v_helper_oid := to_regprocedure(
    'public.wardah_lock_products_for_stock_write(uuid,uuid[])'
  );
  IF v_helper_oid IS NULL THEN
    RAISE EXCEPTION 'M191_PRODUCT_LOCK_HELPER_MISSING';
  END IF;

  SELECT p.proowner, p.prosecdef, p.proconfig
  INTO v_current_owner, v_current_definer, v_current_config
  FROM pg_proc p
  WHERE p.oid = v_helper_oid;

  IF v_current_definer THEN
    RAISE EXCEPTION 'M191_PRODUCT_LOCK_HELPER_MUST_BE_SECURITY_INVOKER';
  END IF;
  IF NOT ('search_path=public, pg_temp' = ANY(COALESCE(v_current_config, '{}'::text[]))) THEN
    RAISE EXCEPTION 'M191_PRODUCT_LOCK_HELPER_SEARCH_PATH_DRIFT: %', v_current_config;
  END IF;
  IF has_function_privilege('anon', v_helper_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_helper_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_helper_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_current_owner, v_helper_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_PRODUCT_LOCK_HELPER_ACL_VIOLATION';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) AS a
    WHERE p.oid = v_helper_oid
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'M191_PRODUCT_LOCK_HELPER_PUBLIC_EXECUTE_REMAINS';
  END IF;

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
    'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'
  ]
  LOOP
    v_oid := to_regprocedure(v_sig);
    SELECT p.proowner INTO v_caller_owner FROM pg_proc p WHERE p.oid = v_oid;
    IF v_caller_owner IS NULL
       OR NOT has_function_privilege(v_caller_owner, v_helper_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'M191_PRODUCT_LOCK_HELPER_CALLER_OWNER_CANNOT_EXECUTE: % owner=%',
        v_sig, v_caller_owner;
    END IF;
  END LOOP;

  -- 4) Fix F historical EXECUTE surface remains unchanged.
  v_oid := to_regprocedure('public.release_expired_reservations(uuid)');
  SELECT p.prosecdef, p.proconfig
  INTO v_current_definer, v_current_config
  FROM pg_proc p WHERE p.oid = v_oid;
  IF v_current_definer THEN
    RAISE EXCEPTION 'M191_RELEASE_EXPIRED_MUST_BE_SECURITY_INVOKER';
  END IF;
  IF NOT ('search_path=public, pg_temp' = ANY(COALESCE(v_current_config, '{}'::text[]))) THEN
    RAISE EXCEPTION 'M191_RELEASE_EXPIRED_SEARCH_PATH_DRIFT: %', v_current_config;
  END IF;
  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_RELEASE_EXPIRED_ACL_DRIFT';
  END IF;

  -- 5) Fix G client-facing ACL + Fix C client ACL.
  v_oid := to_regprocedure('public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)');
  SELECT p.prosecdef, p.proconfig
  INTO v_current_definer, v_current_config
  FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT v_current_definer THEN
    RAISE EXCEPTION 'M191_CREATE_MO_RESERVATION_MUST_BE_SECURITY_DEFINER';
  END IF;
  IF NOT ('search_path=public, pg_temp' = ANY(COALESCE(v_current_config, '{}'::text[]))) THEN
    RAISE EXCEPTION 'M191_CREATE_MO_RESERVATION_SEARCH_PATH_DRIFT: %', v_current_config;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_CREATE_MO_RESERVATION_ACL_VIOLATION';
  END IF;

  v_oid := to_regprocedure('public.rpc_cancel_stock_adjustment(uuid,text)');
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_CANCEL_ADJUSTMENT_ACL_VIOLATION';
  END IF;

  -- 6) S1 header FOR UPDATE + child FKs.
  v_def := regexp_replace(
    pg_get_functiondef('public.rpc_submit_stock_adjustment(uuid)'::regprocedure),
    E'[\\n\\r\\t ]+', ' ', 'g'
  );
  IF v_def !~* 'FROM public\.stock_adjustments WHERE id *= *p_adjustment_id FOR UPDATE' THEN
    RAISE EXCEPTION 'M191_S1_ADJUSTMENT_HEADER_FOR_UPDATE_MISSING';
  END IF;

  v_def := regexp_replace(
    pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure),
    E'[\\n\\r\\t ]+', ' ', 'g'
  );
  IF v_def !~* 'FROM public\.manufacturing_orders WHERE id *= *p_mo_id FOR UPDATE' THEN
    RAISE EXCEPTION 'M191_S1_MO_HEADER_FOR_UPDATE_MISSING';
  END IF;

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
    RAISE EXCEPTION 'M191_S1_ADJUSTMENT_ITEMS_HEADER_FK_MISSING';
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
    RAISE EXCEPTION 'M191_S1_MATERIAL_RESERVATIONS_MO_FK_MISSING';
  END IF;

  -- 7) Separate-debt boundary: do not mutate stock_adjustment_items ACL.
  IF EXISTS (
    SELECT 1
    FROM pg_temp.m191_pre_table_acl_scope pre
    JOIN pg_class c ON c.oid = pre.table_oid
    WHERE c.relacl IS DISTINCT FROM pre.relacl
  ) THEN
    RAISE EXCEPTION 'M191_STOCK_ADJUSTMENT_ITEMS_TABLE_ACL_SCOPE_VIOLATION';
  END IF;
END
$m191_security_postflight$;

COMMIT;
