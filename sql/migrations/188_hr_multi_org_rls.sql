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

-- Keep the table families declared once. Besides making drift checks easier to
-- review, this avoids repeating the same security boundary in four catalog
-- queries and two policy-generation loops.
DO $migration$
DECLARE
  v_employee_table CONSTANT text := 'employees';
  v_dimension_tables CONSTANT text[] := ARRAY['departments', 'positions'];
  v_p12_tables CONSTANT text[] := ARRAY[
    'hr_alerts', 'hr_attendance_monthly', 'hr_payroll_account_mappings',
    'hr_payroll_adjustments', 'hr_payroll_locks', 'hr_policies',
    'hr_settlement_lines', 'hr_settlements'
  ];
  v_p13_tables CONSTANT text[] := ARRAY[
    'employee_salary_structures', 'payroll_runs', 'payroll_details',
    'attendance_records', 'employee_leaves',
    'salary_components', 'leave_types', 'payroll_periods'
  ];
  v_all_tables CONSTANT text[] :=
    ARRAY[v_employee_table] || v_dimension_tables || v_p12_tables || v_p13_tables;
  v_scalar_tables CONSTANT text[] := ARRAY[v_employee_table] || v_dimension_tables;
  v_standard_tables CONSTANT text[] := v_dimension_tables || v_p12_tables;
  v_admin_role CONSTANT text := 'admin';
  v_manager_role CONSTANT text := 'manager';
  v_missing text;
  v_policy_count integer;
  v_scalar_policy_count integer;
  v_limit_policy_count integer;
  v_fallback_policy_count integer;
  v_bad_role_count integer;
  v_legacy_selector_count integer;
  v_unguarded_count integer;
  t text;
  table_position integer;
  is_confidential boolean;
BEGIN
  -- Fail before changing policies if the published cutoff-187 contract drifted.
  SELECT string_agg(table_name, ', ' ORDER BY table_name)
  INTO v_missing
  FROM unnest(v_all_tables) AS required(table_name)
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
    AND tablename = ANY (v_all_tables);

  IF v_policy_count <> 75 THEN
    RAISE EXCEPTION
      'HR_188_POLICY_COUNT_DRIFT: expected 75 cutoff-187 policies, found %',
      v_policy_count;
  END IF;

  SELECT count(*)
  INTO v_scalar_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_scalar_tables)
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
    AND tablename = ANY (v_p12_tables)
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
    AND tablename = ANY (v_p13_tables)
    AND (coalesce(qual, '') || coalesce(with_check, ''))
      LIKE '%wardah_org_id%';

  IF v_fallback_policy_count <> 32 THEN
    RAISE EXCEPTION
      'HR_188_FALLBACK_POLICY_DRIFT: expected 32 fallback policies, found %',
      v_fallback_policy_count;
  END IF;

  -- 1. Legacy employees policies: replace the scalar membership selectors.
  EXECUTE 'DROP POLICY IF EXISTS "Managers can insert employees" ON public.employees';
  EXECUTE format(
    $policy$
      CREATE POLICY "Managers can insert employees" ON public.employees
        FOR INSERT TO authenticated
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.user_organizations AS uo
          WHERE uo.user_id = (SELECT auth.uid())
            AND uo.org_id = employees.org_id
            AND uo.is_active IS TRUE
            AND uo.role IN (%L, %L)
        ))
    $policy$,
    v_admin_role,
    v_manager_role
  );

  EXECUTE 'DROP POLICY IF EXISTS "Managers can update employees" ON public.employees';
  EXECUTE format(
    $policy$
      CREATE POLICY "Managers can update employees" ON public.employees
        FOR UPDATE TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.user_organizations AS uo
          WHERE uo.user_id = (SELECT auth.uid())
            AND uo.org_id = employees.org_id
            AND uo.is_active IS TRUE
            AND uo.role IN (%L, %L)
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.user_organizations AS uo
          WHERE uo.user_id = (SELECT auth.uid())
            AND uo.org_id = employees.org_id
            AND uo.is_active IS TRUE
            AND uo.role IN (%L, %L)
        ))
    $policy$,
    v_admin_role,
    v_manager_role,
    v_admin_role,
    v_manager_role
  );

  EXECUTE 'DROP POLICY IF EXISTS "Users can view org employees" ON public.employees';
  EXECUTE $policy$
    CREATE POLICY "Users can view org employees" ON public.employees
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.user_organizations AS uo
        WHERE uo.user_id = (SELECT auth.uid())
          AND uo.org_id = employees.org_id
          AND uo.is_active IS TRUE
      ))
  $policy$;

  -- 2. Legacy dimensions and P12 tables share the same member-read and
  --    admin/manager-mutation contract, so generate them through one loop.
  FOREACH t IN ARRAY v_standard_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_del_m', t);
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
          USING (EXISTS (
            SELECT 1 FROM public.user_organizations AS uo
            WHERE uo.user_id = (SELECT auth.uid())
              AND uo.org_id = %I.org_id
              AND uo.is_active IS TRUE
              AND uo.role IN (%L, %L)
          ))
      $policy$,
      t || '_del_m', t, t, v_admin_role, v_manager_role
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_ins_m', t);
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.user_organizations AS uo
            WHERE uo.user_id = (SELECT auth.uid())
              AND uo.org_id = %I.org_id
              AND uo.is_active IS TRUE
              AND uo.role IN (%L, %L)
          ))
      $policy$,
      t || '_ins_m', t, t, v_admin_role, v_manager_role
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_sel_m', t);
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
          USING (EXISTS (
            SELECT 1 FROM public.user_organizations AS uo
            WHERE uo.user_id = (SELECT auth.uid())
              AND uo.org_id = %I.org_id
              AND uo.is_active IS TRUE
          ))
      $policy$,
      t || '_sel_m', t, t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_upd_m', t);
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
          USING (EXISTS (
            SELECT 1 FROM public.user_organizations AS uo
            WHERE uo.user_id = (SELECT auth.uid())
              AND uo.org_id = %I.org_id
              AND uo.is_active IS TRUE
              AND uo.role IN (%L, %L)
          ))
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.user_organizations AS uo
            WHERE uo.user_id = (SELECT auth.uid())
              AND uo.org_id = %I.org_id
              AND uo.is_active IS TRUE
              AND uo.role IN (%L, %L)
          ))
      $policy$,
      t || '_upd_m', t, t, v_admin_role, v_manager_role,
      t, v_admin_role, v_manager_role
    );
  END LOOP;

  -- 3. Preserve P13 confidentiality while matching the explicit row org.
  FOR t, table_position IN
    SELECT table_name, position
    FROM unnest(v_p13_tables) WITH ORDINALITY AS tables(table_name, position)
  LOOP
    is_confidential := table_position <= 5;

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
        $policy$
          CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
            USING (public.wardah_is_org_admin(org_id))
        $policy$,
        t || '_wardah_admin_select', t
      );
    ELSE
      EXECUTE format(
        $policy$
          CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
            USING (EXISTS (
              SELECT 1 FROM public.user_organizations AS uo
              WHERE uo.user_id = (SELECT auth.uid())
                AND uo.org_id = %I.org_id
                AND uo.is_active IS TRUE
            ))
        $policy$,
        t || '_wardah_select', t, t
      );
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_wardah_admin_insert', t
    );
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
          WITH CHECK (public.wardah_is_org_admin(org_id))
      $policy$,
      t || '_wardah_admin_insert', t
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_wardah_admin_update', t
    );
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
          USING (public.wardah_is_org_admin(org_id))
          WITH CHECK (public.wardah_is_org_admin(org_id))
      $policy$,
      t || '_wardah_admin_update', t
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_wardah_admin_delete', t
    );
    EXECUTE format(
      $policy$
        CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
          USING (public.wardah_is_org_admin(org_id))
      $policy$,
      t || '_wardah_admin_delete', t
    );
  END LOOP;

  -- 4. Catalog postflight: exact count, role scope, and no legacy selector.
  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_all_tables);

  IF v_policy_count <> 75 THEN
    RAISE EXCEPTION 'HR_188_POST_POLICY_COUNT: expected 75, found %', v_policy_count;
  END IF;

  SELECT count(*)
  INTO v_bad_role_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_all_tables)
    AND roles IS DISTINCT FROM ARRAY['authenticated']::name[];

  IF v_bad_role_count <> 0 THEN
    RAISE EXCEPTION 'HR_188_POST_ROLE_SCOPE: % policies are not authenticated-only',
      v_bad_role_count;
  END IF;

  SELECT count(*)
  INTO v_legacy_selector_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = ANY (v_all_tables)
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
    AND tablename = ANY (v_all_tables)
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
$migration$;

COMMIT;
