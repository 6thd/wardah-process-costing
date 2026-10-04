-- Wardah ERP / F2 / Migration 191 — ASSEMBLED CANDIDATE
--
-- REVIEW / FRESH-DB ACCEPTANCE ARTIFACT ONLY.
-- Deliberately outside sql/migrations/. Do not apply to Production or Staging.
--
-- Assembly source head: e5f2908ab27ebf0077a503682f63d81d49870c17
-- Order invariant:
--   preflight -> Slice 11/A -> helper -> slices 01..10 (including their exact
--   slice-local ACL restatements) -> Slice 11/B -> COMMIT
--
-- The ten implementation slices are included with psql \ir so their reviewed
-- bytes are executed verbatim. This driver changes placement only; it does not
-- rewrite any implementation body. All ACL statements from those slices have
-- completed before Slice 11/B runs.

\set ON_ERROR_STOP on

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
\ir m191-slices/01_incoming_fix_a_b.sql
\ir m191-slices/02_outgoing_8_9.sql
\ir m191-slices/03_cancel_fix_c.sql
\ir m191-slices/04_manual_movement_fix_d.sql
\ir m191-slices/05_goods_receipt_fix_e.sql
\ir m191-slices/06_delivery_note_fix_e.sql
\ir m191-slices/07_submit_stock_adjustment_fix_e.sql
\ir m191-slices/08_consume_reserved_materials_fix_e.sql
\ir m191-slices/09_release_expired_reservations_fix_f.sql
\ir m191-slices/10_create_mo_with_reservation_fix_g.sql

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
