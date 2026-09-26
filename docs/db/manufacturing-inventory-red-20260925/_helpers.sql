-- Session-local helpers for the RED probes. Included with \ir by every probe
-- AFTER its BEGIN, so everything here is rolled back with the probe.
--
-- pg_temp.try_as(uid, sql) runs one statement under the real client role
-- (`authenticated`, RLS + EXECUTE grants in force) with the Supabase JWT claims
-- the repository's auth shim reads, and returns {ok, result} or
-- {ok:false, sqlstate, error}. A failure is captured inside a subtransaction,
-- so a rejected call leaves no partial effect and the probe can continue.

CREATE FUNCTION pg_temp.try_as(p_uid uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_res jsonb;
  v_state text;
  v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config(
    'request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '{}'
         ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
    true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE p_sql INTO v_res;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('ok', true, 'result', v_res);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RETURN jsonb_build_object('ok', false, 'sqlstate', v_state, 'error', v_msg);
  END;
END
$fn$;

-- Asserting variant: the call must succeed; returns its result.
CREATE FUNCTION pg_temp.as_user(p_uid uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v jsonb := pg_temp.try_as(p_uid, p_sql);
BEGIN
  IF NOT (v ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'MFG_RED_HARNESS_CALL_FAILED: % -> %', left(p_sql, 160), v;
  END IF;
  RETURN v -> 'result';
END
$fn$;

-- Fixture identities.
CREATE FUNCTION pg_temp.org()      RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-000000000001'::uuid $$;
CREATE FUNCTION pg_temp.admin()    RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a1'::uuid $$;
CREATE FUNCTION pg_temp.consumer() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a2'::uuid $$;
CREATE FUNCTION pg_temp.reader()   RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000a3'::uuid $$;
CREATE FUNCTION pg_temp.raw()      RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000c1'::uuid $$;
CREATE FUNCTION pg_temp.fg()       RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000c2'::uuid $$;
CREATE FUNCTION pg_temp.cnt()      RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000c3'::uuid $$;
CREATE FUNCTION pg_temp.xfr()      RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000c4'::uuid $$;
CREATE FUNCTION pg_temp.raw_item() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000d1'::uuid $$;
CREATE FUNCTION pg_temp.w1()       RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000e1'::uuid $$;
CREATE FUNCTION pg_temp.w2()       RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000e2'::uuid $$;
CREATE FUNCTION pg_temp.stage()    RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000f1'::uuid $$;
CREATE FUNCTION pg_temp.wc()       RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'ed000000-0000-4000-8000-0000000000f2'::uuid $$;

-- Walk an MO through the CURRENT state machine via rpc_transition_mo_status
-- as the org admin.
CREATE FUNCTION pg_temp.transition(p_mo uuid, p_status text)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_transition_mo_status(%L::uuid, %L, NULL, %L::uuid)$q$,
    p_mo, p_status, pg_temp.org()));
$fn$;

-- Canonical MO setup: create through rpc_create_mo_with_reservation as the
-- org admin (RAW reserved), walk the state machine to p_status (default
-- in_progress) through rpc_transition_mo_status, open a current-period stage
-- WIP log, and create one work order (READY unless p_wo_status says otherwise;
-- the status is set at INSERT because any later work_orders status UPDATE
-- currently fails inside update_mo_status_from_work_orders — see probe D).
-- Returns the MO id.
CREATE FUNCTION pg_temp.mk_mo(p_number text, p_qty numeric, p_reserve numeric,
                              p_status text DEFAULT 'in_progress',
                              p_wo_status text DEFAULT 'READY')
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE
  v_res jsonb;
  v_mo uuid;
BEGIN
  v_res := pg_temp.as_user(pg_temp.admin(), format(
    $q$SELECT public.rpc_create_mo_with_reservation(
         jsonb_build_object('org_id', %L, 'order_number', %L, 'product_id', %L, 'quantity', %s),
         jsonb_build_array(jsonb_build_object('item_id', %L, 'quantity', %s)),
         NULL)$q$,
    pg_temp.org(), p_number, pg_temp.fg(), p_qty, pg_temp.raw_item(), p_reserve));
  v_mo := (v_res ->> 'mo_id')::uuid;

  IF p_status <> 'draft' THEN
    PERFORM pg_temp.transition(v_mo, 'confirmed');
  END IF;
  IF p_status NOT IN ('draft', 'confirmed') THEN
    PERFORM pg_temp.transition(v_mo, 'in_progress');
  END IF;
  IF p_status NOT IN ('draft', 'confirmed', 'in_progress') THEN
    PERFORM pg_temp.transition(v_mo, p_status);
  END IF;

  INSERT INTO public.stage_wip_log (org_id, mo_id, stage_id, period_start, period_end)
  VALUES (pg_temp.org(), v_mo, pg_temp.stage(),
          date_trunc('month', CURRENT_DATE)::date,
          (date_trunc('month', CURRENT_DATE) + interval '1 month -1 day')::date);

  -- work_orders carries a load trigger that calls wardah_assert_org_member, so
  -- the insert runs with the admin identity rather than bypassing the trigger.
  PERFORM set_config('request.jwt.claim.sub', pg_temp.admin()::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.admin(), 'role', 'authenticated')::text, true);
  INSERT INTO public.work_orders (org_id, mo_id, work_center_id, work_order_number,
                                  operation_sequence, operation_name, planned_quantity, status)
  VALUES (pg_temp.org(), v_mo, pg_temp.wc(), p_number || '-WO1', 1, 'RED op', p_qty, p_wo_status);

  RETURN v_mo;
END
$fn$;

-- One consumption business request, exactly as a client would send it.
CREATE FUNCTION pg_temp.consume_sql(p_mo uuid, p_qty numeric)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format(
    $q$SELECT public.rpc_consume_reserved_materials_v2(%L::uuid, %L::uuid,
         jsonb_build_array(jsonb_build_object('item_id', %L, 'quantity', %s, 'warehouse_id', %L)))$q$,
    p_mo, pg_temp.stage(), pg_temp.raw_item(), p_qty, pg_temp.w1());
$fn$;

-- Cross-domain consumption state for one MO (read as the superuser harness).
CREATE FUNCTION pg_temp.consumption_state(p_mo uuid)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_build_object(
    'sle_rows', (SELECT count(*) FROM public.stock_ledger_entries
                 WHERE voucher_type = 'Material Consumption' AND voucher_id = p_mo),
    'sle_qty', (SELECT COALESCE(sum(actual_qty), 0) FROM public.stock_ledger_entries
                WHERE voucher_type = 'Material Consumption' AND voucher_id = p_mo),
    'bin_raw_w1_qty', (SELECT actual_qty FROM public.bins
                       WHERE product_id = pg_temp.raw() AND warehouse_id = pg_temp.w1()),
    'bin_raw_w1_value', (SELECT stock_value FROM public.bins
                         WHERE product_id = pg_temp.raw() AND warehouse_id = pg_temp.w1()),
    'mc_rows', (SELECT count(*) FROM public.material_consumption WHERE mo_id = p_mo),
    'mc_qty', (SELECT COALESCE(sum(consumed_quantity), 0) FROM public.material_consumption WHERE mo_id = p_mo),
    'mc_cost', (SELECT COALESCE(sum(total_cost), 0) FROM public.material_consumption WHERE mo_id = p_mo),
    'reservation_consumed', (SELECT COALESCE(sum(quantity_consumed), 0)
                             FROM public.material_reservations WHERE mo_id = p_mo),
    'wip_material_cost', (SELECT COALESCE(sum(cost_material), 0)
                          FROM public.stage_wip_log WHERE mo_id = p_mo),
    'mo_status', (SELECT status FROM public.manufacturing_orders WHERE id = p_mo));
$fn$;

-- The two completion journals must retain their distinct event identities,
-- exact debit/credit accounts, draft status and matching header/line totals.
CREATE FUNCTION pg_temp.completion_gl_matches(p_mo uuid, p_amount numeric)
RETURNS boolean LANGUAGE sql AS $fn$
  WITH entries AS (
    SELECT e.id, e.idempotency_key, e.reference_type, e.status,
           e.total_debit, e.total_credit,
           count(l.id) AS line_count,
           count(*) FILTER (WHERE a.code = 'T1400' AND l.debit = p_amount AND l.credit = 0) AS wip_dr,
           count(*) FILTER (WHERE a.code = 'T1300' AND l.debit = 0 AND l.credit = p_amount) AS rm_cr,
           count(*) FILTER (WHERE a.code = 'T1350' AND l.debit = p_amount AND l.credit = 0) AS fg_dr,
           count(*) FILTER (WHERE a.code = 'T1400' AND l.debit = 0 AND l.credit = p_amount) AS wip_cr
    FROM public.gl_entries e
    LEFT JOIN public.gl_entry_lines l ON l.entry_id = e.id AND l.org_id = e.org_id
    LEFT JOIN public.gl_accounts a ON a.id = l.account_id AND a.org_id = e.org_id
    WHERE e.org_id = pg_temp.org() AND e.reference_number = p_mo::text
    GROUP BY e.id
  )
  SELECT count(*) = 2
     AND count(*) FILTER (WHERE idempotency_key = 'MATERIAL_ISSUE:' || p_mo::text
                            AND reference_type = 'MANUFACTURING_ORDER'
                            AND status = 'draft' AND total_debit = p_amount
                            AND total_credit = p_amount AND line_count = 2
                            AND wip_dr = 1 AND rm_cr = 1) = 1
     AND count(*) FILTER (WHERE idempotency_key = 'FG_RECEIPT:' || p_mo::text
                            AND reference_type = 'MANUFACTURING_ORDER'
                            AND status = 'draft' AND total_debit = p_amount
                            AND total_credit = p_amount AND line_count = 2
                            AND fg_dr = 1 AND wip_cr = 1) = 1
  FROM entries;
$fn$;
