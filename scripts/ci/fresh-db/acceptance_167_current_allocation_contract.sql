-- Current-schema companion for the historical Migration 167 gate.
-- Migration 169 closed the temporary authenticated INSERT surface that 167 had
-- intentionally left open. Baseline refreshes must prove that closure remains
-- intact while the allocation guard and atomic RPC surface still exist.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION
        'CURRENT_167_FAIL: expected [%] for [%], got [%]',
        p_needle, p_sql, SQLERRM;
    END IF;
  END;

  IF v_succeeded THEN
    RAISE EXCEPTION
      'CURRENT_167_FAIL: expected error [%] for [%], but it succeeded',
      p_needle, p_sql;
  END IF;
END;
$$;

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wardah_protect_voucher_allocation_lines()') IS NULL
     OR to_regprocedure('public.rpc_create_customer_receipt(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_create_supplier_payment(jsonb)') IS NULL
     OR to_regprocedure('public.rpc_update_customer_receipt_draft(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.rpc_update_supplier_payment_draft(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CURRENT_167_FAIL: current voucher RPC/guard surface missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.customer_collection_lines', 'INSERT')
     OR has_table_privilege('authenticated', 'public.supplier_payment_lines', 'INSERT') THEN
    RAISE EXCEPTION 'CURRENT_167_FAIL: authenticated INSERT privilege was reopened';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.customer_collection_lines', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.supplier_payment_lines', 'SELECT') THEN
    RAISE EXCEPTION 'CURRENT_167_FAIL: authenticated read surface unexpectedly missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='customer_collection_lines'
      AND t.tgname='trg_protect_customer_collection_lines'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'CURRENT_167_FAIL: customer allocation protection trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='supplier_payment_lines'
      AND t.tgname='trg_protect_supplier_payment_lines'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'CURRENT_167_FAIL: supplier allocation protection trigger missing';
  END IF;
END;
$$;

-- Direct browser writes must fail at the privilege boundary before any attempt
-- to satisfy the older 167 draft-insert policy/trigger contract.
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$INSERT INTO public.customer_collection_lines DEFAULT VALUES$$,
  'permission denied');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.supplier_payment_lines DEFAULT VALUES$$,
  'permission denied');
RESET ROLE;

-- service_role must not be able to manufacture authority by setting the legacy
-- GUC alone. Migration 169 requires trusted owner + capability together.
SET LOCAL ROLE service_role;
SELECT set_config('wardah.voucher_lines_write', 'on', true);
SELECT pg_temp.expect_error(
  $$INSERT INTO public.customer_collection_lines DEFAULT VALUES$$,
  'VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN');
SELECT set_config('wardah.voucher_lines_write', 'off', true);
RESET ROLE;

ROLLBACK;

SELECT 'VOUCHER_ALLOCATION_167_CURRENT_CONTRACT_PASS' AS result;
