-- ===================================================================
-- Migration 99: تأسيس HR الشرعي — RLS + تحصين + سياسات GOSI (P12-A)
-- ===================================================================
-- الحالة المؤكَّدة حيّاً قبل هذا الترحيل: كل جداول HR (من ملفات
-- 15_hr_module + sql/hr/16 + sql/hr/17 التاريخية) موجودة في قاعدة الإنتاج،
-- لكن خارج سجل MANIFEST، وفيها ثغرات:
--   1) ثمانية جداول (salary_components, employee_salary_structures,
--      payroll_periods/runs/details, attendance_records, leave_types,
--      employee_leaves) سياستها الوحيدة تعتمد current_setting('app.current_org_id')
--      وهو متغيّر جلسة لا يضبطه عميل Supabase إطلاقاً ⇒ منع فعلي (deny-all)
--      لكل مستخدمي التطبيق.
--   2) upsert_attendance_day يثق بـ p_org_id القادم من العميل بلا فحص عضوية.
--   3) payroll_runs بلا قيد تفرّد ولا idempotency ⇒ إعادة المعالجة تكرّر.
--   4) hr_policies بلا سياسات GOSI/معدل يومي/إضافي/استحقاق إجازات.
--   5) hr_payroll_account_mappings محصور في 8 أنواع (بلا GOSI/نهاية خدمة).
--
-- المبدأ: إضافي 100% — سياسات جديدة تُضاف (سياسات RLS permissive تُجمع OR
-- فلا حاجة لحذف القديمة)، أعمدة IF NOT EXISTS، واستبدال CHECK بتوسعة قائمته.
-- هذا الملف يفترض وجود الجداول (مؤكَّد حيّاً) ويفشل مبكراً بوضوح إن غابت
-- (بيئة جديدة ⇒ طبِّق 15 + sql/hr/16 + sql/hr/17 أولاً).
-- ===================================================================

-- 0) تأكيد المتطلبات (fail-fast لبيئة جديدة)
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'employees','salary_components','employee_salary_structures',
        'payroll_periods','payroll_runs','payroll_details','attendance_records',
        'leave_types','employee_leaves','hr_policies','hr_attendance_monthly',
        'hr_payroll_locks','hr_payroll_account_mappings','hr_alerts',
        'hr_settlements','hr_settlement_lines','hr_payroll_adjustments']
    LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE EXCEPTION 'HR_PREREQ_MISSING: table % غائب — طبّق 15_hr_module + sql/hr/16 + sql/hr/17 أولاً', t;
        END IF;
    END LOOP;
END $$;

-- ===================================================================
-- 1) سياسات RLS عاملة (wardah_org_id) للجداول الثمانية المقفلة فعلياً
-- ===================================================================
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'salary_components','employee_salary_structures','payroll_periods',
        'payroll_runs','payroll_details','attendance_records',
        'leave_types','employee_leaves']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_wardah_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (org_id = wardah_org_id(NULL))',
            t || '_wardah_select', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_wardah_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (org_id = wardah_org_id(NULL))',
            t || '_wardah_insert', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_wardah_update', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (org_id = wardah_org_id(NULL)) WITH CHECK (org_id = wardah_org_id(NULL))',
            t || '_wardah_update', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_wardah_delete', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (org_id = wardah_org_id(NULL))',
            t || '_wardah_delete', t);
    END LOOP;
END $$;

-- ===================================================================
-- 2) تحصين upsert_attendance_day: اشتقاق org آمن + فحص عضوية (نمط 93/95)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.upsert_attendance_day(
    p_org_id      UUID,
    p_employee_id UUID,
    p_year        SMALLINT,
    p_month       SMALLINT,
    p_day         TEXT,
    p_payload     JSONB
)
RETURNS hr_attendance_monthly
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org UUID;
    v_row hr_attendance_monthly;
BEGIN
    -- اشتقاق آمن: القيمة الصريحة تُقبل فقط إن كان المستخدم عضواً فيها
    v_org := wardah_org_id(p_org_id);
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'ORG_NOT_RESOLVED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = auth.uid() AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;

    -- الموظف يجب أن يتبع نفس المؤسسة
    IF NOT EXISTS (
        SELECT 1 FROM employees WHERE id = p_employee_id AND org_id = v_org
    ) THEN
        RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
    END IF;

    -- شهر مقفل ⇒ لا تعديل حضور
    IF EXISTS (
        SELECT 1 FROM hr_payroll_locks
        WHERE org_id = v_org AND year = p_year AND month = p_month
          AND status = 'locked'
    ) THEN
        RAISE EXCEPTION 'PAYROLL_MONTH_LOCKED';
    END IF;

    INSERT INTO hr_attendance_monthly (org_id, employee_id, year, month, days, updated_by)
    VALUES (v_org, p_employee_id, p_year, p_month,
            jsonb_build_object(p_day, p_payload), auth.uid())
    ON CONFLICT (org_id, employee_id, year, month) DO UPDATE SET
        days       = hr_attendance_monthly.days || jsonb_build_object(p_day, p_payload),
        updated_by = auth.uid(),
        updated_at = NOW()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.upsert_attendance_day(UUID,UUID,SMALLINT,SMALLINT,TEXT,JSONB) IS
'تحديث يوم حضور ذرّياً (Migration 99): اشتقاق org عبر wardah_org_id + فحص عضوية + رفض الموظف الأجنبي عن المؤسسة + رفض الشهر المقفل. كان يثق بـ p_org_id مباشرة.';

-- ===================================================================
-- 3) سلامة المسير: تفرّد + idempotency على payroll_runs (الجدول فارغ حيّاً)
-- ===================================================================
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS idempotency_key   TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS request_hash      TEXT;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS journal_entry_id  UUID REFERENCES gl_entries(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_org_period
    ON payroll_runs (org_id, period_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_idem
    ON payroll_runs (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ===================================================================
-- 4) توسيع أنواع حسابات خرائط الرواتب (قرار المالك: الحسابات من الضبط)
-- ===================================================================
ALTER TABLE hr_payroll_account_mappings
    DROP CONSTRAINT IF EXISTS hr_payroll_account_mappings_account_type_check;
ALTER TABLE hr_payroll_account_mappings
    ADD CONSTRAINT hr_payroll_account_mappings_account_type_check CHECK (
        account_type = ANY (ARRAY[
            'basic_salary','housing_allowance','transport_allowance','other_allowance',
            'deductions','loans','payable','net_payable',
            'overtime','absence_recovery',
            'gosi_employee','gosi_employer_expense','gosi_payable',
            'eos_expense','eos_payable'
        ])
    );

-- ===================================================================
-- 5) سياسات GOSI/الرواتب/استحقاق الإجازات في hr_policies
--    (افتراضات قابلة للتعديل من شاشة ضبط الرواتب — لا أرقام مُصمَّتة بالكود)
-- ===================================================================
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS gosi_employee_pct            NUMERIC(5,2) NOT NULL DEFAULT 9.75;
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS gosi_employer_pct            NUMERIC(5,2) NOT NULL DEFAULT 11.75;
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS gosi_base_cap                NUMERIC(12,2) NOT NULL DEFAULT 45000;
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS gosi_applies_to              TEXT NOT NULL DEFAULT 'saudi_only';
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS daily_rate_basis             TEXT NOT NULL DEFAULT 'working_days';
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS overtime_base                TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS annual_leave_days_before_5y  INTEGER NOT NULL DEFAULT 21;
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS annual_leave_days_after_5y   INTEGER NOT NULL DEFAULT 30;
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS include_weekends_in_accrual  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE hr_policies ADD COLUMN IF NOT EXISTS exclude_unpaid_from_accrual  BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_policies_gosi_applies_to_check') THEN
        ALTER TABLE hr_policies ADD CONSTRAINT hr_policies_gosi_applies_to_check
            CHECK (gosi_applies_to IN ('saudi_only','all','none'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_policies_daily_rate_basis_check') THEN
        ALTER TABLE hr_policies ADD CONSTRAINT hr_policies_daily_rate_basis_check
            CHECK (daily_rate_basis IN ('working_days','thirty'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_policies_overtime_base_check') THEN
        ALTER TABLE hr_policies ADD CONSTRAINT hr_policies_overtime_base_check
            CHECK (overtime_base IN ('basic','basic_housing'));
    END IF;
END $$;

-- ===================================================================
-- 6) أعمدة الموظف اللازمة لـ GOSI والتنبيهات
-- ===================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_saudi          BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end_date DATE;

-- استنتاج is_saudi من الجنسية حيث NULL (idempotent — لا يمسّ قيماً مضبوطة)
UPDATE employees
SET is_saudi = (nationality ILIKE '%saudi%' OR nationality ILIKE '%سعود%')
WHERE is_saudi IS NULL AND nationality IS NOT NULL;
