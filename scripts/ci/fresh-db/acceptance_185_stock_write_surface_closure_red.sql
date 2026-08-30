-- Red proof for Migration 185: run through 184 with 185 omitted.
--
-- Confirms the risk 185 closes was real, not assumed: before 185,
-- authenticated already holds full table-level write privileges on
-- stock_ledger_entries, and a permissive policy — the same one the green
-- probe adds and rolls back — lets a direct client INSERT succeed. RLS
-- alone (no policy for INSERT today) is what stops this pre-185, not a
-- revoked grant; the moment a policy exists for that command, the retained
-- grant and the policy combine and the ledger is directly writable.
\set ON_ERROR_STOP on

BEGIN;

DO $preconditions$
BEGIN
  IF NOT (has_table_privilege('authenticated', 'public.stock_ledger_entries', 'INSERT')
          AND has_table_privilege('authenticated', 'public.stock_ledger_entries', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.stock_ledger_entries', 'DELETE')
          AND has_table_privilege('authenticated', 'public.bins', 'INSERT')
          AND has_table_privilege('anon', 'public.stock_ledger_entries', 'SELECT')) THEN
    RAISE EXCEPTION 'STOCK_185_RED_PRECONDITION_FAILED: expected pre-185 grants to still be present';
  END IF;
  RAISE NOTICE 'STOCK_185_RED_PRECONDITION_OK: pre-185 grants present on authenticated and anon';
END
$preconditions$;

INSERT INTO public.organizations (id, name, code)
VALUES ('51856185-0000-0000-0000-0000000000a1', 'Stock 185 Red', 'STK185-RED');

INSERT INTO public.warehouses (id, org_id, code, name)
VALUES ('51856185-0000-0000-0000-0000000000a2', '51856185-0000-0000-0000-0000000000a1',
        'STK185-RED-WH', 'Stock 185 Red Warehouse');

INSERT INTO public.products (id, org_id, code, name, is_stockable, base_uom_id)
SELECT '51856185-0000-0000-0000-0000000000a3', '51856185-0000-0000-0000-0000000000a1',
       'STK185-RED-PRD', 'Stock 185 Red Product', true, u.id
FROM public.uoms u
WHERE u.org_id IS NULL AND u.is_active AND NOT u.is_product_specific
LIMIT 1;

SAVEPOINT wardah_185_red_probe;

CREATE POLICY wardah_185_tmp_all ON public.stock_ledger_entries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

SET LOCAL ROLE authenticated;

DO $probe$
DECLARE
  v_product uuid := '51856185-0000-0000-0000-0000000000a3';
  v_warehouse uuid := '51856185-0000-0000-0000-0000000000a2';
  v_org uuid := '51856185-0000-0000-0000-0000000000a1';
BEGIN
  INSERT INTO public.stock_ledger_entries (
    voucher_type, voucher_id, voucher_number, product_id, warehouse_id,
    posting_date, posting_time, actual_qty, qty_after_transaction,
    valuation_rate, stock_value, stock_value_difference, org_id
  ) VALUES (
    'Stock Adjustment', gen_random_uuid(), 'STK185-RED-PROBE', v_product, v_warehouse,
    CURRENT_DATE, CURRENT_TIME, 1, 1, 1, 1, 1, v_org
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.stock_ledger_entries WHERE voucher_number = 'STK185-RED-PROBE'
  ) THEN
    RAISE EXCEPTION 'STOCK_185_RED_PROBE_INSERT_DID_NOT_PERSIST';
  END IF;

  RAISE NOTICE
    'STOCK_185_RED_PROOF_OK: direct insert succeeded pre-185 once a permissive policy existed, using the still-present table grant';
END
$probe$;

RESET ROLE;
ROLLBACK TO SAVEPOINT wardah_185_red_probe;

\echo 'STOCK_185_RED_PROOF_PASS'
ROLLBACK;
