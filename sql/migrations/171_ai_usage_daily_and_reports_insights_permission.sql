-- =====================================================================
-- 171_ai_usage_daily_and_reports_insights_permission
-- =====================================================================
-- Supporting schema for the reports-insights Edge Function (a generic,
-- provider-agnostic AI insights endpoint — no vendor name in any
-- identifier here, per the architecture decision to keep the model
-- provider swappable behind an internal adapter):
--
-- 1. ai_usage_daily: per (org, user, UTC day) accepted/rejected request
--    counters, used to enforce a daily quota per user and per
--    organization. Counting is done exclusively through the
--    service_role-only RPC below — the table itself grants no direct
--    write access to authenticated/anon, only a narrow SELECT of the
--    caller's own row (so the UI can show "N of M used today").
--
-- 2. rpc_check_and_record_ai_usage: atomic, race-safe accept/reject
--    decision. Takes an advisory lock scoped to (org_id, UTC date)
--    before reading or writing counters, so concurrent requests from
--    different users in the same organization cannot both observe the
--    org limit as "not yet reached" and both get accepted (the classic
--    check-then-increment race). A rejected request increments
--    rejected_count only — it must never count against the
--    organization's accepted quota, otherwise one user who has already
--    exhausted their own per-user limit could keep sending requests
--    that (if miscounted as accepted) would exhaust the whole
--    organization's shared quota for every other user.
--
-- 3. reports.ai_insights.use permission: seeded under the existing
--    `reports` module (global permission catalog, not org-scoped — see
--    CLAUDE.md's baseline system-reference-data section). Actual grants
--    happen per-org via role_permissions/user_roles, same as every
--    other permission in this catalog.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- Preflight: fail closed if the schema this migration assumes isn't there.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_ORGANIZATIONS_MISSING';
  END IF;
  IF to_regclass('public.permissions') IS NULL OR to_regclass('public.modules') IS NULL THEN
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

-- ---------------------------------------------------------------------------
-- 1. ai_usage_daily
-- ---------------------------------------------------------------------------
CREATE TABLE public.ai_usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  usage_date date NOT NULL,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_daily_org_user_date_key UNIQUE (org_id, user_id, usage_date),
  CONSTRAINT ai_usage_daily_accepted_nonneg CHECK (accepted_count >= 0),
  CONSTRAINT ai_usage_daily_rejected_nonneg CHECK (rejected_count >= 0)
);

CREATE INDEX idx_ai_usage_daily_org_date ON public.ai_usage_daily (org_id, usage_date);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

-- A caller may see only their own row (e.g. to show "N of M used today" in
-- the UI). No INSERT/UPDATE/DELETE grant to authenticated or anon at all —
-- every write goes through the SECURITY DEFINER RPC below.
CREATE POLICY ai_usage_daily_select_own ON public.ai_usage_daily
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.ai_usage_daily FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ai_usage_daily TO authenticated;
GRANT ALL ON TABLE public.ai_usage_daily TO service_role;

-- ---------------------------------------------------------------------------
-- 2. rpc_check_and_record_ai_usage — service_role-only. The Edge Function
-- authenticates the caller and resolves their org membership using a
-- request-bound client (the user's own JWT); it then calls this RPC through
-- a *separate* service_role-keyed admin client purely to record/check the
-- quota. This function does not re-verify identity — by design, only
-- already-trusted server code can reach it at all (see the REVOKE/GRANT
-- below), so re-deriving auth.uid() here would just check against NULL
-- (service_role calls carry no end-user JWT) and add nothing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rpc_check_and_record_ai_usage(
  p_org_id uuid,
  p_user_id uuid,
  p_user_daily_limit integer,
  p_org_daily_limit integer
) RETURNS TABLE(allowed boolean, user_accepted_count integer, org_accepted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_user_accepted integer;
  v_org_accepted integer;
BEGIN
  IF p_org_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'AI_USAGE_171_NULL_ARGUMENT';
  END IF;
  IF p_user_daily_limit IS NULL OR p_user_daily_limit <= 0
     OR p_org_daily_limit IS NULL OR p_org_daily_limit <= 0 THEN
    RAISE EXCEPTION 'AI_USAGE_171_INVALID_LIMIT';
  END IF;

  -- Serialize every request for this (org, UTC day) — without this, two
  -- concurrent requests from different users could both read the org total
  -- as "one below the limit" and both then be accepted, letting the org
  -- exceed p_org_daily_limit. The lock is released automatically at the end
  -- of this function's transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_today::text));

  INSERT INTO public.ai_usage_daily (org_id, user_id, usage_date)
  VALUES (p_org_id, p_user_id, v_today)
  ON CONFLICT ON CONSTRAINT ai_usage_daily_org_user_date_key DO NOTHING;

  SELECT accepted_count INTO v_user_accepted
  FROM public.ai_usage_daily
  WHERE org_id = p_org_id AND user_id = p_user_id AND usage_date = v_today;

  SELECT COALESCE(SUM(accepted_count), 0) INTO v_org_accepted
  FROM public.ai_usage_daily
  WHERE org_id = p_org_id AND usage_date = v_today;

  IF v_user_accepted >= p_user_daily_limit OR v_org_accepted >= p_org_daily_limit THEN
    -- Rejected attempts are logged but never increase accepted usage — a
    -- user who has already hit their own limit must not be able to keep
    -- consuming the organization's shared quota by retrying.
    UPDATE public.ai_usage_daily
    SET rejected_count = rejected_count + 1, updated_at = now()
    WHERE org_id = p_org_id AND user_id = p_user_id AND usage_date = v_today;

    RETURN QUERY SELECT false, v_user_accepted, v_org_accepted;
    RETURN;
  END IF;

  UPDATE public.ai_usage_daily
  SET accepted_count = accepted_count + 1, updated_at = now()
  WHERE org_id = p_org_id AND user_id = p_user_id AND usage_date = v_today
  RETURNING accepted_count INTO v_user_accepted;

  RETURN QUERY SELECT true, v_user_accepted, v_org_accepted + 1;
END;
$function$;

-- SECURITY DEFINER guard: no execute for anyone except service_role. The
-- Edge Function is the only intended caller, using its service_role key
-- via a client kept entirely separate from the request-bound user client
-- used for auth/org/permission checks.
REVOKE ALL ON FUNCTION public.rpc_check_and_record_ai_usage(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_check_and_record_ai_usage(uuid, uuid, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. reports.ai_insights.use permission (global catalog row)
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (module_id, resource, resource_ar, action, action_ar, permission_key, description, description_ar)
SELECT id, 'ai_insights', 'الرؤى الذكية', 'use', 'استخدام',
       'reports.ai_insights.use', 'Use AI-generated report insights', 'استخدام الرؤى المدعومة بالذكاء الاصطناعي في التقارير'
FROM public.modules WHERE name = 'reports'
ON CONFLICT (permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Postflight: fail closed before COMMIT if any of the above did not take.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_bad_grants text;
BEGIN
  IF to_regclass('public.ai_usage_daily') IS NULL THEN
    RAISE EXCEPTION 'FAIL[171-1] ai_usage_daily table missing';
  END IF;

  SELECT string_agg(grantee, ', ') INTO v_bad_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'ai_usage_daily'
    AND grantee IN ('anon', 'PUBLIC')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
  IF v_bad_grants IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL[171-1b] ai_usage_daily has write grants for: %', v_bad_grants;
  END IF;

  IF has_function_privilege('anon', 'rpc_check_and_record_ai_usage(uuid,uuid,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'rpc_check_and_record_ai_usage(uuid,uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[171-2] rpc_check_and_record_ai_usage is EXECUTE-able by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'rpc_check_and_record_ai_usage(uuid,uuid,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL[171-2b] rpc_check_and_record_ai_usage is not EXECUTE-able by service_role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE permission_key = 'reports.ai_insights.use') THEN
    RAISE EXCEPTION 'FAIL[171-3] reports.ai_insights.use permission was not seeded';
  END IF;

  RAISE NOTICE 'PASS[171] ai_usage_daily + rpc_check_and_record_ai_usage + reports.ai_insights.use applied';
END
$verify$;

COMMIT;
