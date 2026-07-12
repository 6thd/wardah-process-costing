-- ===================================================================
-- Migration 101: RBAC للرواتب + سرية القراءة + تحقق اتساق الحمولة (P13-A)
-- ===================================================================
-- يغلق ملاحظات مراجعة كودكس على P12 (حتى 0a77670):
--
-- P0-1: Migration 97 (سطر 150) أعادت GRANT EXECUTE على wardah_apply_stock_incoming
--   إلى authenticated فعكست إصلاح 95 (P0-2) بصمت ⇒ يُسحب هنا مجدداً. لا تعديل
--   على ملف 97 — البيئات الجديدة تشغّل 101 بعده فتُغلق تلقائياً.
--
-- P0-2: rpc_post_payroll_run/rpc_post_settlement كانتا بعضوية فقط ⇒ أي عضو
--   يعتمد المسير/التسوية ويقفل الشهر ويُنهي موظفاً. الآن بوابة إدارية
--   (wardah_is_org_admin — نمط 96 حرفياً) **قبل** مسار idempotent replay حتى لا
--   يتسرب معرف القيد/الحالة لغير المدير عبر مفتاح معروف.
--
-- P0-3: الدالة كانت تثق بأرقام العميل (totals/lines/buckets) ولا تفحص إلا توازن
--   القيد. الآن (عقد payload_version=2): كل سطر يحمل bucket من قائمة مغلقة،
--   ومجاميع الـbuckets تُشتق من السطور وتُطابق totals، والإجماليات تُطابق مجموع
--   السطور، وكل موظف يتبع المؤسسة — فلا يمكن إرسال قيد متوازن منفصل عن التفاصيل
--   ولا إعادة توزيع bucket دون أن يظهر في القسائم. (إعادة الحساب الخادمي الكامل
--   مرحلة لاحقة موثقة.)
--
-- P0-سرية: سياسات 99 كانت تمنح كل عضو SELECT/CRUD على جداول الرواتب ⇒ أي عضو
--   يقرأ رواتب الجميع. الآن: جداول المبالغ الفردية (employee_salary_structures،
--   payroll_runs، payroll_details، attendance_records، employee_leaves) قراءةً
--   وكتابةً للإدارة فقط؛ جداول التعريفات (salary_components، leave_types،
--   payroll_periods) قراءة للأعضاء وكتابة للإدارة. self-service للموظف يتطلب
--   ربط employees↔auth.uid (غير موجود) — مرحلة لاحقة موثقة.
--   ملاحظة: تُسقَط **كل** السياسات القائمة على هذه الجداول من pg_policies
--   (سياسات permissive تتحد بـOR فتغلب أي تقييد) ثم يعاد بناؤها — في معاملة
--   الـmigration نفسها فلا نافذة انكشاف.
--
-- P1: org_settings كانت كتابة لكل عضو (98) ⇒ الكتابة للإدارة فقط.
-- P1: payroll_details بلا تحقق موظف↔مؤسسة ⇒ UNIQUE(id,org_id) على employees +
--   FK مركب NOT VALID (يحمي الكتابات الجديدة فوراً) مع تقرير صريح بعدد الصفوف
--   التاريخية المخالفة — البند لا يُعد مغلقاً حتى convalidated=true.
--
-- لا FORCE ROW LEVEL SECURITY: دوال SECURITY DEFINER (rpc_post_payroll_run
-- وأخواتها) تكتب بصلاحية المالك وتُفحص عضويتها داخلياً؛ FORCE كان سيكسرها.
-- ===================================================================

-- 0) المتطلبات (fail-fast لبيئة جديدة)
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'employees','salary_components','employee_salary_structures',
        'payroll_periods','payroll_runs','payroll_details','attendance_records',
        'leave_types','employee_leaves','hr_payroll_locks',
        'hr_payroll_account_mappings','hr_settlements','org_settings',
        'user_organizations']
    LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE EXCEPTION 'PREREQ_MISSING: table % غائب — طبّق 15/98/99/100 أولاً', t;
        END IF;
    END LOOP;
    IF to_regprocedure('public.rpc_post_payroll_run(jsonb)') IS NULL THEN
        RAISE EXCEPTION 'PREREQ_MISSING: rpc_post_payroll_run — طبّق Migration 100 أولاً';
    END IF;
END $$;

-- ===================================================================
-- 1) wardah_is_org_admin — بوابة إدارية موحدة (نمط Migration 96 حرفياً)
-- ===================================================================
-- SECURITY DEFINER لتجاوز RLS على user_organizations من داخل سياسات RLS نفسها؛
-- search_path مثبّت؛ الدالة الأقدم is_org_admin (41) لا تشمل role IN
-- ('admin','owner') فلا تطابق بوابة 96 المعتمدة.
CREATE OR REPLACE FUNCTION public.wardah_is_org_admin(p_org UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_organizations
        WHERE user_id = auth.uid()
          AND org_id = p_org
          AND (COALESCE(is_org_admin, FALSE) OR role IN ('admin', 'owner'))
    );
$$;

COMMENT ON FUNCTION public.wardah_is_org_admin(UUID) IS
'بوابة إدارية موحدة (Migration 101): is_org_admin أو role admin/owner — نمط بوابة التكلفة الصفرية في 96. تُستخدم في rpc_post_payroll_run/rpc_post_settlement وسياسات RLS للرواتب وorg_settings.';

-- PostgreSQL يمنح EXECUTE للدوال الجديدة إلى PUBLIC افتراضياً ⇒ سحب صريح،
-- وauthenticated يحتاجها لأن سياسات RLS تقيّمها في سياق المستخدم المستعلم.
REVOKE ALL ON FUNCTION public.wardah_is_org_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wardah_is_org_admin(UUID) TO authenticated;

-- ===================================================================
-- 2) P0-1: إعادة إغلاق ثغرة wardah_apply_stock_incoming (عكستها 97)
-- ===================================================================
REVOKE ALL ON FUNCTION public.wardah_apply_stock_incoming(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wardah_apply_stock_incoming(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE
) FROM authenticated;

COMMENT ON FUNCTION public.wardah_apply_stock_incoming(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID, TEXT, DATE) IS
'داخلية فقط (95 ثم 101 بعد أن أعادت 97 فتحها): يستدعيها rpc_post_goods_receipt (SECURITY DEFINER يفحص العضوية). لا GRANT لـauthenticated — أي migration لاحقة تعيد منحها تُعيد ثغرة P0.';

-- ===================================================================
-- 3) سلامة موظف↔مؤسسة: UNIQUE(id, org_id) + FK مركب على payroll_details
-- ===================================================================
-- id هو PK ⇒ الفهرس الفريد المركب لا يفشل على أي بيانات.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_id_org ON employees (id, org_id);

-- bucket لكل سطر قسيمة (عقد v2) — أثر تدقيقي يربط تفاصيل القسائم بتوزيع القيد.
ALTER TABLE payroll_details ADD COLUMN IF NOT EXISTS bucket TEXT;

DO $$
DECLARE v_bad BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payroll_details_employee_org'
          AND conrelid = 'payroll_details'::regclass
    ) THEN
        -- NOT VALID: يفرض القيد على كل كتابة جديدة فوراً دون رهن النشر ببيانات قديمة
        ALTER TABLE payroll_details
            ADD CONSTRAINT fk_payroll_details_employee_org
            FOREIGN KEY (employee_id, org_id)
            REFERENCES employees (id, org_id) NOT VALID;
    END IF;

    -- تقرير صريح بالبيانات التاريخية المخالفة (لا ابتلاع صامت — بند متابعة)
    SELECT COUNT(*) INTO v_bad
    FROM payroll_details pd
    WHERE NOT EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = pd.employee_id AND e.org_id = pd.org_id);
    IF v_bad > 0 THEN
        RAISE WARNING 'AUDIT[101]: payroll_details فيها % صف تاريخي بموظف لا يتبع org — نظّفها ثم ALTER TABLE payroll_details VALIDATE CONSTRAINT fk_payroll_details_employee_org', v_bad;
    END IF;

    BEGIN
        ALTER TABLE payroll_details VALIDATE CONSTRAINT fk_payroll_details_employee_org;
        RAISE NOTICE 'AUDIT[101]: fk_payroll_details_employee_org convalidated=true ✓';
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'AUDIT[101]: VALIDATE CONSTRAINT فشل (%) — القيد يحمي الكتابات الجديدة فقط حتى تنظيف البيانات', SQLERRM;
    END;
END $$;

-- ===================================================================
-- 4) rpc_post_payroll_run — بوابة إدارية + عقد v2 (اتساق كامل من السطور)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.rpc_post_payroll_run(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_year       INT;
    v_month      INT;
    v_idem       TEXT;
    v_hash       TEXT;
    v_period_id  UUID;
    v_run_id     UUID;
    v_existing   payroll_runs%ROWTYPE;
    v_totals     JSONB;
    v_lines      JSONB;
    v_entry_date DATE;
    v_gl_lines   JSONB := '[]'::JSONB;
    v_line_no    INT := 0;
    v_debits     NUMERIC := 0;
    v_credits    NUMERIC := 0;
    v_journal    JSONB;
    v_amount     NUMERIC;
    v_acct       UUID;
    v_bucket     TEXT;
    -- عقد v2
    v_total_gross NUMERIC;
    v_total_ded   NUMERIC;
    v_total_net   NUMERIC;
    v_sum_earn    NUMERIC;
    v_sum_ded     NUMERIC;
    v_bad         BIGINT;
    v_expected    NUMERIC;
    c_tol CONSTANT NUMERIC := 0.011;  -- يمتص أخطاء float للتسلسل JSON
    -- ترتيب حتمي: المدينون ثم الدائنون
    c_debit_buckets  TEXT[] := ARRAY['basic_salary','housing_allowance',
        'transport_allowance','other_allowance','overtime','gosi_employer_expense'];
    c_credit_buckets TEXT[] := ARRAY['gosi_payable','deductions','loans',
        'absence_recovery','payable'];
    -- الـbuckets المسموحة على مستوى السطر (قائمة مغلقة — عقد v2)
    c_earning_line_buckets  TEXT[] := ARRAY['basic_salary','housing_allowance',
        'transport_allowance','other_allowance','overtime'];
    c_deduction_line_buckets TEXT[] := ARRAY['deductions','loans',
        'absence_recovery','gosi_employee'];
BEGIN
    -- ===== 1) الهوية والصلاحية — قبل أي مسار replay (لا تسريب لغير المدير) =====
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
    IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_organizations
                   WHERE user_id = auth.uid() AND org_id = v_org) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;
    IF NOT wardah_is_org_admin(v_org) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED_PAYROLL_POST: اعتماد المسير يتطلب صلاحية مدير المؤسسة';
    END IF;

    -- ===== 2) عقد الحمولة v2 =====
    IF COALESCE((p_payload->>'payload_version')::int, 1) <> 2 THEN
        RAISE EXCEPTION 'PAYLOAD_VERSION_UNSUPPORTED: الخادم يتطلب payload_version=2 — حدّث الواجهة';
    END IF;

    v_year  := (p_payload->>'year')::int;
    v_month := (p_payload->>'month')::int;
    v_idem  := NULLIF(p_payload->>'idempotency_key','');
    IF v_year IS NULL OR v_month IS NULL OR v_idem IS NULL THEN
        RAISE EXCEPTION 'INVALID_PAYLOAD: year/month/idempotency_key إلزامية';
    END IF;
    v_totals := COALESCE(p_payload->'totals', '{}'::jsonb);
    v_lines  := COALESCE(p_payload->'lines', '[]'::jsonb);
    v_total_gross := COALESCE((p_payload->>'total_gross')::numeric, 0);
    v_total_ded   := COALESCE((p_payload->>'total_deductions')::numeric, 0);
    v_total_net   := COALESCE((p_payload->>'total_net')::numeric, 0);
    v_entry_date := COALESCE(NULLIF(p_payload->>'entry_date','')::date,
                             make_date(v_year, v_month, 1) + INTERVAL '1 month' - INTERVAL '1 day');

    -- 2أ) صحة السطور: حقول إلزامية (is_deduction صريح لا default صامت)،
    --     مبلغ موجب (>0)، bucket من القائمة المغلقة المطابقة لاتجاه السطر.
    --     تكرار البند لنفس الموظف مسموح عمداً (تعديلات ADJ_* المتعددة مشروعة).
    BEGIN
        SELECT COUNT(*),
               COUNT(*) FILTER (WHERE
                   NULLIF(l->>'employee_id','')    IS NULL
                OR NULLIF(l->>'component_code','') IS NULL
                OR NOT (l ? 'is_deduction')
                OR (l->>'amount')::numeric IS NULL
                OR (l->>'amount')::numeric <= 0
                OR NOT (
                     CASE WHEN (l->>'is_deduction')::boolean
                          THEN (l->>'bucket') = ANY (c_deduction_line_buckets)
                          ELSE (l->>'bucket') = ANY (c_earning_line_buckets)
                     END))
        INTO v_line_no, v_bad
        FROM jsonb_array_elements(v_lines) l;
    EXCEPTION WHEN invalid_text_representation OR datatype_mismatch THEN
        RAISE EXCEPTION 'INVALID_LINE: قيمة غير قابلة للتحويل (uuid/numeric/boolean)';
    END;
    IF v_line_no = 0 THEN
        RAISE EXCEPTION 'EMPTY_PAYROLL: لا سطور للترحيل';
    END IF;
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'INVALID_LINE: % سطر بمبلغ غير موجب أو حقول ناقصة أو bucket خارج القائمة', v_bad;
    END IF;
    v_line_no := 0;

    -- 2ب) كل موظف في السطور يتبع المؤسسة (نمط upsert_attendance_day في 99)
    SELECT COUNT(*) INTO v_bad
    FROM (SELECT DISTINCT (l->>'employee_id')::uuid AS emp_id
          FROM jsonb_array_elements(v_lines) l) s
    LEFT JOIN employees e ON e.id = s.emp_id AND e.org_id = v_org
    WHERE e.id IS NULL;
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'EMPLOYEE_ORG_MISMATCH: % موظف في السطور لا يتبع المؤسسة', v_bad;
    END IF;

    -- 2ج) الإجماليات = مجموع السطور (لا ثقة بأرقام حرة من العميل)
    SELECT COALESCE(SUM((l->>'amount')::numeric) FILTER (WHERE NOT (l->>'is_deduction')::boolean), 0),
           COALESCE(SUM((l->>'amount')::numeric) FILTER (WHERE (l->>'is_deduction')::boolean), 0)
    INTO v_sum_earn, v_sum_ded
    FROM jsonb_array_elements(v_lines) l;
    IF abs(v_sum_earn - v_total_gross) > c_tol
       OR abs(v_sum_ded - v_total_ded) > c_tol
       OR abs(v_total_net - (v_total_gross - v_total_ded)) > c_tol THEN
        RAISE EXCEPTION 'TOTALS_MISMATCH: سطور(% / %) ≠ إجماليات(% / % / %)',
            v_sum_earn, v_sum_ded, v_total_gross, v_total_ded, v_total_net;
    END IF;

    -- 2د) توزيع القيد يُشتق من السطور: كل bucket استحقاق/استقطاع = مجموع سطوره،
    --     فلا يمكن نقل مبلغ بين buckets (مثلاً سكن→أخرى) دون أن يظهر في القسائم.
    FOREACH v_bucket IN ARRAY c_earning_line_buckets LOOP
        SELECT COALESCE(SUM((l->>'amount')::numeric), 0) INTO v_expected
        FROM jsonb_array_elements(v_lines) l
        WHERE l->>'bucket' = v_bucket AND NOT (l->>'is_deduction')::boolean;
        IF abs(v_expected - COALESCE((v_totals->>v_bucket)::numeric, 0)) > c_tol THEN
            RAISE EXCEPTION 'BUCKETS_MISMATCH: % — سطور % ≠ قيد %',
                v_bucket, v_expected, COALESCE((v_totals->>v_bucket)::numeric, 0);
        END IF;
    END LOOP;
    FOREACH v_bucket IN ARRAY ARRAY['deductions','loans','absence_recovery'] LOOP
        SELECT COALESCE(SUM((l->>'amount')::numeric), 0) INTO v_expected
        FROM jsonb_array_elements(v_lines) l
        WHERE l->>'bucket' = v_bucket AND (l->>'is_deduction')::boolean;
        IF abs(v_expected - COALESCE((v_totals->>v_bucket)::numeric, 0)) > c_tol THEN
            RAISE EXCEPTION 'BUCKETS_MISMATCH: % — سطور % ≠ قيد %',
                v_bucket, v_expected, COALESCE((v_totals->>v_bucket)::numeric, 0);
        END IF;
    END LOOP;
    -- التأمينات: الدائن gosi_payable = سطور حصة الموظف + مصروف صاحب العمل (بلا سطر)
    SELECT COALESCE(SUM((l->>'amount')::numeric), 0) INTO v_expected
    FROM jsonb_array_elements(v_lines) l
    WHERE l->>'bucket' = 'gosi_employee' AND (l->>'is_deduction')::boolean;
    IF COALESCE((v_totals->>'gosi_employer_expense')::numeric, 0) < 0
       OR COALESCE((v_totals->>'gosi_payable')::numeric, 0)
          < COALESCE((v_totals->>'gosi_employer_expense')::numeric, 0)
       OR abs(v_expected + COALESCE((v_totals->>'gosi_employer_expense')::numeric, 0)
              - COALESCE((v_totals->>'gosi_payable')::numeric, 0)) > c_tol THEN
        RAISE EXCEPTION 'BUCKETS_MISMATCH: gosi_payable ≠ سطور حصة الموظف (%) + gosi_employer_expense', v_expected;
    END IF;
    -- الصافي الدائن = صافي الإجماليات المتحقق منها
    IF abs(COALESCE((v_totals->>'payable')::numeric, 0) - v_total_net) > c_tol THEN
        RAISE EXCEPTION 'BUCKETS_MISMATCH: payable (%) ≠ total_net (%)',
            COALESCE((v_totals->>'payable')::numeric, 0), v_total_net;
    END IF;

    -- ===== 3) بصمة الحمولة + قفل + idempotency (بعد الصلاحية والتحقق) =====
    v_hash := md5((p_payload - 'idempotency_key')::text);
    PERFORM pg_advisory_xact_lock(hashtext(v_org::text || ':payroll:' || v_year || '-' || v_month));

    SELECT * INTO v_existing FROM payroll_runs
    WHERE org_id = v_org AND idempotency_key = v_idem;
    IF FOUND THEN
        IF v_existing.request_hash IS DISTINCT FROM v_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'replayed', true,
            'payroll_run_id', v_existing.id,
            'journal_entry_id', v_existing.journal_entry_id,
            'status', v_existing.status);
    END IF;

    IF EXISTS (SELECT 1 FROM hr_payroll_locks
               WHERE org_id = v_org AND year = v_year AND month = v_month
                 AND status = 'locked') THEN
        RAISE EXCEPTION 'PAYROLL_MONTH_LOCKED';
    END IF;

    -- ===== 4) الفترة والرأس والسطور (كما في 100) =====
    SELECT id INTO v_period_id FROM payroll_periods
    WHERE org_id = v_org AND period_code = format('%s-%s', v_year, lpad(v_month::text,2,'0'));
    IF v_period_id IS NULL THEN
        INSERT INTO payroll_periods (org_id, period_code, period_name, period_type,
                                     start_date, end_date, status)
        VALUES (v_org, format('%s-%s', v_year, lpad(v_month::text,2,'0')),
                format('مسير %s-%s', v_year, lpad(v_month::text,2,'0')), 'monthly',
                make_date(v_year, v_month, 1), v_entry_date, 'open')
        RETURNING id INTO v_period_id;
    END IF;

    IF EXISTS (SELECT 1 FROM payroll_runs WHERE org_id = v_org AND period_id = v_period_id) THEN
        RAISE EXCEPTION 'PAYROLL_RUN_EXISTS: يوجد مسير لهذه الفترة';
    END IF;

    INSERT INTO payroll_runs (org_id, period_id, run_date, status,
                              total_gross, total_deductions, total_net,
                              idempotency_key, request_hash)
    VALUES (v_org, v_period_id, CURRENT_DATE, 'calculated',
            v_total_gross, v_total_ded, v_total_net, v_idem, v_hash)
    RETURNING id INTO v_run_id;

    INSERT INTO payroll_details (org_id, payroll_run_id, employee_id,
                                 component_id, component_code, component_label,
                                 is_deduction, bucket, amount, is_processed, processed_at)
    SELECT v_org, v_run_id,
           (l->>'employee_id')::uuid,
           NULLIF(l->>'component_id','')::uuid,
           l->>'component_code',
           l->>'component_label',
           (l->>'is_deduction')::boolean,
           l->>'bucket',
           (l->>'amount')::numeric,
           true, NOW()
    FROM jsonb_array_elements(v_lines) l;

    -- ===== 5) بناء القيد من totals (المتحقق منها الآن سطراً بسطر) =====
    FOREACH v_bucket IN ARRAY c_debit_buckets LOOP
        v_amount := ROUND(COALESCE((v_totals->>v_bucket)::numeric, 0), 2);
        CONTINUE WHEN v_amount = 0;
        SELECT gl_account_id INTO v_acct FROM hr_payroll_account_mappings
        WHERE org_id = v_org AND account_type = v_bucket;
        IF v_acct IS NULL THEN
            RAISE EXCEPTION 'MAPPING_MISSING: % — اضبط الحساب من ضبط الرواتب', v_bucket;
        END IF;
        v_line_no := v_line_no + 1;
        v_debits := v_debits + v_amount;
        v_gl_lines := v_gl_lines || jsonb_build_array(jsonb_build_object(
            'line_number', v_line_no, 'account_id', v_acct,
            'debit', v_amount, 'credit', 0,
            'description', 'مسير رواتب ' || v_year || '-' || lpad(v_month::text,2,'0') || ' — ' || v_bucket));
    END LOOP;

    FOREACH v_bucket IN ARRAY c_credit_buckets LOOP
        v_amount := ROUND(COALESCE((v_totals->>v_bucket)::numeric, 0), 2);
        CONTINUE WHEN v_amount = 0;
        SELECT gl_account_id INTO v_acct FROM hr_payroll_account_mappings
        WHERE org_id = v_org AND account_type = v_bucket;
        IF v_acct IS NULL THEN
            RAISE EXCEPTION 'MAPPING_MISSING: % — اضبط الحساب من ضبط الرواتب', v_bucket;
        END IF;
        v_line_no := v_line_no + 1;
        v_credits := v_credits + v_amount;
        v_gl_lines := v_gl_lines || jsonb_build_array(jsonb_build_object(
            'line_number', v_line_no, 'account_id', v_acct,
            'debit', 0, 'credit', v_amount,
            'description', 'مسير رواتب ' || v_year || '-' || lpad(v_month::text,2,'0') || ' — ' || v_bucket));
    END LOOP;

    IF v_line_no < 2 THEN
        RAISE EXCEPTION 'EMPTY_PAYROLL: لا مبالغ للترحيل';
    END IF;
    IF ROUND(v_debits,2) <> ROUND(v_credits,2) THEN
        RAISE EXCEPTION 'UNBALANCED_PAYROLL: مدين % ≠ دائن %', v_debits, v_credits;
    END IF;

    v_journal := rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_org::text,
        'entry_date', v_entry_date::text,
        'description', 'Payroll run ' || v_year || '-' || lpad(v_month::text,2,'0'),
        'description_ar', 'مسير رواتب ' || v_year || '-' || lpad(v_month::text,2,'0'),
        'reference_type', 'PAYROLL',
        'reference_number', v_year || '-' || lpad(v_month::text,2,'0'),
        'idempotency_key', v_idem || ':gl',
        'auto_post', true,
        'lines', v_gl_lines));

    UPDATE payroll_runs
    SET status = 'approved', journal_entry_id = (v_journal->>'entry_id')::uuid,
        updated_at = NOW()
    WHERE id = v_run_id;

    INSERT INTO hr_payroll_locks (org_id, year, month, status, locked_at, locked_by, journal_entry_id)
    VALUES (v_org, v_year, v_month, 'locked', NOW(), auth.uid(), (v_journal->>'entry_id')::uuid)
    ON CONFLICT (org_id, year, month) DO UPDATE SET
        status = 'locked', locked_at = NOW(), locked_by = auth.uid(),
        journal_entry_id = (v_journal->>'entry_id')::uuid;

    RETURN jsonb_build_object(
        'success', true, 'replayed', false,
        'payroll_run_id', v_run_id,
        'journal_entry_id', v_journal->>'entry_id',
        'entry_number', v_journal->>'entry_number',
        'total_debit', v_debits, 'total_credit', v_credits,
        'status', 'approved');
END;
$$;

COMMENT ON FUNCTION public.rpc_post_payroll_run(JSONB) IS
'اعتماد مسير ذرّي (100) + تحصين 101: بوابة إدارية قبل الـreplay + عقد payload_version=2 — الإجماليات وتوزيع القيد يُشتقان من السطور ويُتحقق منهما (TOTALS_MISMATCH/BUCKETS_MISMATCH/INVALID_LINE/EMPLOYEE_ORG_MISMATCH). إعادة الحساب الخادمي الكامل مرحلة لاحقة.';

GRANT EXECUTE ON FUNCTION public.rpc_post_payroll_run(JSONB) TO authenticated;

-- ===================================================================
-- 5) rpc_post_settlement — بوابة إدارية قبل الـreplay (بقية 100 كما هي)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.rpc_post_settlement(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_idem       TEXT;
    v_settlement hr_settlements%ROWTYPE;
    v_amount     NUMERIC;
    v_exp_acct   UUID;
    v_pay_acct   UUID;
    v_journal    JSONB;
    v_entry_date DATE;
BEGIN
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
    IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_organizations
                   WHERE user_id = auth.uid() AND org_id = v_org) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;
    -- بوابة إدارية قبل أي replay: غير المدير لا يحصل حتى على معرف القيد بمفتاح معروف
    IF NOT wardah_is_org_admin(v_org) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED_SETTLEMENT_POST: اعتماد التسوية يتطلب صلاحية مدير المؤسسة';
    END IF;

    v_idem := NULLIF(p_payload->>'idempotency_key','');
    IF v_idem IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: idempotency_key إلزامي'; END IF;

    SELECT * INTO v_settlement FROM hr_settlements
    WHERE id = (p_payload->>'settlement_id')::uuid AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;

    -- replay بنفس المفتاح على تسوية مرحَّلة ⇒ إعادة النتيجة
    IF v_settlement.idempotency_key = v_idem AND v_settlement.journal_entry_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'replayed', true,
            'settlement_id', v_settlement.id,
            'journal_entry_id', v_settlement.journal_entry_id,
            'status', v_settlement.status);
    END IF;
    IF v_settlement.status NOT IN ('draft','review') THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_POSTABLE: الحالة %', v_settlement.status;
    END IF;

    v_amount := ROUND(COALESCE(v_settlement.payable_amount, v_settlement.calculated_amount, 0), 2);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'SETTLEMENT_ZERO_AMOUNT'; END IF;
    v_entry_date := COALESCE(NULLIF(p_payload->>'entry_date','')::date, CURRENT_DATE);

    SELECT gl_account_id INTO v_exp_acct FROM hr_payroll_account_mappings
    WHERE org_id = v_org AND account_type = 'eos_expense';
    SELECT gl_account_id INTO v_pay_acct FROM hr_payroll_account_mappings
    WHERE org_id = v_org AND account_type = 'eos_payable';
    IF v_exp_acct IS NULL OR v_pay_acct IS NULL THEN
        RAISE EXCEPTION 'MAPPING_MISSING: eos_expense/eos_payable — اضبطهما من ضبط الرواتب';
    END IF;

    v_journal := rpc_create_journal_entry(jsonb_build_object(
        'org_id', v_org::text,
        'entry_date', v_entry_date::text,
        'description', 'End of service settlement',
        'description_ar', 'تسوية نهاية خدمة',
        'reference_type', 'SETTLEMENT',
        'reference_number', v_settlement.id::text,
        'idempotency_key', v_idem || ':gl',
        'auto_post', true,
        'lines', jsonb_build_array(
            jsonb_build_object('line_number', 1, 'account_id', v_exp_acct,
                               'debit', v_amount, 'credit', 0,
                               'description', 'مكافأة نهاية خدمة'),
            jsonb_build_object('line_number', 2, 'account_id', v_pay_acct,
                               'debit', 0, 'credit', v_amount,
                               'description', 'مستحق نهاية خدمة'))));

    UPDATE hr_settlements
    SET status = 'approved', approved_by = auth.uid(), approved_at = NOW(),
        journal_entry_id = (v_journal->>'entry_id')::uuid,
        idempotency_key = v_idem, updated_at = NOW()
    WHERE id = v_settlement.id;

    -- نهاية الخدمة تقفل الموظف (حراس إضافيون + مرحلة review في Migration 102)
    IF v_settlement.settlement_type = 'end_of_service' THEN
        UPDATE employees
        SET status = 'terminated',
            termination_date = COALESCE(v_settlement.service_end, CURRENT_DATE),
            updated_at = NOW()
        WHERE id = v_settlement.employee_id AND org_id = v_org;
    END IF;

    RETURN jsonb_build_object('success', true, 'replayed', false,
        'settlement_id', v_settlement.id,
        'journal_entry_id', v_journal->>'entry_id',
        'entry_number', v_journal->>'entry_number',
        'amount', v_amount, 'status', 'approved');
END;
$$;

COMMENT ON FUNCTION public.rpc_post_settlement(JSONB) IS
'اعتماد وترحيل تسوية ذرّياً (100) + بوابة إدارية قبل الـreplay (101). snapshot/hash المراجعة وحراس الإنهاء في Migration 102.';

GRANT EXECUTE ON FUNCTION public.rpc_post_settlement(JSONB) TO authenticated;

-- ===================================================================
-- 6) سرية الرواتب + كتابة إدارية: إعادة بناء RLS للجداول الثمانية
-- ===================================================================
-- تُسقَط كل السياسات القائمة (من pg_policies — يعالج الانجراف المنشور وسياسات
-- 99 المتساهلة معاً) ثم يعاد البناء داخل معاملة الـmigration نفسها.
DO $$
DECLARE
    t TEXT;
    pol RECORD;
    -- جداول مبالغ فردية حساسة ⇒ SELECT للإدارة فقط (self-service مرحلة لاحقة)
    c_confidential TEXT[] := ARRAY['employee_salary_structures','payroll_runs',
        'payroll_details','attendance_records','employee_leaves'];
    -- جداول تعريفات بلا مبالغ فردية ⇒ SELECT للأعضاء
    c_definitions  TEXT[] := ARRAY['salary_components','leave_types','payroll_periods'];
BEGIN
    FOREACH t IN ARRAY c_confidential || c_definitions LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        FOR pol IN SELECT policyname FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY %I ON %I', pol.policyname, t);
        END LOOP;

        IF t = ANY (c_confidential) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I FOR SELECT TO authenticated
                 USING (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id))',
                t || '_wardah_admin_select', t);
        ELSE
            EXECUTE format(
                'CREATE POLICY %I ON %I FOR SELECT TO authenticated
                 USING (org_id = wardah_org_id(NULL))',
                t || '_wardah_select', t);
        END IF;

        EXECUTE format(
            'CREATE POLICY %I ON %I FOR INSERT TO authenticated
             WITH CHECK (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id))',
            t || '_wardah_admin_insert', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR UPDATE TO authenticated
             USING (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id))
             WITH CHECK (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id))',
            t || '_wardah_admin_update', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR DELETE TO authenticated
             USING (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id))',
            t || '_wardah_admin_delete', t);
    END LOOP;
END $$;

-- ===================================================================
-- 7) org_settings: القراءة للأعضاء، الكتابة للإدارة (كانت لكل عضو في 98)
-- ===================================================================
DROP POLICY IF EXISTS org_settings_org_insert ON org_settings;
CREATE POLICY org_settings_org_insert ON org_settings
    FOR INSERT TO authenticated
    WITH CHECK (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id));

DROP POLICY IF EXISTS org_settings_org_update ON org_settings;
CREATE POLICY org_settings_org_update ON org_settings
    FOR UPDATE TO authenticated
    USING (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id))
    WITH CHECK (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id));

DROP POLICY IF EXISTS org_settings_org_delete ON org_settings;
CREATE POLICY org_settings_org_delete ON org_settings
    FOR DELETE TO authenticated
    USING (org_id = wardah_org_id(NULL) AND wardah_is_org_admin(org_id));

-- ===================================================================
-- 8) تحقق ختامي
-- ===================================================================
DO $$
DECLARE v_cnt INT;
BEGIN
    IF has_function_privilege('authenticated',
        'public.wardah_apply_stock_incoming(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID,TEXT,DATE)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'VERIFY[101]: wardah_apply_stock_incoming ما زالت مفتوحة لـauthenticated';
    END IF;
    SELECT COUNT(*) INTO v_cnt FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('employee_salary_structures','payroll_runs','payroll_details',
                        'attendance_records','employee_leaves','salary_components',
                        'leave_types','payroll_periods')
      AND cmd <> 'SELECT'
      AND (COALESCE(qual,'') || COALESCE(with_check,'')) NOT LIKE '%wardah_is_org_admin%';
    IF v_cnt > 0 THEN
        RAISE EXCEPTION 'VERIFY[101]: % سياسة كتابة HR بلا بوابة إدارية', v_cnt;
    END IF;
    RAISE NOTICE 'VERIFY[101] ✓ — grant المخزون مسحوب، كتابة HR كلها خلف wardah_is_org_admin';
END $$;
