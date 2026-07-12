-- ===================================================================
-- Migration 102: مرحلة مراجعة التسوية + snapshot/hash + حراس الإنهاء (P13-C)
-- ===================================================================
-- يغلق بقية ملاحظات كودكس على التسويات (P1-11) + علّة E7 المكتشفة أثناء التنفيذ:
--
-- E7 (علّة حية): الواجهة تكتب hr_settlements.settlement_type = نوع الإنهاء
--   (resignation/termination_without_cause/...) بينما شرط قلب الموظف terminated
--   في rpc_post_settlement هو settlement_type='end_of_service' ⇒ الإنهاء لا
--   يحدث إطلاقاً للتسويات المنشأة من الواجهة رغم تحذيرها «يقلب الموظف إلى
--   منتهية». الفصل الصحيح: settlement_type = نوع التسوية (end_of_service)،
--   وtermination_type عمود مستقل — مع ترحيل الصفوف القائمة.
--
-- P1-11أ (idempotency ناقصة): التسوية كانت بلا بصمة حمولة (عكس المسير) ⇒
--   الآن request_hash تُخزن عند الترحيل وتُقارن عند الـreplay.
--
-- P1-11ب (الترحيل يُنهي فوراً بلا مرحلة اعتماد): الآن دورة draft → review →
--   approved: rpc_submit_settlement_review يجمّد snapshot/hash خادمياً من الصف
--   والسطور الفعلية، وrpc_post_settlement يرفض غير المراجَعة
--   (SETTLEMENT_NOT_REVIEWED) ويعيد حساب الـhash ويقارنه — أي تعديل بين
--   المراجعة والاعتماد ⇒ SETTLEMENT_CHANGED_AFTER_REVIEW.
--   قرار موثق: يجوز أن يكون المراجِع هو المعتمِد نفسه (كلاهما admin) — هذه
--   مرحلة تأكيد مقصودة وليست four-eyes approval؛ فصل الأدوار الإلزامي يأتي
--   مع نظام أدوار HR التفصيلي.
--
-- حراس الإنهاء (قبل قلب الموظف): موظف نشط، فترة خدمة سليمة، لا تسوية EOS
--   معتمدة سابقة، ولا شهر رواتب مقفل بعد نهاية الخدمة (تعارض بيانات).
--
-- percentage_base: قيد CHECK على salary_components (basic|basic_housing) —
--   المحرك client-side يدعمهما الآن ويرفض القيم المجهولة (لا fallback صامت).
-- ===================================================================

-- 0) المتطلبات
DO $$
BEGIN
    IF to_regclass('public.hr_settlements') IS NULL
       OR to_regclass('public.hr_settlement_lines') IS NULL THEN
        RAISE EXCEPTION 'PREREQ_MISSING: hr_settlements/hr_settlement_lines — طبّق sql/hr/16 أولاً';
    END IF;
    IF to_regprocedure('public.wardah_is_org_admin(uuid)') IS NULL THEN
        RAISE EXCEPTION 'PREREQ_MISSING: wardah_is_org_admin — طبّق Migration 101 أولاً';
    END IF;
END $$;

-- 1) أعمدة جديدة
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS termination_type TEXT;
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS review_hash      TEXT;
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS reviewed_by      UUID;
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMPTZ;
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS request_hash     TEXT;
ALTER TABLE hr_settlements ADD COLUMN IF NOT EXISTS posted_snapshot  JSONB;

-- 2) ترحيل بيانات E7: صفوف كتبت نوع الإنهاء في settlement_type
UPDATE hr_settlements
SET termination_type = settlement_type,
    settlement_type  = 'end_of_service'
WHERE settlement_type IN ('resignation','termination_without_cause',
                          'termination_for_cause','end_of_contract',
                          'mutual_agreement','retirement','death');

-- 3) percentage_base: قائمة مغلقة + افتراضي واضح
ALTER TABLE salary_components ADD COLUMN IF NOT EXISTS percentage_base TEXT;
ALTER TABLE salary_components ALTER COLUMN percentage_base SET DEFAULT 'basic';
UPDATE salary_components SET percentage_base = 'basic'
WHERE percentage_base IS NULL OR percentage_base NOT IN ('basic','basic_housing');
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'chk_salary_components_percentage_base') THEN
        ALTER TABLE salary_components
            ADD CONSTRAINT chk_salary_components_percentage_base
            CHECK (percentage_base IS NULL OR percentage_base IN ('basic','basic_housing'));
    END IF;
END $$;

-- ===================================================================
-- 4) بصمة snapshot خادمية من الصف والسطور الفعلية (داخلية — بلا GRANT)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.wardah_settlement_snapshot(p_settlement_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'employee_id',       s.employee_id,
        'settlement_type',   s.settlement_type,
        'termination_type',  s.termination_type,
        'payable_amount',    ROUND(COALESCE(s.payable_amount, 0), 2),
        'calculated_amount', ROUND(COALESCE(s.calculated_amount, 0), 2),
        'service_start',     s.service_start,
        'service_end',       s.service_end,
        'notes',             s.notes,
        'lines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'component_code', l.component_code,
                       'amount', ROUND(l.amount, 2),
                       'is_deduction', l.is_deduction)
                   ORDER BY l.component_code, l.amount)
            FROM hr_settlement_lines l
            WHERE l.settlement_id = s.id), '[]'::jsonb))
    FROM hr_settlements s
    WHERE s.id = p_settlement_id;
$$;
REVOKE ALL ON FUNCTION public.wardah_settlement_snapshot(UUID) FROM PUBLIC;

-- ===================================================================
-- 5) rpc_submit_settlement_review — draft → review بتجميد snapshot خادمي
-- ===================================================================
CREATE OR REPLACE FUNCTION public.rpc_submit_settlement_review(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org        UUID;
    v_settlement hr_settlements%ROWTYPE;
    v_snapshot   JSONB;
BEGIN
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
    IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_organizations
                   WHERE user_id = auth.uid() AND org_id = v_org) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;
    IF NOT wardah_is_org_admin(v_org) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED_SETTLEMENT_POST: إرسال التسوية للمراجعة يتطلب صلاحية مدير المؤسسة';
    END IF;

    SELECT * INTO v_settlement FROM hr_settlements
    WHERE id = (p_payload->>'settlement_id')::uuid AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;
    IF v_settlement.status <> 'draft' THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_DRAFT: الحالة % — المراجعة تبدأ من مسودة', v_settlement.status;
    END IF;
    IF ROUND(COALESCE(v_settlement.payable_amount, v_settlement.calculated_amount, 0), 2) <= 0 THEN
        RAISE EXCEPTION 'SETTLEMENT_ZERO_AMOUNT';
    END IF;

    v_snapshot := wardah_settlement_snapshot(v_settlement.id);

    UPDATE hr_settlements
    SET status = 'review',
        reviewed_by = auth.uid(),
        reviewed_at = NOW(),
        review_hash = md5(v_snapshot::text),
        updated_at = NOW()
    WHERE id = v_settlement.id;

    RETURN jsonb_build_object('success', true,
        'settlement_id', v_settlement.id, 'status', 'review',
        'review_hash', md5(v_snapshot::text));
END;
$$;

COMMENT ON FUNCTION public.rpc_submit_settlement_review(JSONB) IS
'draft→review (Migration 102): بوابة إدارية + تجميد snapshot/hash خادمياً من الصف والسطور الفعلية — أي تعديل لاحق يكشفه rpc_post_settlement بـ SETTLEMENT_CHANGED_AFTER_REVIEW.';

GRANT EXECUTE ON FUNCTION public.rpc_submit_settlement_review(JSONB) TO authenticated;

-- ===================================================================
-- 6) rpc_post_settlement — review إلزامية + مطابقة snapshot + بصمة حمولة + حراس
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
    v_hash       TEXT;
    v_settlement hr_settlements%ROWTYPE;
    v_snapshot   JSONB;
    v_amount     NUMERIC;
    v_exp_acct   UUID;
    v_pay_acct   UUID;
    v_journal    JSONB;
    v_entry_date DATE;
    v_emp_status TEXT;
BEGIN
    -- الهوية والصلاحية قبل أي replay (نمط 101)
    v_org := wardah_org_id(NULLIF(p_payload->>'tenant_id','')::uuid);
    IF v_org IS NULL THEN RAISE EXCEPTION 'ORG_NOT_RESOLVED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM user_organizations
                   WHERE user_id = auth.uid() AND org_id = v_org) THEN
        RAISE EXCEPTION 'NOT_ORG_MEMBER';
    END IF;
    IF NOT wardah_is_org_admin(v_org) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED_SETTLEMENT_POST: اعتماد التسوية يتطلب صلاحية مدير المؤسسة';
    END IF;

    v_idem := NULLIF(p_payload->>'idempotency_key','');
    IF v_idem IS NULL THEN RAISE EXCEPTION 'INVALID_PAYLOAD: idempotency_key إلزامي'; END IF;
    v_hash := md5((p_payload - 'idempotency_key')::text);

    SELECT * INTO v_settlement FROM hr_settlements
    WHERE id = (p_payload->>'settlement_id')::uuid AND org_id = v_org
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;

    -- replay بنفس المفتاح على تسوية مرحَّلة: بصمة الحمولة تُقارن (P1-11أ —
    -- كانت المقارنة بالمفتاح والحالة فقط عكس نمط المسير)
    IF v_settlement.idempotency_key = v_idem AND v_settlement.journal_entry_id IS NOT NULL THEN
        IF v_settlement.request_hash IS NOT NULL
           AND v_settlement.request_hash IS DISTINCT FROM v_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
        END IF;
        RETURN jsonb_build_object('success', true, 'replayed', true,
            'settlement_id', v_settlement.id,
            'journal_entry_id', v_settlement.journal_entry_id,
            'status', v_settlement.status);
    END IF;

    -- P1-11ب: الترحيل من review حصراً (كانت draft تُرحَّل وتُنهي الموظف بضغطة واحدة)
    IF v_settlement.status <> 'review' THEN
        RAISE EXCEPTION 'SETTLEMENT_NOT_REVIEWED: الحالة % — أرسل التسوية للمراجعة أولاً', v_settlement.status;
    END IF;

    -- مطابقة snapshot: أي تعديل على الصف/السطور بعد المراجعة يبطلها
    v_snapshot := wardah_settlement_snapshot(v_settlement.id);
    IF v_settlement.review_hash IS DISTINCT FROM md5(v_snapshot::text) THEN
        RAISE EXCEPTION 'SETTLEMENT_CHANGED_AFTER_REVIEW: أعد إرسالها للمراجعة';
    END IF;

    v_amount := ROUND(COALESCE(v_settlement.payable_amount, v_settlement.calculated_amount, 0), 2);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'SETTLEMENT_ZERO_AMOUNT'; END IF;
    v_entry_date := COALESCE(NULLIF(p_payload->>'entry_date','')::date, CURRENT_DATE);

    -- حراس الإنهاء (قبل أي كتابة) لتسويات نهاية الخدمة
    IF v_settlement.settlement_type = 'end_of_service' THEN
        SELECT status INTO v_emp_status FROM employees
        WHERE id = v_settlement.employee_id AND org_id = v_org;
        IF v_emp_status IS NULL THEN
            RAISE EXCEPTION 'EMPLOYEE_ORG_MISMATCH: موظف التسوية لا يتبع المؤسسة';
        END IF;
        IF v_emp_status <> 'active' THEN
            RAISE EXCEPTION 'EMPLOYEE_NOT_ACTIVE: حالة الموظف % — لا إنهاء مكرر', v_emp_status;
        END IF;
        IF v_settlement.service_end IS NOT NULL AND v_settlement.service_start IS NOT NULL
           AND v_settlement.service_end < v_settlement.service_start THEN
            RAISE EXCEPTION 'SETTLEMENT_INVALID_PERIOD: نهاية الخدمة قبل بدايتها';
        END IF;
        IF EXISTS (SELECT 1 FROM hr_settlements
                   WHERE org_id = v_org AND employee_id = v_settlement.employee_id
                     AND settlement_type = 'end_of_service'
                     AND status IN ('approved','paid') AND id <> v_settlement.id) THEN
            RAISE EXCEPTION 'EOS_ALREADY_SETTLED: للموظف تسوية نهاية خدمة معتمدة سابقاً';
        END IF;
        -- شهر رواتب مقفل بعد نهاية الخدمة ⇒ تعارض بيانات يُحل يدوياً أولاً
        IF v_settlement.service_end IS NOT NULL AND EXISTS (
            SELECT 1 FROM hr_payroll_locks
            WHERE org_id = v_org AND status = 'locked'
              AND make_date(year, month, 1)
                  > date_trunc('month', v_settlement.service_end)::date) THEN
            RAISE EXCEPTION 'SETTLEMENT_AFTER_LOCKED_PAYROLL: يوجد مسير مقفل لشهر يلي نهاية الخدمة — راجع الفترات أولاً';
        END IF;
    END IF;

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
        idempotency_key = v_idem, request_hash = v_hash,
        posted_snapshot = v_snapshot, updated_at = NOW()
    WHERE id = v_settlement.id;

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
'اعتماد التسوية (Migration 102): بوابة إدارية قبل الـreplay + بصمة حمولة (IDEMPOTENCY_KEY_REUSED) + review إلزامية (SETTLEMENT_NOT_REVIEWED) + مطابقة snapshot (SETTLEMENT_CHANGED_AFTER_REVIEW) + حراس الإنهاء (EMPLOYEE_NOT_ACTIVE/EOS_ALREADY_SETTLED/SETTLEMENT_INVALID_PERIOD/SETTLEMENT_AFTER_LOCKED_PAYROLL) — المراجِع قد يكون المعتمِد نفسه (مرحلة تأكيد لا four-eyes، موثق).';

GRANT EXECUTE ON FUNCTION public.rpc_post_settlement(JSONB) TO authenticated;

-- ===================================================================
-- 7) FKs مركبة مؤجلة من 101 (نمط NOT VALID + تقرير)
-- ===================================================================
DO $$
DECLARE
    t TEXT;
    v_bad BIGINT;
BEGIN
    FOREACH t IN ARRAY ARRAY['attendance_records','employee_leaves',
                             'employee_salary_structures','hr_settlements'] LOOP
        IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
        -- جدول بلا عمودَي الربط (مخطط ناقص) ⇒ تخطٍّ مُعلَن لا فشل
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = t
                         AND column_name = 'employee_id')
           OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = t
                            AND column_name = 'org_id') THEN
            RAISE WARNING 'AUDIT[102]: % بلا employee_id/org_id — تخطي FK المركب', t;
            CONTINUE;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'fk_' || t || '_employee_org'
              AND conrelid = ('public.' || t)::regclass
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (employee_id, org_id)
                 REFERENCES employees (id, org_id) NOT VALID',
                t, 'fk_' || t || '_employee_org');
        END IF;
        EXECUTE format(
            'SELECT COUNT(*) FROM %I x WHERE NOT EXISTS (
                 SELECT 1 FROM employees e
                 WHERE e.id = x.employee_id AND e.org_id = x.org_id)', t)
        INTO v_bad;
        IF v_bad > 0 THEN
            RAISE WARNING 'AUDIT[102]: % فيه % صف تاريخي بموظف لا يتبع org — نظّف ثم VALIDATE CONSTRAINT %', t, v_bad, 'fk_' || t || '_employee_org';
        ELSE
            EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, 'fk_' || t || '_employee_org');
            RAISE NOTICE 'AUDIT[102]: fk_%_employee_org convalidated=true ✓', t;
        END IF;
    END LOOP;
END $$;

-- 8) تحقق ختامي
DO $$
BEGIN
    IF to_regprocedure('public.rpc_submit_settlement_review(jsonb)') IS NULL THEN
        RAISE EXCEPTION 'VERIFY[102]: rpc_submit_settlement_review غائبة';
    END IF;
    IF has_function_privilege('anon', 'public.wardah_settlement_snapshot(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'VERIFY[102]: wardah_settlement_snapshot مفتوحة لـanon';
    END IF;
    RAISE NOTICE 'VERIFY[102] ✓ — دورة draft→review→approved مفعّلة مع snapshot/hash وحراس الإنهاء';
END $$;
