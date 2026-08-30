-- Acceptance for Migration 185 / Round 3 stock write-surface closure.
-- Runs on a database built through 185. Proves three things, not two:
--   1. The grant/EXECUTE shape matches the migration's postflight exactly.
--   2. The legitimate RPC write path (SECURITY DEFINER, runs as owner)
--      still writes stock_ledger_entries and bins correctly — closing the
--      table grant did not also close the supported surface.
--   3. A direct client write is rejected by the grant itself (SQLSTATE
--      42501), even when a hypothetical permissive RLS policy would
--      otherwise allow it — proving the fix is the revoked grant, not the
--      accidental absence of a policy.
--
-- Fixture ids are fixed literals (not gen_random_uuid()) so they can be
-- referenced after SET LOCAL ROLE authenticated without a SELECT against
-- auth.users under that role, which authenticated cannot perform.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Grant/EXECUTE shape (mirrors the migration's own postflight).
-- ---------------------------------------------------------------------
DO $grants$
DECLARE
  v_table text;
  v_priv text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['stock_ledger_entries', 'bins']
  LOOP
    IF NOT has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_AUTHENTICATED_SELECT_MISSING: %', v_table;
    END IF;

    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF has_table_privilege('authenticated', format('public.%I', v_table), v_priv) THEN
        RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_AUTHENTICATED_WRITE_REMAINS: % %', v_table, v_priv;
      END IF;
    END LOOP;

    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF has_table_privilege('anon', format('public.%I', v_table), v_priv) THEN
        RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_ANON_PRIVILEGE_REMAINS: % %', v_table, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT (has_table_privilege('authenticated', 'public.warehouses', 'INSERT')
          AND has_table_privilege('anon', 'public.warehouses', 'INSERT')) THEN
    RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_WAREHOUSES_SCOPE_VIOLATION';
  END IF;

  IF has_function_privilege('anon', 'public.consume_materials_for_mo(uuid,uuid,jsonb[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_warehouse_gl_mapping(uuid,uuid,uuid,uuid,uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_ANON_FUNCTION_EXECUTE_REMAINS';
  END IF;

  RAISE NOTICE 'STOCK_185_GRANTS_OK';
END
$grants$;

-- ---------------------------------------------------------------------
-- 2. RPC smoke: the SECURITY DEFINER write path is unaffected.
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code)
VALUES ('51856185-0000-0000-0000-000000000001', 'Stock 185 Smoke', 'STK185-SMOKE');

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT '51856185-0000-0000-0000-000000000002', '51856185-0000-0000-0000-000000000001',
       'STK185-PRD', 'Stock 185 Smoke Product', true, u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

DO $seed_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = '51856185-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_NO_SYSTEM_UOM_SEEDED';
  END IF;
END
$seed_check$;

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES ('51856185-0000-0000-0000-000000000003', '51856185-0000-0000-0000-000000000001',
        'STK185-WH', 'Stock 185 Smoke Warehouse');

INSERT INTO auth.users (id, email)
VALUES ('51856185-0000-0000-0000-000000000004', 'stock185-smoke@example.test');

INSERT INTO public.user_organizations (user_id, org_id, is_active)
VALUES ('51856185-0000-0000-0000-000000000004', '51856185-0000-0000-0000-000000000001', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51856185-0000-0000-0000-000000000004', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856185-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);

DO $smoke$
DECLARE
  v_product uuid := '51856185-0000-0000-0000-000000000002';
  v_warehouse uuid := '51856185-0000-0000-0000-000000000003';
  v_result jsonb;
  v_sle_count integer;
  v_bin_qty numeric;
  v_product_qty numeric;
BEGIN
  v_result := public.rpc_manual_stock_movement_v2(jsonb_build_object(
    'product_id', v_product,
    'warehouse_id', v_warehouse,
    'quantity', 120,
    'movement_type', 'in',
    'unit_cost_entered', 4
  ));

  IF COALESCE((v_result ->> 'applied')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STOCK_185_ACCEPTANCE_RPC_WRITE_NOT_APPLIED: %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_sle_count
  FROM public.stock_ledger_entries
  WHERE product_id = v_product AND warehouse_id = v_warehouse;

  SELECT actual_qty INTO v_bin_qty
  FROM public.bins
  WHERE product_id = v_product AND warehouse_id = v_warehouse;

  SELECT stock_quantity INTO v_product_qty
  FROM public.products
  WHERE id = v_product;

  IF v_sle_count <> 1 OR v_bin_qty IS DISTINCT FROM 120::numeric OR v_product_qty IS DISTINCT FROM 120::numeric THEN
    RAISE EXCEPTION
      'STOCK_185_ACCEPTANCE_RPC_WRITE_MISMATCH: sle_count=% bin_qty=% product_qty=%',
      v_sle_count, v_bin_qty, v_product_qty;
  END IF;

  RAISE NOTICE 'STOCK_185_RPC_SMOKE_OK: legitimate write path unaffected by the revoked table grants';
END
$smoke$;

RESET ROLE;

-- ---------------------------------------------------------------------
-- 3. Green probe: a direct write is rejected by the grant itself, even
--    under a hypothetical permissive policy for every command.
-- ---------------------------------------------------------------------
SAVEPOINT wardah_185_green_probe;

CREATE POLICY wardah_185_tmp_all ON public.stock_ledger_entries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51856185-0000-0000-0000-000000000004', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856185-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);

DO $probe$
DECLARE
  v_product uuid := '51856185-0000-0000-0000-000000000002';
  v_warehouse uuid := '51856185-0000-0000-0000-000000000003';
  v_org uuid := '51856185-0000-0000-0000-000000000001';
  v_caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.stock_ledger_entries (
      voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
      posting_date, posting_time, actual_qty, qty_after_transaction,
      valuation_rate, stock_value, stock_value_difference, org_id
    ) VALUES (
      'Stock Adjustment', gen_random_uuid(), 'STK185-PROBE', v_product, v_warehouse,
      CURRENT_DATE, CURRENT_TIME, 1, 1, 1, 1, 1, v_org
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STOCK_185_GREEN_PROBE_DIRECT_INSERT_SUCCEEDED_UNEXPECTEDLY';
  END IF;

  RAISE NOTICE
    'STOCK_185_GREEN_PROBE_OK: direct insert rejected (insufficient_privilege) despite a permissive FOR ALL policy';
END
$probe$;

RESET ROLE;
ROLLBACK TO SAVEPOINT wardah_185_green_probe;

\echo 'STOCK_185_ACCEPTANCE_PASS'
ROLLBACK;
