-- Wardah ERP / F2 / Migration 191 — WORKING IMPLEMENTATION DRAFT
--
-- REVIEW ARTIFACT ONLY. This file is deliberately outside sql/migrations so it
-- cannot be applied by the migration runner while implementation is incomplete.
-- It will be promoted to sql/migrations/191_f2_stock_write_concurrency_closure.sql
-- only after all twelve predecessor bodies, static gates, rollback, and GREEN
-- acceptance are present and reviewed.
--
-- Base: main@1d8221a5cc07c6f18e93820a464512f0860a230a
-- Design authority: docs/F2_STOCK_BIN_RACE_FIX_DESIGN.md
-- Evidence authority: docs/F2_M191_IMPLEMENTATION_EVIDENCE_GATES.md
-- Hard prerequisite: Migration 190 material-consumption authorization boundary.
--
-- Scope is fixed at 13 objects = 12 predecessor bodies + 1 new helper.
-- No Production/Staging execution is authorized by this draft.

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '10min';

-- -----------------------------------------------------------------------------
-- PRE-IMPLEMENTATION PREFLIGHT
-- -----------------------------------------------------------------------------
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

  -- Twelve predecessor bodies. Exact signatures are intentional.
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

  -- Migration 190 is a hard prerequisite. Do not silently carry an older
  -- consumption body into 191.
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

-- -----------------------------------------------------------------------------
-- OBJECT 13 / NEW SHARED HELPER
-- -----------------------------------------------------------------------------
-- Universal transaction-wide product prefix. Multi-product callers resolve
-- their complete product set first and call this exactly once before any bins
-- work. Single-product stock writers may call it with ARRAY[p_product].
--
-- The ordered locking query itself contains ORDER BY p.id immediately before
-- FOR NO KEY UPDATE. Do not replace this with array_agg(... FOR UPDATE):
-- PostgreSQL rejects locking clauses on aggregate/DISTINCT result rows.
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

-- -----------------------------------------------------------------------------
-- IMPLEMENTATION ORDER / FIXED OBJECT MATRIX
-- -----------------------------------------------------------------------------
--  1. incoming 9-arg     <- M97   : Fix A/B + product prefix
--  2. incoming 10-arg    <- M187  : Fix A/B + product prefix + source_line
--  3. outgoing 8-arg     <- M186  : product prefix only
--  4. outgoing 9-arg     <- M187  : product prefix only + source_line
--  5. cancel adjustment  <- M124  : Fix C complete distinct product prefix
--  6. manual movement v2 <- M134  : Fix D prefix before warehouse/bin inference
--  7. goods receipt      <- M177  : Fix E non-throwing complete prepass
--  8. delivery note      <- M133  : Fix E locked SIL prepass + fresh loop reads
--  9. submit adjustment  <- M187  : Fix E lock item rows, then product prefix
-- 10. consume v2         <- M190  : Fix E reservation superset + M190 auth intact
-- 11. release expired    <- M61 + current hardening : Fix F only
-- 12. create MO/reserve  <- M186  : Fix G captured identity + drift fail-closed
-- 13. shared helper      <- NEW   : implemented above
--
-- The working draft intentionally stops here for the first review slice.
-- Subsequent commits append bodies 1-12 in this exact order. The file stays
-- outside sql/migrations until all bodies + ACL postflight + rollback evidence
-- are complete; therefore this COMMIT is intentionally absent in this draft.

-- NO COMMIT: review-only working artifact.
