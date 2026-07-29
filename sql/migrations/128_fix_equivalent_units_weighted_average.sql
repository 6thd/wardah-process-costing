-- migration_number: 128
-- description: Correct weighted-average equivalent-unit calculations and separate
--              transferred-in/beginning-WIP cost pools without rewriting closed periods.
-- safety: additive columns + replace-only trigger function. Closed rows are not recalculated.

ALTER TABLE public.stage_wip_log
  ADD COLUMN IF NOT EXISTS cost_beginning_wip_material numeric(18,6),
  ADD COLUMN IF NOT EXISTS cost_beginning_wip_conversion numeric(18,6),
  ADD COLUMN IF NOT EXISTS cost_beginning_wip_transferred_in numeric(18,6),
  ADD COLUMN IF NOT EXISTS equivalent_units_transferred_in numeric(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_eu_transferred_in numeric(18,6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eu_calculation_version smallint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS eu_calculation_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.stage_wip_log'::regclass
      AND conname = 'stage_wip_log_completion_pct_range'
  ) THEN
    ALTER TABLE public.stage_wip_log
      ADD CONSTRAINT stage_wip_log_completion_pct_range
      CHECK (
        material_completion_pct BETWEEN 0 AND 100
        AND conversion_completion_pct BETWEEN 0 AND 100
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.stage_wip_log'::regclass
      AND conname = 'stage_wip_log_nonnegative_units'
  ) THEN
    ALTER TABLE public.stage_wip_log
      ADD CONSTRAINT stage_wip_log_nonnegative_units
      CHECK (
        COALESCE(units_completed, 0) >= 0
        AND COALESCE(units_ending_wip, 0) >= 0
        AND COALESCE(units_beginning_wip, 0) >= 0
        AND COALESCE(units_started, 0) >= 0
      ) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.calculate_wip_equivalent_units()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_completed numeric := COALESCE(NEW.units_completed, 0);
  v_ending numeric := COALESCE(NEW.units_ending_wip, 0);
  v_material_pct numeric := COALESCE(NEW.material_completion_pct, 0) / 100.0;
  v_conversion_pct numeric := COALESCE(NEW.conversion_completion_pct, 0) / 100.0;
  v_begin_total numeric := COALESCE(NEW.cost_beginning_wip, 0);
  v_begin_material numeric;
  v_begin_conversion numeric;
  v_begin_transferred numeric;
  v_split_total numeric;
BEGIN
  IF v_completed < 0 OR v_ending < 0 THEN
    RAISE EXCEPTION 'WIP_UNITS_MUST_BE_NONNEGATIVE';
  END IF;

  IF v_material_pct < 0 OR v_material_pct > 1
     OR v_conversion_pct < 0 OR v_conversion_pct > 1 THEN
    RAISE EXCEPTION 'WIP_COMPLETION_PERCENT_OUT_OF_RANGE';
  END IF;

  v_begin_material := NEW.cost_beginning_wip_material;
  v_begin_conversion := NEW.cost_beginning_wip_conversion;
  v_begin_transferred := NEW.cost_beginning_wip_transferred_in;

  IF v_begin_total > 0
     AND v_begin_material IS NULL
     AND v_begin_conversion IS NULL
     AND v_begin_transferred IS NULL THEN
    v_begin_material := v_begin_total;
    v_begin_conversion := 0;
    v_begin_transferred := 0;
    NEW.eu_calculation_note := 'legacy_unsplit_beginning_wip_assigned_to_material';
  ELSE
    v_begin_material := COALESCE(v_begin_material, 0);
    v_begin_conversion := COALESCE(v_begin_conversion, 0);
    v_begin_transferred := COALESCE(v_begin_transferred, 0);
    v_split_total := v_begin_material + v_begin_conversion + v_begin_transferred;

    IF abs(v_split_total - v_begin_total) > 0.000001 THEN
      RAISE EXCEPTION
        'BEGINNING_WIP_COST_SPLIT_MISMATCH: total=%, split=%',
        v_begin_total, v_split_total;
    END IF;
    NEW.eu_calculation_note := NULL;
  END IF;

  NEW.equivalent_units_material :=
    v_completed + (v_ending * v_material_pct);
  NEW.equivalent_units_conversion :=
    v_completed + (v_ending * v_conversion_pct);
  NEW.equivalent_units_transferred_in :=
    v_completed + v_ending;

  NEW.cost_per_eu_material :=
    CASE WHEN NEW.equivalent_units_material > 0
      THEN (v_begin_material + COALESCE(NEW.cost_material, 0))
           / NEW.equivalent_units_material
      ELSE 0
    END;

  NEW.cost_per_eu_conversion :=
    CASE WHEN NEW.equivalent_units_conversion > 0
      THEN (v_begin_conversion + COALESCE(NEW.cost_labor, 0)
            + COALESCE(NEW.cost_overhead, 0))
           / NEW.equivalent_units_conversion
      ELSE 0
    END;

  NEW.cost_per_eu_transferred_in :=
    CASE WHEN NEW.equivalent_units_transferred_in > 0
      THEN (v_begin_transferred + COALESCE(NEW.cost_transferred_in, 0))
           / NEW.equivalent_units_transferred_in
      ELSE 0
    END;

  NEW.cost_completed_transferred :=
    v_completed * (
      COALESCE(NEW.cost_per_eu_material, 0)
      + COALESCE(NEW.cost_per_eu_conversion, 0)
      + COALESCE(NEW.cost_per_eu_transferred_in, 0)
    );

  NEW.cost_ending_wip :=
    (v_ending * v_material_pct * COALESCE(NEW.cost_per_eu_material, 0))
    + (v_ending * v_conversion_pct * COALESCE(NEW.cost_per_eu_conversion, 0))
    + (v_ending * COALESCE(NEW.cost_per_eu_transferred_in, 0));

  NEW.eu_calculation_version := 2;
  RETURN NEW;
END;
$function$;

UPDATE public.stage_wip_log
SET updated_at = COALESCE(updated_at, now())
WHERE COALESCE(is_closed, false) = false;

COMMENT ON FUNCTION public.calculate_wip_equivalent_units() IS
  'Weighted-average EUP v2: completed units at 100%, ending WIP by completion %, separate transferred-in pool.';

COMMENT ON COLUMN public.stage_wip_log.eu_calculation_note IS
  'Explicit compatibility note when a row lacks beginning-WIP cost-pool splits.';
