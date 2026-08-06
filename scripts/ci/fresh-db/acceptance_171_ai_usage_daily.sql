-- Acceptance for Migration 171.
-- Proves the two-argument, fixed-limit RPC contract; direct EXECUTE denial;
-- active-membership enforcement; per-user and per-org quotas; UTC-day
-- separation; and own-row RLS that is revoked when membership is disabled.
-- True cross-connection contention is exercised separately by
-- acceptance_171_ai_usage_concurrency.sh.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(
  p_sql text,
  p_needle text
) RETURNS void
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

INSERT INTO auth.users (id, email) VALUES
  ('99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', 'ai171-usera@example.test'),
  ('99bbbbbb-171b-171b-171b-bbbbbbbbbbbb', 'ai171-userb@example.test'),
  ('99cccccc-171c-171c-171c-cccccccccccc', 'ai171-inactive@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('99111111-1717-1717-1717-111111111111', 'AiUsage171 Org', 'AI171-ORG'),
  ('99222222-1717-1717-1717-222222222222', 'AiUsage171 UTC Org', 'AI171-UTC');

INSERT INTO public.user_organizations (user_id, org_id, is_active) VALUES
  ('99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', '99111111-1717-1717-1717-111111111111', true),
  ('99bbbbbb-171b-171b-171b-bbbbbbbbbbbb', '99111111-1717-1717-1717-111111111111', true),
  ('99cccccc-171c-171c-171c-cccccccccccc', '99111111-1717-1717-1717-111111111111', false),
  ('99aaaaaa-171a-171a-171a-aaaaaaaaaaaa', '99222222-1717-1717-1717-222222222222', true);

-- Direct client execution is denied regardless of caller-controlled IDs.
SELECT set_config(
  'request.jwt.claim.sub',
  '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa',
  false
);
SELECT set_config(
  'request.jwt.claims',
  '{"org_id":"99111111-1717-1717-1717-111111111111"}',
  false
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(
  $$SELECT * FROM public.rpc_check_and_record_ai_usage(
      '99111111-1717-1717-1717-111111111111'::uuid,
      '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'::uuid
    )$$,
  'permission denied'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.expect_error(
  $$SELECT * FROM public.rpc_check_and_record_ai_usage(
      '99111111-1717-1717-1717-111111111111'::uuid,
      '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'::uuid
    )$$,
  'permission denied'
);
RESET ROLE;

-- The privileged positive path is executed under the exact granted role.
SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM 1
    FROM public.rpc_check_and_record_ai_usage(
      '99111111-1717-1717-1717-111111111111'::uuid,
      '99cccccc-171c-171c-171c-cccccccccccc'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%AI_USAGE_171_ACTIVE_MEMBERSHIP_REQUIRED%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: inactive membership was accepted by privileged RPC';
  END IF;
END;
$$;

-- Fixed per-user limit: calls 1..20 pass, call 21 is rejected without
-- increasing accepted_count.
DO $$
DECLARE
  v_org CONSTANT uuid := '99111111-1717-1717-1717-111111111111';
  v_user_a CONSTANT uuid := '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa';
  v_allowed boolean;
  v_user_accepted integer;
  v_org_accepted integer;
BEGIN
  FOR i IN 1..20 LOOP
    SELECT allowed, user_accepted_count, org_accepted_count
    INTO v_allowed, v_user_accepted, v_org_accepted
    FROM public.rpc_check_and_record_ai_usage(v_org, v_user_a);

    IF NOT v_allowed OR v_user_accepted <> i THEN
      RAISE EXCEPTION
        'ACCEPTANCE_FAIL: fixed user limit call % returned allowed=% count=%',
        i, v_allowed, v_user_accepted;
    END IF;
  END LOOP;

  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_a);

  IF v_allowed OR v_user_accepted <> 20 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: call 21 must reject at fixed user limit 20';
  END IF;

  IF (
    SELECT rejected_count
    FROM public.ai_usage_daily
    WHERE org_id = v_org
      AND user_id = v_user_a
      AND usage_date = (now() AT TIME ZONE 'utc')::date
  ) <> 1 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: user rejection counter should equal 1';
  END IF;
END;
$$;

RESET ROLE;

-- Put the organization one below its fixed cap, then prove exactly one
-- additional accepted request reaches 100 and the following request rejects.
UPDATE public.ai_usage_daily
SET accepted_count = 99
WHERE org_id = '99111111-1717-1717-1717-111111111111'
  AND user_id = '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'
  AND usage_date = (now() AT TIME ZONE 'utc')::date;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_org CONSTANT uuid := '99111111-1717-1717-1717-111111111111';
  v_user_b CONSTANT uuid := '99bbbbbb-171b-171b-171b-bbbbbbbbbbbb';
  v_allowed boolean;
  v_user_accepted integer;
  v_org_accepted integer;
BEGIN
  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_b);

  IF NOT v_allowed OR v_org_accepted <> 100 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: fixed org limit should accept 99 -> 100';
  END IF;

  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_b);

  IF v_allowed OR v_org_accepted <> 100 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: fixed org limit must reject above 100';
  END IF;
END;
$$;

-- A prior UTC date never consumes today's quota.
DO $$
DECLARE
  v_org CONSTANT uuid := '99222222-1717-1717-1717-222222222222';
  v_user_a CONSTANT uuid := '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa';
  v_allowed boolean;
  v_user_accepted integer;
  v_org_accepted integer;
BEGIN
  INSERT INTO public.ai_usage_daily (
    org_id,
    user_id,
    usage_date,
    accepted_count
  ) VALUES (
    v_org,
    v_user_a,
    (now() AT TIME ZONE 'utc')::date - 1,
    999
  );

  SELECT allowed, user_accepted_count, org_accepted_count
  INTO v_allowed, v_user_accepted, v_org_accepted
  FROM public.rpc_check_and_record_ai_usage(v_org, v_user_a);

  IF NOT v_allowed OR v_user_accepted <> 1 OR v_org_accepted <> 1 THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: prior UTC date affected today: allowed=% user=% org=%',
      v_allowed, v_user_accepted, v_org_accepted;
  END IF;
END;
$$;

RESET ROLE;

-- Own-row RLS while active; other users are hidden and direct writes fail.
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.ai_usage_daily
    WHERE org_id = '99111111-1717-1717-1717-111111111111'
      AND user_id = '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: active user cannot read own quota row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ai_usage_daily
    WHERE user_id = '99bbbbbb-171b-171b-171b-bbbbbbbbbbbb'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: user can read another user quota row';
  END IF;
END;
$$;

SELECT pg_temp.expect_error(
  $$INSERT INTO public.ai_usage_daily (
      org_id,
      user_id,
      usage_date,
      accepted_count
    ) VALUES (
      '99111111-1717-1717-1717-111111111111',
      '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa',
      CURRENT_DATE,
      0
    )$$,
  'permission denied'
);

RESET ROLE;

-- Disabling membership immediately removes direct SELECT access.
UPDATE public.user_organizations
SET is_active = false
WHERE user_id = '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'
  AND org_id = '99111111-1717-1717-1717-111111111111';

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ai_usage_daily
    WHERE org_id = '99111111-1717-1717-1717-111111111111'
      AND user_id = '99aaaaaa-171a-171a-171a-aaaaaaaaaaaa'
  ) THEN
    RAISE EXCEPTION
      'ACCEPTANCE_FAIL: disabled membership retained quota-row visibility';
  END IF;
END;
$$;

RESET ROLE;

ROLLBACK;

SELECT 'AI_USAGE_DAILY_171_ACCEPTANCE_PASS';
