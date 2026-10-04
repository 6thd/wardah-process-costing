BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

-- Issue #156 / OQ-10.
--
-- Migration 188 deliberately preserved the legacy admin-only SELECT contract
-- for five confidential HR tables while repairing multi-organization tenant
-- selection. The application already exposes exact read permissions for these
-- resources, so an ordinary active member with a valid RBAC grant currently
-- passes the UI gate but receives an empty result from RLS.
--
-- This migration changes SELECT only. Every INSERT/UPDATE/DELETE policy stays
-- behind wardah_is_org_admin(org_id), and no business rows are modified.

LOCK TABLE
  public.employee_salary_structures,
  public.payroll_runs,
  public.payroll_details,
  public.attendance_records,
  public.employee_leaves
IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  v_tables CONSTANT text[] := ARRAY[
    'employee_salary_structures', 'payroll_runs', 'payroll_details',
    'attendance_records', 'employee_leaves'
  ];
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (v_tables);
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'HR_189_TABLE_DRIFT: expected 5 target tables, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.permissions
  WHERE permission_key IN (
    'hr.payroll.read', 'hr.attendance.read', 'hr.leaves.read'
  );
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'HR_189_PERMISSION_DRIFT: expected 3 exact read keys, found %', v_count;
  END IF;

  IF to_regprocedure('public.has_permission(uuid,uuid,character varying)') IS NULL THEN
    RAISE EXCEPTION 'HR_189_PERMISSION_HELPER_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_tables)
    AND policyname = tablename || '_wardah_admin_select'
    AND cmd = 'SELECT'
    AND roles = ARRAY['authenticated']::name[]
    AND regexp_replace(coalesce(qual, ''), '\s+', '', 'g') IN (
      'wardah_is_org_admin(org_id)',
      'public.wardah_is_org_admin(org_id)'
    );
  IF v_count <> 5 THEN
    RAISE EXCEPTION
      'HR_189_SELECT_POLICY_DRIFT: expected 5 Migration-188 admin reads, found %',
      v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_tables)
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    AND roles = ARRAY['authenticated']::name[]
    AND (coalesce(qual, '') || coalesce(with_check, ''))
      LIKE '%wardah_is_org_admin%';
  IF v_count <> 15 THEN
    RAISE EXCEPTION
      'HR_189_MUTATION_POLICY_DRIFT: expected 15 admin-only writes, found %',
      v_count;
  END IF;
END
$preflight$;

DROP POLICY IF EXISTS employee_salary_structures_wardah_admin_select
  ON public.employee_salary_structures;
CREATE POLICY employee_salary_structures_wardah_admin_select
  ON public.employee_salary_structures
  FOR SELECT TO authenticated
  USING (public.has_permission(
    (SELECT auth.uid()), org_id, 'hr.payroll.read'::character varying
  ));

DROP POLICY IF EXISTS payroll_runs_wardah_admin_select
  ON public.payroll_runs;
CREATE POLICY payroll_runs_wardah_admin_select
  ON public.payroll_runs
  FOR SELECT TO authenticated
  USING (public.has_permission(
    (SELECT auth.uid()), org_id, 'hr.payroll.read'::character varying
  ));

DROP POLICY IF EXISTS payroll_details_wardah_admin_select
  ON public.payroll_details;
CREATE POLICY payroll_details_wardah_admin_select
  ON public.payroll_details
  FOR SELECT TO authenticated
  USING (public.has_permission(
    (SELECT auth.uid()), org_id, 'hr.payroll.read'::character varying
  ));

DROP POLICY IF EXISTS attendance_records_wardah_admin_select
  ON public.attendance_records;
CREATE POLICY attendance_records_wardah_admin_select
  ON public.attendance_records
  FOR SELECT TO authenticated
  USING (public.has_permission(
    (SELECT auth.uid()), org_id, 'hr.attendance.read'::character varying
  ));

DROP POLICY IF EXISTS employee_leaves_wardah_admin_select
  ON public.employee_leaves;
CREATE POLICY employee_leaves_wardah_admin_select
  ON public.employee_leaves
  FOR SELECT TO authenticated
  USING (public.has_permission(
    (SELECT auth.uid()), org_id, 'hr.leaves.read'::character varying
  ));

DO $postflight$
DECLARE
  v_tables CONSTANT text[] := ARRAY[
    'employee_salary_structures', 'payroll_runs', 'payroll_details',
    'attendance_records', 'employee_leaves'
  ];
  v_table text;
  v_permission text;
  v_qual text;
  v_roles name[];
  v_cmd text;
  v_count integer;
BEGIN
  FOR v_table, v_permission IN
    SELECT * FROM (VALUES
      ('employee_salary_structures', 'hr.payroll.read'),
      ('payroll_runs', 'hr.payroll.read'),
      ('payroll_details', 'hr.payroll.read'),
      ('attendance_records', 'hr.attendance.read'),
      ('employee_leaves', 'hr.leaves.read')
    ) AS expected(table_name, permission_key)
  LOOP
    SELECT qual, roles, cmd
      INTO v_qual, v_roles, v_cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = v_table
      AND policyname = v_table || '_wardah_admin_select';

    IF v_cmd IS DISTINCT FROM 'SELECT'
       OR v_roles IS DISTINCT FROM ARRAY['authenticated']::name[]
       OR position('has_permission' IN coalesce(v_qual, '')) = 0
       OR position(v_permission IN coalesce(v_qual, '')) = 0
       OR position('wardah_is_org_admin' IN coalesce(v_qual, '')) > 0 THEN
      RAISE EXCEPTION
        'HR_189_POST_SELECT_POLICY: table=% cmd=% roles=% qual=%',
        v_table, v_cmd, v_roles, v_qual;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_tables);
  IF v_count <> 20 THEN
    RAISE EXCEPTION 'HR_189_POLICY_COUNT: expected 20, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_tables)
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    AND roles = ARRAY['authenticated']::name[]
    AND position('wardah_is_org_admin' IN
      (coalesce(qual, '') || coalesce(with_check, ''))) > 0
    AND position('has_permission' IN
      (coalesce(qual, '') || coalesce(with_check, ''))) = 0;
  IF v_count <> 15 THEN
    RAISE EXCEPTION
      'HR_189_POST_MUTATION_POLICY: expected 15 unchanged admin writes, found %',
      v_count;
  END IF;

  RAISE NOTICE
    'HR_189_POSTFLIGHT_PASS: 5 exact-RBAC reads; 15 admin-only writes preserved';
END
$postflight$;

COMMIT;
