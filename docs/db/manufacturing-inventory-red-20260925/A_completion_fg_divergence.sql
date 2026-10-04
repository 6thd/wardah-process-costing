-- RED A (#230) — manufacturing completion creates no legal finished-goods
-- receipt; the next canonical stock movement silently re-derives the product
-- projection from bins and erases the completion quantity.
--
-- PASSES only while the defect reproduces on current main.

\set ON_ERROR_STOP on
BEGIN;
\ir _helpers.sql

DO $red_a$
DECLARE
  v_mo uuid;
  v_done jsonb;
  v_fg record;
  v_bins int;
  v_sle int;
  v_move jsonb;
  v_gl jsonb;
BEGIN
  -- Step 1: FG has zero legal balance (no bin, no SLE) and a zero projection.
  SELECT stock_quantity, cost_price, stock_value INTO v_fg FROM public.products WHERE id = pg_temp.fg();
  SELECT count(*) INTO v_bins FROM public.bins WHERE product_id = pg_temp.fg();
  SELECT count(*) INTO v_sle FROM public.stock_ledger_entries WHERE product_id = pg_temp.fg();
  RAISE NOTICE 'A0 FG start: stock_quantity=% cost_price=% stock_value=% bins=% sle=%',
    v_fg.stock_quantity, v_fg.cost_price, v_fg.stock_value, v_bins, v_sle;
  IF v_fg.stock_quantity <> 0 OR v_bins <> 0 OR v_sle <> 0 THEN
    RAISE EXCEPTION 'MFG_RED_A_FIXTURE_WRONG';
  END IF;

  -- Material cost 100 enters WIP through the canonical consumption RPC.
  v_mo := pg_temp.mk_mo('RED-A', 5, 20);
  PERFORM pg_temp.as_user(pg_temp.consumer(), pg_temp.consume_sql(v_mo, 10));

  -- Step 2: complete the MO for quantity 5 through the current completion RPC.
  v_done := pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_complete_manufacturing_order(
         jsonb_build_object('mo_id', %L, 'tenant_id', %L, 'completed_quantity', 5))$q$,
    v_mo, pg_temp.org()));
  RAISE NOTICE 'A2 completion result: %', v_done;

  -- Steps 3-5: projection vs bins vs SLE after completion.
  SELECT stock_quantity, cost_price, stock_value INTO v_fg FROM public.products WHERE id = pg_temp.fg();
  SELECT count(*) INTO v_bins FROM public.bins WHERE product_id = pg_temp.fg();
  SELECT count(*) INTO v_sle FROM public.stock_ledger_entries WHERE product_id = pg_temp.fg();
  RAISE NOTICE 'A3 FG after completion: products.stock_quantity=% cost_price=% stock_value=% | bins=% | sle=%',
    v_fg.stock_quantity, v_fg.cost_price, v_fg.stock_value, v_bins, v_sle;

  SELECT jsonb_agg(jsonb_build_object(
           'reference', e.reference_number, 'description', e.description, 'status', e.status,
           'lines', (SELECT jsonb_agg(jsonb_build_object('account', a.code, 'debit', l.debit, 'credit', l.credit)
                                      ORDER BY l.line_number)
                     FROM public.gl_entry_lines l JOIN public.gl_accounts a ON a.id = l.account_id
                     WHERE l.entry_id = e.id))
         ORDER BY e.created_at)
  INTO v_gl
  FROM public.gl_entries e
  WHERE e.org_id = pg_temp.org() AND e.reference_number = v_mo::text;
  RAISE NOTICE 'A3 GL written by completion: %', v_gl;

  IF NOT pg_temp.completion_gl_matches(v_mo, 100) THEN
    RAISE EXCEPTION 'MFG_RED_A_DRAFT_GL_NOT_REPRODUCED: %', v_gl;
  END IF;

  IF v_fg.stock_quantity <> 5 OR v_bins <> 0 OR v_sle <> 0 THEN
    RAISE EXCEPTION 'MFG_RED_A_NO_FG_RECEIPT_NOT_REPRODUCED: qty=% bins=% sle=%',
      v_fg.stock_quantity, v_bins, v_sle;
  END IF;

  -- Step 6: ONE canonical legal incoming movement of 1 FG unit into W1.
  v_move := pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_manual_stock_movement_v2(jsonb_build_object(
         'product_id', %L, 'warehouse_id', %L, 'movement_type', 'in',
         'quantity', 1, 'unit_cost_entered', 20))$q$,
    pg_temp.fg(), pg_temp.w1()));

  -- Step 7: the projection is re-derived from bins and the 5 completed units vanish.
  SELECT stock_quantity, cost_price, stock_value INTO v_fg FROM public.products WHERE id = pg_temp.fg();
  SELECT count(*) INTO v_bins FROM public.bins WHERE product_id = pg_temp.fg();
  SELECT count(*) INTO v_sle FROM public.stock_ledger_entries WHERE product_id = pg_temp.fg();
  RAISE NOTICE 'A7 FG after one canonical +1 movement: products.stock_quantity=% (expected 6 if completion were legal) | bins=% | sle=% | bin_qty=%',
    v_fg.stock_quantity, v_bins, v_sle,
    (SELECT sum(actual_qty) FROM public.bins WHERE product_id = pg_temp.fg());

  IF v_fg.stock_quantity <> 1 THEN
    RAISE EXCEPTION 'MFG_RED_A_PROJECTION_ERASURE_NOT_REPRODUCED: %', v_fg.stock_quantity;
  END IF;

  RAISE NOTICE 'MFG_RED_A_REPRODUCED: completion wrote products.stock_quantity=5 with no FG bin/SLE; one canonical +1 movement re-derived the projection to 1, silently erasing the 5 completed units';
END
$red_a$;

ROLLBACK;
SELECT 'MFG_RED_A_REPRODUCED' AS result;
