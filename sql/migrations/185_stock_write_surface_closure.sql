-- 185_stock_write_surface_closure
--
-- Round 3 (inventory integrity) finding INV-05: stock_ledger_entries is the
-- legal inventory ledger and bins is its derived per-(product, warehouse)
-- balance (see CLAUDE.md, "Inventory architecture"). Every legitimate write
-- to either table already goes through a SECURITY DEFINER RPC
-- (rpc_post_goods_receipt, rpc_create/submit/cancel_stock_adjustment,
-- rpc_manual_stock_movement_v2, rpc_consume_reserved_materials_v2, or the
-- internal wardah_apply_stock_incoming/outgoing helpers they call) — these
-- run as the function owner and do not depend on the caller's table-level
-- grants at all.
--
-- Despite that, a read-only audit on 2026-08-30 found authenticated and
-- anon still held table-level INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
-- TRIGGER on both tables. Today RLS happens to block a direct write anyway,
-- because neither table has a permissive policy for those commands — but
-- that is an emergent, fragile property, not a designed one: the day a
-- policy is added for any of those commands (for a read-model view, a
-- reporting join, anything), the untouched grant combines with it
-- immediately and a direct client write bypasses the ledger. This is the
-- same latent gap Migration 176 closed on the RBAC tables: RLS and
-- privileges are independent layers, and a missing policy is not a
-- substitute for revoking the grant.
--
-- This migration closes only that gap. It does not touch:
--   * warehouses. A live UI consumer path performs direct INSERT/UPDATE/
--     DELETE against it; closing that grant needs its own consumer
--     inventory and contract decision, not this migration.
--   * service_role, and authenticated's SELECT on both tables — the
--     admin/report surfaces still read stock_ledger_entries and bins
--     directly under RLS; only the write privileges are removed.
--   * the MAINTAIN privilege PostgreSQL 17 also grants by default on both
--     tables to both roles (VACUUM/ANALYZE/CLUSTER/REINDEX, not a data
--     write). REVOKE ALL removes it from anon as a side effect; it is left
--     on authenticated pending a separate, explicit decision — this
--     migration's authorized scope names INSERT/UPDATE/DELETE/TRUNCATE/
--     REFERENCES/TRIGGER only.
--
-- consume_materials_for_mo and update_warehouse_gl_mapping are revoked from
-- anon because neither has a legitimate anon caller, not because either is
-- otherwise dangerous today: consume_materials_for_mo is SECURITY INVOKER
-- with no org-membership guard of its own (RLS on material_reservations is
-- what actually scopes its UPDATE) and its INSERT INTO stock_moves targets
-- a table that does not exist in this schema, so it fails closed today
-- regardless of caller. update_warehouse_gl_mapping is also SECURITY
-- INVOKER with no guard of its own; its UPDATE on warehouses and INSERT
-- into warehouse_gl_mapping both currently no-op/fail under RLS for lack of
-- a write policy on either table, for roles subject to RLS (service_role
-- bypasses RLS entirely and is not covered by this claim). Removing the
-- unused anon EXECUTE grant now is defense in depth against either of
-- those RLS gaps being closed later while the stale anon grant is
-- forgotten — it is not a claim that either function is safe to call.
--
-- Scope: table grants + two anon-executable function grants only. No RLS
-- policy is added or changed, no RPC signature changes, no data is scanned
-- or rewritten.

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.stock_ledger_entries') IS NULL
     OR to_regclass('public.bins') IS NULL THEN
    RAISE EXCEPTION 'STOCK_185_REQUIRED_TABLE_MISSING';
  END IF;

  IF to_regprocedure('public.rpc_post_goods_receipt(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_create_stock_adjustment(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_submit_stock_adjustment(uuid)') IS NULL
     OR to_regprocedure('public.rpc_cancel_stock_adjustment(uuid,text)') IS NULL
     OR to_regprocedure('public.rpc_manual_stock_movement_v2(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)') IS NULL
     OR to_regprocedure('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)') IS NULL
     OR to_regprocedure('public.consume_materials_for_mo(uuid,uuid,jsonb[])') IS NULL
     OR to_regprocedure('public.update_warehouse_gl_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'STOCK_185_REQUIRED_FUNCTION_MISSING';
  END IF;
END
$preflight$;

-- The supported client surface for the inventory ledger is RPC-only for
-- mutations. Keep authenticated's read access; remove every table-level
-- mutation privilege that could bypass that surface.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.stock_ledger_entries, public.bins
  FROM authenticated;

-- anon has no legitimate reason to hold any privilege on the legal ledger
-- or its derived balances.
REVOKE ALL ON TABLE public.stock_ledger_entries, public.bins FROM anon;

-- authenticated keeps EXECUTE on both (see header note on why neither is a
-- live risk today); only anon's reach is removed. Both functions were
-- created without an explicit REVOKE, so PostgreSQL's default EXECUTE
-- grant to PUBLIC is still in their ACL alongside the explicit per-role
-- grants (confirmed live: proacl held both "=X/postgres" and
-- "anon=X/postgres" entries). Revoking only the anon-targeted grant would
-- have left anon executing through its PUBLIC membership regardless;
-- authenticated and service_role are unaffected because they hold their
-- own separate grants already.
REVOKE EXECUTE ON FUNCTION public.consume_materials_for_mo(uuid, uuid, jsonb[])
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_warehouse_gl_mapping(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;

DO $postflight$
DECLARE
  v_table text;
  v_priv text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['stock_ledger_entries', 'bins']
  LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'STOCK_185_AUTHENTICATED_SELECT_MUST_REMAIN: %', v_table;
    END IF;

    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF has_table_privilege('authenticated', format('public.%I', v_table), v_priv) THEN
        RAISE EXCEPTION 'STOCK_185_AUTHENTICATED_WRITE_PRIVILEGE_REMAINS: % %', v_table, v_priv;
      END IF;
    END LOOP;

    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF has_table_privilege('anon', format('public.%I', v_table), v_priv) THEN
        RAISE EXCEPTION 'STOCK_185_ANON_PRIVILEGE_REMAINS: % %', v_table, v_priv;
      END IF;

      IF NOT has_table_privilege('service_role', format('public.%I', v_table), v_priv) THEN
        RAISE EXCEPTION 'STOCK_185_SERVICE_ROLE_PRIVILEGE_LOST: % %', v_table, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- warehouses is deliberately untouched by this migration. Prove the
  -- specific pre-185 grants this migration must not touch are still in
  -- place (this checks those four privileges, not full ACL equivalence),
  -- so a future edit here cannot silently widen this migration's scope.
  IF NOT (has_table_privilege('authenticated', 'public.warehouses', 'INSERT')
          AND has_table_privilege('authenticated', 'public.warehouses', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.warehouses', 'DELETE')
          AND has_table_privilege('anon', 'public.warehouses', 'INSERT')) THEN
    RAISE EXCEPTION 'STOCK_185_WAREHOUSES_SCOPE_VIOLATION';
  END IF;

  IF has_function_privilege('anon', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_warehouse_gl_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOCK_185_ANON_FUNCTION_EXECUTE_REMAINS';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_warehouse_gl_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOCK_185_AUTHENTICATED_FUNCTION_EXECUTE_MUST_REMAIN';
  END IF;

  -- The header names service_role as untouched by this migration; only the
  -- REVOKE ... FROM PUBLIC, anon statements above were run, so service_role
  -- must still hold EXECUTE through its own separate grant. Prove that
  -- claim instead of leaving it asserted only in prose.
  IF NOT has_function_privilege('service_role', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.update_warehouse_gl_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOCK_185_SERVICE_ROLE_FUNCTION_EXECUTE_MUST_REMAIN';
  END IF;
END
$postflight$;

COMMIT;
