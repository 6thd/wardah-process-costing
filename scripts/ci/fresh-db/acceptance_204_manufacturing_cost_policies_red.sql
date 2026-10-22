-- RED for Migration 204: run on a fresh database through 203 (before 204).
--
-- Proves the gaps 204 and its contract address, as they stand in the schema:
--   1. no per-organization cost policy exists: no versioned store, no RPC, and
--      an MO records no policy, so a later rate change would silently re-price
--      an order already in progress;
--   2. the only overhead rates are mutable columns read by no costing path
--      that is reachable today (work_centers.default_overhead_rate,
--      routing_operations.overhead_rate_per_hour);
--   3. the legacy stage engine takes the WHOLE previous stage total_cost as
--      transferred-in (ending WIP and abnormal loss included), and the stage
--      total then includes it — so summing stages counts it twice. The #260
--      engine must use the 204 contract rule instead (runbook §5).
\set ON_ERROR_STOP on

DO $red$
DECLARE
  v_src text;
BEGIN
  IF to_regclass('wardah_internal.mfg_cost_policy_versions') IS NOT NULL
     OR to_regprocedure('public.rpc_get_mfg_cost_policy(uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pin_mo_cost_policy_204') THEN
    RAISE EXCEPTION 'CP204_RED_NOT_PRE_204';
  END IF;
  IF to_regclass('public.manufacturing_orders') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.work_centers'::regclass
                    AND attname = 'default_overhead_rate' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'CP204_RED_SCHEMA_UNEXPECTED';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE oid = to_regprocedure('public.upsert_stage_cost_core(uuid,uuid,integer,uuid,numeric,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)');
  IF v_src IS NULL THEN
    SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_stage_cost_core' LIMIT 1;
  END IF;
  IF v_src IS NULL
     OR position('SELECT COALESCE(total_cost, 0) INTO v_ti' IN v_src) = 0
     OR position('v_total := v_ti + p_dm + v_dl + v_oh + v_rg - v_wc;' IN v_src) = 0 THEN
    RAISE EXCEPTION 'CP204_RED_LEGACY_TRANSFER_RULE_NOT_FOUND';
  END IF;
  RAISE NOTICE 'MFG_COST_POLICY_204_RED_PROOF_OK';
END
$red$;
