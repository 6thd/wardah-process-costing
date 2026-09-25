-- RED G (#157) + H (#170) — direct table mutation surfaces that sit beside the
-- canonical inventory/manufacturing RPCs. Verification only: these are already
-- tracked and are NOT redesigned here.
--
--   G  products: a same-org member with no inventory.products.* grant rewrites
--      stock_quantity / cost_price / valuation_method / stock_queue directly;
--   H  material_reservations: the same member rewrites reservation quantities
--      and status directly, outside rpc_consume_reserved_materials_v2 (#229).
--
-- PASSES only while both surfaces reproduce on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_gh$
DECLARE
  v_call jsonb;
  v_mo uuid;
  v_bins numeric;
BEGIN
  -- G. products (reader has only manufacturing.orders.read).
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$UPDATE public.products
       SET stock_quantity = 999, cost_price = 0.01, valuation_method = 'FIFO',
           stock_queue = '[]'::jsonb
       WHERE id = %L
       RETURNING jsonb_build_object('stock_quantity', stock_quantity, 'cost_price', cost_price,
                                    'valuation_method', valuation_method)$q$, pg_temp.cnt()));
  SELECT sum(actual_qty) INTO v_bins FROM public.bins WHERE product_id = pg_temp.cnt();
  -- validate_stock_queue() re-derives stock_quantity/stock_value from the
  -- rewritten stock_queue, so the projection lands at 0 rather than 999 — it
  -- is still moved off the bin truth by a member with no inventory grant.
  RAISE NOTICE 'G reader direct products UPDATE -> % | bins still sum to %', v_call, v_bins;
  IF NOT (v_call ->> 'ok')::boolean
     OR (v_call -> 'result' ->> 'stock_quantity')::numeric = v_bins THEN
    RAISE EXCEPTION 'MFG_RED_G_PRODUCTS_DIRECT_MUTATION_NOT_REPRODUCED: %', v_call;
  END IF;

  -- H. material_reservations.
  v_mo := pg_temp.mk_mo('RED-H', 5, 20);
  v_call := pg_temp.try_as(pg_temp.reader(), format(
    $q$UPDATE public.material_reservations
       SET quantity_reserved = 1, quantity_consumed = 0, status = 'reserved'
       WHERE mo_id = %L
       RETURNING jsonb_build_object('quantity_reserved', quantity_reserved, 'status', status)$q$, v_mo));
  RAISE NOTICE 'H reader direct material_reservations UPDATE -> %', v_call;
  IF NOT (v_call ->> 'ok')::boolean OR v_call -> 'result' IS NULL THEN
    RAISE EXCEPTION 'MFG_RED_H_RESERVATION_DIRECT_MUTATION_NOT_REPRODUCED: %', v_call;
  END IF;

  RAISE NOTICE 'MFG_RED_GH_REPRODUCED: products inventory fields and reservation quantities are directly writable by a member with no inventory/manufacturing mutation grant';
END
$red_gh$;

ROLLBACK;
SELECT 'MFG_RED_GH_REPRODUCED' AS result;
