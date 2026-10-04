-- #273: protect posted material issue history before FK cascades can erase it.
-- This is a forward-only, additive correction after M192. It does not make
-- material issue, WO completion, or process costing safe for general rollout.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('wardah_internal.material_issue_events') IS NULL
     OR to_regprocedure('public.rpc_consume_material_event(uuid,uuid,uuid,jsonb)') IS NULL
     OR to_regclass('public.material_consumption') IS NULL
     OR to_regclass('public.work_orders') IS NULL
     OR to_regclass('public.stage_wip_log') IS NULL THEN
    RAISE EXCEPTION 'M193_REQUIRES_M192';
  END IF;

  -- A protection migration cannot bless already-orphaned receipts. The
  -- canonical Production preflight currently has zero material issue events.
  IF EXISTS (
    SELECT 1 FROM wardah_internal.material_issue_events e
    CROSS JOIN LATERAL unnest(e.consumption_ids) AS consumed(id)
    LEFT JOIN public.material_consumption c
      ON c.id=consumed.id AND c.org_id=e.org_id
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'M193_EXISTING_ORPHANED_RECEIPT';
  END IF;
END
$preflight$;

-- The invoker WO guard rejects before the work-order FK can cascade to consumption.
-- No MO lock is taken here: M192 holds MO before WO, and reversing that order
-- in a DELETE trigger would create a new MO/WO deadlock.
CREATE FUNCTION wardah_internal.guard_posted_wo_delete_193()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.material_consumption c
    WHERE c.work_order_id=OLD.id AND c.org_id=OLD.org_id
      AND c.status='POSTED'
  ) OR EXISTS (
    SELECT 1 FROM wardah_internal.material_issue_events e
    WHERE e.org_id=OLD.org_id AND e.mo_id=OLD.mo_id
      AND (e.canonical_request->'lines') @>
          jsonb_build_array(jsonb_build_object('work_order_id',OLD.id::text))
  ) THEN
    RAISE EXCEPTION 'M193_POSTED_WORK_ORDER_DELETE_DENIED'
      USING ERRCODE='P0001';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.guard_posted_wo_delete_193()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_posted_wo_delete_193
BEFORE DELETE ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION wardah_internal.guard_posted_wo_delete_193();

-- This second guard covers a direct owner/service-role DELETE on a posted
-- consumption line, as well as any future FK path that bypasses the WO row.
CREATE FUNCTION wardah_internal.guard_posted_consumption_delete_193()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.status='POSTED' OR EXISTS (
    SELECT 1 FROM wardah_internal.material_issue_events e
    WHERE e.org_id=OLD.org_id AND OLD.id=ANY(e.consumption_ids)
  ) THEN
    RAISE EXCEPTION 'M193_POSTED_CONSUMPTION_DELETE_DENIED'
      USING ERRCODE='P0001';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.guard_posted_consumption_delete_193()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_posted_consumption_delete_193
BEFORE DELETE ON public.material_consumption
FOR EACH ROW EXECUTE FUNCTION wardah_internal.guard_posted_consumption_delete_193();

-- stage_wip_log has one FOR ALL tenant policy; keep SELECT/INSERT/UPDATE
-- working and revoke DELETE at the grant layer. Even a privileged DELETE must
-- preserve a row containing posted material cost or an M192 stage receipt.
CREATE FUNCTION wardah_internal.guard_posted_wip_delete_193()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF COALESCE(OLD.cost_material,0)<>0 OR EXISTS (
    SELECT 1 FROM wardah_internal.material_issue_events e
    WHERE e.org_id=OLD.org_id AND e.mo_id=OLD.mo_id
      AND e.canonical_request->>'stage_id'=OLD.stage_id::text
  ) THEN
    RAISE EXCEPTION 'M193_POSTED_WIP_DELETE_DENIED'
      USING ERRCODE='P0001';
  END IF;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.guard_posted_wip_delete_193()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_posted_wip_delete_193
BEFORE DELETE ON public.stage_wip_log
FOR EACH ROW EXECUTE FUNCTION wardah_internal.guard_posted_wip_delete_193();

-- TRUNCATE bypasses RLS and row triggers. Refuse it even from a privileged
-- SQL caller on the ledger and its children; archival needs its own reviewed
-- forward migration, not an unscoped table operation.
CREATE FUNCTION wardah_internal.deny_manufacturing_history_truncate_193()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'M193_MANUFACTURING_HISTORY_TRUNCATE_DENIED'
    USING ERRCODE='P0001';
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.deny_manufacturing_history_truncate_193()
  FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'manufacturing_orders','work_orders','material_reservations',
    'material_consumption','stage_wip_log','labor_time_tracking',
    'operation_execution_logs','quality_inspections'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER deny_history_truncate_193 BEFORE TRUNCATE ON public.%I '
      || 'FOR EACH STATEMENT EXECUTE FUNCTION '
      || 'wardah_internal.deny_manufacturing_history_truncate_193()',v_table
    );
  END LOOP;
END
$triggers$;

-- There is no supported client DELETE on these history tables. The mounted
-- WIP-delete button is retired in this PR; older bundles fail closed (42501).
-- stage_wip_log's FOR ALL policy is retained for read and non-delete writes.
REVOKE DELETE, TRUNCATE ON
  public.manufacturing_orders, public.work_orders,
  public.material_reservations, public.stage_wip_log,
  public.labor_time_tracking, public.operation_execution_logs,
  public.quality_inspections
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS manufacturing_orders_delete ON public.manufacturing_orders;
DROP POLICY IF EXISTS work_orders_delete_policy ON public.work_orders;
DROP POLICY IF EXISTS material_reservations_delete ON public.material_reservations;
DROP POLICY IF EXISTS labor_time_tracking_delete_policy ON public.labor_time_tracking;
DROP POLICY IF EXISTS operation_execution_logs_delete_policy ON public.operation_execution_logs;
DROP POLICY IF EXISTS quality_inspections_delete_policy ON public.quality_inspections;

DO $postflight$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'manufacturing_orders','work_orders','material_reservations',
    'material_consumption','stage_wip_log','labor_time_tracking',
    'operation_execution_logs','quality_inspections'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=format('public.%I',v_table)::regclass
        AND t.tgname='deny_history_truncate_193' AND t.tgenabled='O'
    ) THEN RAISE EXCEPTION 'M193_TRUNCATE_GUARD_MISSING: %',v_table; END IF;
    IF has_table_privilege('anon',format('public.%I',v_table),'TRUNCATE')
       OR has_table_privilege('authenticated',format('public.%I',v_table),'TRUNCATE') THEN
      RAISE EXCEPTION 'M193_TRUNCATE_GRANT_RESTORED: %',v_table;
    END IF;
    IF has_table_privilege('anon',format('public.%I',v_table),'DELETE')
       OR has_table_privilege('authenticated',format('public.%I',v_table),'DELETE') THEN
      RAISE EXCEPTION 'M193_DELETE_GRANT_RESTORED: %',v_table;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_trigger
      WHERE tgname IN ('guard_posted_wo_delete_193',
                       'guard_posted_consumption_delete_193',
                       'guard_posted_wip_delete_193') AND tgenabled='O')<>3
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='wardah_internal' AND p.proname IN (
         'guard_posted_wo_delete_193',
         'guard_posted_consumption_delete_193',
         'guard_posted_wip_delete_193',
         'deny_manufacturing_history_truncate_193'
       ) AND (p.prosecdef
              OR has_function_privilege('anon',p.oid,'EXECUTE')
              OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
     ) THEN RAISE EXCEPTION 'M193_TRIGGER_GUARD_DRIFT'; END IF;
END
$postflight$;

COMMIT;
