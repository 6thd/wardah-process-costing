-- 201_manufacturing_settings_permissions
--
-- Owner decisions on the manufacturing-settings inventory (#312, §7):
--   D1: manufacturing settings live inside the general settings section
--       (/settings/manufacturing), not in a separate manufacturing area.
--   D3: editing them is a role permission. The org admin grants it to roles
--       according to what each user may do. The org admin keeps editing
--       rights as today; the key lets the admin delegate them.
--
-- This migration:
--   1. adds manufacturing.settings.read and manufacturing.settings.update to
--      the permission catalog (module 'manufacturing'). The roles screen
--      (/org-admin/roles) lists the catalog directly, so both keys appear
--      there for the org admin to grant;
--   2. keeps wildcard templates ('*', 'manufacturing.%') from granting them:
--      like the M199 quality keys, they expand only when a template names
--      them exactly (create_role_from_template);
--   3. widens the org-admin-only guard of the three existing settings
--      writers to "org admin OR holder of manufacturing.settings.update"
--      (one internal predicate, a strict superset of the old guard):
--        rpc_set_gl_event_mapping            (M200, GL event mappings)
--        rpc_set_material_issue_wo_statuses  (M192, material-issue statuses)
--        rpc_set_quality_policy              (M199, quality policy)
--      and makes rpc_get_quality_policy report can_manage_policy from the
--      same predicate, so the UI and the database agree.
--
-- Every replaced body is the previous body verbatim except the guard (or, for
-- rpc_get_quality_policy and create_role_from_template, the single line or
-- list noted above). The preflight refuses to run if any current body no
-- longer matches the version this migration was written against, so a later
-- CREATE OR REPLACE (for example the G05 pause fence proposed in #313) cannot
-- be silently overwritten. Whichever of the two lands second must carry both
-- changes; see docs/db/MANUFACTURING_SETTINGS_PERMISSIONS_201_RUNBOOK.md.
--
-- Requires 192, 199 and 200. Production order: 195 -> 199, 200, then 201.
-- No UI depends on these keys yet; the /settings/manufacturing UI PR waits
-- for 201 to be applied and verified on Production (DB-first).

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
DECLARE
  v_def text;
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.modules') IS NULL
     OR to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL
     OR to_regprocedure('wardah_internal.quality_is_admin_199(uuid)') IS NULL THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_PREREQUISITE_MISSING';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.modules WHERE name = 'manufacturing') THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_MODULE_MISSING';
  END IF;

  IF EXISTS (SELECT 1 FROM public.permissions
             WHERE permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update'))
     OR to_regprocedure('wardah_internal.manufacturing_settings_can_update_201(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_ALREADY_APPLIED';
  END IF;

  IF to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regprocedure('public.wardah_is_org_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_PREREQUISITE_MISSING';
  END IF;

  -- Each replaced function must still be the version this file copies.
  IF to_regprocedure('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)') IS NULL
     OR to_regprocedure('public.rpc_set_material_issue_wo_statuses(uuid,text[])') IS NULL
     OR to_regprocedure('public.rpc_set_quality_policy(uuid,jsonb,bigint)') IS NULL
     OR to_regprocedure('public.rpc_get_quality_policy(uuid)') IS NULL
     OR to_regprocedure('public.create_role_from_template(uuid,uuid,character varying,uuid)') IS NULL THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_TARGET_FUNCTION_MISSING';
  END IF;

  v_def := pg_get_functiondef('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)'::regprocedure);
  IF position('PERFORM public.wardah_assert_org_admin(p_org_id);' IN v_def) = 0
     OR position('ON CONFLICT (org_id, event_code, COALESCE(work_center_code, '''')) DO NOTHING' IN v_def) = 0 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_UNEXPECTED_BODY: rpc_set_gl_event_mapping';
  END IF;

  v_def := pg_get_functiondef('public.rpc_set_material_issue_wo_statuses(uuid,text[])'::regprocedure);
  IF position('PERFORM public.wardah_assert_org_admin(p_org_id);' IN v_def) = 0
     OR position('manufacturing.material_issue_wo_policy.update' IN v_def) = 0 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_UNEXPECTED_BODY: rpc_set_material_issue_wo_statuses';
  END IF;

  v_def := pg_get_functiondef('public.rpc_set_quality_policy(uuid,jsonb,bigint)'::regprocedure);
  IF position('PERFORM public.wardah_assert_org_admin(p_org_id);' IN v_def) = 0
     OR position('''migration'',199' IN v_def) = 0 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_UNEXPECTED_BODY: rpc_set_quality_policy';
  END IF;

  v_def := pg_get_functiondef('public.rpc_get_quality_policy(uuid)'::regprocedure);
  IF position('''can_manage_policy'', wardah_internal.quality_is_admin_199(p_org_id)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_UNEXPECTED_BODY: rpc_get_quality_policy';
  END IF;

  v_def := pg_get_functiondef('public.create_role_from_template(uuid,uuid,character varying,uuid)'::regprocedure);
  IF position('''manufacturing.quality_inspections.approve_conditional'')' IN v_def) = 0
     OR position('''manufacturing.material_issue_setup.prepare''' IN v_def) = 0
     OR position('''rbac.role.create''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_UNEXPECTED_BODY: create_role_from_template';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog. Ordinary keys (not in wardah_is_sensitive_permission).
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions(module_id,resource,resource_ar,action,action_ar,
  permission_key,description,description_ar)
SELECT m.id,v.resource,v.resource_ar,v.action,v.action_ar,v.key,v.description,v.description_ar
FROM public.modules m CROSS JOIN (VALUES
  ('settings','إعدادات التصنيع','read','عرض',
   'manufacturing.settings.read',
   'View the manufacturing settings page (/settings/manufacturing)',
   'عرض صفحة إعدادات التصنيع ضمن الإعدادات العامة'),
  ('settings','إعدادات التصنيع','update','تعديل',
   'manufacturing.settings.update',
   'Change manufacturing settings: GL event mappings, material-issue work-order statuses and the quality policy',
   'تعديل إعدادات التصنيع: ربط القيود المحاسبية، وحالات أوامر العمل المسموح بالصرف عليها، وسياسة الجودة')
) v(resource,resource_ar,action,action_ar,key,description,description_ar)
WHERE m.name = 'manufacturing';

-- ---------------------------------------------------------------------------
-- 2. Template expansion: wildcards must not grant the settings keys. Body
--    equals M199 except the two keys added to the exact-name-only list.
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
                 'manufacturing.quality_inspections.approve_conditional',
                 'manufacturing.settings.read',
                 'manufacturing.settings.update')
               OR p.permission_key = v_perm_key)
        ON CONFLICT DO NOTHING;
    END LOOP;

    SELECT COALESCE(jsonb_agg(p.permission_key ORDER BY p.permission_key), '[]'::jsonb)
      INTO v_granted_keys
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_new_role_id;

    -- Preserve the M175 audit record; M196, M199 and M201 only narrow template
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
-- 3. Settings writers: org-admin-only guard -> org admin OR key holder.
--
--    One internal predicate decides, so the writers and the capability the UI
--    reads cannot drift. It is a strict superset of the previous guard
--    (wardah_assert_org_admin = super admin OR wardah_is_org_admin), so no
--    current admin loses access, plus any active member whose role the org
--    admin granted manufacturing.settings.update.
--
--    has_permission alone is NOT used for the admin part on purpose: its
--    Org Admin bypass reads only user_organizations.is_org_admin, while
--    wardah_is_org_admin also accepts role IN ('admin','owner'). Using
--    has_permission alone would lock out admins defined only by role.
--
--    ACLs of the replaced functions are untouched by CREATE OR REPLACE and
--    re-checked below.
-- ---------------------------------------------------------------------------
CREATE FUNCTION wardah_internal.manufacturing_settings_can_update_201(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = ''
AS $fn$
  SELECT COALESCE(public.is_super_admin(), false)
      OR public.wardah_is_org_admin(p_org)
      OR COALESCE(public.has_permission(auth.uid(), p_org, 'manufacturing.settings.update'), false);
$fn$;
REVOKE ALL ON FUNCTION wardah_internal.manufacturing_settings_can_update_201(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION wardah_internal.manufacturing_settings_can_update_201(uuid) IS
  'Migration 201: who may change manufacturing settings — super admin, org admin (wardah_is_org_admin), or holder of manufacturing.settings.update.';

CREATE OR REPLACE FUNCTION public.rpc_set_material_issue_wo_statuses(
  p_org_id uuid, p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before wardah_internal.material_issue_wo_policies%ROWTYPE;
  v_after wardah_internal.material_issue_wo_policies%ROWTYPE;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_allowed_statuses IS NULL OR NOT (
    p_allowed_statuses = ARRAY['IN_PROGRESS']::text[]
    OR p_allowed_statuses = ARRAY['IN_PROGRESS','READY']::text[]
    OR p_allowed_statuses = ARRAY['IN_PROGRESS','IN_SETUP']::text[]
    OR p_allowed_statuses = ARRAY['IN_PROGRESS','READY','IN_SETUP']::text[]
  ) THEN
    RAISE EXCEPTION 'INVALID_MATERIAL_ISSUE_WO_STATUSES';
  END IF;
  SELECT * INTO v_before FROM wardah_internal.material_issue_wo_policies
    WHERE org_id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_ISSUE_WO_POLICY_MISSING'; END IF;
  UPDATE wardah_internal.material_issue_wo_policies
    SET allowed_statuses=p_allowed_statuses, version=version+1,
        updated_at=now(), updated_by=auth.uid()
    WHERE org_id=p_org_id RETURNING * INTO v_after;
  INSERT INTO public.audit_logs(
    org_id,user_id,action,entity_type,entity_id,old_data,new_data,metadata
  ) VALUES (
    p_org_id,auth.uid(),'manufacturing.material_issue_wo_policy.update',
    'material_issue_wo_policy',p_org_id::text,
    jsonb_build_object('statuses',v_before.allowed_statuses,'version',v_before.version),
    jsonb_build_object('statuses',v_after.allowed_statuses,'version',v_after.version),
    jsonb_build_object('source','rpc_set_material_issue_wo_statuses')
  );
  RETURN jsonb_build_object('org_id',p_org_id,'allowed_statuses',v_after.allowed_statuses,
                            'version',v_after.version);
END
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_set_quality_policy(
  p_org_id uuid, p_policy jsonb, p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_before wardah_internal.quality_policies%ROWTYPE;
  v_after wardah_internal.quality_policies%ROWTYPE;
  v_unknown text;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
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

CREATE OR REPLACE FUNCTION public.rpc_get_quality_policy(p_org_id uuid)
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
      'can_manage_policy', wardah_internal.manufacturing_settings_can_update_201(p_org_id),
      'can_read', COALESCE(public.has_permission(auth.uid(), p_org_id,
        'manufacturing.quality_inspections.read'), false),
      'can_inspect', wardah_internal.quality_actor_can_199(p_org_id,
        'manufacturing.quality_inspections.create', v_policy.admins_subject_to_quality_controls),
      'can_approve_conditional', wardah_internal.quality_actor_can_199(p_org_id,
        'manufacturing.quality_inspections.approve_conditional',
        v_policy.admins_subject_to_quality_controls)));
END
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_set_gl_event_mapping(
  p_org_id uuid,
  p_event_code text,
  p_debit_account_code text,
  p_credit_account_code text,
  p_work_center_code text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_is_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event text := upper(btrim(COALESCE(p_event_code, '')));
  v_wc text := NULLIF(btrim(COALESCE(p_work_center_code, '')), '');
  v_debit text := btrim(COALESCE(p_debit_account_code, ''));
  v_credit text := btrim(COALESCE(p_credit_account_code, ''));
  v_before public.gl_event_mappings%ROWTYPE;
  v_after public.gl_event_mappings%ROWTYPE;
  v_created boolean;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;

  IF v_event !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'GL_EVENT_MAPPING_INVALID_EVENT_CODE' USING ERRCODE = '22023';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'GL_EVENT_MAPPING_IS_ACTIVE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Only rpc_post_work_center_oh resolves a per-work-center row, and only
  -- for OH_APPLIED; rpc_post_event_journal reads work_center_code IS NULL.
  -- A work-center override on any other event would be a dead row.
  IF v_wc IS NOT NULL THEN
    IF v_event <> 'OH_APPLIED' THEN
      RAISE EXCEPTION 'GL_EVENT_MAPPING_WORK_CENTER_OVERRIDE_NOT_SUPPORTED' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.work_centers wc
      WHERE wc.org_id = p_org_id AND wc.code = v_wc
    ) THEN
      RAISE EXCEPTION 'GL_EVENT_MAPPING_WORK_CENTER_NOT_FOUND' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_debit = '' OR v_credit = '' THEN
    RAISE EXCEPTION 'GL_EVENT_MAPPING_ACCOUNT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_debit = v_credit THEN
    RAISE EXCEPTION 'GL_EVENT_MAPPING_SAME_ACCOUNT' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.org_id = p_org_id AND a.code = v_debit
      AND a.is_active IS TRUE AND a.allow_posting IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.org_id = p_org_id AND a.code = v_credit
      AND a.is_active IS TRUE AND a.allow_posting IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'GL_EVENT_MAPPING_CREDIT_ACCOUNT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Serialize callers of this RPC on the same key.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wardah-gl-event-mapping:' || p_org_id::text || ':' || v_event || ':' || COALESCE(v_wc, ''), 0));

  -- The before-image must be exact even against writers that do not take
  -- the advisory lock above (rpc_upsert_event_mapping, service_role). So it
  -- is never read before the write: first try the insert, which waits on any
  -- concurrent uncommitted insert of the same key and creates the row only
  -- if none commits; otherwise lock the committed row, read it, update it.
  INSERT INTO public.gl_event_mappings AS m (
    org_id, event_code, work_center_code,
    debit_account_code, credit_account_code, description, is_active
  ) VALUES (
    p_org_id, v_event, v_wc,
    v_debit, v_credit, p_description, p_is_active
  )
  ON CONFLICT (org_id, event_code, COALESCE(work_center_code, '')) DO NOTHING
  RETURNING * INTO v_after;
  v_created := FOUND;

  IF NOT v_created THEN
    SELECT * INTO v_before
    FROM public.gl_event_mappings m
    WHERE m.org_id = p_org_id
      AND m.event_code = v_event
      AND COALESCE(m.work_center_code, '') = COALESCE(v_wc, '')
    FOR UPDATE;
    IF NOT FOUND THEN
      -- Deleted by another writer between the two statements; let the
      -- caller retry rather than guess.
      RAISE EXCEPTION 'GL_EVENT_MAPPING_CONCURRENT_CHANGE' USING ERRCODE = '40001';
    END IF;

    UPDATE public.gl_event_mappings m SET
      debit_account_code = v_debit,
      credit_account_code = v_credit,
      description = COALESCE(p_description, m.description),
      is_active = p_is_active,
      updated_at = now()
    WHERE m.id = v_before.id
    RETURNING * INTO v_after;
  END IF;

  INSERT INTO public.audit_logs (
    org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata
  ) VALUES (
    p_org_id, auth.uid(), 'accounting.gl_event_mapping.set', 'gl_event_mapping',
    v_after.id::text,
    CASE WHEN v_created THEN NULL ELSE jsonb_build_object(
      'event_code', v_before.event_code,
      'work_center_code', v_before.work_center_code,
      'debit_account_code', v_before.debit_account_code,
      'credit_account_code', v_before.credit_account_code,
      'is_active', v_before.is_active) END,
    jsonb_build_object(
      'event_code', v_after.event_code,
      'work_center_code', v_after.work_center_code,
      'debit_account_code', v_after.debit_account_code,
      'credit_account_code', v_after.credit_account_code,
      'is_active', v_after.is_active),
    jsonb_build_object('source', 'rpc_set_gl_event_mapping', 'migration', 200)
  );

  RETURN jsonb_build_object(
    'id', v_after.id,
    'org_id', v_after.org_id,
    'event_code', v_after.event_code,
    'work_center_code', v_after.work_center_code,
    'debit_account_code', v_after.debit_account_code,
    'credit_account_code', v_after.credit_account_code,
    'is_active', v_after.is_active,
    'created', v_created
  );
END
$fn$;

COMMENT ON FUNCTION public.rpc_set_gl_event_mapping(uuid, text, text, text, text, text, boolean) IS
  'Migration 200/201: audited upsert of one GL event mapping, guarded by manufacturing.settings.update. The only client write surface for gl_event_mappings.';

-- ---------------------------------------------------------------------------
-- 4. Postflight.
-- ---------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_sig text;
BEGIN
  IF (SELECT count(*) FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
      WHERE m.name = 'manufacturing'
        AND p.permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update')) <> 2 THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_KEYS_MISSING';
  END IF;
  IF public.wardah_is_sensitive_permission('manufacturing.settings.update')
     OR public.wardah_is_sensitive_permission('manufacturing.settings.read') THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_KEYS_UNEXPECTEDLY_SENSITIVE';
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)',
    'public.rpc_set_material_issue_wo_statuses(uuid,text[])',
    'public.rpc_set_quality_policy(uuid,jsonb,bigint)'
  ] LOOP
    IF position('manufacturing_settings_can_update_201(p_org_id)' IN pg_get_functiondef(v_sig::regprocedure)) = 0
       OR position('wardah_assert_org_admin' IN pg_get_functiondef(v_sig::regprocedure)) > 0 THEN
      RAISE EXCEPTION 'MFG_SETTINGS_201_GUARD_NOT_REPLACED: %', v_sig;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'wardah_internal.manufacturing_settings_can_update_201(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'wardah_internal.manufacturing_settings_can_update_201(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MFG_SETTINGS_201_HELPER_EXPOSED';
  END IF;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)',
    'public.rpc_set_material_issue_wo_statuses(uuid,text[])',
    'public.rpc_set_quality_policy(uuid,jsonb,bigint)',
    'public.rpc_get_quality_policy(uuid)',
    'public.create_role_from_template(uuid,uuid,character varying,uuid)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE')
       OR has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'MFG_SETTINGS_201_ACL_CHANGED: %', v_sig;
    END IF;
  END LOOP;
END
$postflight$;

COMMIT;
