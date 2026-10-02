-- 199: Manufacturing quality control (قسم الضبط) — inspections, release gate, policy.
-- Requires 190..198 in ledger order. Backward compatible: every org is seeded
-- with release_gate_mode='off', so no completion path changes behavior until an
-- org admin turns the gate on from Settings > Quality. Inventory and decision
-- record: docs/architecture/MANUFACTURING_QUALITY_CONTROL_INVENTORY_20261002.md;
-- runbook: docs/db/MANUFACTURING_QUALITY_CONTROL_199_RUNBOOK.md.
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.rpc_manage_material_issue_setup(uuid,uuid,jsonb,uuid)') IS NULL
     OR to_regprocedure('wardah_internal.deny_manufacturing_history_truncate_193()') IS NULL
     OR to_regprocedure('public.normalize_mo_status(text)') IS NULL
     OR to_regprocedure('public.validate_mo_transition(text,text)') IS NULL
     OR to_regclass('wardah_internal.material_issue_events') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.manufacturing_orders'::regclass
         AND attname = 'maintenance_version' AND NOT attisdropped)
     OR has_table_privilege('authenticated','public.manufacturing_orders','UPDATE') THEN
    RAISE EXCEPTION 'M199_REQUIRES_M190_THROUGH_M198';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quality_inspections
    GROUP BY org_id, inspection_number HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'M199_DUPLICATE_INSPECTION_NUMBERS';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog (module.resource.action) and role templates.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions(module_id,resource,resource_ar,action,action_ar,
  permission_key,description,description_ar)
SELECT m.id,v.resource,v.resource_ar,v.action,v.action_ar,v.key,v.description,v.description_ar
FROM public.modules m CROSS JOIN (VALUES
  ('quality_inspections','فحوص الجودة','read','عرض',
   'manufacturing.quality_inspections.read',
   'Read manufacturing quality inspections and order release status',
   'عرض فحوص الجودة وحالة الإفراج عن أوامر التصنيع'),
  ('quality_inspections','فحوص الجودة','create','تسجيل',
   'manufacturing.quality_inspections.create',
   'Record in-process and final inspections; place an order under quality hold or return it to production',
   'تسجيل الفحوص المرحلية والنهائية، ووضع الأمر تحت الفحص أو إعادته للإنتاج'),
  ('quality_inspections','فحوص الجودة','approve_conditional','اعتماد مشروط',
   'manufacturing.quality_inspections.approve_conditional',
   'Record a conditional (use-as-is) release decision',
   'اعتماد قرار إفراج مشروط (قبول كما هو)')
) v(resource,resource_ar,action,action_ar,key,description,description_ar)
WHERE m.name = 'manufacturing'
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_templates(name,name_ar,description,description_ar,
  permission_keys,category,is_active)
SELECT v.name,v.name_ar,v.description,v.description_ar,v.keys,'manufacturing',true
FROM (VALUES
  ('Quality Inspector','مراقب جودة',
   'Records manufacturing inspections and quality holds',
   'تسجيل فحوص التصنيع ووضع الأوامر تحت الفحص',
   ARRAY['manufacturing.quality_inspections.read','manufacturing.quality_inspections.create',
         'manufacturing.orders.read','manufacturing.stages.read']),
  ('Quality Manager','مدير الجودة',
   'Inspections, quality holds and conditional release decisions',
   'الفحوص والحجز للفحص وقرارات الإفراج المشروط',
   ARRAY['manufacturing.quality_inspections.read','manufacturing.quality_inspections.create',
         'manufacturing.quality_inspections.approve_conditional',
         'manufacturing.orders.read','manufacturing.stages.read'])
) v(name,name_ar,description,description_ar,keys)
WHERE NOT EXISTS (SELECT 1 FROM public.role_templates t WHERE t.name = v.name);

-- ---------------------------------------------------------------------------
-- 2. Private policy, QC-cycle and numbering state. No client grants.
-- ---------------------------------------------------------------------------
CREATE TABLE wardah_internal.quality_policies (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  release_gate_mode text NOT NULL DEFAULT 'off'
    CHECK (release_gate_mode IN ('off','all_orders','routing_flagged')),
  inspection_scope text NOT NULL DEFAULT 'final_only'
    CHECK (inspection_scope IN ('final_only','stages_and_final')),
  allow_conditional_release boolean NOT NULL DEFAULT false,
  segregation_of_duties boolean NOT NULL DEFAULT true,
  admins_subject_to_quality_controls boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
REVOKE ALL ON wardah_internal.quality_policies FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO wardah_internal.quality_policies(org_id) SELECT id FROM public.organizations;

CREATE FUNCTION wardah_internal.seed_quality_policy_199()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO wardah_internal.quality_policies(org_id) VALUES (NEW.id)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.seed_quality_policy_199()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER seed_quality_policy_199
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION wardah_internal.seed_quality_policy_199();

-- One row per MO that ever entered quality_check. The cycle increments on each
-- entry, so a FINAL inspection recorded in an earlier cycle can never release
-- the order after it went back to production. Written only by the MO trigger.
CREATE TABLE wardah_internal.mo_quality_cycles (
  mo_id uuid PRIMARY KEY REFERENCES public.manufacturing_orders(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cycle integer NOT NULL CHECK (cycle > 0),
  entered_at timestamptz NOT NULL,
  entered_by uuid
);
REVOKE ALL ON wardah_internal.mo_quality_cycles FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO wardah_internal.mo_quality_cycles(mo_id,org_id,cycle,entered_at)
SELECT id, org_id, 1, now() FROM public.manufacturing_orders
WHERE public.normalize_mo_status(status) = 'quality_check';

CREATE TABLE wardah_internal.quality_inspection_counters (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number bigint NOT NULL CHECK (last_number > 0)
);
REVOKE ALL ON wardah_internal.quality_inspection_counters
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. quality_inspections: additive columns, RPC-only writes, immutable rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.quality_inspections ALTER COLUMN work_order_id DROP NOT NULL;
ALTER TABLE public.quality_inspections
  ADD COLUMN mo_id uuid REFERENCES public.manufacturing_orders(id),
  ADD COLUMN stage_id uuid REFERENCES public.manufacturing_stages(id),
  ADD COLUMN qc_cycle integer,
  ADD COLUMN inspection_seq bigint,
  ADD COLUMN disposition text,
  ADD COLUMN request_id uuid,
  ADD COLUMN request_hash text;
ALTER TABLE public.quality_inspections
  ADD CONSTRAINT quality_inspections_subject_199
    CHECK (work_order_id IS NOT NULL OR mo_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT quality_inspections_quantities_199
    CHECK (COALESCE(passed_quantity,0) >= 0 AND COALESCE(failed_quantity,0) >= 0
           AND COALESCE(sample_size,0) >= 0) NOT VALID,
  ADD CONSTRAINT quality_inspections_disposition_199
    CHECK (disposition IS NULL OR disposition IN ('scrap','rework','use_as_is')) NOT VALID;
CREATE UNIQUE INDEX quality_inspections_org_number_199
  ON public.quality_inspections(org_id, inspection_number);
CREATE UNIQUE INDEX quality_inspections_org_request_199
  ON public.quality_inspections(org_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX quality_inspections_mo_199
  ON public.quality_inspections(mo_id, inspection_type, qc_cycle, inspection_seq);
CREATE INDEX quality_inspections_stage_199 ON public.quality_inspections(stage_id);

COMMENT ON COLUMN public.quality_inspections.qc_cycle IS
  'M199: wardah_internal.mo_quality_cycles.cycle when recorded; FINAL releases only its own cycle.';
COMMENT ON COLUMN public.quality_inspections.disposition IS
  'M199: decision for failed_quantity — scrap, rework, or use_as_is (CONDITIONAL only).';

-- The only write path is rpc_record_quality_inspection. Reads go through the
-- permission-checked RPCs so manufacturing.quality_inspections.read is real.
REVOKE ALL ON public.quality_inspections FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS quality_inspections_insert_policy ON public.quality_inspections;
DROP POLICY IF EXISTS quality_inspections_update_policy ON public.quality_inspections;

CREATE FUNCTION wardah_internal.deny_quality_inspection_change_199()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501',
    MESSAGE = 'QUALITY_INSPECTION_IMMUTABLE',
    HINT = 'Record a new inspection instead of changing or deleting history.';
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.deny_quality_inspection_change_199()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER deny_quality_inspection_change_199
BEFORE UPDATE OR DELETE ON public.quality_inspections
FOR EACH ROW EXECUTE FUNCTION wardah_internal.deny_quality_inspection_change_199();

-- ---------------------------------------------------------------------------
-- 4. Private helpers.
-- ---------------------------------------------------------------------------
-- Explicit active role grant, with no Org Admin/super-admin bypass (as M196).
CREATE FUNCTION wardah_internal.quality_has_explicit_grant_199(
  p_org uuid, p_user uuid, p_key text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organizations uo
    JOIN public.user_roles ur ON ur.user_id = uo.user_id AND ur.org_id = uo.org_id
    JOIN public.roles r ON r.id = ur.role_id AND r.org_id = ur.org_id AND r.is_active IS TRUE
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE uo.user_id = p_user AND uo.org_id = p_org AND uo.is_active IS TRUE
      AND p.permission_key = p_key
      AND (ur.expires_at IS NULL OR ur.expires_at > clock_timestamp()));
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.quality_has_explicit_grant_199(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION wardah_internal.quality_is_admin_199(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT COALESCE(public.is_super_admin(), false) OR public.wardah_is_org_admin(p_org);
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.quality_is_admin_199(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Write capability follows the org policy: when admins are subject to quality
-- controls an explicit grant is required for everyone; otherwise the ordinary
-- has_permission contract (with its Org Admin bypass) applies.
CREATE FUNCTION wardah_internal.quality_actor_can_199(
  p_org uuid, p_key text, p_admins_subject boolean
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_admins_subject
    THEN wardah_internal.quality_has_explicit_grant_199(p_org, auth.uid(), p_key)
    ELSE COALESCE(public.has_permission(auth.uid(), p_org, p_key), false)
  END;
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.quality_actor_can_199(uuid,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- Anyone who created the order, wrote its stage WIP, issued its materials or
-- operated its work orders took part in producing it.
CREATE FUNCTION wardah_internal.quality_is_production_participant_199(
  p_mo uuid, p_user uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.manufacturing_orders
                 WHERE id = p_mo AND created_by = p_user)
      OR EXISTS (SELECT 1 FROM public.stage_wip_log
                 WHERE mo_id = p_mo AND p_user IN (created_by, updated_by))
      OR EXISTS (SELECT 1 FROM public.material_consumption
                 WHERE mo_id = p_mo AND created_by = p_user)
      OR EXISTS (SELECT 1 FROM wardah_internal.material_issue_events
                 WHERE mo_id = p_mo AND actor_id = p_user)
      OR EXISTS (SELECT 1 FROM public.work_orders
                 WHERE mo_id = p_mo AND p_user IN (created_by, current_operator_id));
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.quality_is_production_participant_199(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Single source of truth for the release decision, used by the MO trigger and
-- by the read RPC. p_status is the status the order is LEAVING (or holds now);
-- p_completed_qty NULL skips the quantity comparison.
CREATE FUNCTION wardah_internal.evaluate_quality_release_199(
  p_org uuid, p_mo uuid, p_routing uuid, p_status text, p_completed_qty numeric
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_policy wardah_internal.quality_policies%ROWTYPE;
  v_required boolean;
  v_cycle integer;
  v_final public.quality_inspections%ROWTYPE;
  v_released numeric := 0;
  v_missing jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_policy FROM wardah_internal.quality_policies WHERE org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;

  v_required := CASE v_policy.release_gate_mode
    WHEN 'all_orders' THEN true
    WHEN 'routing_flagged' THEN p_routing IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.routing_operations ro
      WHERE ro.routing_id = p_routing AND ro.org_id = p_org
        AND COALESCE(ro.is_active, true)
        AND (COALESCE(ro.requires_inspection, false) OR ro.operation_type = 'INSPECTION'))
    ELSE false END;

  SELECT cycle INTO v_cycle FROM wardah_internal.mo_quality_cycles WHERE mo_id = p_mo;

  SELECT qi.* INTO v_final FROM public.quality_inspections qi
  WHERE qi.mo_id = p_mo AND qi.org_id = p_org AND qi.inspection_type = 'FINAL'
    AND v_cycle IS NOT NULL AND qi.qc_cycle = v_cycle
  ORDER BY qi.inspection_seq DESC LIMIT 1;

  IF v_final.id IS NOT NULL THEN
    v_released := CASE v_final.result
      WHEN 'PASS' THEN COALESCE(v_final.passed_quantity, 0)
      WHEN 'CONDITIONAL' THEN COALESCE(v_final.passed_quantity, 0)
                              + COALESCE(v_final.failed_quantity, 0)
      ELSE 0 END;
  END IF;

  IF v_policy.inspection_scope = 'stages_and_final' THEN
    SELECT COALESCE(jsonb_agg(s.stage_id ORDER BY s.stage_id), '[]'::jsonb) INTO v_missing
    FROM (SELECT DISTINCT w.stage_id FROM public.stage_wip_log w
          WHERE w.mo_id = p_mo AND w.org_id = p_org) s
    WHERE NOT EXISTS (
      SELECT 1 FROM (
        SELECT qi.result FROM public.quality_inspections qi
        WHERE qi.mo_id = p_mo AND qi.org_id = p_org
          AND qi.inspection_type = 'IN_PROCESS' AND qi.stage_id = s.stage_id
        ORDER BY qi.inspection_seq DESC LIMIT 1
      ) latest
      WHERE latest.result = 'PASS'
         OR (latest.result = 'CONDITIONAL' AND v_policy.allow_conditional_release));
  END IF;

  v_reason := CASE
    WHEN public.normalize_mo_status(p_status) <> 'quality_check'
      THEN 'QUALITY_CHECK_STATUS_REQUIRED'
    WHEN v_final.id IS NULL THEN 'QUALITY_RELEASE_REQUIRED'
    WHEN v_final.result = 'FAIL' THEN 'QUALITY_RELEASE_REJECTED'
    WHEN v_final.result = 'CONDITIONAL' AND NOT v_policy.allow_conditional_release
      THEN 'QUALITY_CONDITIONAL_RELEASE_DISABLED'
    WHEN jsonb_array_length(v_missing) > 0 THEN 'QUALITY_STAGE_INSPECTION_REQUIRED'
    WHEN p_completed_qty IS NOT NULL AND p_completed_qty > v_released
      THEN 'QUALITY_RELEASE_QUANTITY_EXCEEDED'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'gate_mode', v_policy.release_gate_mode,
    'inspection_scope', v_policy.inspection_scope,
    'allow_conditional_release', v_policy.allow_conditional_release,
    'required', v_required,
    'ready', (NOT v_required) OR v_reason IS NULL,
    'reason', CASE WHEN v_required THEN v_reason END,
    'blocking_reason_if_required', v_reason,
    'qc_cycle', v_cycle,
    'released_quantity', v_released,
    'missing_stage_ids', v_missing,
    'final_inspection', CASE WHEN v_final.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_final.id, 'inspection_number', v_final.inspection_number,
      'result', v_final.result, 'passed_quantity', v_final.passed_quantity,
      'failed_quantity', v_final.failed_quantity, 'disposition', v_final.disposition,
      'inspector_id', v_final.inspector_id, 'inspection_date', v_final.inspection_date) END);
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Release gate on the order itself. Every path that moves an MO to done
--    (today's quarantined RPCs, the future #230 orchestrator, owner scripts)
--    inherits it. Ordered after mo_status_machine (which validates and
--    normalizes the transition) and before zz_issue_maintenance_version.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.mo_quality_gate_199()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_old text := public.normalize_mo_status(OLD.status);
  v_new text := public.normalize_mo_status(NEW.status);
  v_eval jsonb;
BEGIN
  IF v_new = 'quality_check' AND v_old IS DISTINCT FROM 'quality_check' THEN
    INSERT INTO wardah_internal.mo_quality_cycles(mo_id,org_id,cycle,entered_at,entered_by)
    VALUES (NEW.id, NEW.org_id, 1, clock_timestamp(), auth.uid())
    ON CONFLICT (mo_id) DO UPDATE
      SET cycle = wardah_internal.mo_quality_cycles.cycle + 1,
          entered_at = EXCLUDED.entered_at,
          entered_by = EXCLUDED.entered_by;
  ELSIF v_new = 'done' AND v_old IS DISTINCT FROM 'done' THEN
    v_eval := wardah_internal.evaluate_quality_release_199(
      NEW.org_id, NEW.id, NEW.routing_id, OLD.status, NEW.completed_quantity);
    IF NOT (v_eval ->> 'ready')::boolean THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = v_eval ->> 'reason', DETAIL = v_eval::text;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.mo_quality_gate_199()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zq_quality_release_gate_199
BEFORE UPDATE OF status ON public.manufacturing_orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION wardah_internal.mo_quality_gate_199();

-- Re-close every private helper after the last CREATE TRIGGER of this file
-- (the DEFINER scanner treats a trigger's EXECUTE FUNCTION as an ACL event).
REVOKE ALL ON FUNCTION wardah_internal.seed_quality_policy_199()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.deny_quality_inspection_change_199()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.quality_has_explicit_grant_199(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.quality_is_admin_199(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.quality_actor_can_199(uuid,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.quality_is_production_participant_199(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION wardah_internal.mo_quality_gate_199()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Client RPCs (authenticated only).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rpc_get_quality_policy(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_policy wardah_internal.quality_policies%ROWTYPE;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  SELECT * INTO v_policy FROM wardah_internal.quality_policies WHERE org_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;
  RETURN jsonb_build_object(
    'org_id', p_org_id,
    'release_gate_mode', v_policy.release_gate_mode,
    'inspection_scope', v_policy.inspection_scope,
    'allow_conditional_release', v_policy.allow_conditional_release,
    'segregation_of_duties', v_policy.segregation_of_duties,
    'admins_subject_to_quality_controls', v_policy.admins_subject_to_quality_controls,
    'version', v_policy.version,
    'updated_at', v_policy.updated_at,
    'updated_by', v_policy.updated_by,
    'capabilities', jsonb_build_object(
      'can_manage_policy', wardah_internal.quality_is_admin_199(p_org_id),
      'can_read', COALESCE(public.has_permission(auth.uid(), p_org_id,
        'manufacturing.quality_inspections.read'), false),
      'can_inspect', wardah_internal.quality_actor_can_199(p_org_id,
        'manufacturing.quality_inspections.create', v_policy.admins_subject_to_quality_controls),
      'can_approve_conditional', wardah_internal.quality_actor_can_199(p_org_id,
        'manufacturing.quality_inspections.approve_conditional',
        v_policy.admins_subject_to_quality_controls)));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_get_quality_policy(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_quality_policy(uuid) TO authenticated;

CREATE FUNCTION public.rpc_set_quality_policy(
  p_org_id uuid, p_policy jsonb, p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before wardah_internal.quality_policies%ROWTYPE;
  v_after wardah_internal.quality_policies%ROWTYPE;
  v_unknown text;
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);
  IF jsonb_typeof(p_policy) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'QUALITY_POLICY_INVALID';
  END IF;
  SELECT min(k) INTO v_unknown FROM jsonb_object_keys(p_policy) k
  WHERE k NOT IN ('release_gate_mode','inspection_scope','allow_conditional_release',
                  'segregation_of_duties','admins_subject_to_quality_controls');
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'QUALITY_POLICY_UNKNOWN_KEY: %', v_unknown;
  END IF;
  IF jsonb_typeof(p_policy->'release_gate_mode') IS DISTINCT FROM 'string'
     OR p_policy->>'release_gate_mode' NOT IN ('off','all_orders','routing_flagged')
     OR jsonb_typeof(p_policy->'inspection_scope') IS DISTINCT FROM 'string'
     OR p_policy->>'inspection_scope' NOT IN ('final_only','stages_and_final')
     OR jsonb_typeof(p_policy->'allow_conditional_release') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_policy->'segregation_of_duties') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_policy->'admins_subject_to_quality_controls') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'QUALITY_POLICY_INVALID';
  END IF;
  SELECT * INTO v_before FROM wardah_internal.quality_policies
  WHERE org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;
  IF p_expected_version IS NULL OR p_expected_version <> v_before.version THEN
    RAISE EXCEPTION 'QUALITY_POLICY_VERSION_CONFLICT: current=%', v_before.version;
  END IF;
  UPDATE wardah_internal.quality_policies SET
    release_gate_mode = p_policy->>'release_gate_mode',
    inspection_scope = p_policy->>'inspection_scope',
    allow_conditional_release = (p_policy->>'allow_conditional_release')::boolean,
    segregation_of_duties = (p_policy->>'segregation_of_duties')::boolean,
    admins_subject_to_quality_controls = (p_policy->>'admins_subject_to_quality_controls')::boolean,
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE org_id = p_org_id RETURNING * INTO v_after;
  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata)
  VALUES (p_org_id, auth.uid(), 'manufacturing.quality_policy.update', 'quality_policy',
    p_org_id::text, to_jsonb(v_before) - 'org_id', to_jsonb(v_after) - 'org_id',
    jsonb_build_object('source','rpc_set_quality_policy','migration',199));
  RETURN public.rpc_get_quality_policy(p_org_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_quality_policy(uuid,jsonb,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_quality_policy(uuid,jsonb,bigint) TO authenticated;

-- Lock order: MO row, policy row (shared), counter row.
CREATE FUNCTION public.rpc_record_quality_inspection(
  p_mo_id uuid, p_request_id uuid, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org uuid;
  v_actor uuid := auth.uid();
  v_mo public.manufacturing_orders%ROWTYPE;
  v_policy wardah_internal.quality_policies%ROWTYPE;
  v_existing public.quality_inspections%ROWTYPE;
  v_row public.quality_inspections%ROWTYPE;
  v_type text; v_result text; v_disposition text; v_stage uuid;
  v_passed numeric; v_failed numeric; v_sample numeric;
  v_findings text; v_corrective text; v_specs text;
  v_request jsonb; v_hash text; v_seq bigint; v_cycle integer;
  v_status text;
BEGIN
  SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id = p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'QUALITY_REQUEST_ID_REQUIRED'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'QUALITY_PAYLOAD_INVALID';
  END IF;

  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = p_mo_id FOR UPDATE;
  IF v_mo.org_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_policy FROM wardah_internal.quality_policies
  WHERE org_id = v_org FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;

  IF NOT wardah_internal.quality_actor_can_199(v_org,
       'manufacturing.quality_inspections.create', v_policy.admins_subject_to_quality_controls) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_INSPECT_PERMISSION_DENIED';
  END IF;

  -- Canonical request: normalized text fields, quantities as numbers.
  v_type := upper(btrim(COALESCE(p_payload->>'inspection_type','')));
  v_result := upper(btrim(COALESCE(p_payload->>'result','')));
  v_disposition := NULLIF(lower(btrim(COALESCE(p_payload->>'disposition',''))), '');
  v_findings := NULLIF(btrim(COALESCE(p_payload->>'findings','')), '');
  v_corrective := NULLIF(btrim(COALESCE(p_payload->>'corrective_action','')), '');
  v_specs := NULLIF(btrim(COALESCE(p_payload->>'specifications','')), '');
  IF jsonb_typeof(p_payload->'passed_quantity') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'failed_quantity') IS DISTINCT FROM 'number'
     OR (p_payload ? 'sample_size' AND jsonb_typeof(p_payload->'sample_size') NOT IN ('number','null'))
     OR (p_payload ? 'stage_id' AND jsonb_typeof(p_payload->'stage_id') NOT IN ('string','null')) THEN
    RAISE EXCEPTION 'QUALITY_PAYLOAD_INVALID';
  END IF;
  v_passed := (p_payload->>'passed_quantity')::numeric;
  v_failed := (p_payload->>'failed_quantity')::numeric;
  v_sample := (p_payload->>'sample_size')::numeric;
  BEGIN
    v_stage := NULLIF(p_payload->>'stage_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'QUALITY_PAYLOAD_INVALID';
  END;
  v_request := jsonb_build_object(
    'mo_id', p_mo_id, 'inspection_type', v_type, 'result', v_result,
    'passed_quantity', v_passed, 'failed_quantity', v_failed, 'sample_size', v_sample,
    'disposition', v_disposition, 'stage_id', v_stage, 'findings', v_findings,
    'corrective_action', v_corrective, 'specifications', v_specs);
  v_hash := md5(v_request::text);

  SELECT * INTO v_existing FROM public.quality_inspections
  WHERE org_id = v_org AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash = v_hash AND v_existing.inspector_id = v_actor
       AND v_existing.mo_id = p_mo_id THEN
      RETURN jsonb_build_object('replayed', true, 'inspection_id', v_existing.id,
        'inspection_number', v_existing.inspection_number, 'result', v_existing.result,
        'qc_cycle', v_existing.qc_cycle,
        'release', wardah_internal.evaluate_quality_release_199(
          v_org, p_mo_id, v_mo.routing_id, v_mo.status, NULL));
    END IF;
    RAISE EXCEPTION 'QUALITY_REQUEST_ID_REUSED';
  END IF;

  IF v_type NOT IN ('IN_PROCESS','FINAL') THEN RAISE EXCEPTION 'QUALITY_INSPECTION_TYPE_INVALID'; END IF;
  IF v_result NOT IN ('PASS','FAIL','CONDITIONAL') THEN RAISE EXCEPTION 'QUALITY_RESULT_INVALID'; END IF;
  IF v_passed < 0 OR v_failed < 0 OR v_passed + v_failed <= 0
     OR (v_sample IS NOT NULL AND v_sample < 0) THEN
    RAISE EXCEPTION 'QUALITY_INVALID_QUANTITY';
  END IF;
  IF v_disposition IS NOT NULL AND v_disposition NOT IN ('scrap','rework','use_as_is') THEN
    RAISE EXCEPTION 'QUALITY_DISPOSITION_INVALID';
  END IF;
  IF v_failed > 0 AND v_disposition IS NULL THEN RAISE EXCEPTION 'QUALITY_DISPOSITION_REQUIRED'; END IF;
  IF v_failed = 0 AND v_disposition IS NOT NULL THEN RAISE EXCEPTION 'QUALITY_DISPOSITION_NOT_ALLOWED'; END IF;
  IF v_result = 'FAIL' AND v_failed = 0 THEN RAISE EXCEPTION 'QUALITY_FAIL_REQUIRES_REJECTED_QUANTITY'; END IF;
  IF v_result = 'CONDITIONAL' AND (v_failed = 0 OR v_disposition <> 'use_as_is') THEN
    RAISE EXCEPTION 'QUALITY_CONDITIONAL_REQUIRES_USE_AS_IS';
  END IF;
  IF v_disposition = 'use_as_is' AND v_result <> 'CONDITIONAL' THEN
    RAISE EXCEPTION 'QUALITY_USE_AS_IS_REQUIRES_CONDITIONAL';
  END IF;
  IF v_result IN ('FAIL','CONDITIONAL') AND v_corrective IS NULL THEN
    RAISE EXCEPTION 'QUALITY_CORRECTIVE_ACTION_REQUIRED';
  END IF;

  v_status := public.normalize_mo_status(v_mo.status);
  IF v_type = 'FINAL' THEN
    IF v_stage IS NOT NULL THEN RAISE EXCEPTION 'QUALITY_STAGE_NOT_ALLOWED'; END IF;
    IF v_status <> 'quality_check' THEN RAISE EXCEPTION 'QUALITY_CHECK_STATUS_REQUIRED'; END IF;
  ELSE
    IF v_stage IS NULL THEN RAISE EXCEPTION 'QUALITY_STAGE_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manufacturing_stages
                   WHERE id = v_stage AND org_id = v_org) THEN
      RAISE EXCEPTION 'QUALITY_STAGE_NOT_FOUND';
    END IF;
    IF v_status NOT IN ('in_progress','quality_check') THEN
      RAISE EXCEPTION 'QUALITY_MO_STATUS_INVALID: %', v_status;
    END IF;
  END IF;

  IF v_result = 'CONDITIONAL' THEN
    IF NOT v_policy.allow_conditional_release THEN
      RAISE EXCEPTION 'QUALITY_CONDITIONAL_RELEASE_DISABLED';
    END IF;
    IF NOT wardah_internal.quality_actor_can_199(v_org,
         'manufacturing.quality_inspections.approve_conditional',
         v_policy.admins_subject_to_quality_controls) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_CONDITIONAL_PERMISSION_DENIED';
    END IF;
  END IF;

  IF v_policy.segregation_of_duties
     AND (v_policy.admins_subject_to_quality_controls
          OR NOT wardah_internal.quality_is_admin_199(v_org))
     AND wardah_internal.quality_is_production_participant_199(p_mo_id, v_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_SEGREGATION_OF_DUTIES';
  END IF;

  INSERT INTO wardah_internal.quality_inspection_counters(org_id, last_number)
  VALUES (v_org, 1)
  ON CONFLICT (org_id) DO UPDATE
    SET last_number = wardah_internal.quality_inspection_counters.last_number + 1
  RETURNING last_number INTO v_seq;
  SELECT cycle INTO v_cycle FROM wardah_internal.mo_quality_cycles WHERE mo_id = p_mo_id;

  INSERT INTO public.quality_inspections(
    org_id, work_order_id, mo_id, stage_id, inspection_number, inspection_type,
    inspector_id, sample_size, passed_quantity, failed_quantity, result,
    inspection_date, specifications, findings, corrective_action,
    qc_cycle, inspection_seq, disposition, request_id, request_hash)
  VALUES (
    v_org, NULL, p_mo_id, v_stage, 'QI-' || lpad(v_seq::text, 6, '0'), v_type,
    v_actor, COALESCE(v_sample, v_passed + v_failed), v_passed, v_failed, v_result,
    clock_timestamp(), v_specs, v_findings, v_corrective,
    v_cycle, v_seq, v_disposition, p_request_id, v_hash)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata)
  VALUES (v_org, v_actor, 'manufacturing.quality_inspection.create', 'quality_inspection',
    v_row.id::text, NULL, v_request || jsonb_build_object(
      'inspection_number', v_row.inspection_number, 'qc_cycle', v_cycle),
    jsonb_build_object('source','rpc_record_quality_inspection','migration',199,
      'policy_version', v_policy.version, 'request_id', p_request_id));

  RETURN jsonb_build_object('replayed', false, 'inspection_id', v_row.id,
    'inspection_number', v_row.inspection_number, 'result', v_row.result,
    'qc_cycle', v_cycle,
    'release', wardah_internal.evaluate_quality_release_199(
      v_org, p_mo_id, v_mo.routing_id, v_mo.status, NULL));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) TO authenticated;

-- Two quality transitions only: in_progress -> quality_check (hold) and
-- quality_check -> in_progress (return for rework). Completion stays with the
-- quarantined/#230 path and is gated by zq_quality_release_gate_199.
CREATE FUNCTION public.rpc_set_mo_quality_hold(
  p_mo_id uuid, p_action text, p_expected_version bigint, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_org uuid;
  v_mo public.manufacturing_orders%ROWTYPE;
  v_policy wardah_internal.quality_policies%ROWTYPE;
  v_from text; v_to text; v_reason text := NULLIF(btrim(COALESCE(p_reason,'')), '');
BEGIN
  SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id = p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = p_mo_id FOR UPDATE;
  IF v_mo.org_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  SELECT * INTO v_policy FROM wardah_internal.quality_policies WHERE org_id = v_org FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUALITY_POLICY_MISSING'; END IF;
  IF NOT wardah_internal.quality_actor_can_199(v_org,
       'manufacturing.quality_inspections.create', v_policy.admins_subject_to_quality_controls) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_INSPECT_PERMISSION_DENIED';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version <> v_mo.maintenance_version THEN
    RAISE EXCEPTION 'QUALITY_MO_VERSION_CONFLICT: current=%', v_mo.maintenance_version;
  END IF;
  v_from := public.normalize_mo_status(v_mo.status);
  IF p_action = 'hold' THEN
    IF v_from <> 'in_progress' THEN RAISE EXCEPTION 'QUALITY_HOLD_REQUIRES_IN_PROGRESS: %', v_from; END IF;
    v_to := 'quality_check';
  ELSIF p_action = 'return' THEN
    IF v_from <> 'quality_check' THEN RAISE EXCEPTION 'QUALITY_RETURN_REQUIRES_QUALITY_CHECK: %', v_from; END IF;
    IF v_reason IS NULL THEN RAISE EXCEPTION 'QUALITY_RETURN_REASON_REQUIRED'; END IF;
    v_to := 'in_progress';
  ELSE
    RAISE EXCEPTION 'QUALITY_HOLD_ACTION_INVALID';
  END IF;

  UPDATE public.manufacturing_orders SET status = v_to WHERE id = p_mo_id
  RETURNING * INTO v_mo;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata)
  VALUES (v_org, auth.uid(), 'manufacturing.quality_hold.' || p_action, 'manufacturing_order',
    p_mo_id::text, jsonb_build_object('status', v_from),
    jsonb_build_object('status', v_to, 'reason', v_reason),
    jsonb_build_object('source','rpc_set_mo_quality_hold','migration',199));

  RETURN jsonb_build_object('mo_id', p_mo_id, 'previous_status', v_from, 'status', v_mo.status,
    'maintenance_version', v_mo.maintenance_version,
    'qc_cycle', (SELECT cycle FROM wardah_internal.mo_quality_cycles WHERE mo_id = p_mo_id));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_set_mo_quality_hold(uuid,text,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_mo_quality_hold(uuid,text,bigint,text) TO authenticated;

CREATE FUNCTION public.rpc_list_quality_inspections(
  p_org_id uuid, p_mo_id uuid DEFAULT NULL, p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT COALESCE(public.has_permission(auth.uid(), p_org_id,
       'manufacturing.quality_inspections.read'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_READ_PERMISSION_DENIED';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_data ORDER BY seq DESC NULLS LAST, inspection_date DESC)
    FROM (
      SELECT qi.inspection_seq AS seq, qi.inspection_date,
        jsonb_build_object(
          'id', qi.id, 'inspection_number', qi.inspection_number,
          'inspection_type', qi.inspection_type, 'result', qi.result,
          'mo_id', qi.mo_id, 'order_number', mo.order_number,
          'work_order_id', qi.work_order_id,
          'stage_id', qi.stage_id, 'stage_name', st.name, 'stage_name_ar', st.name_ar,
          'qc_cycle', qi.qc_cycle, 'sample_size', qi.sample_size,
          'passed_quantity', qi.passed_quantity, 'failed_quantity', qi.failed_quantity,
          'disposition', qi.disposition, 'findings', qi.findings,
          'corrective_action', qi.corrective_action, 'specifications', qi.specifications,
          'inspector_id', qi.inspector_id,
          'inspector_name', COALESCE(up.full_name_ar, up.full_name),
          'inspection_date', qi.inspection_date) AS row_data
      FROM public.quality_inspections qi
      LEFT JOIN public.manufacturing_orders mo ON mo.id = qi.mo_id
      LEFT JOIN public.manufacturing_stages st ON st.id = qi.stage_id
      LEFT JOIN LATERAL (
        SELECT u.full_name, u.full_name_ar FROM public.user_profiles u
        WHERE u.user_id = qi.inspector_id LIMIT 1) up ON true
      WHERE qi.org_id = p_org_id
        AND (p_mo_id IS NULL OR qi.mo_id = p_mo_id)
      ORDER BY qi.inspection_seq DESC NULLS LAST, qi.inspection_date DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    ) q), '[]'::jsonb);
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_list_quality_inspections(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_list_quality_inspections(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.rpc_get_mo_quality_status(p_mo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_org uuid; v_mo public.manufacturing_orders%ROWTYPE;
BEGIN
  SELECT org_id INTO v_org FROM public.manufacturing_orders WHERE id = p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUFACTURING_ORDER_NOT_FOUND'; END IF;
  PERFORM public.wardah_assert_org_member(v_org);
  IF NOT COALESCE(public.has_permission(auth.uid(), v_org,
       'manufacturing.quality_inspections.read'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'QUALITY_READ_PERMISSION_DENIED';
  END IF;
  SELECT * INTO v_mo FROM public.manufacturing_orders WHERE id = p_mo_id;
  RETURN jsonb_build_object(
    'mo_id', v_mo.id, 'order_number', v_mo.order_number, 'status', v_mo.status,
    'quantity', v_mo.quantity, 'maintenance_version', v_mo.maintenance_version,
    'release', wardah_internal.evaluate_quality_release_199(
      v_org, v_mo.id, v_mo.routing_id, v_mo.status, NULL));
END
$fn$;
REVOKE ALL ON FUNCTION public.rpc_get_mo_quality_status(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_mo_quality_status(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Template expansion: a wildcard such as 'manufacturing.%' (Production
--    Manager) must not silently grant inspection authority. The quality keys
--    expand only when a template names them exactly. Body otherwise equals
--    M196 (M175 audit record and M196 exclusions preserved).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_role_from_template(
  p_org_id uuid,
  p_template_id uuid,
  p_custom_name character varying DEFAULT NULL::character varying,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_template role_templates%ROWTYPE;
    v_new_role_id UUID;
    v_perm_key TEXT;
    v_granted_keys jsonb;
BEGIN
    -- [120] admin gate on the target org; p_created_by is ignored (would
    -- otherwise allow impersonating a different creator).
    PERFORM public.wardah_assert_org_admin(p_org_id);

    SELECT * INTO v_template FROM role_templates WHERE id = p_template_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Template not found';
    END IF;

    INSERT INTO roles (org_id, name, name_ar, description_ar, created_by)
    VALUES (
        p_org_id,
        COALESCE(p_custom_name, v_template.name),
        v_template.name_ar,
        v_template.description_ar,
        auth.uid()
    )
    RETURNING id INTO v_new_role_id;

    FOREACH v_perm_key IN ARRAY v_template.permission_keys
    LOOP
        INSERT INTO role_permissions (role_id, permission_id, created_by)
        SELECT v_new_role_id, p.id, auth.uid()
        FROM permissions p
        WHERE (p.permission_key LIKE REPLACE(v_perm_key, '%', '%%')
           OR p.permission_key LIKE v_perm_key)
          AND p.permission_key NOT IN ('manufacturing.material_reservation.reserve',
             'manufacturing.material_reservation.release', 'manufacturing.material_issue_setup.prepare')
          AND (p.permission_key NOT IN ('manufacturing.quality_inspections.read',
                 'manufacturing.quality_inspections.create',
                 'manufacturing.quality_inspections.approve_conditional')
               OR p.permission_key = v_perm_key)
        ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT COALESCE(jsonb_agg(p.permission_key ORDER BY p.permission_key), '[]'::jsonb)
      INTO v_granted_keys
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_new_role_id;

    -- Preserve the M175 audit record; M196 and M199 only narrow template
    -- expansion above.
    INSERT INTO audit_logs (org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata)
    VALUES (
      p_org_id, auth.uid(), 'rbac.role.create', 'role', v_new_role_id::text,
      NULL,
      jsonb_build_object('role_id', v_new_role_id,
                         'name', COALESCE(p_custom_name, v_template.name),
                         'permission_keys', v_granted_keys),
      jsonb_build_object(
        'migration', 175,
        'source', 'template',
        'template_id', p_template_id,
        'permission_count', jsonb_array_length(v_granted_keys),
        'sensitive_keys', (
          SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
          FROM jsonb_array_elements_text(v_granted_keys) AS t(k)
          WHERE wardah_is_sensitive_permission(k)
        ))
    );

    RETURN v_new_role_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Postflight (fail closed).
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE v_role text; v_priv text; v_fn text;
BEGIN
  IF (SELECT count(*) FROM public.permissions WHERE permission_key IN (
        'manufacturing.quality_inspections.read','manufacturing.quality_inspections.create',
        'manufacturing.quality_inspections.approve_conditional')) <> 3 THEN
    RAISE EXCEPTION 'M199_PERMISSION_CATALOG_INCOMPLETE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE NOT EXISTS (
       SELECT 1 FROM wardah_internal.quality_policies q
       WHERE q.org_id = o.id AND q.release_gate_mode = 'off')) THEN
    RAISE EXCEPTION 'M199_POLICY_SEED_INCOMPLETE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.manufacturing_orders'::regclass
                 AND tgname = 'zq_quality_release_gate_199' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.quality_inspections'::regclass
                 AND tgname = 'deny_quality_inspection_change_199' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.organizations'::regclass
                 AND tgname = 'seed_quality_policy_199' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'M199_TRIGGER_MISSING';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role,'public.quality_inspections',v_priv)
         OR (v_priv IN ('SELECT','INSERT','UPDATE')
             AND has_any_column_privilege(v_role,'public.quality_inspections',v_priv)) THEN
        RAISE EXCEPTION 'M199_DIRECT_GRANT_REMAINS: % %', v_role, v_priv;
      END IF;
    END LOOP;
    IF has_table_privilege(v_role,'wardah_internal.quality_policies','SELECT')
       OR has_table_privilege(v_role,'wardah_internal.mo_quality_cycles','SELECT')
       OR has_table_privilege(v_role,'wardah_internal.quality_inspection_counters','SELECT') THEN
      RAISE EXCEPTION 'M199_PRIVATE_STATE_GRANT: %', v_role;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_get_quality_policy(uuid)',
    'public.rpc_set_quality_policy(uuid,jsonb,bigint)',
    'public.rpc_record_quality_inspection(uuid,uuid,jsonb)',
    'public.rpc_set_mo_quality_hold(uuid,text,bigint,text)',
    'public.rpc_list_quality_inspections(uuid,uuid,integer)',
    'public.rpc_get_mo_quality_status(uuid)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'M199_RPC_GRANT_DRIFT: %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'wardah_internal.evaluate_quality_release_199(uuid,uuid,uuid,text,numeric)',
    'wardah_internal.quality_actor_can_199(uuid,text,boolean)',
    'wardah_internal.quality_has_explicit_grant_199(uuid,uuid,text)',
    'wardah_internal.quality_is_admin_199(uuid)',
    'wardah_internal.quality_is_production_participant_199(uuid,uuid)',
    'wardah_internal.mo_quality_gate_199()',
    'wardah_internal.seed_quality_policy_199()',
    'wardah_internal.deny_quality_inspection_change_199()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'M199_INTERNAL_HELPER_EXPOSED: %', v_fn;
    END IF;
  END LOOP;
  -- M195 containment must survive this migration.
  IF has_table_privilege('authenticated','public.manufacturing_orders','UPDATE')
     OR has_function_privilege('authenticated',
          'public.rpc_complete_manufacturing_order(jsonb)','EXECUTE')
     OR has_function_privilege('authenticated',
          'public.rpc_transition_mo_status(uuid,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'M199_M195_CONTAINMENT_DRIFT';
  END IF;
END
$postflight$;

COMMIT;
