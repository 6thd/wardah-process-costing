-- Green acceptance for Migration 188.
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
        'HR_188_GREEN_WRONG_ERROR: expected [%], got [%]', p_needle, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'HR_188_GREEN_EXPECTED_ERROR_MISSING: %', p_needle;
  END IF;
END;
$$;

BEGIN;

-- Multi-org administrator: both explicitly selected organizations work, the
-- unrelated third organization remains invisible, and confidential reads stay
-- admin-only. No JWT org claim is needed to choose A versus B.
SELECT set_config('request.jwt.claim.sub', '51856188-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"51856188-0000-0000-0000-000000000001"}', true);
SET LOCAL ROLE authenticated;

DO $admin_reads$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.employees
  WHERE org_id = '51856188-1000-0000-0000-000000000001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'HR_188_ADMIN_ORG_A_EMPLOYEES: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.employees
  WHERE org_id = '51856188-2000-0000-0000-000000000001';
  IF v_count <> 1 THEN RAISE EXCEPTION 'HR_188_ADMIN_ORG_B_EMPLOYEES: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.employees
  WHERE org_id = '51856188-3000-0000-0000-000000000001';
  IF v_count <> 0 THEN RAISE EXCEPTION 'HR_188_ADMIN_CROSS_ORG_EMPLOYEES: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.hr_policies
  WHERE org_id IN (
    '51856188-1000-0000-0000-000000000001',
    '51856188-2000-0000-0000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'HR_188_ADMIN_MULTI_POLICY_READ: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.payroll_runs
  WHERE org_id IN (
    '51856188-1000-0000-0000-000000000001',
    '51856188-2000-0000-0000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'HR_188_ADMIN_MULTI_CONFIDENTIAL_READ: %', v_count; END IF;

  UPDATE public.departments SET description = 'updated through org B'
  WHERE id = '51856188-2000-0000-0000-000000000020';
  IF NOT FOUND THEN RAISE EXCEPTION 'HR_188_ADMIN_ORG_B_UPDATE_DENIED'; END IF;
END
$admin_reads$;

SELECT pg_temp.expect_error(
  $$UPDATE public.departments
    SET org_id = '51856188-3000-0000-0000-000000000001'
    WHERE id = '51856188-2000-0000-0000-000000000020'$$,
  'row-level security'
);

RESET ROLE;

-- Ordinary multi-org member: may read both organizations' non-confidential
-- rows, but cannot mutate legacy manager tables or read confidential payroll.
SELECT set_config('request.jwt.claim.sub', '51856188-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"51856188-0000-0000-0000-000000000002"}', true);
SET LOCAL ROLE authenticated;

DO $member_reads$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.employees
  WHERE org_id IN (
    '51856188-1000-0000-0000-000000000001',
    '51856188-2000-0000-0000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'HR_188_MEMBER_MULTI_EMPLOYEE_READ: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.payroll_periods
  WHERE org_id IN (
    '51856188-1000-0000-0000-000000000001',
    '51856188-2000-0000-0000-000000000001'
  );
  IF v_count <> 2 THEN RAISE EXCEPTION 'HR_188_MEMBER_MULTI_DEFINITION_READ: %', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.payroll_runs;
  IF v_count <> 0 THEN RAISE EXCEPTION 'HR_188_MEMBER_CONFIDENTIAL_DISCLOSURE: %', v_count; END IF;
END
$member_reads$;

SELECT pg_temp.expect_error(
  $$INSERT INTO public.departments (org_id, code, name, name_ar)
    VALUES ('51856188-2000-0000-0000-000000000001',
            'HR188-MEMBER-WRITE', 'Denied', 'مرفوض')$$,
  'row-level security'
);

RESET ROLE;

-- A forged claim for Org C cannot extend the caller's real memberships.
SELECT set_config('request.jwt.claim.sub', '51856188-0000-0000-0000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51856188-0000-0000-0000-000000000002","org_id":"51856188-3000-0000-0000-000000000001"}',
  true
);
SET LOCAL ROLE authenticated;
DO $spoof_denied$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employees
    WHERE org_id = '51856188-3000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'HR_188_FORGED_CLAIM_EXTENDED_MEMBERSHIP';
  END IF;
END
$spoof_denied$;
RESET ROLE;

-- Inactive membership is denied even when it carries the old admin flags.
SELECT set_config('request.jwt.claim.sub', '51856188-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"51856188-0000-0000-0000-000000000004"}', true);
SET LOCAL ROLE authenticated;
DO $inactive_denied$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employees
    WHERE org_id = '51856188-1000-0000-0000-000000000001'
  ) OR EXISTS (
    SELECT 1 FROM public.payroll_runs
    WHERE org_id = '51856188-1000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'HR_188_INACTIVE_MEMBERSHIP_RETAINED_ACCESS';
  END IF;
END
$inactive_denied$;
RESET ROLE;

-- Unrelated active member sees only Org C, never A or B.
SELECT set_config('request.jwt.claim.sub', '51856188-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"51856188-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
DO $cross_org_denied$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.employees;
  IF v_count <> 1 THEN RAISE EXCEPTION 'HR_188_OUTSIDER_EMPLOYEE_SCOPE: %', v_count; END IF;
  IF EXISTS (
    SELECT 1 FROM public.employees
    WHERE org_id IN (
      '51856188-1000-0000-0000-000000000001',
      '51856188-2000-0000-0000-000000000001'
    )
  ) THEN
    RAISE EXCEPTION 'HR_188_CROSS_ORG_DISCLOSURE';
  END IF;
END
$cross_org_denied$;
RESET ROLE;

-- Catalog contract: all 75 policies are authenticated-only and no scalar,
-- unordered LIMIT, or implicit effective-org fallback remains.
DO $catalog_contract$
DECLARE
  v_total integer;
  v_bad_roles integer;
  v_legacy integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employees', 'departments', 'positions',
      'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
      'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
      'hr_settlement_lines', 'hr_settlements',
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves', 'salary_components',
      'leave_types', 'payroll_periods'
    ]);

  SELECT count(*) INTO v_bad_roles
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employees', 'departments', 'positions',
      'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
      'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
      'hr_settlement_lines', 'hr_settlements',
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves', 'salary_components',
      'leave_types', 'payroll_periods'
    ])
    AND roles IS DISTINCT FROM ARRAY['authenticated']::name[];

  SELECT count(*) INTO v_legacy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employees', 'departments', 'positions',
      'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
      'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
      'hr_settlement_lines', 'hr_settlements',
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves', 'salary_components',
      'leave_types', 'payroll_periods'
    ])
    AND (
      (coalesce(qual, '') || coalesce(with_check, ''))
        ~* 'org_id\s*=\s*\(\s*SELECT'
      OR (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mLIMIT\s+1\M'
      OR (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%wardah_org_id%'
    );

  IF v_total <> 75 OR v_bad_roles <> 0 OR v_legacy <> 0 THEN
    RAISE EXCEPTION
      'HR_188_CATALOG_CONTRACT: total=% bad_roles=% legacy=%',
      v_total, v_bad_roles, v_legacy;
  END IF;
  RAISE NOTICE 'HR_188_GREEN_CATALOG_OK';
END
$catalog_contract$;

ROLLBACK;

SELECT 'HR_188_GREEN_ACCEPTANCE_PASS' AS result;
