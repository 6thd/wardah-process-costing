-- =======================================
-- اختبار الدوال المثبتة
-- =======================================

-- 1. اختبار get_account_tree - عرض شجرة الحسابات
SELECT '📊 شجرة حسابات الأصول (ASSET):' as test;
SELECT 
    REPEAT('  ', level - 1) || code as الكود_بالمستوى,
    name as الاسم,
    level as المستوى
FROM get_account_tree('00000000-0000-0000-0000-000000000001', 'ASSET')
LIMIT 20;

-- 2. اختبار search_accounts - البحث عن "نقدية"
SELECT '🔍 البحث عن "نقدية":' as test;
SELECT * FROM search_accounts('00000000-0000-0000-0000-000000000001', 'نقدية');

-- 3. اختبار get_account_details - تفاصيل حساب محدد
SELECT '📋 تفاصيل حساب 110102:' as test;
SELECT * FROM get_account_details('00000000-0000-0000-0000-000000000001', '110102');

-- 4. اختبار get_gl_mapping - خريطة حدث
SELECT '🗺️ خريطة حدث "material_issue_mixing":' as test;
SELECT * FROM get_gl_mapping('00000000-0000-0000-0000-000000000001', 'material_issue_mixing');

-- 5. عدد الحسابات حسب المستوى
SELECT '📊 إحصائيات المستويات:' as test;
SELECT 
    CASE 
        WHEN parent_code IS NULL THEN 'المستوى 1 (رئيسية)'
        ELSE 'المستوى 2+ (فرعية)'
    END as المستوى,
    COUNT(*) as العدد
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY CASE WHEN parent_code IS NULL THEN 'المستوى 1 (رئيسية)' ELSE 'المستوى 2+ (فرعية)' END;
