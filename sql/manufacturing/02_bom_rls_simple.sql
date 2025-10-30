-- =============================================
-- BOM System RLS Policies - نسخة بديلة مبسطة
-- استخدم هذا الملف إذا واجهتك مشاكل مع RLS
-- =============================================

-- 1. حذف السياسات القديمة (إن وجدت)
-- =============================================
DROP POLICY IF EXISTS bom_headers_select_policy ON bom_headers;
DROP POLICY IF EXISTS bom_headers_write_policy ON bom_headers;
DROP POLICY IF EXISTS bom_lines_select_policy ON bom_lines;
DROP POLICY IF EXISTS bom_lines_write_policy ON bom_lines;
DROP POLICY IF EXISTS bom_versions_select_policy ON bom_versions;
DROP POLICY IF EXISTS bom_explosion_select_policy ON bom_explosion_cache;
DROP POLICY IF EXISTS bom_where_used_select_policy ON bom_where_used;

-- 2. تعطيل RLS مؤقتاً للاختبار (اختياري)
-- =============================================
-- يمكنك تشغيل هذا لتعطيل RLS والاختبار بدونه أولاً
-- ALTER TABLE bom_headers DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE bom_lines DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE bom_versions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE bom_explosion_cache DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE bom_where_used DISABLE ROW LEVEL SECURITY;

-- 3. سياسات RLS مبسطة - السماح بكل شيء للمصادقة
-- =============================================
-- هذه السياسات تسمح لأي مستخدم مصادق عليه بالوصول لجميع البيانات
-- استخدمها للاختبار فقط، ثم حدّث لاحقاً للتحكم الدقيق

-- تفعيل RLS
ALTER TABLE bom_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_explosion_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_where_used ENABLE ROW LEVEL SECURITY;

-- سياسة بسيطة: السماح بكل شيء للمستخدمين المصادق عليهم
CREATE POLICY bom_headers_all_policy ON bom_headers
    FOR ALL 
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY bom_lines_all_policy ON bom_lines
    FOR ALL 
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY bom_versions_all_policy ON bom_versions
    FOR ALL 
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY bom_explosion_all_policy ON bom_explosion_cache
    FOR ALL 
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY bom_where_used_all_policy ON bom_where_used
    FOR ALL 
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =============================================
-- ملاحظة مهمة:
-- هذه السياسات مبسطة للغاية وتسمح بالوصول لجميع البيانات
-- بعد التأكد من عمل النظام، يجب تحديثها للتحكم حسب org_id
-- =============================================

SELECT 'RLS Policies Created - Simple Version' AS status;
