-- =====================================================================
-- 171_ai_usage_daily_and_reports_insights_permission
-- =====================================================================
-- Supporting schema for the provider-agnostic reports-insights Edge
-- Function:
--
-- 1. ai_usage_daily stores per-(organization, user, UTC day) accepted and
--    rejected request counters. Authenticated clients may read only their
--    own rows while their membership in that organization is active. They
--    have no direct write grant.
--
-- 2. rpc_check_and_record_ai_usage makes an atomic quota decision with
--    fixed server-side limits (20/user/day, 100/org/day). It is executable
--    only by service_role, revalidates the supplied active membership, and
--    serializes requests for the same (organization, UTC day) with a
--    transaction-scoped advisory lock.
--
-- 3. reports.ai_insights.use is seeded into the global permission catalog.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_ORGANIZATIONS_MISSING';
  END IF;
  IF to_regclass('public.user_organizations') IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_USER_ORGANIZATIONS_MISSING';
  END IF;
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.modules') IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_PERMISSIONS_CATALOG_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modules WHERE name = 'reports') THEN
    RAISE EXCEPTION 'AI_USAGE_171_REPORTS_MODULE_MISSING';
  END IF;
  IF to_regclass('public.ai_usage_daily') IS NOT NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_TABLE_ALREADY_EXISTS';
  END IF;
END
$preflight$;

CREATE TABLE public.ai_usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  usage_date date NOT NULL,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_daily_org_user_date_key
    UNIQUE (org_id, user_id, usage_date),
  CONSTRAINT ai_usage_daily_accepted_nonneg CHECK (accepted_count >= 0),
  CONSTRAINT ai_usage_daily_rejected_nonneg CHECK (rejected_count >= 0)
);

CREATE INDEX idx_ai_usage_daily_org_date
  ON public.ai_usage_daily (org_id, usage_date);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_daily_select_own_active_org
  ON public.ai_usage_daily
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_organizations AS uo
      WHERE uo.user_id = (SELECT auth.uid())
        AND uo.org_id = ai_usage_daily.org_id
        AND uo.is_active IS TRUE
    )
  );

-- Supabase-style default privileges in the baseline grant new public tables
-- broadly. Revoke first, then grant only the narrow contract explicitly.
REVOKE ALL ON TABLE public.ai_usage_daily
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ai_usage_daily TO authenticated;
GRANT ALL ON TABLE public.ai_usage_daily TO service_role;

CREATE FUNCTION public.rpc_check_and_record_ai_usage(
  p_org_id uuid,
  p_user_id uuid
) RETURNS TABLE(
  allowed boolean,
  user_accepted_count integer,
  org_accepted_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_user_daily_limit CONSTANT integer := 20;
  c_org_daily_limit CONSTANT integer := 100;
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_user_accepted integer;
  v_org_accepted integer;
BEGIN
  IF p_org_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_NULL_ARGUMENT'
      USING ERRCODE = '22004';
  END IF;

  -- The Edge Function checks membership with the request-bound client, but
  -- this privileged RPC independently validates the supplied pair. A stale,
  -- disabled, or fabricated membership therefore fails closed before the
  -- quota lock or any counter write.
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_organizations AS uo
    WHERE uo.org_id = p_org_id
      AND uo.user_id = p_user_id
      AND uo.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'AI_USAGE_171_ACTIVE_MEMBERSHIP_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize all requests for one organization and UTC day. Rejections
  -- increment only rejected_count and never consume the shared accepted
  -- quota.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_org_id::text),
    hashtext(v_today::text)
  );

  INSERT INTO public.ai_usage_daily (org_id, user_id, usage_date)
  VALUES (p_org_id, p_user_id, v_today)
  ON CONFLICT ON CONSTRAINT ai_usage_daily_org_user_date_key DO NOTHING;

  SELECT accepted_count
  INTO v_user_accepted
  FROM public.ai_usage_daily
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND usage_date = v_today;

  SELECT COALESCE(SUM(accepted_count), 0)::integer
  INTO v_org_accepted
  FROM public.ai_usage_daily
  WHERE org_id = p_org_id
    AND usage_date = v_today;

  IF v_user_accepted >= c_user_daily_limit
     OR v_org_accepted >= c_org_daily_limit THEN
    UPDATE public.ai_usage_daily
    SET rejected_count = rejected_count + 1,
        updated_at = now()
    WHERE org_id = p_org_id
      AND user_id = p_user_id
      AND usage_date = v_today;

    RETURN QUERY SELECT false, v_user_accepted, v_org_accepted;
    RETURN;
  END IF;

  UPDATE public.ai_usage_daily
  SET accepted_count = accepted_count + 1,
      updated_at = now()
  WHERE org_id = p_org_id
    AND user_id = p_user_id
    AND usage_date = v_today
  RETURNING accepted_count INTO v_user_accepted;

  RETURN QUERY SELECT true, v_user_accepted, v_org_accepted + 1;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.rpc_check_and_record_ai_usage(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.rpc_check_and_record_ai_usage(uuid, uuid)
  TO service_role;

INSERT INTO public.permissions (
  module_id,
  resource,
  resource_ar,
  action,
  action_ar,
  permission_key,
  description,
  description_ar
)
SELECT
  id,
  'ai_insights',
  'الرؤى الذكية',
  'use',
  'استخدام',
  'reports.ai_insights.use',
  'Use AI-generated report insights',
  'استخدام الرؤى المدعومة بالذكاء الاصطناعي في التقارير'
FROM public.modules
WHERE name = 'reports'
ON CONFLICT (permission_key) DO NOTHING;

DO $verify$
DECLARE
  v_bad_grants text;
  v_policy_qual text;
BEGIN
  IF to_regclass('public.ai_usage_daily') IS NULL THEN
    RAISE EXCEPTION 'FAIL[171-1] ai_usage_daily table missing';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.ai_usage_daily'::regclass
  ) THEN
    RAISE EXCEPTION 'FAIL[171-1a] ai_usage_daily RLS is disabled';
  END IF;

  SELECT string_agg(grantee || ':' || privilege_type, ', ')
  INTO v_bad_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'ai_usage_daily'
    AND grantee IN ('anon', 'PUBLIC', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

  IF v_bad_grants IS NOT NULL THEN
    RAISE EXCEPTION
      'FAIL[171-1b] ai_usage_daily has client write grants: %',
      v_bad_grants;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO v_policy_qual
  FROM pg_policy AS pol
  WHERE pol.polrelid = 'public.ai_usage_daily'::regclass
    AND pol.polname = 'ai_usage_daily_select_own_active_org';

  IF v_policy_qual IS NULL
     OR v_policy_qual !~ 'user_id'
     OR v_policy_qual !~ 'org_id'
     OR v_policy_qual !~ 'is_active' THEN
    RAISE EXCEPTION
      'FAIL[171-1c] ai_usage_daily SELECT policy lacks own-user active-membership scope';
  END IF;

  IF has_function_privilege(
       'anon',
       'rpc_check_and_record_ai_usage(uuid,uuid)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'rpc_check_and_record_ai_usage(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'FAIL[171-2] quota RPC is executable by anon/authenticated';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'rpc_check_and_record_ai_usage(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'FAIL[171-2b] quota RPC is not executable by service_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.permissions
    WHERE permission_key = 'reports.ai_insights.use'
  ) THEN
    RAISE EXCEPTION
      'FAIL[171-3] reports.ai_insights.use permission was not seeded';
  END IF;

  RAISE NOTICE
    'PASS[171] quota table, fixed-limit RPC, active membership, and permission applied';
END
$verify$;

COMMIT;
