-- Wardah ERP / F2 / M191 review slice 11
-- Step 10 only: exact ACL/security pre-capture + postflight.
--
-- REVIEW FRAGMENT ONLY. Not a standalone migration and deliberately outside
-- sql/migrations/. This file has TWO placement sections:
--   A) PRE-REPLACE CAPTURE goes after M191's existing prerequisite preflight
--      and before the first CREATE OR REPLACE / helper creation.
--   B) POSTFLIGHT goes after all 13 object definitions/ACL statements and
--      before the final migration COMMIT.
--
-- Security source of truth is the database catalog at migration start, not
-- historical GRANT text in predecessor migration files. The pre-capture stores
-- normalized effective ACL rows, owner, SECURITY mode, and per-function config
-- for all twelve predecessor signatures; postflight requires exact equality.
--
-- Intentional hard invariants in addition to exact carry-forward:
--   * four canonical stock helpers remain client-closed and service_role-only;
--   * new wardah_lock_products_for_stock_write is SECURITY INVOKER,
--     search_path=public,pg_temp, client-closed, service_role executable, and
--     executable by every SECURITY DEFINER caller owner that invokes it;
--   * release_expired_reservations deliberately retains its current effective
--     anon/authenticated/service_role EXECUTE surface and current hardened
--     search_path. Fix F is lock-order-only; this is explicit carry-forward,
--     not an endorsement of anon exposure;
--   * rpc_create_mo_with_reservation remains client-facing: authenticated and
--     service_role retain EXECUTE, anon does not;
--   * rpc_cancel_stock_adjustment remains authenticated + service_role and not
--     anon, as required by Fix C's design contract;
--   * S1 header locks remain FOR UPDATE and both child->header FKs remain;
--   * stock_adjustment_items table ACL is compared pre/post only to prove M191
--     did not widen or narrow that separate security debt. M191 does not repair
--     or bless the existing anon table grant.
--
-- check_definer_guards.py is a separate CI/static gate. This fragment does not
-- replace it and must not be cited as proof that the Python gate ran.

-- =============================================================================
-- A) PRE-REPLACE CAPTURE — place before any M191 function replacement/creation.
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

-- This is scope evidence only. The known stock_adjustment_items anon grant is
-- separate security debt; preserving relacl here means only "M191 did not touch
-- it", not "the grant is acceptable".
CREATE TEMP TABLE m191_pre_table_acl_scope (
  table_oid oid PRIMARY KEY,
  relacl aclitem[]
) ON COMMIT DROP;

INSERT INTO m191_pre_table_acl_scope(table_oid, relacl)
SELECT c.oid, c.relacl
FROM pg_class c
WHERE c.oid = 'public.stock_adjustment_items'::regclass;

-- =============================================================================
-- B) POSTFLIGHT — place after all 13 M191 objects and ACL statements.
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
  -- CREATE OR REPLACE must not silently change owner, SECURITY mode,
  -- per-function settings, or normalized ACL semantics.
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

  -- 2) Four canonical stock helpers: positive hard invariant, not only
  -- pre/post equality. They are internal stock-write helpers and must remain
  -- unreachable by PUBLIC-derived anon/authenticated privileges.
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

  -- 3) New shared helper: SECURITY INVOKER, hardened search_path, no client
  -- EXECUTE, service_role allowed. Also prove every SECURITY DEFINER caller
  -- owner that invokes the helper can execute it; checking only the helper's
  -- own owner would miss a future mixed-owner deployment.
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

  -- 4) Fix F's broad historical EXECUTE surface is intentionally unchanged.
  -- This assertion makes anon preservation explicit so it cannot be mistaken
  -- for an omitted postflight check. Closing it is separate security scope.
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

  -- 5) Fix G remains client-facing. Do not apply service_role-only helper ACL.
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

  -- Fix C's client ACL was explicitly called out by design review.
  v_oid := to_regprocedure('public.rpc_cancel_stock_adjustment(uuid,text)');
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M191_CANCEL_ADJUSTMENT_ACL_VIOLATION';
  END IF;

  -- 6) S1: parent FOR UPDATE is part of predicate-membership stability. Never
  -- weaken these two header locks to FOR NO KEY UPDATE while the child FK is
  -- the mechanism that blocks phantom child inserts.
  v_def := regexp_replace(
    pg_get_functiondef('public.rpc_submit_stock_adjustment(uuid)'::regprocedure),
    E'[\\n\\r\\t ]+', ' ', 'g'
  );
  IF v_def !~* 'FROM public\\.stock_adjustments WHERE id *= *p_adjustment_id FOR UPDATE' THEN
    RAISE EXCEPTION 'M191_S1_ADJUSTMENT_HEADER_FOR_UPDATE_MISSING';
  END IF;

  v_def := regexp_replace(
    pg_get_functiondef('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'::regprocedure),
    E'[\\n\\r\\t ]+', ' ', 'g'
  );
  IF v_def !~* 'FROM public\\.manufacturing_orders WHERE id *= *p_mo_id FOR UPDATE' THEN
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

  -- 7) Separate debt boundary: M191 must not mutate stock_adjustment_items ACL.
  -- Exact relacl equality does not approve the existing anon grant; it proves
  -- only that this concurrency migration did not silently absorb that work.
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
