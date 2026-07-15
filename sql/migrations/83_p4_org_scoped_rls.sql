-- ===================================================================
-- Migration 83: عزل المؤسسات — سياسات RLS محصورة بالمؤسسة
-- ===================================================================
-- المشكلة: سياسات USING(true) الحالية تسمح لأي مستخدم مسجَّل برؤية
-- وتعديل بيانات كل المؤسسات، وجدول products/categories مفتوح حتى
-- لغير المسجلين (الدور public = مفتاح anon).
--
-- الحل: سياسات org_id = wardah_org_id() — الدالة الحية من Migration 76
-- التي تقرأ عضوية المستخدم من user_organizations (لا تعتمد على JWT claim).
--
-- ⚠️ تصميم فائل-سيف:
--   1) القسم 1 (فحص مسبق) يرمي EXCEPTION ويجهض المعاملة كلها لو وُجدت
--      بيانات يتيمة أو مستخدم بلا عضوية — لا يُطبَّق شيء ناقص أبداً
--   2) سكربت التراجع الجاهز: sql/rollback/83_rollback_org_scoped_rls.sql
--      — افتحه في تبويب ثانٍ قبل التنفيذ
--   3) محرّر Supabase SQL يعمل بدور service (يتجاوز RLS) — لا قفل نهائي
--
-- خطوات التطبيق:
--   أ) نفّذ هذا الملف كاملاً — لو رمى EXCEPTION اقرأ الرسالة وعالج السبب
--      (غالباً: فعّل عبارات الـ backfill المعلَّقة في القسم 1ب)
--   ب) سجّل دخولاً حقيقياً في التطبيق وتحقق: المنتجات تظهر، القيود تظهر،
--      شاشة BOM تعمل
--   ج) عندها فقط أغلق تبويب سكربت التراجع
-- ===================================================================

BEGIN;

-- ===================================================================
-- القسم 1: الفحص المسبق المُجهِض — يمنع القفل قبل حدوثه
-- ===================================================================
DO $$
DECLARE
    v_orphans BIGINT;
    v_users_without_org BIGINT;
    v_table TEXT;
    v_msg TEXT := '';
BEGIN
    -- 1أ) صفوف بلا org_id في الجداول المستهدفة (ستختفي عن الجميع لو طُبِّقت السياسات)
    FOREACH v_table IN ARRAY ARRAY[
        'products', 'categories', 'journals',
        'bom_headers', 'bom_lines', 'bom_versions',
        'bom_explosion_cache', 'bom_where_used'
    ] LOOP
        IF to_regclass('public.' || v_table) IS NOT NULL THEN
            EXECUTE format('SELECT COUNT(*) FROM %I WHERE org_id IS NULL', v_table)
            INTO v_orphans;
            IF v_orphans > 0 THEN
                v_msg := v_msg || format('- %s: %s صف بلا org_id%s', v_table, v_orphans, E'\n');
            END IF;
        END IF;
    END LOOP;

    -- 1ب) مستخدمون مصادَقون بلا عضوية في user_organizations (سيُقفلون تماماً)
    IF to_regclass('public.user_organizations') IS NOT NULL THEN
        SELECT COUNT(*) INTO v_users_without_org
        FROM auth.users u
        WHERE u.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM user_organizations uo WHERE uo.user_id = u.id
          );
        IF v_users_without_org > 0 THEN
            v_msg := v_msg || format('- %s مستخدم نشط بلا صف في user_organizations%s',
                                     v_users_without_org, E'\n');
        END IF;
    ELSE
        v_msg := v_msg || '- جدول user_organizations غير موجود أصلاً!' || E'\n';
    END IF;

    IF v_msg <> '' THEN
        RAISE EXCEPTION E'PREFLIGHT_FAILED — عالج الآتي قبل تطبيق العزل:\n%\n'
            'لو لديك مؤسسة واحدة فقط، فعّل عبارات الـ backfill المعلَّقة أدناه '
            '(أزل -- من أولها) ثم أعد تنفيذ الملف كاملاً.', v_msg;
    END IF;

    RAISE NOTICE 'الفحص المسبق نجح ✅ — لا بيانات يتيمة ولا مستخدمين بلا عضوية';
END $$;

-- -------------------------------------------------------------------
-- (backfill اختياري — فعّله فقط عند مؤسسة واحدة، بعد التأكد من الـ id:
--    SELECT id, name FROM organizations;)
-- -------------------------------------------------------------------
-- UPDATE products   SET org_id = (SELECT id FROM organizations LIMIT 1) WHERE org_id IS NULL;
-- UPDATE categories SET org_id = (SELECT id FROM organizations LIMIT 1) WHERE org_id IS NULL;
-- UPDATE journals   SET org_id = (SELECT id FROM organizations LIMIT 1) WHERE org_id IS NULL;
-- INSERT INTO user_organizations (user_id, org_id, role)
--   SELECT u.id, (SELECT id FROM organizations LIMIT 1), 'member'
--   FROM auth.users u
--   WHERE u.deleted_at IS NULL
--     AND NOT EXISTS (SELECT 1 FROM user_organizations uo WHERE uo.user_id = u.id);

-- ===================================================================
-- القسم 2: products — كانت مفتوحة حتى للـ anon (USING(true) بدور public)
-- ===================================================================
DROP POLICY IF EXISTS "Enable read access for all users" ON products;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON products;
DROP POLICY IF EXISTS "Enable update for authenticated users only" ON products;
DROP POLICY IF EXISTS "Enable delete for authenticated users only" ON products;

CREATE POLICY products_org_select ON products
    FOR SELECT TO authenticated
    USING (org_id = wardah_org_id(NULL));
CREATE POLICY products_org_insert ON products
    FOR INSERT TO authenticated
    WITH CHECK (org_id = wardah_org_id(NULL));
CREATE POLICY products_org_update ON products
    FOR UPDATE TO authenticated
    USING (org_id = wardah_org_id(NULL))
    WITH CHECK (org_id = wardah_org_id(NULL));
CREATE POLICY products_org_delete ON products
    FOR DELETE TO authenticated
    USING (org_id = wardah_org_id(NULL));

-- ===================================================================
-- القسم 3: categories
-- ===================================================================
DROP POLICY IF EXISTS "Enable read access for all users" ON categories;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON categories;

CREATE POLICY categories_org_select ON categories
    FOR SELECT TO authenticated
    USING (org_id = wardah_org_id(NULL));
CREATE POLICY categories_org_insert ON categories
    FOR INSERT TO authenticated
    WITH CHECK (org_id = wardah_org_id(NULL));
CREATE POLICY categories_org_update ON categories
    FOR UPDATE TO authenticated
    USING (org_id = wardah_org_id(NULL))
    WITH CHECK (org_id = wardah_org_id(NULL));
CREATE POLICY categories_org_delete ON categories
    FOR DELETE TO authenticated
    USING (org_id = wardah_org_id(NULL));

-- ===================================================================
-- القسم 4: journals (كانت USING(true) من 12f)
-- ===================================================================
DROP POLICY IF EXISTS "journals_select_policy" ON journals;
DROP POLICY IF EXISTS "journals_insert_policy" ON journals;
DROP POLICY IF EXISTS "journals_update_policy" ON journals;
DROP POLICY IF EXISTS "journals_delete_policy" ON journals;

CREATE POLICY journals_org_select ON journals
    FOR SELECT TO authenticated
    USING (org_id = wardah_org_id(NULL));
CREATE POLICY journals_org_insert ON journals
    FOR INSERT TO authenticated
    WITH CHECK (org_id = wardah_org_id(NULL));
CREATE POLICY journals_org_update ON journals
    FOR UPDATE TO authenticated
    USING (org_id = wardah_org_id(NULL))
    WITH CHECK (org_id = wardah_org_id(NULL));
CREATE POLICY journals_org_delete ON journals
    FOR DELETE TO authenticated
    USING (org_id = wardah_org_id(NULL));

-- ===================================================================
-- القسم 5: جداول BOM الخمسة (كانت FOR ALL USING(true))
-- ===================================================================
DO $$
DECLARE
    v_table TEXT;
    v_old_policy TEXT;
BEGIN
    FOR v_table, v_old_policy IN
        SELECT * FROM (VALUES
            ('bom_headers',         'bom_headers_all_policy'),
            ('bom_lines',           'bom_lines_all_policy'),
            ('bom_versions',        'bom_versions_all_policy'),
            ('bom_explosion_cache', 'bom_explosion_all_policy'),
            ('bom_where_used',      'bom_where_used_all_policy')
        ) AS t(tbl, pol)
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE NOTICE 'جدول % غير موجود — تخطٍّ', v_table;
            CONTINUE;
        END IF;
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', v_old_policy, v_table);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO authenticated
             USING (org_id = wardah_org_id(NULL))
             WITH CHECK (org_id = wardah_org_id(NULL))',
            v_table || '_org_policy', v_table
        );
        RAISE NOTICE 'عُزل جدول % بسياسة org_id ✅', v_table;
    END LOOP;
END $$;

COMMIT;

-- ===================================================================
-- التحقق بعد التطبيق:
--   SELECT tablename, policyname, roles, qual
--   FROM pg_policies
--   WHERE tablename IN ('products','categories','journals',
--                       'bom_headers','bom_lines','bom_versions',
--                       'bom_explosion_cache','bom_where_used')
--   ORDER BY tablename, policyname;
-- يجب ألا يظهر أي qual = true، وكل الأدوار = {authenticated}
--
-- ثم: سجّل دخولاً حقيقياً وتحقق أن المنتجات والقيود وBOM تظهر طبيعياً.
-- عند أي مشكلة: sql/rollback/83_rollback_org_scoped_rls.sql
-- ===================================================================
