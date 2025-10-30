-- =============================================
-- Pre-BOM Setup Verification
-- التحقق من المتطلبات الأساسية قبل تطبيق BOM
-- =============================================

-- 1. التحقق من وجود الجداول المطلوبة
-- =============================================
SELECT 
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ جدول items موجود'
        ELSE '❌ جدول items غير موجود - يجب إنشاؤه أولاً'
    END AS items_check
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'items';

SELECT 
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ جدول organizations موجود'
        ELSE '❌ جدول organizations غير موجود - يجب إنشاؤه أولاً'
    END AS organizations_check
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'organizations';

SELECT 
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ جدول user_organizations موجود'
        ELSE '❌ جدول user_organizations غير موجود - يجب إنشاؤه أولاً'
    END AS user_organizations_check
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name = 'user_organizations';

-- 2. التحقق من أعمدة items المطلوبة
-- =============================================
SELECT 
    column_name,
    data_type,
    CASE 
        WHEN column_name IN ('id', 'item_code', 'item_name', 'unit_of_measure', 'unit_cost') 
        THEN '✅ مطلوب'
        ELSE '⚪ اختياري'
    END AS status
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'items'
ORDER BY ordinal_position;

-- 3. التحقق من أعمدة user_organizations
-- =============================================
SELECT 
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'user_organizations'
ORDER BY ordinal_position;

-- 4. عرض البيانات الحالية
-- =============================================
SELECT 
    '📊 عدد الأصناف (Items):' AS info,
    COUNT(*) AS count
FROM items
WHERE is_active = true;

SELECT 
    '📊 عدد المؤسسات (Organizations):' AS info,
    COUNT(*) AS count
FROM organizations
WHERE is_active = true;

-- =============================================
-- الخطوة التالية:
-- إذا كانت جميع الفحوصات ✅، يمكنك تطبيق 01_bom_system_setup.sql
-- إذا كان هناك ❌، يجب إنشاء الجداول المطلوبة أولاً
-- =============================================
