-- Acceptance for Migration 171.
-- Proves: (1) ai_usage_daily grants no direct write access to anon/
-- authenticated, only SELECT of the caller's own row; (2)
-- rpc_check_and_record_ai_usage is EXECUTE-denied for anon and
-- authenticated, and callable only as a role that holds it (simulated here
-- via a direct SECURITY DEFINER-context call, since granting service_role
-- to a test session isn't how Supabase's connection pooling actually works
-- — the EXECUTE-privilege check itself is the real contract, proven
-- directly below); (3) a user's own accepted requests are correctly
-- limited per-user; (4) once a user is over their own limit, further
-- rejected attempts do NOT inflate the organization's accepted total —
-- proving one user cannot exhaust the whole org's quota after exceeding
-- their own; (5) the organization-wide limit is enforced across two
-- different users in the same org; (6) a maxed-out row from a prior UTC
-- day does not affect today's counters.
--
-- Not covered here: true concurrent-connection racing (this script is a
-- single sequential psql session, like every other acceptance file in this
-- repo). The advisory-lock design is reviewed for correctness under
-- concurrent access, but this suite only proves sequential-call correctness
-- — noted explicitly rather than claiming concurrency coverage that isn't
-- actually exercised.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION
        'ACCEPTANCE_FAIL: expected [%] for [%], got [%]',
        p_needle, p_sql, SQLERRM;
    END IF;
  END;

  IF v_succeeded THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: expected error [%] for [%], but it succeeded',
      p_needle, p_sql;
  END IF;
END;
$$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Fixtures: one organization, two active users in it.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', 'ai171-usera@example.test'),
  ('99bbbbbb-171b-171b-171b-bbbbbbbbbbbb', 'ai171-userb@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99111111-1717-1717-1717-111111111111', 'AiUsage171 Org', 'AI171-ORG');

INSERT INTO public.user_organizations (user_id, org_id, is_active) VALUES
  ('99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', '99111111-1717-1717-1717-111111111111', true),
  ('99bbbbbb-171b-171b-171b-bbbbbbbbbbbb', '99111111-1717-1717-1717-111111111111', true);

-- ---------------------------------------------------------------------------
-- 2. Direct-EXECUTE denial: anon and authenticated must not be able to call
-- the quota RPC at all, regardless of arguments.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99111111-1717-1717-1717-111111111111"}', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$SELECT * FROM public.rpc_check_and_record_ai_usage(
      '99111111-1717-1717-1717-111111111111'::uuid,
      '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'::uuid, 20, 100)$$,
  'permission denied');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.expect_error(
  $$SELECT * FROM public.rpc_check_and_record_ai_usage(
      '99111111-1717-1717-1717-111111111111'::uuid,
      '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'::uuid, 20, 100)$$,
  'permission denied');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. Per-user limit: with a limit of 3, the first 3 calls for user A are
-- accepted, the 4th is rejected — and the rejection does not increase
-- accepted_count.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := '99111111-1717-1717-1717-111111111111';
  v_user_a uuid := '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa';
  v_allowed boolean;
  v_user_accepted int;
  v_org_accepted int;
  v_accepted_before int;
BEGIN
  FOR i IN 1..3 LOOP
    SELECT allowed, user_accepted_count, org_accepted_count
    INTO v_allowed, v_user_accepted, v_org_accepted
    FROM public.rpc_check_and_record_ai_usage(v_org, v_user_a, 3, 100);

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: call % for user A unexpectedly rejected (limit=3)', i;
    END IF;
    IF v_user_accepted <> i THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: user A accepted_count expected % got %', i, v_user_accepted;
    END IF;
  END LOOP;

  SELECT accepted_count INTO v_accepted_before
  FROM public.ai_usage_daily
  WHERE org_id = v_org AND user_id = v_user_a AND usage_date = (now() AT TIME ZONE 'utc')::date;

  -- 4th call: user A is already at their limit of 3.
  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_a, 3, 100);

  IF v_allowed THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: 4th call for user A should be rejected (over per-user limit)';
  END IF;

  IF v_user_accepted <> v_accepted_before THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: rejected call inflated accepted_count: before % after %', v_accepted_before, v_user_accepted;
  END IF;

  IF (SELECT rejected_count FROM public.ai_usage_daily
      WHERE org_id = v_org AND user_id = v_user_a AND usage_date = (now() AT TIME ZONE 'utc')::date) <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: rejected_count for user A should be 1 after one rejection';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Org-wide limit shared across two users: with org limit 4 and user A
-- already holding 3 accepted (from step 3), user B's first call brings the
-- org total to 4 (accepted), user B's second call must be rejected for
-- exceeding the ORG limit — even though user B's own per-user count (1) is
-- nowhere near a generous per-user limit.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := '99111111-1717-1717-1717-111111111111';
  v_user_b uuid := '99bbbbbb-171b-171b-171b-bbbbbbbbbbbb';
  v_allowed boolean;
  v_user_accepted int;
  v_org_accepted int;
BEGIN
  -- Org currently has 3 accepted (all from user A). Org limit = 4.
  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_b, 20, 4);

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: user B first call should be accepted (org total 3 -> 4, limit 4)';
  END IF;
  IF v_org_accepted <> 4 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: org_accepted_count expected 4 got %', v_org_accepted;
  END IF;

  -- Org is now at its limit of 4. User B's own limit (20) is nowhere close,
  -- but the org-wide cap must still reject this call.
  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_b, 20, 4);

  IF v_allowed THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: user B second call should be rejected (org limit reached, even though user B is under their own per-user limit)';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. UTC-day boundary: a maxed-out row dated "yesterday" must not affect
-- today's counters — a fresh row for today starts at zero.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := '99222222-1717-1717-1717-222222222222';
  v_user uuid := '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa';
  v_allowed boolean;
  v_user_accepted int;
  v_org_accepted int;
BEGIN
  INSERT INTO public.organizations (id, name, code)
  VALUES (v_org, 'AiUsage171 Org 2', 'AI171-ORG2');
  INSERT INTO public.user_organizations (user_id, org_id, is_active)
  VALUES (v_user, v_org, true);

  -- Yesterday's row is already at the limit — must not block today's call.
  INSERT INTO public.ai_usage_daily (org_id, user_id, usage_date, accepted_count)
  VALUES (v_org, v_user, ((now() AT TIME ZONE 'utc')::date - 1), 999);

  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user, 20, 100);

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: yesterday''s maxed-out row incorrectly blocked today''s request (UTC-day boundary not respected)';
  END IF;
  IF v_user_accepted <> 1 THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: today''s accepted_count should start at 1, got %', v_user_accepted;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS: a user can SELECT only their own ai_usage_daily row.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub',
                  '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', false);
SELECT set_config('request.jwt.claims',
                  '{"org_id":"99111111-1717-1717-1717-111111111111"}', false);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_usage_daily
                 WHERE user_id = '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: user A cannot see their own ai_usage_daily row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_usage_daily
             WHERE user_id = '99bbbbbb-171b-171b-171b-bbbbbbbbbbbb') THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: user A can see user B''s ai_usage_daily row';
  END IF;
END;
$$;

SELECT pg_temp.expect_error(
  $$INSERT INTO public.ai_usage_daily (org_id, user_id, usage_date, accepted_count)
    VALUES ('99111111-1717-1717-1717-111111111111', '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', CURRENT_DATE, 0)$$,
  'permission denied');

RESET ROLE;

ROLLBACK;

SELECT 'AI_USAGE_DAILY_171_ACCEPTANCE_PASS';
