-- 204: Manufacturing cost policies — per-organization, versioned, effective-dated.
--
-- Owner decision (2026-10-22): cost policies differ between companies. Each org
-- chooses its labor cost source and its overhead pools, each pool absorbed on a
-- basis (labor hours or machine hours in this first release) at a rate per hour,
-- with a company default and explicit per-work-center rules. Lives under
-- Settings > Manufacturing and is governed by M201 (manufacturing.settings.*).
--
-- Additive. Does not edit migrations 189-203 and does not change any existing
-- function, grant or table. New objects only:
--   * wardah_internal.mfg_cost_policy_versions / _pools / _wc_rules /
--     _wc_pool_rules: immutable policy versions (no client grants);
--   * wardah_internal.mo_cost_policy_pin_timing: the pin timing each MO takes,
--     at creation, from the version in force that day (policy field pin_event);
--   * wardah_internal.mo_cost_policy_pins: the cost version each MO is pinned to,
--     once, at the saved event: creation (AFTER INSERT) or first start of
--     production (AFTER UPDATE OF status to in_progress), by triggers on
--     manufacturing_orders;
--   * wardah_internal.mfg_cost_policy_compute_204: the one place that turns
--     driver hours into labor and overhead amounts for a pinned version — the
--     #260 engine and the #230 completion orchestrator call it, nothing else
--     computes absorption;
--   * public.rpc_get_mfg_cost_policy, rpc_create_mfg_cost_policy_version,
--     rpc_withdraw_mfg_cost_policy_version, rpc_preview_mfg_cost_absorption.
--
-- Not toggleable by any policy: org isolation, the M201 guard, idempotent
-- creation, immutability of a version once created, and fail-closed handling of
-- a missing driver (NULL is "not measured" and raises; 0 is a measured zero).
--
-- Not in 204: the stage-cost engine (#260) and completion (#230). Until they
-- call mfg_cost_policy_compute_204 no stage_costs row or journal is produced
-- from a policy. Contract: docs/db/MANUFACTURING_COST_POLICIES_204_RUNBOOK.md.
--
-- Transaction: runner-owned, as for 195-203. Apply with psql --single-transaction
-- (or an equivalent single-transaction runner); the file has no BEGIN/COMMIT.
SET LOCAL lock_timeout = '10s';

DO $preflight$
BEGIN
  IF to_regclass('wardah_internal.mfg_cost_policy_versions') IS NOT NULL THEN
    RAISE EXCEPTION 'M204_ALREADY_APPLIED';
  END IF;
  IF to_regprocedure('wardah_internal.manufacturing_settings_can_update_201(uuid)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL
     OR to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL
     OR to_regprocedure('public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)') IS NULL
     OR to_regprocedure('public.normalize_mo_status(text)') IS NULL
     OR (SELECT count(*) FROM public.permissions
         WHERE permission_key IN ('manufacturing.settings.read','manufacturing.settings.update')) <> 2 THEN
    RAISE EXCEPTION 'M204_REQUIRES_M201_THROUGH_M203';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Policy storage. Private schema, no client privileges; RPCs are the only
--    path. A version is never edited after creation: a change is a new version
--    with a later effective date, and a version no order is pinned to may be
--    withdrawn before it takes effect.
-- ---------------------------------------------------------------------------
CREATE TABLE wardah_internal.mfg_cost_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  effective_from date NOT NULL,
  labor_cost_source text NOT NULL
    CHECK (labor_cost_source IN ('work_center_rate','recorded_entry_rate')),
  default_labor_rate_per_hour numeric(18,6)
    CHECK (default_labor_rate_per_hour IS NULL OR default_labor_rate_per_hour > 0),
  stage_costing_method text NOT NULL DEFAULT 'weighted_average'
    CHECK (stage_costing_method = 'weighted_average'),
  -- When orders created under this version are pinned: on creation, or on
  -- their first start of production. Saved on each order at its creation.
  pin_event text NOT NULL CHECK (pin_event IN ('mo_created','production_started')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text,
  CONSTRAINT mfg_cost_policy_labor_rate_matches_source CHECK (
    (labor_cost_source = 'work_center_rate' AND default_labor_rate_per_hour IS NOT NULL)
    OR (labor_cost_source = 'recorded_entry_rate' AND default_labor_rate_per_hour IS NULL)),
  CONSTRAINT mfg_cost_policy_withdrawal_complete CHECK (
    (withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdraw_reason IS NULL)
    OR (withdrawn_at IS NOT NULL AND withdraw_reason IS NOT NULL)),
  UNIQUE (org_id, version_no),
  UNIQUE (org_id, idempotency_key),
  UNIQUE (id, org_id)
);
-- No two live versions start on the same day: effective ranges are derived from
-- the ordered start dates, so overlap is impossible by construction.
CREATE UNIQUE INDEX mfg_cost_policy_versions_live_start
  ON wardah_internal.mfg_cost_policy_versions (org_id, effective_from)
  WHERE withdrawn_at IS NULL;

CREATE TABLE wardah_internal.mfg_cost_policy_pools (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  pool_code text NOT NULL CHECK (pool_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  name_ar text CHECK (name_ar IS NULL OR length(btrim(name_ar)) BETWEEN 1 AND 120),
  basis text NOT NULL CHECK (basis IN ('labor_hours','machine_hours')),
  basis_uom text NOT NULL DEFAULT 'hour' CHECK (basis_uom = 'hour'),
  rate numeric(18,6) NOT NULL CHECK (rate > 0),
  PRIMARY KEY (policy_version_id, pool_code),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);

CREATE TABLE wardah_internal.mfg_cost_policy_wc_rules (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  work_center_id uuid NOT NULL REFERENCES public.work_centers(id) ON DELETE CASCADE,
  labor_rate_per_hour numeric(18,6) CHECK (labor_rate_per_hour IS NULL OR labor_rate_per_hour > 0),
  PRIMARY KEY (policy_version_id, work_center_id),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);

-- A work center may override a pool's rate or exclude the pool. It may not
-- change the pool's basis: the basis belongs to the pool, so one pool can never
-- be absorbed on two drivers.
CREATE TABLE wardah_internal.mfg_cost_policy_wc_pool_rules (
  policy_version_id uuid NOT NULL,
  org_id uuid NOT NULL,
  work_center_id uuid NOT NULL,
  pool_code text NOT NULL,
  applies boolean NOT NULL,
  rate numeric(18,6),
  CHECK ((applies AND rate IS NOT NULL AND rate > 0) OR (NOT applies AND rate IS NULL)),
  PRIMARY KEY (policy_version_id, work_center_id, pool_code),
  FOREIGN KEY (policy_version_id, work_center_id)
    REFERENCES wardah_internal.mfg_cost_policy_wc_rules(policy_version_id, work_center_id) ON DELETE CASCADE,
  FOREIGN KEY (policy_version_id, pool_code)
    REFERENCES wardah_internal.mfg_cost_policy_pools(policy_version_id, pool_code) ON DELETE CASCADE,
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);

-- The pin timing an MO took at creation, from the version in force that day.
-- Set once; a later version with another pin_event does not change it. No
-- version in force at creation -> no row, and the order is never pinned.
CREATE TABLE wardah_internal.mo_cost_policy_pin_timing (
  mo_id uuid PRIMARY KEY REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  pin_event text NOT NULL CHECK (pin_event IN ('mo_created','production_started')),
  timing_source_version_id uuid NOT NULL,
  decided_on date NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (timing_source_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);
CREATE INDEX mo_cost_policy_pin_timing_version
  ON wardah_internal.mo_cost_policy_pin_timing (timing_source_version_id);

-- The cost version an MO is pinned to, at its saved event. Set once; never
-- re-resolved.
CREATE TABLE wardah_internal.mo_cost_policy_pins (
  mo_id uuid PRIMARY KEY REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  pinned_on date NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_by uuid,
  pin_source text NOT NULL CHECK (pin_source IN ('mo_created','production_started')),
  FOREIGN KEY (policy_version_id, org_id)
    REFERENCES wardah_internal.mfg_cost_policy_versions(id, org_id) ON DELETE CASCADE
);
CREATE INDEX mo_cost_policy_pins_version ON wardah_internal.mo_cost_policy_pins (policy_version_id);

REVOKE ALL ON wardah_internal.mfg_cost_policy_versions,
              wardah_internal.mfg_cost_policy_pools,
              wardah_internal.mfg_cost_policy_wc_rules,
              wardah_internal.mfg_cost_policy_wc_pool_rules,
              wardah_internal.mo_cost_policy_pin_timing,
              wardah_internal.mo_cost_policy_pins
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE wardah_internal.mfg_cost_policy_versions IS
  'Migration 204: per-org manufacturing cost policy versions (immutable; withdrawable only before use). See docs/db/MANUFACTURING_COST_POLICIES_204_RUNBOOK.md.';
COMMENT ON TABLE wardah_internal.mo_cost_policy_pin_timing IS
  'Migration 204: the pin timing (pin_event) each MO took at creation from the version in force in the org timezone that day.';
COMMENT ON TABLE wardah_internal.mo_cost_policy_pins IS
  'Migration 204: the cost policy version each MO is pinned to, once, at its saved pin timing (creation or first start of production).';

-- ---------------------------------------------------------------------------
-- 2. Immutability. Rows change only by withdrawal of a version; deletes happen
--    only as cascades after the organization, MO or work center is gone.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.mfg_cost_policy_immutable_204()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old jsonb := to_jsonb(OLD);
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allowed only as the cascade of a parent that is already gone.
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = (v_old->>'org_id')::uuid)
       OR (v_old ? 'mo_id' AND NOT EXISTS (
             SELECT 1 FROM public.manufacturing_orders WHERE id = (v_old->>'mo_id')::uuid))
       OR (v_old ? 'work_center_id' AND NOT EXISTS (
             SELECT 1 FROM public.work_centers WHERE id = (v_old->>'work_center_id')::uuid))
       OR (v_old ? 'policy_version_id' AND NOT EXISTS (
             SELECT 1 FROM wardah_internal.mfg_cost_policy_versions
             WHERE id = (v_old->>'policy_version_id')::uuid)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_IMMUTABLE';
  END IF;
  IF TG_TABLE_NAME = 'mfg_cost_policy_versions'
     AND v_old->>'withdrawn_at' IS NULL AND to_jsonb(NEW)->>'withdrawn_at' IS NOT NULL
     AND (to_jsonb(NEW) - ARRAY['withdrawn_at','withdrawn_by','withdraw_reason'])
       = (v_old - ARRAY['withdrawn_at','withdrawn_by','withdraw_reason']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_IMMUTABLE';
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_immutable_204()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mfg_cost_policy_versions_immutable_204
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_versions
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_pools_immutable_204
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_pools
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_wc_rules_immutable_204
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_wc_rules
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mfg_cost_policy_wc_pool_rules_immutable_204
BEFORE UPDATE OR DELETE ON wardah_internal.mfg_cost_policy_wc_pool_rules
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mo_cost_policy_pin_timing_immutable_204
BEFORE UPDATE OR DELETE ON wardah_internal.mo_cost_policy_pin_timing
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();
CREATE TRIGGER mo_cost_policy_pins_immutable_204
BEFORE UPDATE OR DELETE ON wardah_internal.mo_cost_policy_pins
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_cost_policy_immutable_204();

-- One organization per order: a timing or pin row must carry the order's own
-- org (its version is already tied to that org by the composite foreign key).
CREATE FUNCTION wardah_internal.mo_cost_policy_org_match_204()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.manufacturing_orders
                 WHERE id = NEW.mo_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'COST_POLICY_ORG_MISMATCH';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mo_cost_policy_org_match_204()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mo_cost_policy_pin_timing_org_match_204
BEFORE INSERT ON wardah_internal.mo_cost_policy_pin_timing
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mo_cost_policy_org_match_204();
CREATE TRIGGER mo_cost_policy_pins_org_match_204
BEFORE INSERT ON wardah_internal.mo_cost_policy_pins
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mo_cost_policy_org_match_204();

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (no client EXECUTE).
-- ---------------------------------------------------------------------------

-- "Today" in the organization's own timezone. Strict callers (policy writers)
-- refuse an unknown timezone; the MO pin trigger falls back to UTC so a bad
-- timezone value can never block MO creation.
CREATE FUNCTION wardah_internal.mfg_cost_policy_org_today_204(p_org uuid, p_strict boolean)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE v_tz text;
BEGIN
  SELECT NULLIF(btrim(timezone), '') INTO v_tz FROM public.organizations WHERE id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_ORG_MISSING';
  END IF;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
    IF p_strict THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_ORG_TIMEZONE_INVALID';
    END IF;
    v_tz := 'UTC';
  END IF;
  RETURN (now() AT TIME ZONE v_tz)::date;
END
$fn$;

-- The live version in force on p_date: latest start on or before that day.
CREATE FUNCTION wardah_internal.mfg_cost_policy_version_at_204(p_org uuid, p_date date)
RETURNS uuid LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT v.id FROM wardah_internal.mfg_cost_policy_versions v
  WHERE v.org_id = p_org AND v.withdrawn_at IS NULL AND v.effective_from <= p_date
  ORDER BY v.effective_from DESC
  LIMIT 1;
$fn$;

CREATE FUNCTION wardah_internal.mfg_cost_policy_can_read_204(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT wardah_internal.manufacturing_settings_can_update_201(p_org)
      OR COALESCE(public.has_permission(auth.uid(), p_org, 'manufacturing.settings.read'), false);
$fn$;

CREATE FUNCTION wardah_internal.mfg_cost_policy_version_json_204(p_version uuid, p_today date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'id', v.id,
    'version_no', v.version_no,
    'effective_from', v.effective_from,
    'status', CASE
      WHEN v.withdrawn_at IS NOT NULL THEN 'withdrawn'
      WHEN v.effective_from > p_today THEN 'scheduled'
      WHEN v.id = wardah_internal.mfg_cost_policy_version_at_204(v.org_id, p_today) THEN 'current'
      ELSE 'superseded' END,
    'labor_cost_source', v.labor_cost_source,
    'default_labor_rate_per_hour', v.default_labor_rate_per_hour,
    'stage_costing_method', v.stage_costing_method,
    'pin_event', v.pin_event,
    'note', v.note,
    'created_at', v.created_at,
    'created_by', v.created_by,
    'withdrawn_at', v.withdrawn_at,
    'withdrawn_by', v.withdrawn_by,
    'withdraw_reason', v.withdraw_reason,
    'pinned_order_count',
      (SELECT count(*) FROM wardah_internal.mo_cost_policy_pins p WHERE p.policy_version_id = v.id),
    'awaiting_start_order_count',
      (SELECT count(*) FROM wardah_internal.mo_cost_policy_pin_timing t
       WHERE t.timing_source_version_id = v.id AND t.pin_event = 'production_started'
         AND NOT EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins p WHERE p.mo_id = t.mo_id)),
    'overhead_pools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'pool_code', p.pool_code, 'name', p.name, 'name_ar', p.name_ar,
               'basis', p.basis, 'basis_uom', p.basis_uom, 'rate', p.rate)
             ORDER BY p.pool_code)
      FROM wardah_internal.mfg_cost_policy_pools p WHERE p.policy_version_id = v.id), '[]'::jsonb),
    'work_center_rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'work_center_id', r.work_center_id,
               'work_center_code', wc.code,
               'work_center_name', wc.name,
               'work_center_name_ar', wc.name_ar,
               'labor_rate_per_hour', r.labor_rate_per_hour,
               'pools', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'pool_code', pr.pool_code, 'applies', pr.applies, 'rate', pr.rate)
                        ORDER BY pr.pool_code)
                 FROM wardah_internal.mfg_cost_policy_wc_pool_rules pr
                 WHERE pr.policy_version_id = r.policy_version_id
                   AND pr.work_center_id = r.work_center_id), '[]'::jsonb))
             ORDER BY wc.code, r.work_center_id)
      FROM wardah_internal.mfg_cost_policy_wc_rules r
      JOIN public.work_centers wc ON wc.id = r.work_center_id
      WHERE r.policy_version_id = v.id), '[]'::jsonb))
  FROM wardah_internal.mfg_cost_policy_versions v
  WHERE v.id = p_version;
$fn$;

-- Absorption for one work center and one set of measured drivers under one
-- pinned version. Called by the stage-cost engine (#260) and the completion
-- orchestrator (#230); the preview RPC exposes it read-only. Rules:
--   * labor: work_center_rate -> labor hours x (work-center rule rate, else the
--     version default); recorded_entry_rate -> the recorded labor cost passed in
--     (sum of the tracked entries' own cost), never re-priced;
--   * each pool once: excluded at this work center -> no line; otherwise driver
--     hours of the pool's basis x (work-center rule rate, else pool rate);
--   * a driver that a line needs and is NULL raises COST_POLICY_DRIVER_MISSING;
--     an input the version does not use raises COST_POLICY_INPUT_NOT_APPLICABLE;
--   * amounts are rounded to 2 decimals per line; totals are sums of the
--     rounded lines.
CREATE FUNCTION wardah_internal.mfg_cost_policy_compute_204(
  p_org uuid, p_version uuid, p_work_center uuid,
  p_labor_hours numeric, p_machine_hours numeric, p_recorded_labor_cost numeric
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_version wardah_internal.mfg_cost_policy_versions%ROWTYPE;
  v_rule wardah_internal.mfg_cost_policy_wc_rules%ROWTYPE;
  v_pool record;
  v_labor_rate numeric;
  v_labor_rate_source text;
  v_labor_amount numeric;
  v_driver numeric;
  v_rate numeric;
  v_amount numeric;
  v_lines jsonb := '[]'::jsonb;
  v_excluded jsonb := '[]'::jsonb;
  v_oh_total numeric := 0;
BEGIN
  SELECT * INTO v_version FROM wardah_internal.mfg_cost_policy_versions
  WHERE id = p_version AND org_id = p_org AND withdrawn_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_UNKNOWN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_centers WHERE id = p_work_center AND org_id = p_org) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_WORK_CENTER_UNKNOWN';
  END IF;
  IF p_labor_hours < 0 OR p_machine_hours < 0 OR p_recorded_labor_cost < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRIVER_INVALID';
  END IF;

  SELECT * INTO v_rule FROM wardah_internal.mfg_cost_policy_wc_rules
  WHERE policy_version_id = p_version AND work_center_id = p_work_center;

  IF v_version.labor_cost_source = 'work_center_rate' THEN
    IF p_recorded_labor_cost IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'COST_POLICY_INPUT_NOT_APPLICABLE: recorded_labor_cost';
    END IF;
    IF p_labor_hours IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_DRIVER_MISSING: labor_hours';
    END IF;
    IF v_rule.labor_rate_per_hour IS NOT NULL THEN
      v_labor_rate := v_rule.labor_rate_per_hour;
      v_labor_rate_source := 'work_center_rule';
    ELSE
      v_labor_rate := v_version.default_labor_rate_per_hour;
      v_labor_rate_source := 'policy_default';
    END IF;
    v_labor_amount := round(p_labor_hours * v_labor_rate, 2);
  ELSE
    IF p_recorded_labor_cost IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'COST_POLICY_DRIVER_MISSING: recorded_labor_cost';
    END IF;
    v_labor_rate := NULL;
    v_labor_rate_source := 'recorded_entries';
    v_labor_amount := round(p_recorded_labor_cost, 2);
  END IF;

  FOR v_pool IN
    SELECT p.pool_code, p.basis, p.rate AS pool_rate, pr.applies, pr.rate AS rule_rate
    FROM wardah_internal.mfg_cost_policy_pools p
    LEFT JOIN wardah_internal.mfg_cost_policy_wc_pool_rules pr
      ON pr.policy_version_id = p.policy_version_id
     AND pr.pool_code = p.pool_code
     AND pr.work_center_id = p_work_center
    WHERE p.policy_version_id = p_version
    ORDER BY p.pool_code
  LOOP
    IF v_pool.applies IS FALSE THEN
      v_excluded := v_excluded || to_jsonb(v_pool.pool_code);
      CONTINUE;
    END IF;
    v_driver := CASE v_pool.basis WHEN 'labor_hours' THEN p_labor_hours ELSE p_machine_hours END;
    IF v_driver IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'COST_POLICY_DRIVER_MISSING: ' || v_pool.basis;
    END IF;
    v_rate := COALESCE(v_pool.rule_rate, v_pool.pool_rate);
    v_amount := round(v_driver * v_rate, 2);
    v_oh_total := v_oh_total + v_amount;
    v_lines := v_lines || jsonb_build_object(
      'pool_code', v_pool.pool_code,
      'basis', v_pool.basis,
      'driver_hours', v_driver,
      'rate_per_hour', v_rate,
      'rate_source', CASE WHEN v_pool.rule_rate IS NOT NULL THEN 'work_center_rule' ELSE 'policy_default' END,
      'amount', v_amount);
  END LOOP;

  RETURN jsonb_build_object(
    'policy_version_id', v_version.id,
    'version_no', v_version.version_no,
    'work_center_id', p_work_center,
    'stage_costing_method', v_version.stage_costing_method,
    'labor', jsonb_build_object(
      'source', v_version.labor_cost_source,
      'hours', p_labor_hours,
      'rate_per_hour', v_labor_rate,
      'rate_source', v_labor_rate_source,
      'amount', v_labor_amount),
    'overhead', v_lines,
    'excluded_pools', v_excluded,
    'overhead_total', v_oh_total,
    'total', v_labor_amount + v_oh_total);
END
$fn$;

REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_org_today_204(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_version_at_204(uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_can_read_204(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_version_json_204(uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mfg_cost_policy_compute_204(uuid, uuid, uuid, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Pin timing and pin. Every creation and transition path writes
--    manufacturing_orders, so neither depends on which RPC is used, and neither
--    grants a transition: they run only when a write the caller was already
--    allowed to make happens, inside that write's transaction.
--    * Creation: the version in force that day decides the order's pin timing
--      (saved once). No live version that day -> no timing, never a pin; the
--      engine then refuses the order (COST_POLICY_NOT_PINNED).
--    * Pin: once, at the saved event. mo_created -> in the creation
--      transaction. production_started -> in the transaction of the order's
--      first transition to in_progress (or its insertion as in_progress), to
--      the version in force that day; restarts after on_hold/quality_check
--      keep the pin.
--    * "Day" is now() in the org timezone: the transaction's start time.
--    The shared per-org lock waits for an in-flight create/withdraw to commit
--    and the versions are read after it, so an order is never pinned to, or
--    timed by, a version being withdrawn; orders in one org do not block each
--    other.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.pin_mo_cost_policy_204()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_day date;
  v_version uuid;
  v_event text;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('wardah.mfg_cost_policy:' || NEW.org_id::text, 204));
  v_day := wardah_internal.mfg_cost_policy_org_today_204(NEW.org_id, false);
  v_version := wardah_internal.mfg_cost_policy_version_at_204(NEW.org_id, v_day);
  IF v_version IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT pin_event INTO v_event FROM wardah_internal.mfg_cost_policy_versions WHERE id = v_version;
  INSERT INTO wardah_internal.mo_cost_policy_pin_timing
    (mo_id, org_id, pin_event, timing_source_version_id, decided_on)
  VALUES (NEW.id, NEW.org_id, v_event, v_version, v_day);
  -- Pinned now when the timing is creation, or when the order is inserted
  -- already started (the status machine runs on UPDATE only).
  IF v_event = 'mo_created' OR public.normalize_mo_status(NEW.status) = 'in_progress' THEN
    INSERT INTO wardah_internal.mo_cost_policy_pins
      (mo_id, org_id, policy_version_id, pinned_on, pinned_by, pin_source)
    VALUES (NEW.id, NEW.org_id, v_version, v_day, auth.uid(), v_event);
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.pin_mo_cost_policy_204()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pin_mo_cost_policy_204
AFTER INSERT ON public.manufacturing_orders
FOR EACH ROW EXECUTE FUNCTION wardah_internal.pin_mo_cost_policy_204();
-- Re-closed after the trigger statement, as in 199: the DEFINER scanner treats
-- the CREATE TRIGGER as an effect it cannot prove and requires closure after it.
REVOKE ALL ON FUNCTION wardah_internal.pin_mo_cost_policy_204()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION wardah_internal.pin_mo_cost_policy_on_start_204()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_day date;
  v_version uuid;
BEGIN
  IF public.normalize_mo_status(NEW.status) IS DISTINCT FROM 'in_progress'
     OR public.normalize_mo_status(OLD.status) IS NOT DISTINCT FROM 'in_progress'
     OR NOT EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pin_timing
                    WHERE mo_id = NEW.id AND pin_event = 'production_started') THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('wardah.mfg_cost_policy:' || NEW.org_id::text, 204));
  -- Read after the lock wait.
  IF EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = NEW.id) THEN
    RETURN NULL;
  END IF;
  v_day := wardah_internal.mfg_cost_policy_org_today_204(NEW.org_id, false);
  v_version := wardah_internal.mfg_cost_policy_version_at_204(NEW.org_id, v_day);
  IF v_version IS NULL THEN
    -- Only when the org timezone moved "today" before the timing source's start.
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_START_PIN_UNRESOLVED';
  END IF;
  INSERT INTO wardah_internal.mo_cost_policy_pins
    (mo_id, org_id, policy_version_id, pinned_on, pinned_by, pin_source)
  VALUES (NEW.id, NEW.org_id, v_version, v_day, auth.uid(), 'production_started')
  ON CONFLICT (mo_id) DO NOTHING;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.pin_mo_cost_policy_on_start_204()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pin_mo_cost_policy_on_start_204
AFTER UPDATE OF status ON public.manufacturing_orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION wardah_internal.pin_mo_cost_policy_on_start_204();
-- Both DEFINER trigger functions re-closed after the last trigger statement.
REVOKE ALL ON FUNCTION wardah_internal.pin_mo_cost_policy_on_start_204()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.pin_mo_cost_policy_204()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Client RPCs (authenticated only).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rpc_get_mfg_cost_policy(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today date;
  v_current uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.mfg_cost_policy_can_read_204(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_READ_DENIED';
  END IF;
  v_today := wardah_internal.mfg_cost_policy_org_today_204(p_org_id, false);
  v_current := wardah_internal.mfg_cost_policy_version_at_204(p_org_id, v_today);
  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'today', v_today,
    'current_version_id', v_current,
    'latest_version_no', COALESCE((SELECT max(version_no)
      FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = p_org_id), 0),
    'versions', COALESCE((
      SELECT jsonb_agg(wardah_internal.mfg_cost_policy_version_json_204(v.id, v_today)
                       ORDER BY v.version_no DESC)
      FROM wardah_internal.mfg_cost_policy_versions v WHERE v.org_id = p_org_id), '[]'::jsonb),
    'supported', jsonb_build_object(
      'labor_cost_sources', jsonb_build_array('work_center_rate','recorded_entry_rate'),
      'overhead_bases', jsonb_build_array('labor_hours','machine_hours'),
      'stage_costing_methods', jsonb_build_array('weighted_average'),
      'pin_events', jsonb_build_array('mo_created','production_started')),
    'capabilities', jsonb_build_object(
      'can_manage', wardah_internal.manufacturing_settings_can_update_201(p_org_id)));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_get_mfg_cost_policy(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_mfg_cost_policy(uuid) TO authenticated;

CREATE FUNCTION public.rpc_create_mfg_cost_policy_version(
  p_org_id uuid, p_policy jsonb, p_expected_latest_version_no integer, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  C_MAX_RATE CONSTANT numeric := 999999999;
  v_hash text;
  v_existing wardah_internal.mfg_cost_policy_versions%ROWTYPE;
  v_latest_no integer;
  v_latest_start date;
  v_today date;
  v_unknown text;
  v_effective date;
  v_source text;
  v_default_labor numeric;
  v_note text;
  v_pin_event text;
  v_version_id uuid;
  v_item jsonb;
  v_sub jsonb;
  v_idx bigint;
  v_sub_idx bigint;
  v_rate numeric;
  v_wc uuid;
  v_pool_codes text[] := ARRAY[]::text[];
  v_wcs uuid[] := ARRAY[]::uuid[];
  v_rule_pools text[];
  v_has_labor boolean;
  v_after jsonb;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID';
  END IF;
  v_hash := md5(p_policy::text);

  -- One writer per organization at a time; replay and version checks run under it.
  PERFORM pg_advisory_xact_lock(hashtextextended('wardah.mfg_cost_policy:' || p_org_id::text, 204));

  SELECT * INTO v_existing FROM wardah_internal.mfg_cost_policy_versions
  WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN public.rpc_get_mfg_cost_policy(p_org_id)
      || jsonb_build_object('policy_version_id', v_existing.id, 'replayed', true);
  END IF;

  SELECT COALESCE(max(version_no), 0) INTO v_latest_no
  FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = p_org_id;
  IF p_expected_latest_version_no IS NULL OR p_expected_latest_version_no <> v_latest_no THEN
    RAISE EXCEPTION 'COST_POLICY_VERSION_CONFLICT: latest=%', v_latest_no;
  END IF;

  SELECT min(k) INTO v_unknown FROM jsonb_object_keys(p_policy) k
  WHERE k NOT IN ('effective_from','labor_cost_source','default_labor_rate_per_hour',
                  'stage_costing_method','pin_event','note','overhead_pools','work_center_rules');
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_UNKNOWN_KEY: ' || v_unknown;
  END IF;

  -- Effective date: today or later in the org's timezone, strictly after every
  -- live version's start. No retroactive versions, no overlap.
  IF jsonb_typeof(p_policy->'effective_from') IS DISTINCT FROM 'string'
     OR (p_policy->>'effective_from') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: effective_from';
  END IF;
  BEGIN
    v_effective := (p_policy->>'effective_from')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: effective_from';
  END;
  v_today := wardah_internal.mfg_cost_policy_org_today_204(p_org_id, true);
  IF v_effective < v_today THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_EFFECTIVE_DATE_IN_PAST';
  END IF;
  SELECT max(effective_from) INTO v_latest_start
  FROM wardah_internal.mfg_cost_policy_versions
  WHERE org_id = p_org_id AND withdrawn_at IS NULL;
  IF v_latest_start IS NOT NULL AND v_effective <= v_latest_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'COST_POLICY_EFFECTIVE_DATE_NOT_AFTER_LATEST: latest=' || v_latest_start;
  END IF;

  -- Labor source and its rate.
  v_source := p_policy->>'labor_cost_source';
  IF jsonb_typeof(p_policy->'labor_cost_source') IS DISTINCT FROM 'string'
     OR v_source NOT IN ('work_center_rate','recorded_entry_rate') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LABOR_SOURCE_UNSUPPORTED';
  END IF;
  IF v_source = 'work_center_rate' THEN
    IF jsonb_typeof(p_policy->'default_labor_rate_per_hour') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_LABOR_RATE_MISSING';
    END IF;
    v_default_labor := (p_policy->>'default_labor_rate_per_hour')::numeric;
    IF v_default_labor <= 0 OR v_default_labor > C_MAX_RATE OR scale(v_default_labor) > 6 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'COST_POLICY_RATE_INVALID: default_labor_rate_per_hour';
    END IF;
  ELSIF COALESCE(jsonb_typeof(p_policy->'default_labor_rate_per_hour'), 'null') <> 'null' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'COST_POLICY_LABOR_RATE_NOT_APPLICABLE: default_labor_rate_per_hour';
  END IF;

  IF COALESCE(jsonb_typeof(p_policy->'stage_costing_method'), 'null') <> 'null'
     AND (jsonb_typeof(p_policy->'stage_costing_method') <> 'string'
          OR p_policy->>'stage_costing_method' <> 'weighted_average') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_STAGE_METHOD_UNSUPPORTED';
  END IF;

  -- Pin timing: required, one of the implemented events.
  IF jsonb_typeof(p_policy->'pin_event') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: pin_event';
  END IF;
  v_pin_event := p_policy->>'pin_event';
  IF v_pin_event NOT IN ('mo_created','production_started') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_PIN_EVENT_UNSUPPORTED';
  END IF;

  IF COALESCE(jsonb_typeof(p_policy->'note'), 'null') NOT IN ('null','string')
     OR length(p_policy->>'note') > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: note';
  END IF;
  v_note := NULLIF(btrim(p_policy->>'note'), '');

  -- Overhead pools: at least one, unique codes, supported basis, positive rate.
  IF jsonb_typeof(p_policy->'overhead_pools') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_policy->'overhead_pools') = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_POOLS_REQUIRED';
  END IF;
  IF jsonb_array_length(p_policy->'overhead_pools') > 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: overhead_pools';
  END IF;
  FOR v_item, v_idx IN SELECT e, o FROM jsonb_array_elements(p_policy->'overhead_pools') WITH ORDINALITY AS t(e, o) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: overhead_pools[%s]', v_idx);
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_item) k
    WHERE k NOT IN ('pool_code','name','name_ar','basis','rate');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_UNKNOWN_KEY: overhead_pools[%s].%s', v_idx, v_unknown);
    END IF;
    IF jsonb_typeof(v_item->'pool_code') IS DISTINCT FROM 'string'
       OR (v_item->>'pool_code') !~ '^[A-Z][A-Z0-9_]{1,29}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_INVALID: overhead_pools[%s].pool_code', v_idx);
    END IF;
    IF (v_item->>'pool_code') = ANY (v_pool_codes) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'COST_POLICY_POOL_DUPLICATE: ' || (v_item->>'pool_code');
    END IF;
    v_pool_codes := v_pool_codes || (v_item->>'pool_code');
    IF jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
       OR length(btrim(v_item->>'name')) NOT BETWEEN 1 AND 120
       OR COALESCE(jsonb_typeof(v_item->'name_ar'), 'null') NOT IN ('null','string')
       OR (jsonb_typeof(v_item->'name_ar') = 'string'
           AND length(btrim(v_item->>'name_ar')) NOT BETWEEN 1 AND 120) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_INVALID: overhead_pools[%s].name', v_idx);
    END IF;
    IF jsonb_typeof(v_item->'basis') IS DISTINCT FROM 'string'
       OR (v_item->>'basis') NOT IN ('labor_hours','machine_hours') THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_POOL_BASIS_UNSUPPORTED: overhead_pools[%s]', v_idx);
    END IF;
    IF jsonb_typeof(v_item->'rate') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_RATE_INVALID: overhead_pools[%s].rate', v_idx);
    END IF;
    v_rate := (v_item->>'rate')::numeric;
    IF v_rate <= 0 OR v_rate > C_MAX_RATE OR scale(v_rate) > 6 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_RATE_INVALID: overhead_pools[%s].rate', v_idx);
    END IF;
  END LOOP;

  -- Work-center rules: active work centers of this org, each once; a labor
  -- override only where the labor source uses rates; pool rules only for pools
  -- of this version, each once; an empty rule is refused.
  IF COALESCE(jsonb_typeof(p_policy->'work_center_rules'), 'null') NOT IN ('null','array') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: work_center_rules';
  END IF;
  IF jsonb_array_length(COALESCE(NULLIF(p_policy->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_INVALID: work_center_rules';
  END IF;
  FOR v_item, v_idx IN
    SELECT e, o FROM jsonb_array_elements(COALESCE(NULLIF(p_policy->'work_center_rules', 'null'::jsonb), '[]'::jsonb))
    WITH ORDINALITY AS t(e, o)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s]', v_idx);
    END IF;
    SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_item) k
    WHERE k NOT IN ('work_center_id','labor_rate_per_hour','pools');
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_UNKNOWN_KEY: work_center_rules[%s].%s', v_idx, v_unknown);
    END IF;
    BEGIN
      v_wc := (v_item->>'work_center_id')::uuid;
    EXCEPTION WHEN others THEN
      v_wc := NULL;
    END;
    IF jsonb_typeof(v_item->'work_center_id') IS DISTINCT FROM 'string' OR v_wc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.work_centers
                      WHERE id = v_wc AND org_id = p_org_id AND is_active IS TRUE) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_WORK_CENTER_UNKNOWN: work_center_rules[%s]', v_idx);
    END IF;
    IF v_wc = ANY (v_wcs) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_WORK_CENTER_DUPLICATE: work_center_rules[%s]', v_idx);
    END IF;
    v_wcs := v_wcs || v_wc;
    v_has_labor := COALESCE(jsonb_typeof(v_item->'labor_rate_per_hour'), 'null') <> 'null';
    IF v_has_labor THEN
      IF v_source <> 'work_center_rate' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_LABOR_RATE_NOT_APPLICABLE: work_center_rules[%s]', v_idx);
      END IF;
      IF jsonb_typeof(v_item->'labor_rate_per_hour') <> 'number' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_RATE_INVALID: work_center_rules[%s].labor_rate_per_hour', v_idx);
      END IF;
      v_rate := (v_item->>'labor_rate_per_hour')::numeric;
      IF v_rate <= 0 OR v_rate > C_MAX_RATE OR scale(v_rate) > 6 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_RATE_INVALID: work_center_rules[%s].labor_rate_per_hour', v_idx);
      END IF;
    END IF;
    IF COALESCE(jsonb_typeof(v_item->'pools'), 'null') NOT IN ('null','array') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s].pools', v_idx);
    END IF;
    IF NOT v_has_labor
       AND jsonb_array_length(COALESCE(NULLIF(v_item->'pools', 'null'::jsonb), '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('COST_POLICY_WC_RULE_EMPTY: work_center_rules[%s]', v_idx);
    END IF;
    v_rule_pools := ARRAY[]::text[];
    FOR v_sub, v_sub_idx IN
      SELECT e, o FROM jsonb_array_elements(COALESCE(NULLIF(v_item->'pools', 'null'::jsonb), '[]'::jsonb))
      WITH ORDINALITY AS t(e, o)
    LOOP
      IF jsonb_typeof(v_sub) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
      SELECT min(k) INTO v_unknown FROM jsonb_object_keys(v_sub) k
      WHERE k NOT IN ('pool_code','applies','rate');
      IF v_unknown IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_UNKNOWN_KEY: work_center_rules[%s].pools[%s].%s', v_idx, v_sub_idx, v_unknown);
      END IF;
      IF jsonb_typeof(v_sub->'pool_code') IS DISTINCT FROM 'string'
         OR NOT ((v_sub->>'pool_code') = ANY (v_pool_codes)) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_WC_POOL_UNKNOWN: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
      IF (v_sub->>'pool_code') = ANY (v_rule_pools) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_WC_POOL_DUPLICATE: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
      v_rule_pools := v_rule_pools || (v_sub->>'pool_code');
      IF jsonb_typeof(v_sub->'applies') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_INVALID: work_center_rules[%s].pools[%s].applies', v_idx, v_sub_idx);
      END IF;
      IF (v_sub->>'applies')::boolean THEN
        IF jsonb_typeof(v_sub->'rate') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = format('COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
        END IF;
        v_rate := (v_sub->>'rate')::numeric;
        IF v_rate <= 0 OR v_rate > C_MAX_RATE OR scale(v_rate) > 6 THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = format('COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
        END IF;
      ELSIF COALESCE(jsonb_typeof(v_sub->'rate'), 'null') <> 'null' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[%s].pools[%s]', v_idx, v_sub_idx);
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO wardah_internal.mfg_cost_policy_versions
    (org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour,
     stage_costing_method, pin_event, note, idempotency_key, payload_hash, created_by)
  VALUES (p_org_id, v_latest_no + 1, v_effective, v_source, v_default_labor,
          'weighted_average', v_pin_event, v_note, p_idempotency_key, v_hash, auth.uid())
  RETURNING id INTO v_version_id;

  INSERT INTO wardah_internal.mfg_cost_policy_pools
    (policy_version_id, org_id, pool_code, name, name_ar, basis, rate)
  SELECT v_version_id, p_org_id, e->>'pool_code', btrim(e->>'name'),
         NULLIF(btrim(e->>'name_ar'), ''), e->>'basis', (e->>'rate')::numeric
  FROM jsonb_array_elements(p_policy->'overhead_pools') e;

  INSERT INTO wardah_internal.mfg_cost_policy_wc_rules
    (policy_version_id, org_id, work_center_id, labor_rate_per_hour)
  SELECT v_version_id, p_org_id, (e->>'work_center_id')::uuid,
         CASE WHEN COALESCE(jsonb_typeof(e->'labor_rate_per_hour'), 'null') = 'null' THEN NULL
              ELSE (e->>'labor_rate_per_hour')::numeric END
  FROM jsonb_array_elements(COALESCE(NULLIF(p_policy->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) e;

  INSERT INTO wardah_internal.mfg_cost_policy_wc_pool_rules
    (policy_version_id, org_id, work_center_id, pool_code, applies, rate)
  SELECT v_version_id, p_org_id, (e->>'work_center_id')::uuid, pr->>'pool_code',
         (pr->>'applies')::boolean,
         CASE WHEN (pr->>'applies')::boolean THEN (pr->>'rate')::numeric ELSE NULL END
  FROM jsonb_array_elements(COALESCE(NULLIF(p_policy->'work_center_rules', 'null'::jsonb), '[]'::jsonb)) e
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(e->'pools', 'null'::jsonb), '[]'::jsonb)) pr;

  v_after := wardah_internal.mfg_cost_policy_version_json_204(v_version_id, v_today);
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.create', 'mfg_cost_policy_version',
    v_version_id::text, NULL, v_after,
    jsonb_build_object('source', 'rpc_create_mfg_cost_policy_version', 'migration', 204,
                       'idempotency_key', p_idempotency_key));

  RETURN public.rpc_get_mfg_cost_policy(p_org_id)
    || jsonb_build_object('policy_version_id', v_version_id, 'replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_create_mfg_cost_policy_version(uuid, jsonb, integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_mfg_cost_policy_version(uuid, jsonb, integer, uuid) TO authenticated;

-- Withdraw a version before it is used: it must start today or later, no order
-- may be pinned to it and no order may have taken its pin timing from it. Used
-- or past versions stay as they are; a correction is a new version with a
-- later start.
CREATE FUNCTION public.rpc_withdraw_mfg_cost_policy_version(
  p_org_id uuid, p_policy_version_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_version wardah_internal.mfg_cost_policy_versions%ROWTYPE;
  v_today date;
  v_before jsonb;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_WITHDRAW_REASON_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wardah.mfg_cost_policy:' || p_org_id::text, 204));
  SELECT * INTO v_version FROM wardah_internal.mfg_cost_policy_versions
  WHERE id = p_policy_version_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_UNKNOWN';
  END IF;
  IF v_version.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_ALREADY_WITHDRAWN';
  END IF;
  v_today := wardah_internal.mfg_cost_policy_org_today_204(p_org_id, true);
  IF v_version.effective_from < v_today THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_ALREADY_IN_FORCE';
  END IF;
  -- The exclusive per-org lock above already waits for any MO insert or start
  -- that is timing or pinning in this org (the triggers hold the shared form
  -- until commit).
  IF EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins
             WHERE policy_version_id = p_policy_version_id)
     OR EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pin_timing
                WHERE timing_source_version_id = p_policy_version_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'COST_POLICY_VERSION_PINNED';
  END IF;
  v_before := wardah_internal.mfg_cost_policy_version_json_204(p_policy_version_id, v_today);
  UPDATE wardah_internal.mfg_cost_policy_versions
  SET withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = btrim(p_reason)
  WHERE id = p_policy_version_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.cost_policy.withdraw', 'mfg_cost_policy_version',
    p_policy_version_id::text, v_before,
    wardah_internal.mfg_cost_policy_version_json_204(p_policy_version_id, v_today),
    jsonb_build_object('source', 'rpc_withdraw_mfg_cost_policy_version', 'migration', 204));
  RETURN public.rpc_get_mfg_cost_policy(p_org_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_withdraw_mfg_cost_policy_version(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_mfg_cost_policy_version(uuid, uuid, text) TO authenticated;

-- Read-only worked example: what a version absorbs at one work center for the
-- hours given. Uses the same computation the engine will use.
CREATE FUNCTION public.rpc_preview_mfg_cost_absorption(
  p_org_id uuid, p_policy_version_id uuid, p_work_center_id uuid,
  p_labor_hours numeric, p_machine_hours numeric, p_recorded_labor_cost numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.mfg_cost_policy_can_read_204(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_READ_DENIED';
  END IF;
  RETURN wardah_internal.mfg_cost_policy_compute_204(
    p_org_id, p_policy_version_id, p_work_center_id,
    p_labor_hours, p_machine_hours, p_recorded_labor_cost);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_preview_mfg_cost_absorption(uuid, uuid, uuid, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_preview_mfg_cost_absorption(uuid, uuid, uuid, numeric, numeric, numeric)
  TO authenticated;
