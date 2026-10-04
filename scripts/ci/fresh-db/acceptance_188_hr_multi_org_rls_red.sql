-- Red proof for Migration 188. Runs on cutoff 187 before applying 188.
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
        'HR_188_RED_WRONG_ERROR: expected [%], got [%]', p_needle, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'HR_188_RED_EXPECTED_ERROR_MISSING: %', p_needle;
  END IF;
END;
$$;

BEGIN;

DO $red_catalog$
DECLARE
  v_scalar_count integer;
  v_limit_count integer;
  v_fallback_count integer;
BEGIN
  SELECT count(*) INTO v_scalar_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY['employees', 'departments', 'positions'])
    AND (coalesce(qual, '') || coalesce(with_check, ''))
      ~* 'org_id\s*=\s*\(\s*SELECT';

  SELECT count(*) INTO v_limit_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
      'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
      'hr_settlement_lines', 'hr_settlements'
    ])
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mLIMIT\s+1\M';

  SELECT count(*) INTO v_fallback_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves', 'salary_components',
      'leave_types', 'payroll_periods'
    ])
    AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%wardah_org_id%';

  IF v_scalar_count <> 11 OR v_limit_count <> 32 OR v_fallback_count <> 32 THEN
    RAISE EXCEPTION
      'HR_188_RED_CATALOG_DRIFT: scalar=% limit=% fallback=%',
      v_scalar_count, v_limit_count, v_fallback_count;
  END IF;
  RAISE NOTICE 'HR_188_RED_LEGACY_POLICY_SHAPES_OK';
END
$red_catalog$;

SELECT set_config(
  'request.jwt.claim.sub',
  '51856188-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856188-0000-0000-0000-000000000001"}',
  true
);
SET LOCAL ROLE authenticated;

-- This is the production defect: two active memberships make the employees
-- scalar subquery return two rows, aborting even an explicitly scoped read.
SELECT pg_temp.expect_error(
  $$SELECT count(*) FROM public.employees
    WHERE org_id = '51856188-1000-0000-0000-000000000001'$$,
  'more than one row returned by a subquery used as an expression'
);

RESET ROLE;
ROLLBACK;

SELECT 'HR_188_RED_PROOF_PASS' AS result;
