-- =====================================================================
-- 170_tenant_isolation_and_permission_hardening
-- =====================================================================
-- Closes three independently confirmed tenant-isolation / disclosure gaps
-- found by security audit on 2026-08-05:
--
-- 1. physical_count_items / physical_count_sessions (8 policies): the
--    tenant-membership subquery selected the OUTER table's own
--    `organization_id` instead of `user_organizations.org_id`, degenerating
--    to `organization_id IN (organization_id)` — true for every row, for
--    any authenticated user with at least one org membership. Full
--    cross-tenant SELECT/INSERT/UPDATE/DELETE exposure.
--
-- 2. manufacturing_stages / stage_wip_log / standard_costs: the
--    tenant-isolation policy fell back to the hardcoded UUID
--    '00000000-0000-0000-0000-000000000001' (a real seeded organization,
--    "Wardah Factory") when JWT claims carried no org_id/tenant_id, and had
--    no FOR/TO clause (defaulted to ALL commands, role PUBLIC). Combined
--    with `anon` holding GRANT ALL on all three tables, an unauthenticated
--    request could read/write that organization's manufacturing data.
--    get_effective_org_id() (feeding journal_entry_attachments) carries the
--    identical fallback pattern; included here for consistency, though its
--    four policies are already TO authenticated and therefore not
--    anon-reachable today.
--
-- 3. has_permission(p_user_id, p_org_id, p_permission_key): never compared
--    p_user_id to auth.uid(), so any authenticated user could query any
--    OTHER user's super-admin/org-admin/permission status directly via RPC.
--    Every existing caller (149, 150, and the baseline copies of the same
--    functions) already passes auth.uid() as p_user_id; no legitimate
--    caller needs to check a different user.
--
-- Mirrors the fail-closed pattern migration 121 already established for
-- get_current_tenant_id()/wardah_org_id(): no default-organization fallback
-- of any kind, ever. Reuses wardah_org_id() rather than reinventing inline
-- JWT-claim parsing.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE public.physical_count_items,
           public.physical_count_sessions,
           public.manufacturing_stages,
           public.stage_wip_log,
           public.standard_costs
IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- Preflight: fail closed if the schema has already drifted from what this
-- migration assumes, before touching anything.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.physical_count_items') IS NULL
     OR to_regclass('public.physical_count_sessions') IS NULL
     OR to_regclass('public.manufacturing_stages') IS NULL
     OR to_regclass('public.stage_wip_log') IS NULL
     OR to_regclass('public.standard_costs') IS NULL THEN
    RAISE EXCEPTION 'TENANT_170_REQUIRED_TABLE_MISSING';
  END IF;

  IF to_regprocedure('public.wardah_org_id(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TENANT_170_WARDAH_ORG_ID_MISSING';
  END IF;

  IF to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'TENANT_170_HAS_PERMISSION_MISSING';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. physical_count_items / physical_count_sessions — correct the
--    self-referencing subquery on all 8 policies. The sel_m policies also
--    had a redundant duplicate OR clause (the same wrong condition twice);
--    collapsed to a single correct clause.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS physical_count_items_del_m ON public.physical_count_items;
CREATE POLICY physical_count_items_del_m ON public.physical_count_items
  FOR DELETE TO authenticated
  USING (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_items_ins_m ON public.physical_count_items;
CREATE POLICY physical_count_items_ins_m ON public.physical_count_items
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_items_sel_m ON public.physical_count_items;
CREATE POLICY physical_count_items_sel_m ON public.physical_count_items
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_items_upd_m ON public.physical_count_items;
CREATE POLICY physical_count_items_upd_m ON public.physical_count_items
  FOR UPDATE TO authenticated
  USING (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_sessions_del_m ON public.physical_count_sessions;
CREATE POLICY physical_count_sessions_del_m ON public.physical_count_sessions
  FOR DELETE TO authenticated
  USING (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_sessions_ins_m ON public.physical_count_sessions;
CREATE POLICY physical_count_sessions_ins_m ON public.physical_count_sessions
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_sessions_sel_m ON public.physical_count_sessions;
CREATE POLICY physical_count_sessions_sel_m ON public.physical_count_sessions
  FOR SELECT TO authenticated
  USING (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS physical_count_sessions_upd_m ON public.physical_count_sessions;
CREATE POLICY physical_count_sessions_upd_m ON public.physical_count_sessions
  FOR UPDATE TO authenticated
  USING (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ))
  WITH CHECK (organization_id IN (
    SELECT user_organizations.org_id FROM public.user_organizations
    WHERE user_organizations.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 2. manufacturing_stages / stage_wip_log / standard_costs — remove the
--    default-organization fallback entirely and scope to `authenticated`.
--    wardah_org_id() (migration 121) already resolves via verified JWT claim
--    or the caller's own active membership, returning NULL — never another
--    tenant's id — when neither is resolvable. Also revoke the `anon` table
--    grants: the wrong predicate and the wrong role scope were two halves of
--    the same bug.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS manufacturing_stages_tenant_isolation ON public.manufacturing_stages;
CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
  FOR ALL TO authenticated
  USING (org_id = public.wardah_org_id())
  WITH CHECK (org_id = public.wardah_org_id());

DROP POLICY IF EXISTS stage_wip_log_tenant_isolation ON public.stage_wip_log;
CREATE POLICY stage_wip_log_tenant_isolation ON public.stage_wip_log
  FOR ALL TO authenticated
  USING (org_id = public.wardah_org_id())
  WITH CHECK (org_id = public.wardah_org_id());

DROP POLICY IF EXISTS standard_costs_tenant_isolation ON public.standard_costs;
CREATE POLICY standard_costs_tenant_isolation ON public.standard_costs
  FOR ALL TO authenticated
  USING (org_id = public.wardah_org_id())
  WITH CHECK (org_id = public.wardah_org_id());

REVOKE ALL ON TABLE public.manufacturing_stages FROM anon;
REVOKE ALL ON TABLE public.stage_wip_log FROM anon;
REVOKE ALL ON TABLE public.standard_costs FROM anon;

-- Lower-urgency, same shape, included for consistency: get_effective_org_id()
-- carries the identical default-org fallback. Its only consumers
-- (journal_entry_attachments, 4 policies) are already TO authenticated, so
-- this is defense-in-depth, not a live anon-reachable gap.
CREATE OR REPLACE FUNCTION public.get_effective_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN current_setting('app.current_org_id', true)::uuid;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. has_permission — reject any caller checking a permission for a user
--    other than themselves. Returns false (not an exception) to preserve the
--    boolean contract for the two legitimate self-check callers, which are
--    unaffected since they already always pass auth.uid(). No confirmed
--    caller anywhere (SQL migrations, baseline, or application code) passes
--    a p_user_id other than auth.uid(); no service_role bypass is carried
--    forward since none was found in use.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_org_id uuid, p_permission_key character varying) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_has_permission BOOLEAN;
BEGIN
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
        RETURN false;
    END IF;

    -- Super Admin: كل الصلاحيات
    IF EXISTS (
        SELECT 1 FROM super_admins
        WHERE user_id = p_user_id AND is_active = true
    ) THEN
        RETURN true;
    END IF;

    -- Org Admin: كل صلاحيات منظمته
    IF EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = p_user_id
        AND org_id = p_org_id
        AND is_active = true
        AND is_org_admin = true
    ) THEN
        RETURN true;
    END IF;

    -- التحقق من الصلاحيات العادية
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
        AND ur.org_id = p_org_id
        AND (
            p.permission_key = p_permission_key
            OR p.permission_key LIKE REPLACE(SPLIT_PART(p_permission_key, '.', 1) || '.%', '*', '%')
        )
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    ) INTO v_has_permission;

    RETURN COALESCE(v_has_permission, false);
END;
$$;

-- Grants unchanged: authenticated and service_role retain EXECUTE. The new
-- guard compares against auth.uid() only; service_role sessions (no JWT,
-- auth.uid() NULL) calling with any concrete p_user_id now correctly get
-- false rather than an arbitrary other user's permission state, which is the
-- intended tightening, not a regression — no confirmed caller relied on that
-- path.

-- ---------------------------------------------------------------------------
-- Postflight: fail closed before COMMIT if any of the above did not take.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_qual text;
  v_bad_tables text;
  v_src text;
  c_default constant text := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- (1) None of the 8 rewritten policies still self-reference the outer
  -- table's own organization_id column (the exact bug signature: the outer
  -- table name immediately followed by .organization_id inside the
  -- subquery, which only the broken version ever produces).
  FOR v_qual IN
    SELECT coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
           || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    FROM pg_policy pol
    WHERE pol.polrelid IN ('public.physical_count_items'::regclass,
                            'public.physical_count_sessions'::regclass)
  LOOP
    IF v_qual LIKE '%physical_count_items.organization_id%'
       OR v_qual LIKE '%physical_count_sessions.organization_id%' THEN
      RAISE EXCEPTION 'FAIL[170-1] physical_count_* policy still self-references organization_id: %', v_qual;
    END IF;
  END LOOP;

  -- (2) None of the 3 rewritten tenant-isolation policies (or
  -- get_effective_org_id) still carry the hardcoded default-org UUID.
  FOR v_qual IN
    SELECT coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
           || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    FROM pg_policy pol
    WHERE pol.polrelid IN ('public.manufacturing_stages'::regclass,
                            'public.stage_wip_log'::regclass,
                            'public.standard_costs'::regclass)
  LOOP
    IF position(c_default IN v_qual) > 0 THEN
      RAISE EXCEPTION 'FAIL[170-2] tenant-isolation policy still contains default-org UUID: %', v_qual;
    END IF;
  END LOOP;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_effective_org_id';
  IF v_src IS NULL OR position(c_default IN v_src) > 0 THEN
    RAISE EXCEPTION 'FAIL[170-2] get_effective_org_id still contains default-org UUID';
  END IF;

  SELECT string_agg(t, ', ') INTO v_bad_tables
  FROM unnest(ARRAY['manufacturing_stages', 'stage_wip_log', 'standard_costs']) t
  WHERE has_table_privilege('anon', 'public.' || t, 'SELECT')
     OR has_table_privilege('anon', 'public.' || t, 'INSERT')
     OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
     OR has_table_privilege('anon', 'public.' || t, 'DELETE');
  IF v_bad_tables IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL[170-2] anon still holds a grant on: %', v_bad_tables;
  END IF;

  -- (3) has_permission carries the new caller-identity guard.
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_permission';
  IF v_src IS NULL OR v_src !~ 'p_user_id IS DISTINCT FROM auth\.uid\(\)' THEN
    RAISE EXCEPTION 'FAIL[170-3] has_permission missing caller-identity guard';
  END IF;

  RAISE NOTICE 'PASS[170] tenant isolation + permission hardening applied: physical_count_* corrected, default-org fallback removed, has_permission self-scoped';
END
$verify$;

COMMIT;
