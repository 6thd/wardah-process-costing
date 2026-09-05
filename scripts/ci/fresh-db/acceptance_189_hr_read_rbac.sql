\set ON_ERROR_STOP on

BEGIN;

-- Exact reader: all five Org A resources are visible. The same user's active
-- membership in Org B is not enough without an Org B role grant.
SELECT set_config('request.jwt.claim.sub', '89189189-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"89189189-0000-0000-0000-000000000002"}', true);
SET LOCAL ROLE authenticated;
DO $exact_reader$
DECLARE
  v_count integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.payroll_runs
      WHERE org_id = '89189189-1000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.payroll_details
      WHERE org_id = '89189189-1000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.employee_salary_structures
      WHERE org_id = '89189189-1000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.attendance_records
      WHERE org_id = '89189189-1000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.employee_leaves
      WHERE org_id = '89189189-1000-0000-0000-000000000001')
  INTO v_count;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'HR_189_EXACT_READER_ORG_A: expected 5, found %', v_count;
  END IF;

  SELECT
    (SELECT count(*) FROM public.payroll_runs
      WHERE org_id = '89189189-2000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.payroll_details
      WHERE org_id = '89189189-2000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.employee_salary_structures
      WHERE org_id = '89189189-2000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.attendance_records
      WHERE org_id = '89189189-2000-0000-0000-000000000001') +
    (SELECT count(*) FROM public.employee_leaves
      WHERE org_id = '89189189-2000-0000-0000-000000000001')
  INTO v_count;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'HR_189_MEMBERSHIP_ONLY_ORG_B_DISCLOSURE: %', v_count;
  END IF;
END
$exact_reader$;
RESET ROLE;

-- Exact-key matching: attendance.read cannot unlock payroll or leave rows.
SELECT set_config('request.jwt.claim.sub', '89189189-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"89189189-0000-0000-0000-000000000003"}', true);
SET LOCAL ROLE authenticated;
DO $attendance_only$
DECLARE
  v_attendance integer;
  v_other integer;
BEGIN
  SELECT count(*) INTO v_attendance FROM public.attendance_records;
  SELECT
    (SELECT count(*) FROM public.payroll_runs) +
    (SELECT count(*) FROM public.payroll_details) +
    (SELECT count(*) FROM public.employee_salary_structures) +
    (SELECT count(*) FROM public.employee_leaves)
  INTO v_other;
  IF v_attendance <> 1 OR v_other <> 0 THEN
    RAISE EXCEPTION
      'HR_189_EXACT_KEY_SCOPE: attendance=% other=%', v_attendance, v_other;
  END IF;
END
$attendance_only$;
RESET ROLE;

-- A role assignment whose permission rows were revoked grants nothing.
SELECT set_config('request.jwt.claim.sub', '89189189-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"89189189-0000-0000-0000-000000000004"}', true);
SET LOCAL ROLE authenticated;
DO $revoked$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_runs)
     OR EXISTS (SELECT 1 FROM public.attendance_records)
     OR EXISTS (SELECT 1 FROM public.employee_leaves) THEN
    RAISE EXCEPTION 'HR_189_REVOKED_GRANT_RETAINED_ACCESS';
  END IF;
END
$revoked$;
RESET ROLE;

-- An inactive membership invalidates the still-present role and grants.
SELECT set_config('request.jwt.claim.sub', '89189189-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"89189189-0000-0000-0000-000000000005"}', true);
SET LOCAL ROLE authenticated;
DO $inactive$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_runs)
     OR EXISTS (SELECT 1 FROM public.attendance_records)
     OR EXISTS (SELECT 1 FROM public.employee_leaves) THEN
    RAISE EXCEPTION 'HR_189_INACTIVE_MEMBERSHIP_RETAINED_ACCESS';
  END IF;
END
$inactive$;
RESET ROLE;

-- The central helper's ordinary-key org-admin override remains intact.
SELECT set_config('request.jwt.claim.sub', '89189189-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"89189189-0000-0000-0000-000000000001"}', true);
SET LOCAL ROLE authenticated;
DO $admin_override$
DECLARE
  v_count integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.payroll_runs) +
    (SELECT count(*) FROM public.payroll_details) +
    (SELECT count(*) FROM public.employee_salary_structures) +
    (SELECT count(*) FROM public.attendance_records) +
    (SELECT count(*) FROM public.employee_leaves)
  INTO v_count;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'HR_189_ORG_ADMIN_OVERRIDE: expected 5, found %', v_count;
  END IF;
END
$admin_override$;
RESET ROLE;

DO $catalog$
DECLARE
  v_select integer;
  v_write integer;
BEGIN
  SELECT count(*) INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves'
    ])
    AND cmd = 'SELECT'
    AND roles = ARRAY['authenticated']::name[]
    AND position('has_permission' IN coalesce(qual, '')) > 0;

  SELECT count(*) INTO v_write
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves'
    ])
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    AND position('wardah_is_org_admin' IN
      (coalesce(qual, '') || coalesce(with_check, ''))) > 0
    AND position('has_permission' IN
      (coalesce(qual, '') || coalesce(with_check, ''))) = 0;

  IF v_select <> 5 OR v_write <> 15 THEN
    RAISE EXCEPTION 'HR_189_CATALOG: selects=% writes=%', v_select, v_write;
  END IF;
  RAISE NOTICE 'HR_189_GREEN_CATALOG_OK';
END
$catalog$;

ROLLBACK;

SELECT 'HR_189_GREEN_ACCEPTANCE_PASS' AS result;
