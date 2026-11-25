-- 206: Production recording foundation (stage 2 of #260 / #230) — owner decision group B.
--
-- Design: docs/db/MANUFACTURING_SETTINGS_260_DESIGN.md §4.2, §5, §11 stage 2. Runbook and the
-- decision record: docs/db/PRODUCTION_RECORDING_206_RUNBOOK.md. Owner decisions, 2026-11-25:
--   B1 P-YIELD        approval of a BOM snapshot with any line yield_percentage <> 100 is refused,
--                     naming the BOM line; the meaning of yield is deferred.
--   B2 P-SCRAP-UNIT   scrap_factor is a percent 0..100 (2 = 2%). The CHECK already exists in the
--                     schema (bom_lines_scrap_factor_check, validated); 206 records the unit in a
--                     column comment and the snapshot's expected quantity uses it as a percent.
--   B3 P-STAGE-MAP    each BOM operation maps to the cost stage with the same sequence AND work
--                     center; no match or more than one match refuses the snapshot, naming the
--                     operation. (Source confirmed by the owner, 2026-11-25: bom_operations.) A
--                     production record linked to an actual work order is checked against the
--                     snapshot operation: same sequence and work center, at entry and again at
--                     approval.
--   B4 P-BOM-CHANGE   a new snapshot applies to quantity processed from its effective time on, with
--                     a separate permission and an audited reason; every record keeps the snapshot
--                     it was attributed to (by execution time, not entry time).
--   B5 P-LATE-WINDOW  a per-organization late-entry window in days, plus exceptional approval past
--                     it. The number of days is an operational setting; 206 seeds none. While it is
--                     unset every record entered on a later local day than its execution needs the
--                     exceptional approval (fail-closed, no assumed number).
--   B6 periods        monthly periods in the organization's timezone, one dated calendar version
--                     at a time; a record's period is the local month of its execution start.
--   B7 inputs         labor hours, machine hours and counts are approved under a separate
--                     permission, never by the user who recorded them.
--
-- Additive. No existing table, function, trigger or grant changes; 204 pins are read, not written.
-- Nothing here moves stock, writes WIP, stage costs or GL: those are stages 3-5 (207-209).
-- New objects only:
--   * eight ordinary permission keys (manufacturing module);
--   * wardah_internal tables: period calendars, recording settings (+ audit), MO BOM snapshots,
--     snapshot lines, snapshot operations, production records, production inputs;
--   * internal invoker helpers (no client EXECUTE);
--   * public SECURITY DEFINER RPCs for authenticated, each guarded by wardah_assert_org_member and
--     an explicit permission check.
--
-- Transaction: runner-owned, as for 195-205. Apply with psql --single-transaction (or an
-- equivalent single-transaction runner); the file has no BEGIN/COMMIT.
SET LOCAL lock_timeout = '10s';

DO $preflight$
BEGIN
  IF to_regclass('wardah_internal.mfg_production_records_206') IS NOT NULL THEN
    RAISE EXCEPTION 'M206_ALREADY_APPLIED';
  END IF;
  IF to_regclass('wardah_internal.mfg_cost_policy_drafts_205') IS NULL
     OR to_regclass('wardah_internal.mo_cost_policy_pins') IS NULL
     OR to_regprocedure('wardah_internal.manufacturing_settings_can_update_201(uuid)') IS NULL
     OR to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL
     OR to_regprocedure('public.normalize_mo_status(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.modules WHERE name = 'manufacturing') THEN
    RAISE EXCEPTION 'M206_REQUIRES_M205';
  END IF;
  IF EXISTS (SELECT 1 FROM public.permissions
             WHERE permission_key LIKE 'manufacturing.bom_snapshots.%'
                OR permission_key LIKE 'manufacturing.production_records.%'
                OR permission_key LIKE 'manufacturing.production_inputs.%') THEN
    RAISE EXCEPTION 'M206_PERMISSION_KEYS_PRESENT';
  END IF;
  -- B2: the percent range must already be enforced and validated on every stored row.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bom_lines'::regclass
                   AND conname = 'bom_lines_scrap_factor_check' AND convalidated) THEN
    RAISE EXCEPTION 'M206_SCRAP_FACTOR_RANGE_NOT_ENFORCED';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog (ordinary keys, checked through has_permission).
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions(module_id,resource,resource_ar,action,action_ar,
  permission_key,description,description_ar)
SELECT m.id,v.resource,v.resource_ar,v.action,v.action_ar,v.key,v.description,v.description_ar
FROM public.modules m CROSS JOIN (VALUES
  ('bom_snapshots','لقطات BOM للأوامر','create','إنشاء',
   'manufacturing.bom_snapshots.create',
   'Create the first BOM snapshot of a manufacturing order (draft)',
   'إنشاء أول لقطة BOM لأمر التصنيع (مسودة)'),
  ('bom_snapshots','لقطات BOM للأوامر','change','تغيير',
   'manufacturing.bom_snapshots.change',
   'Create a replacement BOM snapshot for an order in progress, from a stated effective time and with a reason',
   'إنشاء لقطة BOM بديلة لأمر جارٍ، من وقت سريان محدد وبسبب'),
  ('bom_snapshots','لقطات BOM للأوامر','approve','اعتماد',
   'manufacturing.bom_snapshots.approve',
   'Approve a BOM snapshot of a manufacturing order',
   'اعتماد لقطة BOM لأمر تصنيع'),
  ('production_records','سجلات الإنتاج','record','تسجيل',
   'manufacturing.production_records.record',
   'Record and submit production quantities (good and spoiled) for an order stage',
   'تسجيل كميات الإنتاج (الجيدة والتالفة) لمرحلة أمر وتقديمها'),
  ('production_records','سجلات الإنتاج','approve','اعتماد',
   'manufacturing.production_records.approve',
   'Approve or reject production records recorded by someone else',
   'اعتماد سجلات إنتاج سجّلها غيرك أو رفضها'),
  ('production_records','سجلات الإنتاج','approve_late','اعتماد التسجيل المتأخر',
   'manufacturing.production_records.approve_late',
   'Exceptional approval of records and inputs entered after the company late-entry window (needs approve as well)',
   'الاعتماد الاستثنائي لسجلات ومدخلات أُدخلت بعد مهلة التسجيل اللاحق للشركة (تحتاج صلاحية الاعتماد معها)'),
  ('production_inputs','مدخلات الإنتاج','record','تسجيل',
   'manufacturing.production_inputs.record',
   'Record and submit labor hours, machine hours and counts for an order stage',
   'تسجيل ساعات العمالة وساعات الماكينة والعدّ لمرحلة أمر وتقديمها'),
  ('production_inputs','مدخلات الإنتاج','approve','اعتماد',
   'manufacturing.production_inputs.approve',
   'Approve or reject labor, machine and count inputs recorded by someone else',
   'اعتماد مدخلات العمالة والماكينة والعدّ التي سجّلها غيرك أو رفضها')
) v(resource,resource_ar,action,action_ar,key,description,description_ar)
WHERE m.name = 'manufacturing';

COMMENT ON COLUMN public.bom_lines.scrap_factor IS
  'Expected material loss as a PERCENT, 0..100 (2 = 2%). Owner decision B2 (P-SCRAP-UNIT), 2026-11-25; see docs/db/PRODUCTION_RECORDING_206_RUNBOOK.md.';

-- ---------------------------------------------------------------------------
-- 2. Storage. Private schema, no client privileges; the RPCs are the only path.
-- ---------------------------------------------------------------------------

-- B6: dated calendar versions. A version starts on the first day of a month and fixes the
-- timezone that local dates and periods are computed in.
CREATE TABLE wardah_internal.mfg_period_calendars_206 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  effective_from date NOT NULL CHECK (extract(day FROM effective_from) = 1),
  period_kind text NOT NULL DEFAULT 'monthly' CHECK (period_kind = 'monthly'),
  timezone text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, version_no),
  UNIQUE (org_id, effective_from)
);

-- B5: per-organization recording settings. late_window_days NULL = not configured.
CREATE TABLE wardah_internal.mfg_recording_settings_206 (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  late_window_days integer CHECK (late_window_days IS NULL OR late_window_days BETWEEN 0 AND 3650),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wardah_internal.mfg_recording_settings_audit_206 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  setting text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- B1/B3/B4: BOM snapshots of an order. Snapshot 1 covers the order from its start
-- (effective_from_at = -infinity, the first one approved); a later snapshot covers quantity processed from its
-- effective_from_at on. Rows are never deleted while the order exists; a draft is withdrawn.
CREATE TABLE wardah_internal.mo_bom_snapshots_206 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  snapshot_no integer NOT NULL CHECK (snapshot_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','withdrawn')),
  source_bom_id uuid NOT NULL,
  bom_number text NOT NULL,
  bom_version integer,
  bom_status text NOT NULL,
  bom_item_id uuid NOT NULL,
  header_quantity numeric NOT NULL CHECK (header_quantity > 0),
  determination_date date NOT NULL,
  cost_policy_version_id uuid,
  effective_from_at timestamptz NOT NULL,
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  withdrawn_by uuid,
  withdrawn_at timestamptz,
  withdraw_reason text,
  idempotency_key uuid NOT NULL,
  UNIQUE (mo_id, snapshot_no),
  UNIQUE (org_id, idempotency_key),
  UNIQUE (id, org_id),
  CHECK (effective_from_at = '-infinity'::timestamptz OR length(btrim(COALESCE(reason, ''))) > 0),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL))
);
-- At most one live draft per order; at most one approved snapshot per effective time.
CREATE UNIQUE INDEX mo_bom_snapshots_206_one_draft ON wardah_internal.mo_bom_snapshots_206 (mo_id)
  WHERE status = 'draft';
CREATE UNIQUE INDEX mo_bom_snapshots_206_approved_eff ON wardah_internal.mo_bom_snapshots_206 (mo_id, effective_from_at)
  WHERE status = 'approved';

CREATE TABLE wardah_internal.mo_bom_snapshot_lines_206 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id uuid NOT NULL,
  org_id uuid NOT NULL,
  bom_line_id uuid NOT NULL,
  line_sequence integer,
  item_id uuid NOT NULL,
  product_id uuid,
  line_type text NOT NULL,
  quantity numeric NOT NULL,
  uom text,
  uom_id uuid,
  quantity_base numeric,
  conversion_factor_snapshot numeric,
  scrap_factor_percent numeric NOT NULL,
  yield_percentage numeric,
  operation_sequence integer,
  qty_per_unit numeric NOT NULL,
  FOREIGN KEY (snapshot_id, org_id) REFERENCES wardah_internal.mo_bom_snapshots_206(id, org_id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, bom_line_id)
);

CREATE TABLE wardah_internal.mo_bom_snapshot_operations_206 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id uuid NOT NULL,
  org_id uuid NOT NULL,
  bom_operation_id uuid NOT NULL,
  operation_sequence integer NOT NULL,
  operation_code text NOT NULL,
  operation_name text NOT NULL,
  work_center_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  FOREIGN KEY (snapshot_id, org_id) REFERENCES wardah_internal.mo_bom_snapshots_206(id, org_id) ON DELETE CASCADE,
  UNIQUE (snapshot_id, operation_sequence),
  UNIQUE (snapshot_id, stage_id)
);

-- R4: production records with the four dates kept apart. entered_at is the server's; the
-- execution interval [executed_from, executed_to) is the recorder's; the period is derived from
-- executed_from in the calendar version in force; posting is not done here (207).
CREATE TABLE wardah_internal.mfg_production_records_206 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL,
  operation_sequence integer NOT NULL,
  stage_id uuid NOT NULL,
  work_center_id uuid NOT NULL,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  good_quantity numeric NOT NULL CHECK (good_quantity >= 0),
  spoiled_quantity numeric NOT NULL DEFAULT 0 CHECK (spoiled_quantity >= 0),
  executed_from timestamptz NOT NULL,
  executed_to timestamptz NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  calendar_id uuid NOT NULL REFERENCES wardah_internal.mfg_period_calendars_206(id) ON DELETE RESTRICT,
  execution_local_date date NOT NULL,
  execution_period_start date NOT NULL,
  late_by_days integer NOT NULL,
  late_window_days integer,
  is_late boolean NOT NULL,
  after_close boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','withdrawn')),
  notes text,
  recorded_by uuid NOT NULL,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  late_approval boolean NOT NULL DEFAULT false,
  idempotency_key uuid NOT NULL,
  FOREIGN KEY (snapshot_id, org_id) REFERENCES wardah_internal.mo_bom_snapshots_206(id, org_id) ON DELETE RESTRICT,
  UNIQUE (org_id, idempotency_key),
  CHECK (good_quantity + spoiled_quantity > 0),
  CHECK (executed_from <= executed_to),
  CHECK (status NOT IN ('approved','rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'approved' OR decided_by <> recorded_by),
  CHECK (status <> 'approved' OR NOT is_late OR late_approval),
  CHECK (NOT after_close OR is_late)
);
CREATE INDEX mfg_production_records_206_mo ON wardah_internal.mfg_production_records_206 (mo_id, executed_from);
CREATE INDEX mfg_production_records_206_period ON wardah_internal.mfg_production_records_206 (org_id, execution_period_start);

-- B7: labor hours, machine hours and counts, same dates and lifecycle as a production record.
CREATE TABLE wardah_internal.mfg_production_inputs_206 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  mo_id uuid NOT NULL REFERENCES public.manufacturing_orders(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL,
  operation_sequence integer NOT NULL,
  stage_id uuid NOT NULL,
  work_center_id uuid NOT NULL,
  input_kind text NOT NULL CHECK (input_kind IN ('labor_hours','machine_hours','count')),
  activity text CHECK (activity IN ('run','setup')),
  quantity numeric NOT NULL CHECK (quantity > 0),
  count_unit text,
  executed_from timestamptz NOT NULL,
  executed_to timestamptz NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  calendar_id uuid NOT NULL REFERENCES wardah_internal.mfg_period_calendars_206(id) ON DELETE RESTRICT,
  execution_local_date date NOT NULL,
  execution_period_start date NOT NULL,
  late_by_days integer NOT NULL,
  late_window_days integer,
  is_late boolean NOT NULL,
  after_close boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','withdrawn')),
  notes text,
  recorded_by uuid NOT NULL,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  late_approval boolean NOT NULL DEFAULT false,
  idempotency_key uuid NOT NULL,
  FOREIGN KEY (snapshot_id, org_id) REFERENCES wardah_internal.mo_bom_snapshots_206(id, org_id) ON DELETE RESTRICT,
  UNIQUE (org_id, idempotency_key),
  CHECK (executed_from <= executed_to),
  CHECK ((input_kind = 'count') = (count_unit IS NOT NULL AND length(btrim(count_unit)) > 0)),
  CHECK ((input_kind = 'count') = (activity IS NULL)),
  CHECK (status NOT IN ('approved','rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'approved' OR decided_by <> recorded_by),
  CHECK (status <> 'approved' OR NOT is_late OR late_approval),
  CHECK (NOT after_close OR is_late)
);
CREATE INDEX mfg_production_inputs_206_mo ON wardah_internal.mfg_production_inputs_206 (mo_id, executed_from);
CREATE INDEX mfg_production_inputs_206_period ON wardah_internal.mfg_production_inputs_206 (org_id, execution_period_start);

REVOKE ALL ON wardah_internal.mfg_period_calendars_206,
              wardah_internal.mfg_recording_settings_206,
              wardah_internal.mfg_recording_settings_audit_206,
              wardah_internal.mo_bom_snapshots_206,
              wardah_internal.mo_bom_snapshot_lines_206,
              wardah_internal.mo_bom_snapshot_operations_206,
              wardah_internal.mfg_production_records_206,
              wardah_internal.mfg_production_inputs_206
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE wardah_internal.mfg_period_calendars_206 IS
  'Migration 206 (B6): monthly period calendar versions per org, in the org timezone captured at creation. See docs/db/PRODUCTION_RECORDING_206_RUNBOOK.md.';
COMMENT ON TABLE wardah_internal.mo_bom_snapshots_206 IS
  'Migration 206 (B1/B3/B4): BOM snapshots of an MO; snapshot 1 from the start, later snapshots from their effective time.';
COMMENT ON TABLE wardah_internal.mfg_production_records_206 IS
  'Migration 206 (R4): production quantity records; snapshot and period attributed by execution time. No stock, WIP or GL effect.';
COMMENT ON TABLE wardah_internal.mfg_production_inputs_206 IS
  'Migration 206 (B7): labor hours, machine hours and counts; approved by someone other than the recorder.';

-- ---------------------------------------------------------------------------
-- 3. Integrity triggers.
-- ---------------------------------------------------------------------------

-- Every row carries its order's org; a snapshot, record or input never crosses organizations.
CREATE FUNCTION wardah_internal.mfg_production_org_match_206()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.manufacturing_orders WHERE id = NEW.mo_id AND org_id = NEW.org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MFG_PRODUCTION_ORG_MISMATCH';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mfg_production_org_match_206() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mo_bom_snapshots_206_org_match BEFORE INSERT ON wardah_internal.mo_bom_snapshots_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_org_match_206();
CREATE TRIGGER mfg_production_records_206_org_match BEFORE INSERT ON wardah_internal.mfg_production_records_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_org_match_206();
CREATE TRIGGER mfg_production_inputs_206_org_match BEFORE INSERT ON wardah_internal.mfg_production_inputs_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_org_match_206();

-- Immutability. Insert-only tables refuse every UPDATE; a DELETE is allowed only as the cascade
-- of an organization or order that is already gone. Workflow tables allow only their forward
-- status transitions, and only the workflow columns of that transition may change.
CREATE FUNCTION wardah_internal.mfg_production_immutable_206()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb;
  v_from text;
  v_to text;
  c_workflow CONSTANT text[] := ARRAY['status','submitted_at','decided_by','decided_at','decision_reason',
                                      'late_approval','approved_by','approved_at','withdrawn_by',
                                      'withdrawn_at','withdraw_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = (v_old->>'org_id')::uuid)
       OR (v_old ? 'mo_id' AND NOT EXISTS (
             SELECT 1 FROM public.manufacturing_orders WHERE id = (v_old->>'mo_id')::uuid))
       OR (v_old ? 'snapshot_id' AND NOT EXISTS (
             SELECT 1 FROM wardah_internal.mo_bom_snapshots_206 WHERE id = (v_old->>'snapshot_id')::uuid)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_IMMUTABLE';
  END IF;
  v_new := to_jsonb(NEW);
  IF TG_TABLE_NAME IN ('mo_bom_snapshots_206','mfg_production_records_206','mfg_production_inputs_206')
     AND (v_new - c_workflow) = (v_old - c_workflow) THEN
    v_from := v_old->>'status';
    v_to := v_new->>'status';
    IF (TG_TABLE_NAME = 'mo_bom_snapshots_206' AND v_from = 'draft' AND v_to IN ('approved','withdrawn'))
       OR (TG_TABLE_NAME <> 'mo_bom_snapshots_206' AND (
             (v_from = 'draft' AND v_to IN ('submitted','withdrawn'))
          OR (v_from = 'submitted' AND v_to IN ('approved','rejected','withdrawn')))) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_IMMUTABLE';
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mfg_production_immutable_206() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mfg_period_calendars_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mfg_period_calendars_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();
CREATE TRIGGER mfg_recording_settings_audit_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mfg_recording_settings_audit_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();
CREATE TRIGGER mo_bom_snapshots_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mo_bom_snapshots_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();
CREATE TRIGGER mo_bom_snapshot_lines_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mo_bom_snapshot_lines_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();
CREATE TRIGGER mo_bom_snapshot_operations_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mo_bom_snapshot_operations_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();
CREATE TRIGGER mfg_production_records_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mfg_production_records_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();
CREATE TRIGGER mfg_production_inputs_206_immutable BEFORE UPDATE OR DELETE ON wardah_internal.mfg_production_inputs_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mfg_production_immutable_206();

-- Snapshot lines and operations are written only while their snapshot is a draft.
CREATE FUNCTION wardah_internal.mo_bom_snapshot_child_insert_206()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.mo_bom_snapshots_206
                 WHERE id = NEW.snapshot_id AND org_id = NEW.org_id AND status = 'draft') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mo_bom_snapshot_child_insert_206() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER mo_bom_snapshot_lines_206_insert BEFORE INSERT ON wardah_internal.mo_bom_snapshot_lines_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mo_bom_snapshot_child_insert_206();
CREATE TRIGGER mo_bom_snapshot_operations_206_insert BEFORE INSERT ON wardah_internal.mo_bom_snapshot_operations_206
FOR EACH ROW EXECUTE FUNCTION wardah_internal.mo_bom_snapshot_child_insert_206();

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (invoker rights, no client EXECUTE).
-- ---------------------------------------------------------------------------

CREATE FUNCTION wardah_internal.mfg_production_require_206(p_org uuid, p_key text)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_permission(auth.uid(), p_org, p_key::character varying), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFG_PRODUCTION_PERMISSION_DENIED: ' || p_key;
  END IF;
END
$fn$;

-- One transaction lock per order for every path that writes its snapshots, records or inputs:
-- a snapshot change is approved against the records that exist when it holds the lock, and a
-- record is attributed against the snapshots approved when it holds the lock. Advisory only;
-- the MO row is not locked here, so the M192/M195 MO -> WO lock order is not involved.
CREATE FUNCTION wardah_internal.mfg_production_lock_mo_206(p_mo uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $fn$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wardah.mfg_production_206:' || p_mo::text, 206));
$fn$;

-- One per org for calendar and settings writes (exclusive). Every path that attributes an entry
-- to a calendar version and a late window takes the same key shared, before the order lock, so a
-- calendar version or window cannot be committed between an entry's read of the old one and its
-- commit (review item 5).
CREATE FUNCTION wardah_internal.mfg_production_lock_org_206(p_org uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $fn$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wardah.mfg_production_org_206:' || p_org::text, 206));
$fn$;

CREATE FUNCTION wardah_internal.mfg_production_lock_org_shared_206(p_org uuid)
RETURNS void LANGUAGE sql VOLATILE SET search_path = ''
AS $fn$
  SELECT pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('wardah.mfg_production_org_206:' || p_org::text, 206));
$fn$;

-- The order, in the caller's org, locked for this transaction's 206 writes.
CREATE FUNCTION wardah_internal.mfg_production_mo_206(p_org uuid, p_mo uuid)
RETURNS public.manufacturing_orders LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $fn$
DECLARE v_mo public.manufacturing_orders;
BEGIN
  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = p_mo AND org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_MO_NOT_FOUND';
  END IF;
  PERFORM wardah_internal.mfg_production_lock_org_shared_206(p_org);
  PERFORM wardah_internal.mfg_production_lock_mo_206(p_mo);
  RETURN v_mo;
END
$fn$;

-- The calendar version in force at instant p_at: the latest version whose start is on or before
-- the local date of p_at in that version's own timezone. NULL when none.
CREATE FUNCTION wardah_internal.mfg_period_calendar_at_206(p_org uuid, p_at timestamptz)
RETURNS wardah_internal.mfg_period_calendars_206 LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT c.* FROM wardah_internal.mfg_period_calendars_206 c
  WHERE c.org_id = p_org AND (p_at AT TIME ZONE c.timezone)::date >= c.effective_from
  ORDER BY c.effective_from DESC
  LIMIT 1;
$fn$;

-- The approved snapshot that covers an execution start: the latest effective time at or before it.
CREATE FUNCTION wardah_internal.mo_bom_snapshot_at_206(p_mo uuid, p_at timestamptz)
RETURNS wardah_internal.mo_bom_snapshots_206 LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT s.* FROM wardah_internal.mo_bom_snapshots_206 s
  WHERE s.mo_id = p_mo AND s.status = 'approved' AND s.effective_from_at <= p_at
  ORDER BY s.effective_from_at DESC
  LIMIT 1;
$fn$;

-- Everything a record or input derives from its execution interval, validated:
--   snapshot (B4: by execution start; the interval must not cross a later snapshot's start),
--   the snapshot operation and its stage (B3), the calendar version and period (B6), lateness (B5).
CREATE FUNCTION wardah_internal.mfg_production_attribute_206(
  p_org uuid, p_mo public.manufacturing_orders, p_operation_sequence integer,
  p_from timestamptz, p_to timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE
  v_status text := public.normalize_mo_status(p_mo.status);
  v_snap wardah_internal.mo_bom_snapshots_206;
  v_next_eff timestamptz;
  v_op wardah_internal.mo_bom_snapshot_operations_206;
  v_cal wardah_internal.mfg_period_calendars_206;
  v_cal_to wardah_internal.mfg_period_calendars_206;
  v_local date;
  v_local_to date;
  v_entered_local date;
  v_window integer;
  v_late_by integer;
  v_pinned_on date;
BEGIN
  -- Review item 2 (X6, owner decision 2026-11-25): a closed (done) order still accepts a late entry;
  -- it is marked after_close and always needs the late approval.
  IF v_status IS NULL OR v_status NOT IN ('in_progress','on_hold','quality_check','done') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_MO_STATUS_INVALID: ' || COALESCE(v_status, 'null');
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to
     OR p_from IN ('-infinity','infinity') OR p_to IN ('-infinity','infinity') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_EXECUTION_INVALID';
  END IF;
  IF p_to > now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_EXECUTION_IN_FUTURE';
  END IF;
  v_snap := wardah_internal.mo_bom_snapshot_at_206(p_mo.id, p_from);
  IF v_snap.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_NOT_APPROVED';
  END IF;
  SELECT min(s.effective_from_at) INTO v_next_eff FROM wardah_internal.mo_bom_snapshots_206 s
  WHERE s.mo_id = p_mo.id AND s.status = 'approved' AND s.effective_from_at > p_from;
  IF v_next_eff IS NOT NULL AND p_to > v_next_eff THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'MFG_PRODUCTION_SPANS_SNAPSHOT_CHANGE: split at ' || v_next_eff::text;
  END IF;
  SELECT o.* INTO v_op FROM wardah_internal.mo_bom_snapshot_operations_206 o
  WHERE o.snapshot_id = v_snap.id AND o.operation_sequence = p_operation_sequence;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'MFG_PRODUCTION_OPERATION_NOT_IN_SNAPSHOT: ' || COALESCE(p_operation_sequence::text, 'null');
  END IF;
  v_cal := wardah_internal.mfg_period_calendar_at_206(p_org, p_from);
  IF v_cal.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PERIOD_CALENDAR_NOT_IN_FORCE';
  END IF;
  v_local := (p_from AT TIME ZONE v_cal.timezone)::date;
  -- Review item 4: nothing is executed on an order before its 204 pin date (creation or start).
  SELECT p.pinned_on INTO v_pinned_on FROM wardah_internal.mo_cost_policy_pins p WHERE p.mo_id = p_mo.id;
  IF v_pinned_on IS NULL OR v_local < v_pinned_on THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'MFG_PRODUCTION_EXECUTION_BEFORE_ORDER: pinned on ' || COALESCE(v_pinned_on::text, 'null');
  END IF;
  v_cal_to := wardah_internal.mfg_period_calendar_at_206(p_org, p_to);
  v_local_to := (p_to AT TIME ZONE v_cal_to.timezone)::date;
  -- Review item 3 (B6, owner decision 2026-11-25): like a snapshot change, a local month boundary
  -- must not fall inside the interval (an end exactly at local midnight is inside the month).
  IF date_trunc('month', ((CASE WHEN p_to > p_from THEN p_to - interval '1 microsecond' ELSE p_to END)
                           AT TIME ZONE v_cal_to.timezone))::date <> date_trunc('month', v_local)::date THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'MFG_PRODUCTION_SPANS_PERIOD: split at local ' || (date_trunc('month', v_local) + interval '1 month')::date::text;
  END IF;
  v_entered_local := (now() AT TIME ZONE v_cal_to.timezone)::date;
  v_late_by := v_entered_local - v_local_to;
  SELECT s.late_window_days INTO v_window FROM wardah_internal.mfg_recording_settings_206 s WHERE s.org_id = p_org;
  RETURN jsonb_build_object(
    'snapshot_id', v_snap.id,
    'stage_id', v_op.stage_id,
    'work_center_id', v_op.work_center_id,
    'calendar_id', v_cal.id,
    'execution_local_date', v_local,
    'execution_period_start', date_trunc('month', v_local)::date,
    'late_by_days', v_late_by,
    'late_window_days', v_window,
    -- B5: unset window = only the same local day is on time (no assumed number of days).
    'after_close', v_status = 'done',
    'is_late', v_late_by > COALESCE(v_window, 0) OR v_status = 'done');
END
$fn$;

-- B3 + snapshot content. Writes the lines and operations of a draft snapshot from its source BOM,
-- or refuses naming the BOM operation or line that blocks it.
CREATE FUNCTION wardah_internal.mo_bom_snapshot_fill_206(p_snapshot uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $fn$
DECLARE
  v_s wardah_internal.mo_bom_snapshots_206;
  r record;
  v_n integer;
  v_stage uuid;
BEGIN
  SELECT * INTO v_s FROM wardah_internal.mo_bom_snapshots_206 WHERE id = p_snapshot AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_NOT_DRAFT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bom_operations o
                 WHERE o.bom_id = v_s.source_bom_id AND o.org_id = v_s.org_id AND COALESCE(o.is_active, true)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_NO_OPERATIONS: ' || v_s.bom_number;
  END IF;
  FOR r IN
    SELECT o.* FROM public.bom_operations o
    WHERE o.bom_id = v_s.source_bom_id AND o.org_id = v_s.org_id AND COALESCE(o.is_active, true)
    ORDER BY o.operation_sequence
  LOOP
    IF r.work_center_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('MFG_BOM_STAGE_MAP_NO_WORK_CENTER: operation %s (%s)', r.operation_sequence, r.operation_code);
    END IF;
    SELECT count(*), min(st.id::text)::uuid INTO v_n, v_stage FROM public.manufacturing_stages st
    WHERE st.org_id = v_s.org_id AND COALESCE(st.is_active, true)
      AND st.order_sequence = r.operation_sequence AND st.work_center_id = r.work_center_id;
    IF v_n = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('MFG_BOM_STAGE_MAP_NO_MATCH: operation %s (%s)', r.operation_sequence, r.operation_code);
    ELSIF v_n > 1 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('MFG_BOM_STAGE_MAP_AMBIGUOUS: operation %s (%s)', r.operation_sequence, r.operation_code);
    END IF;
    INSERT INTO wardah_internal.mo_bom_snapshot_operations_206
      (snapshot_id, org_id, bom_operation_id, operation_sequence, operation_code, operation_name, work_center_id, stage_id)
    VALUES (v_s.id, v_s.org_id, r.id, r.operation_sequence, r.operation_code, r.operation_name, r.work_center_id, v_stage);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.bom_lines l WHERE l.bom_id = v_s.source_bom_id AND l.org_id = v_s.org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_NO_LINES: ' || v_s.bom_number;
  END IF;
  FOR r IN
    SELECT l.* FROM public.bom_lines l
    WHERE l.bom_id = v_s.source_bom_id AND l.org_id = v_s.org_id
    ORDER BY l.sequence, l.id
  LOOP
    -- A phantom is exploded by explode_bom at execution date; pinning that explosion is not in 206.
    IF COALESCE(r.line_type, 'COMPONENT') = 'PHANTOM' THEN
      RAISE EXCEPTION USING ERRCODE = '0A000',
        MESSAGE = format('MFG_BOM_SNAPSHOT_PHANTOM_UNSUPPORTED: line %s', COALESCE(r.sequence::text, r.id::text));
    END IF;
    IF r.operation_sequence IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM wardah_internal.mo_bom_snapshot_operations_206 o
         WHERE o.snapshot_id = v_s.id AND o.operation_sequence = r.operation_sequence) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('MFG_BOM_SNAPSHOT_LINE_OPERATION_MISSING: line %s operation %s',
                         COALESCE(r.sequence::text, r.id::text), r.operation_sequence);
    END IF;
    INSERT INTO wardah_internal.mo_bom_snapshot_lines_206
      (snapshot_id, org_id, bom_line_id, line_sequence, item_id, product_id, line_type, quantity, uom, uom_id,
       quantity_base, conversion_factor_snapshot, scrap_factor_percent, yield_percentage, operation_sequence, qty_per_unit)
    VALUES (v_s.id, v_s.org_id, r.id, r.sequence, r.item_id, r.product_id, COALESCE(r.line_type, 'COMPONENT'),
            r.quantity, r.uom, r.uom_id, r.quantity_base, r.conversion_factor_snapshot,
            COALESCE(r.scrap_factor, 0), r.yield_percentage, r.operation_sequence,
            -- §4.2: quantity_base / header quantity * (1 + scrap% / 100); yield not applied (B1). Full precision.
            CASE WHEN COALESCE(r.line_type, 'COMPONENT') = 'REFERENCE' THEN 0
                 ELSE COALESCE(r.quantity_base, r.quantity) / v_s.header_quantity * (1 + COALESCE(r.scrap_factor, 0) / 100) END);
  END LOOP;
END
$fn$;

-- B1 and B3 checks of a draft snapshot at approval; refuses naming the first blocking line.
CREATE FUNCTION wardah_internal.mo_bom_snapshot_approval_check_206(p_snapshot uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE v_line text;
BEGIN
  SELECT COALESCE(l.line_sequence::text, l.bom_line_id::text) INTO v_line
  FROM wardah_internal.mo_bom_snapshot_lines_206 l
  WHERE l.snapshot_id = p_snapshot AND l.yield_percentage IS DISTINCT FROM 100
  ORDER BY l.line_sequence NULLS LAST, l.bom_line_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('MFG_BOM_SNAPSHOT_YIELD_UNDECIDED: line %s (yield_percentage <> 100; P-YIELD pending)', v_line);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.mo_bom_snapshot_operations_206 WHERE snapshot_id = p_snapshot) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_NO_OPERATIONS';
  END IF;
END
$fn$;

-- B3 (owner, 2026-11-25): a record linked to an actual work order must be on the same order and
-- operation, at the work center the snapshot maps that operation to. Checked at entry and at
-- approval (the work order may have been edited in between).
-- Review item 1 (B3 x B4, owner decision 2026-11-25, option A): work_orders keeps no history, so the work
-- center is compared only while the record's snapshot is the one in force now. A late record on
-- an earlier snapshot is checked on the operation sequence; its work center is its snapshot's.
CREATE FUNCTION wardah_internal.mfg_production_check_work_order_206(
  p_org uuid, p_mo uuid, p_work_order uuid, p_snapshot uuid, p_operation_sequence integer
) RETURNS void LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE
  v_wo public.work_orders;
  v_wc uuid;
  v_current boolean;
BEGIN
  IF p_work_order IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_work_order AND org_id = p_org AND mo_id = p_mo;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_WORK_ORDER_NOT_ON_ORDER';
  END IF;
  IF upper(v_wo.status::text) = 'CANCELLED' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_WORK_ORDER_CANCELLED: ' || v_wo.work_order_number;
  END IF;
  SELECT o.work_center_id INTO v_wc FROM wardah_internal.mo_bom_snapshot_operations_206 o
  WHERE o.snapshot_id = p_snapshot AND o.operation_sequence = p_operation_sequence;
  v_current := (wardah_internal.mo_bom_snapshot_at_206(p_mo, now())).id IS NOT DISTINCT FROM p_snapshot;
  IF v_wo.operation_sequence IS DISTINCT FROM p_operation_sequence
     OR (v_current AND v_wo.work_center_id IS DISTINCT FROM v_wc) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('MFG_PRODUCTION_WORK_ORDER_STAGE_MISMATCH: work order %s (operation %s) vs snapshot operation %s',
                       v_wo.work_order_number, v_wo.operation_sequence, p_operation_sequence);
  END IF;
END
$fn$;

CREATE FUNCTION wardah_internal.mo_bom_snapshot_json_206(p_snapshot uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT to_jsonb(s) - 'idempotency_key'
    || jsonb_build_object(
      'effective_from_at', CASE WHEN s.effective_from_at = '-infinity' THEN NULL ELSE s.effective_from_at END,
      'operations', COALESCE((SELECT jsonb_agg(to_jsonb(o) - 'id' - 'org_id' - 'snapshot_id' ORDER BY o.operation_sequence)
                              FROM wardah_internal.mo_bom_snapshot_operations_206 o WHERE o.snapshot_id = s.id), '[]'::jsonb),
      'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) - 'id' - 'org_id' - 'snapshot_id' ORDER BY l.line_sequence NULLS LAST, l.bom_line_id)
                         FROM wardah_internal.mo_bom_snapshot_lines_206 l WHERE l.snapshot_id = s.id), '[]'::jsonb))
  FROM wardah_internal.mo_bom_snapshots_206 s WHERE s.id = p_snapshot;
$fn$;

DO $close_internal$
DECLARE v_sig text;
BEGIN
  FOR v_sig IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wardah_internal' AND p.proname LIKE '%\_206' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_sig);
  END LOOP;
END
$close_internal$;

-- ---------------------------------------------------------------------------
-- 5. Client RPCs (authenticated only). Every identity is auth.uid(); no RPC takes a user.
-- ---------------------------------------------------------------------------

-- B6: add a calendar version. The first may start on any first-of-month date (late entry of
-- earlier months needs it); a later one must start after the latest and after every recorded
-- execution, so no stored period changes meaning.
CREATE FUNCTION public.rpc_add_mfg_period_calendar_206(p_org_id uuid, p_effective_from date, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_tz text;
  v_latest wardah_internal.mfg_period_calendars_206;
  v_no integer;
  v_id uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_effective_from IS NULL OR extract(day FROM p_effective_from) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PERIOD_CALENDAR_START_NOT_MONTH_START';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_REASON_REQUIRED';
  END IF;
  SELECT NULLIF(btrim(timezone), '') INTO v_tz FROM public.organizations WHERE id = p_org_id;
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PERIOD_CALENDAR_ORG_TIMEZONE_INVALID';
  END IF;
  PERFORM wardah_internal.mfg_production_lock_org_206(p_org_id);
  SELECT * INTO v_latest FROM wardah_internal.mfg_period_calendars_206
  WHERE org_id = p_org_id ORDER BY effective_from DESC LIMIT 1;
  IF v_latest.id IS NOT NULL THEN
    IF p_effective_from <= v_latest.effective_from THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PERIOD_CALENDAR_NOT_AFTER_LATEST';
    END IF;
    IF EXISTS (SELECT 1 FROM wardah_internal.mfg_production_records_206
               WHERE org_id = p_org_id AND execution_local_date >= p_effective_from)
       OR EXISTS (SELECT 1 FROM wardah_internal.mfg_production_inputs_206
                  WHERE org_id = p_org_id AND execution_local_date >= p_effective_from) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PERIOD_CALENDAR_RECORDS_EXIST';
    END IF;
  END IF;
  SELECT COALESCE(max(version_no), 0) + 1 INTO v_no FROM wardah_internal.mfg_period_calendars_206 WHERE org_id = p_org_id;
  INSERT INTO wardah_internal.mfg_period_calendars_206 (org_id, version_no, effective_from, timezone, reason, created_by)
  VALUES (p_org_id, v_no, p_effective_from, v_tz, p_reason, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.period_calendar.add', 'mfg_period_calendar', v_id::text, NULL,
          jsonb_build_object('version_no', v_no, 'effective_from', p_effective_from, 'timezone', v_tz, 'period_kind', 'monthly'),
          jsonb_build_object('source', 'rpc_add_mfg_period_calendar_206', 'migration', 206, 'reason', p_reason));
  RETURN jsonb_build_object('calendar_id', v_id, 'version_no', v_no, 'effective_from', p_effective_from, 'timezone', v_tz);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_add_mfg_period_calendar_206(uuid, date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_add_mfg_period_calendar_206(uuid, date, text) TO authenticated;

-- B5: set (or clear, with NULL) the late-entry window in days. Audited with a reason.
CREATE FUNCTION public.rpc_set_mfg_late_entry_window_206(p_org_id uuid, p_days integer, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_old integer;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_days IS NOT NULL AND (p_days < 0 OR p_days > 3650) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_LATE_WINDOW_INVALID';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_REASON_REQUIRED';
  END IF;
  PERFORM wardah_internal.mfg_production_lock_org_206(p_org_id);
  SELECT late_window_days INTO v_old FROM wardah_internal.mfg_recording_settings_206 WHERE org_id = p_org_id;
  INSERT INTO wardah_internal.mfg_recording_settings_206 (org_id, late_window_days, updated_by)
  VALUES (p_org_id, p_days, auth.uid())
  ON CONFLICT (org_id) DO UPDATE SET late_window_days = EXCLUDED.late_window_days,
                                     updated_by = EXCLUDED.updated_by, updated_at = now();
  INSERT INTO wardah_internal.mfg_recording_settings_audit_206 (org_id, setting, old_value, new_value, reason, changed_by)
  VALUES (p_org_id, 'late_window_days', to_jsonb(v_old), to_jsonb(p_days), p_reason, auth.uid());
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.recording_settings.late_window', 'mfg_recording_settings', p_org_id::text,
          jsonb_build_object('late_window_days', v_old), jsonb_build_object('late_window_days', p_days),
          jsonb_build_object('source', 'rpc_set_mfg_late_entry_window_206', 'migration', 206, 'reason', p_reason));
  RETURN jsonb_build_object('late_window_days', p_days);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_mfg_late_entry_window_206(uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_mfg_late_entry_window_206(uuid, integer, text) TO authenticated;

-- Snapshot draft. Snapshot 1 (create): the order must be pinned by 204; the BOM is the approved,
-- active BOM of the order's item in force on the pin date (or p_bom_id, which must be that same
-- kind of BOM). A later snapshot (change, B4): the order must have an approved snapshot, p_bom_id,
-- p_effective_from (after the latest approved snapshot's start) and a reason are required.
CREATE FUNCTION public.rpc_create_mo_bom_snapshot_206(
  p_org_id uuid, p_mo_id uuid, p_bom_id uuid, p_effective_from timestamptz, p_reason text, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_mo public.manufacturing_orders;
  v_existing wardah_internal.mo_bom_snapshots_206;
  v_pin wardah_internal.mo_cost_policy_pins;
  v_bom public.bom_headers;
  v_no integer;
  v_det date;
  v_eff timestamptz;
  v_latest_eff timestamptz;
  v_tz text;
  v_n integer;
  v_id uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  SELECT * INTO v_existing FROM wardah_internal.mo_bom_snapshots_206
  WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.mo_id <> p_mo_id OR v_existing.created_by <> auth.uid()
       OR v_existing.reason IS DISTINCT FROM p_reason
       OR v_existing.effective_from_at IS DISTINCT FROM COALESCE(p_effective_from, '-infinity'::timestamptz)
       OR (p_bom_id IS NOT NULL AND v_existing.source_bom_id <> p_bom_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN wardah_internal.mo_bom_snapshot_json_206(v_existing.id) || jsonb_build_object('replayed', true);
  END IF;
  v_mo := wardah_internal.mfg_production_mo_206(p_org_id, p_mo_id);
  IF public.normalize_mo_status(v_mo.status) IN ('done','cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_MO_STATUS_INVALID: ' || public.normalize_mo_status(v_mo.status);
  END IF;
  IF EXISTS (SELECT 1 FROM wardah_internal.mo_bom_snapshots_206 WHERE mo_id = p_mo_id AND status = 'draft') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_DRAFT_EXISTS';
  END IF;
  SELECT max(effective_from_at) INTO v_latest_eff FROM wardah_internal.mo_bom_snapshots_206
  WHERE mo_id = p_mo_id AND status = 'approved';
  SELECT COALESCE(max(snapshot_no), 0) + 1 INTO v_no FROM wardah_internal.mo_bom_snapshots_206 WHERE mo_id = p_mo_id;
  SELECT * INTO v_pin FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = p_mo_id;
  IF v_latest_eff IS NULL THEN
    -- First snapshot (snapshot_no may be > 1 only after withdrawn drafts).
    PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.bom_snapshots.create');
    IF p_effective_from IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_FIRST_HAS_NO_EFFECTIVE_TIME';
    END IF;
    IF v_pin.mo_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_MO_NOT_PINNED';
    END IF;
    v_det := v_pin.pinned_on;
    v_eff := '-infinity';
  ELSE
    PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.bom_snapshots.change');
    IF p_bom_id IS NULL OR p_effective_from IS NULL OR length(btrim(COALESCE(p_reason, ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_CHANGE_INCOMPLETE';
    END IF;
    IF p_effective_from IN ('-infinity','infinity') OR p_effective_from <= v_latest_eff THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_EFFECTIVE_NOT_AFTER_LATEST';
    END IF;
    v_tz := (wardah_internal.mfg_period_calendar_at_206(p_org_id, p_effective_from)).timezone;
    IF v_tz IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PERIOD_CALENDAR_NOT_IN_FORCE';
    END IF;
    v_det := (p_effective_from AT TIME ZONE v_tz)::date;
    v_eff := p_effective_from;
  END IF;
  -- The BOM: approved, active, of the order's item, in force on the determination date.
  IF p_bom_id IS NULL THEN
    SELECT count(*) INTO v_n FROM public.bom_headers b
    WHERE b.org_id = p_org_id AND b.item_id IN (v_mo.item_id, v_mo.product_id)
      AND b.status = 'APPROVED' AND COALESCE(b.is_active, true)
      AND COALESCE(b.effective_date, '-infinity'::date) <= v_det
      AND COALESCE(b.bom_version, 0) = (
        SELECT max(COALESCE(b2.bom_version, 0)) FROM public.bom_headers b2
        WHERE b2.org_id = p_org_id AND b2.item_id IN (v_mo.item_id, v_mo.product_id)
          AND b2.status = 'APPROVED' AND COALESCE(b2.is_active, true)
          AND COALESCE(b2.effective_date, '-infinity'::date) <= v_det);
    IF v_n = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_NO_APPROVED_BOM: ' || v_det::text;
    ELSIF v_n > 1 THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_BOM_AMBIGUOUS: ' || v_det::text;
    END IF;
    SELECT b.* INTO v_bom FROM public.bom_headers b
    WHERE b.org_id = p_org_id AND b.item_id IN (v_mo.item_id, v_mo.product_id)
      AND b.status = 'APPROVED' AND COALESCE(b.is_active, true)
      AND COALESCE(b.effective_date, '-infinity'::date) <= v_det
    ORDER BY COALESCE(b.bom_version, 0) DESC LIMIT 1;
  ELSE
    SELECT b.* INTO v_bom FROM public.bom_headers b WHERE b.id = p_bom_id AND b.org_id = p_org_id;
    IF NOT FOUND OR v_bom.item_id NOT IN (v_mo.item_id, v_mo.product_id)
       OR v_bom.status <> 'APPROVED' OR NOT COALESCE(v_bom.is_active, true)
       OR COALESCE(v_bom.effective_date, '-infinity'::date) > v_det THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_BOM_NOT_ELIGIBLE';
    END IF;
  END IF;
  IF v_bom.quantity IS NULL OR v_bom.quantity <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_HEADER_QUANTITY_INVALID: ' || v_bom.bom_number;
  END IF;
  INSERT INTO wardah_internal.mo_bom_snapshots_206
    (org_id, mo_id, snapshot_no, source_bom_id, bom_number, bom_version, bom_status, bom_item_id, header_quantity,
     determination_date, cost_policy_version_id, effective_from_at, reason, created_by, idempotency_key)
  VALUES (p_org_id, p_mo_id, v_no, v_bom.id, v_bom.bom_number, v_bom.bom_version, v_bom.status, v_bom.item_id,
          v_bom.quantity, v_det, v_pin.policy_version_id, v_eff, NULLIF(btrim(COALESCE(p_reason, '')), ''),
          auth.uid(), p_idempotency_key)
  RETURNING id INTO v_id;
  PERFORM wardah_internal.mo_bom_snapshot_fill_206(v_id);
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(),
          CASE WHEN v_latest_eff IS NULL THEN 'manufacturing.bom_snapshot.create' ELSE 'manufacturing.bom_snapshot.change' END,
          'mo_bom_snapshot', v_id::text, NULL, wardah_internal.mo_bom_snapshot_json_206(v_id),
          jsonb_build_object('source', 'rpc_create_mo_bom_snapshot_206', 'migration', 206,
                             'idempotency_key', p_idempotency_key, 'reason', p_reason));
  RETURN wardah_internal.mo_bom_snapshot_json_206(v_id) || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_create_mo_bom_snapshot_206(uuid, uuid, uuid, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_mo_bom_snapshot_206(uuid, uuid, uuid, timestamptz, text, uuid) TO authenticated;

-- Approve a draft snapshot (B1, B3). A change snapshot is refused while any live record or input
-- of the order ends after its effective time: such quantity would change snapshot after the fact.
CREATE FUNCTION public.rpc_approve_mo_bom_snapshot_206(p_org_id uuid, p_snapshot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_s wardah_internal.mo_bom_snapshots_206;
  v_n integer;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.bom_snapshots.approve');
  SELECT * INTO v_s FROM wardah_internal.mo_bom_snapshots_206 WHERE id = p_snapshot_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_NOT_FOUND';
  END IF;
  PERFORM wardah_internal.mfg_production_mo_206(p_org_id, v_s.mo_id);
  SELECT * INTO v_s FROM wardah_internal.mo_bom_snapshots_206 WHERE id = p_snapshot_id FOR UPDATE;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_NOT_DRAFT';
  END IF;
  PERFORM wardah_internal.mo_bom_snapshot_approval_check_206(v_s.id);
  IF v_s.effective_from_at <> '-infinity' THEN
    IF v_s.effective_from_at <= (SELECT max(effective_from_at) FROM wardah_internal.mo_bom_snapshots_206
                                 WHERE mo_id = v_s.mo_id AND status = 'approved') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_EFFECTIVE_NOT_AFTER_LATEST';
    END IF;
    SELECT count(*) INTO v_n FROM (
      SELECT 1 FROM wardah_internal.mfg_production_records_206
      WHERE mo_id = v_s.mo_id AND status IN ('draft','submitted','approved') AND executed_to > v_s.effective_from_at
      UNION ALL
      SELECT 1 FROM wardah_internal.mfg_production_inputs_206
      WHERE mo_id = v_s.mo_id AND status IN ('draft','submitted','approved') AND executed_to > v_s.effective_from_at) x;
    IF v_n > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = format('MFG_BOM_SNAPSHOT_CHANGE_CONFLICTS_RECORDS: %s record(s) end after the effective time', v_n);
    END IF;
  ELSIF EXISTS (SELECT 1 FROM wardah_internal.mo_bom_snapshots_206 WHERE mo_id = v_s.mo_id AND status = 'approved') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_FIRST_ALREADY_APPROVED';
  END IF;
  UPDATE wardah_internal.mo_bom_snapshots_206
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_s.id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.bom_snapshot.approve', 'mo_bom_snapshot', v_s.id::text,
          jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'approved'),
          jsonb_build_object('source', 'rpc_approve_mo_bom_snapshot_206', 'migration', 206, 'mo_id', v_s.mo_id,
                             'snapshot_no', v_s.snapshot_no));
  RETURN wardah_internal.mo_bom_snapshot_json_206(v_s.id);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_approve_mo_bom_snapshot_206(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_approve_mo_bom_snapshot_206(uuid, uuid) TO authenticated;

CREATE FUNCTION public.rpc_withdraw_mo_bom_snapshot_206(p_org_id uuid, p_snapshot_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_s wardah_internal.mo_bom_snapshots_206;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  SELECT * INTO v_s FROM wardah_internal.mo_bom_snapshots_206 WHERE id = p_snapshot_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_BOM_SNAPSHOT_NOT_FOUND';
  END IF;
  IF v_s.created_by IS DISTINCT FROM auth.uid() THEN
    PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.bom_snapshots.approve');
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_REASON_REQUIRED';
  END IF;
  PERFORM wardah_internal.mfg_production_mo_206(p_org_id, v_s.mo_id);
  SELECT * INTO v_s FROM wardah_internal.mo_bom_snapshots_206 WHERE id = p_snapshot_id FOR UPDATE;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_BOM_SNAPSHOT_NOT_DRAFT';
  END IF;
  UPDATE wardah_internal.mo_bom_snapshots_206
  SET status = 'withdrawn', withdrawn_by = auth.uid(), withdrawn_at = now(), withdraw_reason = p_reason
  WHERE id = v_s.id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.bom_snapshot.withdraw', 'mo_bom_snapshot', v_s.id::text,
          jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'withdrawn'),
          jsonb_build_object('source', 'rpc_withdraw_mo_bom_snapshot_206', 'migration', 206, 'reason', p_reason));
  RETURN jsonb_build_object('snapshot_id', v_s.id, 'status', 'withdrawn');
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_withdraw_mo_bom_snapshot_206(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_mo_bom_snapshot_206(uuid, uuid, text) TO authenticated;

-- Record production (draft). Snapshot, stage, period and lateness are derived, never supplied.
CREATE FUNCTION public.rpc_record_production_206(
  p_org_id uuid, p_mo_id uuid, p_operation_sequence integer, p_work_order_id uuid, p_good_quantity numeric,
  p_spoiled_quantity numeric, p_executed_from timestamptz, p_executed_to timestamptz, p_notes text, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_existing wardah_internal.mfg_production_records_206;
  v_mo public.manufacturing_orders;
  v_a jsonb;
  v_id uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.production_records.record');
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  SELECT * INTO v_existing FROM wardah_internal.mfg_production_records_206
  WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.mo_id <> p_mo_id OR v_existing.recorded_by <> auth.uid()
       OR v_existing.operation_sequence IS DISTINCT FROM p_operation_sequence
       OR v_existing.work_order_id IS DISTINCT FROM p_work_order_id
       OR v_existing.good_quantity IS DISTINCT FROM p_good_quantity
       OR v_existing.spoiled_quantity IS DISTINCT FROM COALESCE(p_spoiled_quantity, 0)
       OR v_existing.executed_from IS DISTINCT FROM p_executed_from
       OR v_existing.executed_to IS DISTINCT FROM p_executed_to THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN to_jsonb(v_existing) - 'idempotency_key' || jsonb_build_object('replayed', true);
  END IF;
  IF p_good_quantity IS NULL OR p_good_quantity < 0 OR COALESCE(p_spoiled_quantity, 0) < 0
     OR p_good_quantity + COALESCE(p_spoiled_quantity, 0) <= 0
     OR p_good_quantity = 'NaN'::numeric OR COALESCE(p_spoiled_quantity, 0) = 'NaN'::numeric THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_QUANTITY_INVALID';
  END IF;
  v_mo := wardah_internal.mfg_production_mo_206(p_org_id, p_mo_id);
  v_a := wardah_internal.mfg_production_attribute_206(p_org_id, v_mo, p_operation_sequence, p_executed_from, p_executed_to);
  PERFORM wardah_internal.mfg_production_check_work_order_206(p_org_id, p_mo_id, p_work_order_id,
    (v_a->>'snapshot_id')::uuid, p_operation_sequence);
  INSERT INTO wardah_internal.mfg_production_records_206
    (org_id, mo_id, snapshot_id, operation_sequence, stage_id, work_center_id, work_order_id, good_quantity, spoiled_quantity,
     executed_from, executed_to, calendar_id, execution_local_date, execution_period_start, late_by_days,
     late_window_days, is_late, after_close, notes, recorded_by, idempotency_key)
  VALUES (p_org_id, p_mo_id, (v_a->>'snapshot_id')::uuid, p_operation_sequence, (v_a->>'stage_id')::uuid,
          (v_a->>'work_center_id')::uuid, p_work_order_id, p_good_quantity, COALESCE(p_spoiled_quantity, 0),
          p_executed_from, p_executed_to, (v_a->>'calendar_id')::uuid, (v_a->>'execution_local_date')::date,
          (v_a->>'execution_period_start')::date, (v_a->>'late_by_days')::integer,
          (v_a->>'late_window_days')::integer, (v_a->>'is_late')::boolean, (v_a->>'after_close')::boolean,
          p_notes, auth.uid(), p_idempotency_key)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.production_record.create', 'mfg_production_record', v_id::text, NULL,
          (SELECT to_jsonb(r) - 'idempotency_key' FROM wardah_internal.mfg_production_records_206 r WHERE r.id = v_id),
          jsonb_build_object('source', 'rpc_record_production_206', 'migration', 206, 'idempotency_key', p_idempotency_key));
  RETURN (SELECT to_jsonb(r) - 'idempotency_key' FROM wardah_internal.mfg_production_records_206 r WHERE r.id = v_id)
         || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_record_production_206(uuid, uuid, integer, uuid, numeric, numeric, timestamptz, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_production_206(uuid, uuid, integer, uuid, numeric, numeric, timestamptz, timestamptz, text, uuid)
  TO authenticated;

-- Record a labor, machine or count input (draft).
CREATE FUNCTION public.rpc_record_production_input_206(
  p_org_id uuid, p_mo_id uuid, p_operation_sequence integer, p_input_kind text, p_activity text,
  p_quantity numeric, p_count_unit text, p_executed_from timestamptz, p_executed_to timestamptz,
  p_notes text, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_existing wardah_internal.mfg_production_inputs_206;
  v_mo public.manufacturing_orders;
  v_a jsonb;
  v_id uuid;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.production_inputs.record');
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  SELECT * INTO v_existing FROM wardah_internal.mfg_production_inputs_206
  WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.mo_id <> p_mo_id OR v_existing.recorded_by <> auth.uid()
       OR v_existing.operation_sequence IS DISTINCT FROM p_operation_sequence
       OR v_existing.input_kind IS DISTINCT FROM p_input_kind
       OR v_existing.activity IS DISTINCT FROM p_activity
       OR v_existing.quantity IS DISTINCT FROM p_quantity
       OR v_existing.count_unit IS DISTINCT FROM p_count_unit
       OR v_existing.executed_from IS DISTINCT FROM p_executed_from
       OR v_existing.executed_to IS DISTINCT FROM p_executed_to THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN to_jsonb(v_existing) - 'idempotency_key' || jsonb_build_object('replayed', true);
  END IF;
  IF p_input_kind IS NULL OR p_input_kind NOT IN ('labor_hours','machine_hours','count')
     OR (p_input_kind = 'count') <> (p_activity IS NULL)
     OR (p_activity IS NOT NULL AND p_activity NOT IN ('run','setup'))
     OR (p_input_kind = 'count') <> (length(btrim(COALESCE(p_count_unit, ''))) > 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_INPUT_KIND_INVALID';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity = 'NaN'::numeric THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_QUANTITY_INVALID';
  END IF;
  v_mo := wardah_internal.mfg_production_mo_206(p_org_id, p_mo_id);
  v_a := wardah_internal.mfg_production_attribute_206(p_org_id, v_mo, p_operation_sequence, p_executed_from, p_executed_to);
  INSERT INTO wardah_internal.mfg_production_inputs_206
    (org_id, mo_id, snapshot_id, operation_sequence, stage_id, work_center_id, input_kind, activity, quantity, count_unit,
     executed_from, executed_to, calendar_id, execution_local_date, execution_period_start, late_by_days,
     late_window_days, is_late, after_close, notes, recorded_by, idempotency_key)
  VALUES (p_org_id, p_mo_id, (v_a->>'snapshot_id')::uuid, p_operation_sequence, (v_a->>'stage_id')::uuid,
          (v_a->>'work_center_id')::uuid, p_input_kind, p_activity, p_quantity, NULLIF(btrim(COALESCE(p_count_unit, '')), ''),
          p_executed_from, p_executed_to, (v_a->>'calendar_id')::uuid, (v_a->>'execution_local_date')::date,
          (v_a->>'execution_period_start')::date, (v_a->>'late_by_days')::integer,
          (v_a->>'late_window_days')::integer, (v_a->>'is_late')::boolean, (v_a->>'after_close')::boolean,
          p_notes, auth.uid(), p_idempotency_key)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.production_input.create', 'mfg_production_input', v_id::text, NULL,
          (SELECT to_jsonb(r) - 'idempotency_key' FROM wardah_internal.mfg_production_inputs_206 r WHERE r.id = v_id),
          jsonb_build_object('source', 'rpc_record_production_input_206', 'migration', 206, 'idempotency_key', p_idempotency_key));
  RETURN (SELECT to_jsonb(r) - 'idempotency_key' FROM wardah_internal.mfg_production_inputs_206 r WHERE r.id = v_id)
         || jsonb_build_object('replayed', false);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_record_production_input_206(uuid, uuid, integer, text, text, numeric, text, timestamptz, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_production_input_206(uuid, uuid, integer, text, text, numeric, text, timestamptz, timestamptz, text, uuid)
  TO authenticated;

-- One transition RPC for both record kinds. p_kind: 'record' | 'input'.
--   submit   draft -> submitted        by the recorder
--   withdraw draft|submitted -> withdrawn  by the recorder, with a reason
--   approve  submitted -> approved     approve permission of the kind; never the recorder (B7);
--                                      past the late window also production_records.approve_late (B5)
--   reject   submitted -> rejected     approve permission of the kind, with a reason; never the recorder
CREATE FUNCTION public.rpc_transition_production_entry_206(
  p_org_id uuid, p_kind text, p_entry_id uuid, p_action text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_table text;
  v_approve_key text;
  v_row jsonb;
  v_status text;
  v_recorder uuid;
  v_is_late boolean;
  v_mo uuid;
  v_to text;
  v_late_ok boolean := false;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF p_kind = 'record' THEN
    v_table := 'mfg_production_records_206';
    v_approve_key := 'manufacturing.production_records.approve';
  ELSIF p_kind = 'input' THEN
    v_table := 'mfg_production_inputs_206';
    v_approve_key := 'manufacturing.production_inputs.approve';
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_KIND_INVALID';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('submit','withdraw','approve','reject') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_ACTION_INVALID';
  END IF;
  EXECUTE format('SELECT mo_id FROM wardah_internal.%I WHERE id = $1 AND org_id = $2', v_table)
  INTO v_mo USING p_entry_id, p_org_id;
  IF v_mo IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_ENTRY_NOT_FOUND';
  END IF;
  PERFORM wardah_internal.mfg_production_lock_mo_206(v_mo);
  EXECUTE format('SELECT to_jsonb(t) FROM wardah_internal.%I t WHERE id = $1 FOR UPDATE', v_table)
  INTO v_row USING p_entry_id;
  v_status := v_row->>'status';
  v_recorder := (v_row->>'recorded_by')::uuid;
  v_is_late := (v_row->>'is_late')::boolean;
  IF p_action IN ('submit','withdraw') THEN
    IF v_recorder IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFG_PRODUCTION_NOT_RECORDER';
    END IF;
    IF p_action = 'submit' AND v_status <> 'draft'
       OR p_action = 'withdraw' AND v_status NOT IN ('draft','submitted') THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_STATUS_INVALID: ' || v_status;
    END IF;
    IF p_action = 'withdraw' AND length(btrim(COALESCE(p_reason, ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_REASON_REQUIRED';
    END IF;
    v_to := CASE p_action WHEN 'submit' THEN 'submitted' ELSE 'withdrawn' END;
    EXECUTE format('UPDATE wardah_internal.%I SET status = $2, submitted_at = CASE WHEN $2 = ''submitted'' THEN now() ELSE submitted_at END, decision_reason = CASE WHEN $2 = ''withdrawn'' THEN $3 ELSE decision_reason END WHERE id = $1', v_table)
    USING p_entry_id, v_to, p_reason;
  ELSE
    PERFORM wardah_internal.mfg_production_require_206(p_org_id, v_approve_key);
    IF v_recorder = auth.uid() THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFG_PRODUCTION_SELF_APPROVAL_DENIED';
    END IF;
    IF v_status <> 'submitted' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFG_PRODUCTION_STATUS_INVALID: ' || v_status;
    END IF;
    IF p_action = 'reject' AND length(btrim(COALESCE(p_reason, ''))) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_REASON_REQUIRED';
    END IF;
    IF p_action = 'approve' AND p_kind = 'record' THEN
      PERFORM wardah_internal.mfg_production_check_work_order_206(p_org_id, v_mo, (v_row->>'work_order_id')::uuid,
        (v_row->>'snapshot_id')::uuid, (v_row->>'operation_sequence')::integer);
    END IF;
    IF p_action = 'approve' AND v_is_late THEN
      PERFORM wardah_internal.mfg_production_require_206(p_org_id, 'manufacturing.production_records.approve_late');
      IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_LATE_REASON_REQUIRED';
      END IF;
      v_late_ok := true;
    END IF;
    v_to := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
    EXECUTE format('UPDATE wardah_internal.%I SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4, late_approval = $5 WHERE id = $1', v_table)
    USING p_entry_id, v_to, auth.uid(), NULLIF(btrim(COALESCE(p_reason, '')), ''), v_late_ok;
  END IF;
  INSERT INTO public.audit_logs(org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
  VALUES (p_org_id, auth.uid(), format('manufacturing.production_%s.%s', p_kind, p_action),
          'mfg_production_' || p_kind, p_entry_id::text,
          jsonb_build_object('status', v_status), jsonb_build_object('status', v_to, 'late_approval', v_late_ok),
          jsonb_build_object('source', 'rpc_transition_production_entry_206', 'migration', 206, 'reason', p_reason));
  EXECUTE format('SELECT to_jsonb(t) - ''idempotency_key'' FROM wardah_internal.%I t WHERE id = $1', v_table)
  INTO v_row USING p_entry_id;
  RETURN v_row;
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_transition_production_entry_206(uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_transition_production_entry_206(uuid, text, uuid, text, text) TO authenticated;

-- Read an order's snapshots, records and inputs (orders.read or any 206 key), plus the org
-- recording settings and calendar.
CREATE FUNCTION public.rpc_get_mo_production_206(p_org_id uuid, p_mo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT (COALESCE(public.has_permission(auth.uid(), p_org_id, 'manufacturing.orders.read'), false)
          OR EXISTS (SELECT 1 FROM unnest(ARRAY['manufacturing.production_records.record','manufacturing.production_records.approve',
                       'manufacturing.production_inputs.record','manufacturing.production_inputs.approve',
                       'manufacturing.bom_snapshots.approve']) k
                     WHERE COALESCE(public.has_permission(auth.uid(), p_org_id, k::character varying), false))) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFG_PRODUCTION_PERMISSION_DENIED: manufacturing.orders.read';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.manufacturing_orders WHERE id = p_mo_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFG_PRODUCTION_MO_NOT_FOUND';
  END IF;
  RETURN jsonb_build_object(
    'mo_id', p_mo_id,
    'late_window_days', (SELECT late_window_days FROM wardah_internal.mfg_recording_settings_206 WHERE org_id = p_org_id),
    'calendars', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.effective_from)
                           FROM wardah_internal.mfg_period_calendars_206 c WHERE c.org_id = p_org_id), '[]'::jsonb),
    'snapshots', COALESCE((SELECT jsonb_agg(wardah_internal.mo_bom_snapshot_json_206(s.id) ORDER BY s.snapshot_no)
                           FROM wardah_internal.mo_bom_snapshots_206 s WHERE s.mo_id = p_mo_id), '[]'::jsonb),
    'records', COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'idempotency_key' ORDER BY r.executed_from, r.entered_at)
                         FROM wardah_internal.mfg_production_records_206 r WHERE r.mo_id = p_mo_id), '[]'::jsonb),
    'inputs', COALESCE((SELECT jsonb_agg(to_jsonb(i) - 'idempotency_key' ORDER BY i.executed_from, i.entered_at)
                        FROM wardah_internal.mfg_production_inputs_206 i WHERE i.mo_id = p_mo_id), '[]'::jsonb));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_get_mo_production_206(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_mo_production_206(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Postflight.
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_sig text;
BEGIN
  IF (SELECT count(*) FROM public.permissions
      WHERE permission_key LIKE 'manufacturing.bom_snapshots.%'
         OR permission_key LIKE 'manufacturing.production_records.%'
         OR permission_key LIKE 'manufacturing.production_inputs.%') <> 8
     OR EXISTS (SELECT 1 FROM public.permissions
                WHERE (permission_key LIKE 'manufacturing.bom_snapshots.%'
                    OR permission_key LIKE 'manufacturing.production_records.%'
                    OR permission_key LIKE 'manufacturing.production_inputs.%')
                  AND COALESCE(public.wardah_is_sensitive_permission(permission_key), false)) THEN
    RAISE EXCEPTION 'M206_POSTFLIGHT_PERMISSIONS';
  END IF;
  FOR v_sig IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'wardah_internal' AND p.proname LIKE '%\_206' ESCAPE '\'
  LOOP
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') OR has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('service_role', v_sig, 'EXECUTE')
       OR (SELECT prosecdef FROM pg_proc WHERE oid = v_sig::regprocedure) THEN
      RAISE EXCEPTION 'M206_POSTFLIGHT_INTERNAL_EXPOSED: %', v_sig;
    END IF;
  END LOOP;
  FOR v_sig IN
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'rpc\_%\_206' ESCAPE '\'
  LOOP
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') OR has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('service_role', v_sig, 'EXECUTE')
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_sig::regprocedure) THEN
      RAISE EXCEPTION 'M206_POSTFLIGHT_RPC_ACL: %', v_sig;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'rpc\_%\_206' ESCAPE '\') <> 9 THEN
    RAISE EXCEPTION 'M206_POSTFLIGHT_RPC_COUNT';
  END IF;
END
$postflight$;
