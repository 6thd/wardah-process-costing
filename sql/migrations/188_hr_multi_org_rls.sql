-- ============================================================================
-- Migration 188: deterministic multi-organization RLS for the HR foundation
-- ============================================================================
-- Issue #222 proved three related legacy policy shapes across all 19 HR tables:
--   * employees/departments/positions use scalar membership subqueries without
--     LIMIT, so two active memberships raise cardinality_violation (21000);
--   * eight P12 tables use an unordered LIMIT 1, silently authorizing whichever
--     membership PostgreSQL happens to return rather than the requested org;
--   * eight P13 tables combine wardah_org_id(NULL)'s deterministic fallback
--     with an explicit client org filter, so a valid second organization is
--     invisible even when the caller is an active member/admin there.
--
-- This migration changes only how the row's own org is matched to the caller's
-- active memberships. It deliberately preserves every existing authorization
-- level:
--   * ordinary active members may read employees and HR definition tables;
--   * the legacy admin/manager membership gate remains on P12 mutations;
--   * P13 confidential tables and every P13 mutation remain org-admin-only.
-- Exact permission/RBAC replacement remains separately tracked in #156.
-- No table data is changed.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE
  public.employees,
  public.departments,
  public.positions,
  public.hr_alerts,
  public.hr_attendance_monthly,
  public.hr_payroll_account_mappings,
  public.hr_payroll_adjustments,
  public.hr_payroll_locks,
  public.hr_policies,
  public.hr_settlement_lines,
  public.hr_settlements,
  public.employee_salary_structures,
  public.payroll_runs,
  public.payroll_details,
  public.attendance_records,
  public.employee_leaves,
  public.salary_components,
  public.leave_types,
  public.payroll_periods
IN SHARE ROW EXCLUSIVE MODE;

-- Fail before changing policies if the published cutoff-187 contract drifted.
DO $preflight$
DECLARE
  v_missing text;
  v_policy_count integer;
  v_scalar_policy_count integer;
  v_limit_policy_count integer;
  v_fallback_policy_count integer;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO v_missing
  FROM unnest(ARRAY[
    'employees', 'departments', 'positions',
    'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
    'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
    'hr_settlement_lines', 'hr_settlements',
    'employee_salary_structures', 'payroll_runs', 'payroll_details',
    'attendance_records', 'employee_leaves', 'salary_components',
    'leave_types', 'payroll_periods'
  ]) AS required(table_name)
  WHERE to_regclass('public.' || table_name) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'HR_188_REQUIRED_TABLE_MISSING: %', v_missing;
  END IF;

  IF to_regprocedure('public.wardah_is_org_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'HR_188_REQUIRED_ORG_GUARD_MISSING';
  END IF;

  SELECT count(*)
  INTO v_policy_count
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

  IF v_policy_count <> 75 THEN
    RAISE EXCEPTION
      'HR_188_POLICY_COUNT_DRIFT: expected 75 cutoff-187 policies, found %',
      v_policy_count;
  END IF;

  SELECT count(*)
  INTO v_scalar_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY['employees', 'departments', 'positions'])
    AND (coalesce(qual, '') || coalesce(with_check, ''))
      ~* 'org_id\s*=\s*\(\s*SELECT';

  IF v_scalar_policy_count <> 11 THEN
    RAISE EXCEPTION
      'HR_188_SCALAR_POLICY_DRIFT: expected 11 scalar policies, found %',
      v_scalar_policy_count;
  END IF;

  SELECT count(*)
  INTO v_limit_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
      'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
      'hr_settlement_lines', 'hr_settlements'
    ])
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mLIMIT\s+1\M';

  IF v_limit_policy_count <> 32 THEN
    RAISE EXCEPTION
      'HR_188_LIMIT_POLICY_DRIFT: expected 32 unordered LIMIT policies, found %',
      v_limit_policy_count;
  END IF;

  SELECT count(*)
  INTO v_fallback_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY[
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves', 'salary_components',
      'leave_types', 'payroll_periods'
    ])
    AND (coalesce(qual, '') || coalesce(with_check, ''))
      LIKE '%wardah_org_id%';

  IF v_fallback_policy_count <> 32 THEN
    RAISE EXCEPTION
      'HR_188_FALLBACK_POLICY_DRIFT: expected 32 fallback policies, found %',
      v_fallback_policy_count;
  END IF;
END
$preflight$;

-- --------------------------------------------------------------------------
-- 1. Legacy HR core: remove the scalar subqueries that throw for multi-org.
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can insert employees" ON public.employees;
CREATE POLICY "Managers can insert employees" ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.user_organizations AS uo
    WHERE uo.user_id = (SELECT auth.uid())
      AND uo.org_id = employees.org_id
      AND uo.is_active IS TRUE
      AND uo.role IN ('admin', 'manager')
  ));

DROP POLICY IF EXISTS "Managers can update employees" ON public.employees;
CREATE POLICY "Managers can update employees" ON public.employees
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_organizations AS uo
    WHERE uo.user_id = (SELECT auth.uid())
      AND uo.org_id = employees.org_id
      AND uo.is_active IS TRUE
      AND uo.role IN ('admin', 'manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.user_organizations AS uo
    WHERE uo.user_id = (SELECT auth.uid())
      AND uo.org_id = employees.org_id
      AND uo.is_active IS TRUE
      AND uo.role IN ('admin', 'manager')
  ));

DROP POLICY IF EXISTS "Users can view org employees" ON public.employees;
CREATE POLICY "Users can view org employees" ON public.employees
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.user_organizations AS uo
    WHERE uo.user_id = (SELECT auth.uid())
      AND uo.org_id = employees.org_id
      AND uo.is_active IS TRUE
  ));

DO $legacy_dimensions$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'positions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))',
      t || '_del_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))',
      t || '_ins_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
       ))',
      t || '_sel_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))
       WITH CHECK (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))',
      t || '_upd_m', t, t, t
    );
  END LOOP;
END
$legacy_dimensions$;

-- --------------------------------------------------------------------------
-- 2. P12 foundation: correlate every policy with the row's organization.
-- --------------------------------------------------------------------------
DO $foundation$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
    'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
    'hr_settlement_lines', 'hr_settlements'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))',
      t || '_del_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))',
      t || '_ins_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
       ))',
      t || '_sel_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd_m', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))
       WITH CHECK (EXISTS (
         SELECT 1 FROM public.user_organizations AS uo
         WHERE uo.user_id = (SELECT auth.uid())
           AND uo.org_id = %I.org_id
           AND uo.is_active IS TRUE
           AND uo.role IN (''admin'', ''manager'')
       ))',
      t || '_upd_m', t, t, t
    );
  END LOOP;
END
$foundation$;

-- --------------------------------------------------------------------------
-- 3. P13 confidential/definition tables: preserve P13 confidentiality while
--    matching the row's explicit org instead of wardah_org_id(NULL)'s fallback.
-- --------------------------------------------------------------------------
DO $p13$
DECLARE
  t text;
  is_confidential boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_salary_structures', 'payroll_runs', 'payroll_details',
    'attendance_records', 'employee_leaves',
    'salary_components', 'leave_types', 'payroll_periods'
  ] LOOP
    is_confidential := t = ANY (ARRAY[
      'employee_salary_structures', 'payroll_runs', 'payroll_details',
      'attendance_records', 'employee_leaves'
    ]);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      CASE WHEN is_confidential
        THEN t || '_wardah_admin_select'
        ELSE t || '_wardah_select'
      END,
      t
    );
    IF is_confidential THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (public.wardah_is_org_admin(org_id))',
        t || '_wardah_admin_select', t
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (EXISTS (
           SELECT 1 FROM public.user_organizations AS uo
           WHERE uo.user_id = (SELECT auth.uid())
             AND uo.org_id = %I.org_id
             AND uo.is_active IS TRUE
         ))',
        t || '_wardah_select', t, t
      );
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_wardah_admin_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (public.wardah_is_org_admin(org_id))',
      t || '_wardah_admin_insert', t
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_wardah_admin_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (public.wardah_is_org_admin(org_id))
       WITH CHECK (public.wardah_is_org_admin(org_id))',
      t || '_wardah_admin_update', t
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_wardah_admin_delete', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
       USING (public.wardah_is_org_admin(org_id))',
      t || '_wardah_admin_delete', t
    );
  END LOOP;
END
$p13$;

-- --------------------------------------------------------------------------
-- 4. Catalog postflight: exact policy count, role scope, and no legacy tenant
--    selector remains anywhere in the 19-table HR foundation.
-- --------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_policy_count integer;
  v_bad_role_count integer;
  v_legacy_selector_count integer;
  v_unguarded_count integer;
BEGIN
  SELECT count(*)
  INTO v_policy_count
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

  IF v_policy_count <> 75 THEN
    RAISE EXCEPTION 'HR_188_POST_POLICY_COUNT: expected 75, found %', v_policy_count;
  END IF;

  SELECT count(*)
  INTO v_bad_role_count
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

  IF v_bad_role_count <> 0 THEN
    RAISE EXCEPTION 'HR_188_POST_ROLE_SCOPE: % policies are not authenticated-only',
      v_bad_role_count;
  END IF;

  SELECT count(*)
  INTO v_legacy_selector_count
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

  IF v_legacy_selector_count <> 0 THEN
    RAISE EXCEPTION 'HR_188_POST_LEGACY_SELECTOR: % policies remain',
      v_legacy_selector_count;
  END IF;

  SELECT count(*)
  INTO v_unguarded_count
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
    AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%wardah_is_org_member%'
    AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%wardah_is_org_admin%'
    AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%user_organizations%';

  IF v_unguarded_count <> 0 THEN
    RAISE EXCEPTION 'HR_188_POST_UNGUARDED_POLICY: % policies lack an org guard',
      v_unguarded_count;
  END IF;

  RAISE NOTICE
    'HR_188_POSTFLIGHT_PASS: 75 authenticated-only policies across 19 HR tables';
END
$postflight$;

COMMIT;
