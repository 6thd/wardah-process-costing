-- ===================================================================
-- test_payroll_rbac.sql — تحقق صلاحيات الرواتب (Migration 101)
-- ===================================================================
-- أسلوب assert: أي نتيجة غير متوقعة ⇒ RAISE EXCEPTION (exit code ≠ 0 مع psql
-- -v ON_ERROR_STOP=1) — لا مجرد طباعة. التشغيل:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/security/test_payroll_rbac.sql
-- يعمل بأي دور يملك قراءة الكتالوج (postgres/service_role). اختبارات السلوك
-- الحي بأدوار anon/member/admin موثقة في نهاية الملف (تتطلب JWTs حقيقية).
-- ===================================================================

-- 1) P0-1: صلاحية تنفيذ دالة المخزون مسحوبة من authenticated وPUBLIC
DO $$
BEGIN
    IF has_function_privilege('authenticated',
        'public.wardah_apply_stock_incoming(UUID,UUID,UUID,NUMERIC,NUMERIC,TEXT,UUID,TEXT,DATE)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL[1]: wardah_apply_stock_incoming قابلة للتنفيذ من authenticated — أعد تطبيق 101 وتأكد ألا migration لاحقة أعادت GRANT';
    END IF;
    RAISE NOTICE 'PASS[1]: wardah_apply_stock_incoming داخلية فقط';
END $$;

-- 2) rpc_post_goods_receipt ما زالت متاحة (القناة القانونية لم تنكسر)
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated',
        'public.rpc_post_goods_receipt(JSONB)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL[2]: rpc_post_goods_receipt غير متاحة لـauthenticated — كسر تشغيلي';
    END IF;
    RAISE NOTICE 'PASS[2]: rpc_post_goods_receipt متاحة';
END $$;

-- 3) wardah_is_org_admin موجودة، SECURITY DEFINER، search_path مثبّت، بلا PUBLIC
DO $$
DECLARE r RECORD;
BEGIN
    SELECT prosecdef, proconfig INTO r
    FROM pg_proc WHERE oid = 'public.wardah_is_org_admin(UUID)'::regprocedure;
    IF NOT FOUND OR NOT r.prosecdef THEN
        RAISE EXCEPTION 'FAIL[3]: wardah_is_org_admin غائبة أو ليست SECURITY DEFINER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%') THEN
        RAISE EXCEPTION 'FAIL[3]: wardah_is_org_admin بلا search_path مثبّت';
    END IF;
    IF has_function_privilege('anon', 'public.wardah_is_org_admin(UUID)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL[3]: wardah_is_org_admin مفتوحة لـanon (PUBLIC لم يُسحب)';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.wardah_is_org_admin(UUID)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL[3]: authenticated لا يملك تنفيذ wardah_is_org_admin — سياسات RLS ستفشل';
    END IF;
    RAISE NOTICE 'PASS[3]: wardah_is_org_admin محصّنة';
END $$;

-- 4) كل سياسات الكتابة على جداول HR التسعة (٨ + org_settings) خلف البوابة الإدارية
DO $$
DECLARE v_cnt INT;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('salary_components','employee_salary_structures','payroll_periods',
                        'payroll_runs','payroll_details','attendance_records',
                        'leave_types','employee_leaves','org_settings')
      AND cmd <> 'SELECT'
      AND (COALESCE(qual,'') || COALESCE(with_check,'')) NOT LIKE '%wardah_is_org_admin%';
    IF v_cnt > 0 THEN
        RAISE EXCEPTION 'FAIL[4]: % سياسة كتابة بلا بوابة إدارية', v_cnt;
    END IF;
    RAISE NOTICE 'PASS[4]: كتابة HR/org_settings كلها خلف wardah_is_org_admin';
END $$;

-- 5) سرية القراءة: جداول المبالغ الفردية SELECT للإدارة فقط
DO $$
DECLARE v_cnt INT;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('employee_salary_structures','payroll_runs','payroll_details',
                        'attendance_records','employee_leaves')
      AND cmd = 'SELECT'
      AND COALESCE(qual,'') NOT LIKE '%wardah_is_org_admin%';
    IF v_cnt > 0 THEN
        RAISE EXCEPTION 'FAIL[5]: % سياسة SELECT على جداول رواتب حساسة بلا بوابة إدارية — تسريب قراءة', v_cnt;
    END IF;
    RAISE NOTICE 'PASS[5]: قراءة جداول المبالغ الفردية للإدارة فقط';
END $$;

-- 6) لا سياسات permissive قديمة متبقية من Migration 99 (كانت تتحد بـOR فتغلب)
DO $$
DECLARE v_cnt INT;
BEGIN
    -- أسماء سياسات 99 كانت <table>_wardah_insert/update/delete (بلا admin) —
    -- وجود أي منها يعني أن الإسقاط الديناميكي في 101 لم يعمل
    SELECT COUNT(*) INTO v_cnt FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('salary_components','employee_salary_structures','payroll_periods',
                        'payroll_runs','payroll_details','attendance_records',
                        'leave_types','employee_leaves')
      AND (policyname LIKE '%\_wardah\_insert' ESCAPE '\'
        OR policyname LIKE '%\_wardah\_update' ESCAPE '\'
        OR policyname LIKE '%\_wardah\_delete' ESCAPE '\');
    IF v_cnt > 0 THEN
        RAISE EXCEPTION 'FAIL[6]: سياسات Migration 99 المتساهلة ما زالت قائمة (% سياسة)', v_cnt;
    END IF;
    RAISE NOTICE 'PASS[6]: لا سياسات متساهلة متبقية';
END $$;

-- 7) FK المركب موجود — وتقرير حالة convalidated (تحذير لا فشل: بيانات تاريخية)
DO $$
DECLARE v_validated BOOLEAN;
BEGIN
    SELECT convalidated INTO v_validated FROM pg_constraint
    WHERE conname = 'fk_payroll_details_employee_org'
      AND conrelid = 'payroll_details'::regclass;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL[7]: fk_payroll_details_employee_org غائب';
    END IF;
    IF v_validated THEN
        RAISE NOTICE 'PASS[7]: FK موظف↔مؤسسة convalidated=true ✓';
    ELSE
        RAISE WARNING 'WARN[7]: FK موجود لكن convalidated=false — نظّف الصفوف التاريخية ثم VALIDATE CONSTRAINT (بند متابعة مفتوح)';
    END IF;
END $$;

-- ===================================================================
-- اختبارات السلوك الحي (تتطلب مستخدمَين حقيقيين — تُنفذ يدوياً على staging):
--   أ. بمستخدم member (غير admin/owner):
--      SELECT rpc_post_payroll_run('{"payload_version":2,...}') ⇒ يجب أن يفشل
--      بـ NOT_AUTHORIZED_PAYROLL_POST (قبل أي replay).
--      SELECT * FROM payroll_details LIMIT 1 ⇒ صفر صفوف (سرية القراءة).
--   ب. بمستخدم admin: المسير يمر، وإعادة نفس المفتاح تعيد replayed=true،
--      وتغيير الحمولة مع نفس المفتاح ⇒ IDEMPOTENCY_KEY_REUSED.
--   ج. بحمولة عبث: totals لا تطابق lines ⇒ TOTALS_MISMATCH؛ نقل مبلغ من
--      housing_allowance إلى other_allowance في totals فقط ⇒ BUCKETS_MISMATCH؛
--      employee_id من مؤسسة أخرى ⇒ EMPLOYEE_ORG_MISMATCH.
--   د. rpc_post_goods_receipt يعمل لعضو عادي (القناة القانونية سليمة).
-- سجّل النتائج والتاريخ والبيئة في docs/security/PAYROLL_SECURITY_LOG.md
-- ===================================================================
