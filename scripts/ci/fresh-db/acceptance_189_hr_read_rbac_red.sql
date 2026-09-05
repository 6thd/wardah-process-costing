\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('request.jwt.claim.sub', '89189189-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"89189189-0000-0000-0000-000000000002"}', true);
SET LOCAL ROLE authenticated;

DO $red$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.has_permission(
    (SELECT auth.uid()),
    '89189189-1000-0000-0000-000000000001',
    'hr.payroll.read'
  ) OR NOT public.has_permission(
    (SELECT auth.uid()),
    '89189189-1000-0000-0000-000000000001',
    'hr.attendance.read'
  ) OR NOT public.has_permission(
    (SELECT auth.uid()),
    '89189189-1000-0000-0000-000000000001',
    'hr.leaves.read'
  ) THEN
    RAISE EXCEPTION 'HR_189_RED_FIXTURE_PERMISSION_MISSING';
  END IF;

  SELECT
    (SELECT count(*) FROM public.payroll_runs) +
    (SELECT count(*) FROM public.payroll_details) +
    (SELECT count(*) FROM public.employee_salary_structures) +
    (SELECT count(*) FROM public.attendance_records) +
    (SELECT count(*) FROM public.employee_leaves)
  INTO v_count;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'HR_189_RED_ADMIN_ONLY_READ_NOT_REPRODUCED: %', v_count;
  END IF;

  RAISE NOTICE
    'HR_189_RED_PROOF_PASS: exact grants true while all 5 RLS reads return zero';
END
$red$;

RESET ROLE;
ROLLBACK;

SELECT 'HR_189_RED_ACCEPTANCE_PASS' AS result;
