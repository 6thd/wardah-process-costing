-- ===================================================================
-- تراجع Migration 83: استعادة السياسات السابقة حرفياً
-- ===================================================================
-- ⚠️ افتح هذا الملف في تبويب ثانٍ من محرّر Supabase SQL قبل تطبيق
-- Migration 83 — ونفّذه فقط إذا حدثت مشكلة وصول بعد التطبيق.
--
-- يعيد بالضبط السياسات التي كانت قائمة قبل 83:
--   products/categories: من sql/inventory/01_create_products_table.sql
--   journals:            من sql/migrations/12f_fix_journals_rls.sql
--   BOM:                 من sql/manufacturing/02_bom_rls_simple.sql
-- (نعم — هذه السياسات القديمة غير آمنة؛ هذا التراجع لاستعادة العمل
--  فوراً فقط، ثم عالج سبب الفشل وأعد تطبيق 83)
-- ===================================================================

BEGIN;

-- ===== products =====
DROP POLICY IF EXISTS products_org_select ON products;
DROP POLICY IF EXISTS products_org_insert ON products;
DROP POLICY IF EXISTS products_org_update ON products;
DROP POLICY IF EXISTS products_org_delete ON products;

CREATE POLICY "Enable read access for all users" ON products
    FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON products
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for authenticated users only" ON products
    FOR UPDATE USING (true);
CREATE POLICY "Enable delete for authenticated users only" ON products
    FOR DELETE USING (true);

-- ===== categories =====
DROP POLICY IF EXISTS categories_org_select ON categories;
DROP POLICY IF EXISTS categories_org_insert ON categories;
DROP POLICY IF EXISTS categories_org_update ON categories;
DROP POLICY IF EXISTS categories_org_delete ON categories;

CREATE POLICY "Enable read access for all users" ON categories
    FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON categories
    FOR INSERT WITH CHECK (true);

-- ===== journals =====
DROP POLICY IF EXISTS journals_org_select ON journals;
DROP POLICY IF EXISTS journals_org_insert ON journals;
DROP POLICY IF EXISTS journals_org_update ON journals;
DROP POLICY IF EXISTS journals_org_delete ON journals;

CREATE POLICY "journals_select_policy" ON journals
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "journals_insert_policy" ON journals
    FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "journals_update_policy" ON journals
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "journals_delete_policy" ON journals
    FOR DELETE TO authenticated USING (true);

-- ===== BOM (الجداول الخمسة) =====
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
        IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', v_table || '_org_policy', v_table);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
            v_old_policy, v_table
        );
    END LOOP;
END $$;

COMMIT;

-- تحقق: SELECT tablename, policyname FROM pg_policies WHERE tablename IN
-- ('products','categories','journals','bom_headers','bom_lines',
--  'bom_versions','bom_explosion_cache','bom_where_used');
