-- 200_gl_event_mapping_write_closure
--
-- Finding MS-01 (docs/architecture/MANUFACTURING_SETTINGS_INVENTORY_20261003.md):
-- public.gl_event_mappings decides the debit/credit accounts of every
-- event-driven journal: MATERIAL_ISSUE and FG_RECEIPT (manufacturing order
-- completion), OH_APPLIED per work center, the scrap and overhead-variance
-- events, COGS_DELIVERY, GR_RECEIPT and the AP three-way-match events. Its
-- only supported writer, rpc_upsert_event_mapping, is executable by
-- service_role alone. Yet the table itself is open:
--   * policy gl_event_mappings_org_isolation is FOR ALL, has no TO clause
--     (so it applies to PUBLIC) and checks only org_id = wardah_org_id();
--   * authenticated and anon hold GRANT ALL on the table.
-- Together they let any active member of an organization INSERT, UPDATE or
-- DELETE that organization's posting map directly through PostgREST — for
-- example re-pointing FG_RECEIPT's debit account — with no admin check,
-- no permission key and no audit row. Unlike Migration 185, this is not a
-- latent gap waiting for a policy to appear: the permissive policy already
-- exists, so the retained grant is exploitable today.
--
-- This migration:
--   1. revokes every table-level write privilege from authenticated and all
--      privileges from anon, keeping authenticated SELECT. The client still
--      reads the table directly: fetchCogsAccounts in
--      src/services/financial-statements-service.ts selects COGS_DELIVERY
--      rows for the profitability report;
--   2. adds rpc_set_gl_event_mapping as the guarded, audited write surface
--      for organization admins (wardah_assert_org_admin), validating the
--      event code, the optional work-center override and both accounts
--      against the caller's own chart of accounts.
--
-- It does not:
--   * change the existing policy (with the write grants gone it can only
--     admit SELECT; replacing it is not required for this closure);
--   * change rpc_upsert_event_mapping, the posting functions that read the
--     table, or any existing mapping row;
--   * seed mappings for organizations that have none (MS-08, decision D2);
--   * touch service_role's privileges.
--
-- Repository-only until merged and applied per CLAUDE.md. No UI depends on
-- the new RPC yet; a later UI PR must wait for this migration to be applied
-- and verified on Production (DB-first).

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.gl_event_mappings') IS NULL
     OR to_regclass('public.gl_accounts') IS NULL
     OR to_regclass('public.work_centers') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'GL_EVENT_200_REQUIRED_TABLE_MISSING';
  END IF;

  IF to_regclass('public.uq_gl_event_mappings_key') IS NULL THEN
    RAISE EXCEPTION 'GL_EVENT_200_UNIQUE_KEY_MISSING';
  END IF;

  IF to_regprocedure('public.wardah_assert_org_admin(uuid)') IS NULL
     OR to_regprocedure('public.rpc_upsert_event_mapping(text,text,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'GL_EVENT_200_REQUIRED_FUNCTION_MISSING';
  END IF;

  IF to_regprocedure('public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'GL_EVENT_200_ALREADY_APPLIED';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 1. Close the direct write surface; keep member reads.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.gl_event_mappings
  FROM PUBLIC, authenticated;

REVOKE ALL ON TABLE public.gl_event_mappings FROM anon;

-- ---------------------------------------------------------------------
-- 2. Guarded, audited write surface for organization admins.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.rpc_set_gl_event_mapping(
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
BEGIN
  PERFORM public.wardah_assert_org_admin(p_org_id);

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

  -- Serialize writers of the same key so the before-image used for the
  -- audit row and the 'created' flag is exact even for a first insert,
  -- which FOR UPDATE alone cannot lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'wardah-gl-event-mapping:' || p_org_id::text || ':' || v_event || ':' || COALESCE(v_wc, ''), 0));

  SELECT * INTO v_before
  FROM public.gl_event_mappings m
  WHERE m.org_id = p_org_id
    AND m.event_code = v_event
    AND COALESCE(m.work_center_code, '') = COALESCE(v_wc, '')
  FOR UPDATE;

  INSERT INTO public.gl_event_mappings AS m (
    org_id, event_code, work_center_code,
    debit_account_code, credit_account_code, description, is_active
  ) VALUES (
    p_org_id, v_event, v_wc,
    v_debit, v_credit, p_description, p_is_active
  )
  ON CONFLICT (org_id, event_code, COALESCE(work_center_code, ''))
  DO UPDATE SET
    debit_account_code = EXCLUDED.debit_account_code,
    credit_account_code = EXCLUDED.credit_account_code,
    description = COALESCE(EXCLUDED.description, m.description),
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (
    org_id, user_id, action, entity_type, entity_id, old_data, new_data, metadata
  ) VALUES (
    p_org_id, auth.uid(), 'accounting.gl_event_mapping.set', 'gl_event_mapping',
    v_after.id::text,
    CASE WHEN v_before.id IS NULL THEN NULL ELSE jsonb_build_object(
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
    'created', v_before.id IS NULL
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.rpc_set_gl_event_mapping(uuid, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_set_gl_event_mapping(uuid, text, text, text, text, text, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.rpc_set_gl_event_mapping(uuid, text, text, text, text, text, boolean) IS
  'Migration 200: org-admin guarded, audited upsert of one GL event mapping. The only client write surface for gl_event_mappings.';

-- ---------------------------------------------------------------------
-- 3. Postflight.
-- ---------------------------------------------------------------------
DO $postflight$
DECLARE
  v_priv text;
  v_sig text := 'public.rpc_set_gl_event_mapping(uuid,text,text,text,text,text,boolean)';
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.gl_event_mappings', 'SELECT') THEN
    RAISE EXCEPTION 'GL_EVENT_200_AUTHENTICATED_SELECT_MUST_REMAIN';
  END IF;

  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF has_table_privilege('authenticated', 'public.gl_event_mappings', v_priv) THEN
      RAISE EXCEPTION 'GL_EVENT_200_AUTHENTICATED_WRITE_PRIVILEGE_REMAINS: %', v_priv;
    END IF;
  END LOOP;

  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF has_table_privilege('anon', 'public.gl_event_mappings', v_priv) THEN
      RAISE EXCEPTION 'GL_EVENT_200_ANON_PRIVILEGE_REMAINS: %', v_priv;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.gl_event_mappings', v_priv) THEN
      RAISE EXCEPTION 'GL_EVENT_200_SERVICE_ROLE_PRIVILEGE_LOST: %', v_priv;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'GL_EVENT_200_AUTHENTICATED_EXECUTE_MISSING';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'GL_EVENT_200_ANON_EXECUTE_REMAINS';
  END IF;

  -- The existing service-role seed path is untouched.
  IF NOT has_function_privilege('service_role', 'public.rpc_upsert_event_mapping(text,text,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rpc_upsert_event_mapping(text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'GL_EVENT_200_UPSERT_EVENT_MAPPING_ACL_CHANGED';
  END IF;
END
$postflight$;

COMMIT;
