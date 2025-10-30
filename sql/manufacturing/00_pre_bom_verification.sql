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
-- البحث في جدول items أو products (أيهما موجود)
DO $$
BEGIN
    -- محاولة عرض عدد items
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
        RAISE NOTICE '📊 عدد الأصناف (Items): %', (SELECT COUNT(*) FROM items WHERE is_active = true);
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        RAISE NOTICE '📊 عدد الأصناف (Products): %', (SELECT COUNT(*) FROM products WHERE is_active = true);
    ELSE
        RAISE NOTICE '⚠️ لم يتم العثور على جدول items أو products';
    END IF;
    
    -- محاولة عرض عدد organizations
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
        RAISE NOTICE '📊 عدد المؤسسات (Organizations): %', (SELECT COUNT(*) FROM organizations WHERE is_active = true);
    ELSE
        RAISE NOTICE '⚠️ لم يتم العثور على جدول organizations';
    END IF;
END $$;

-- =============================================
-- الخطوة التالية:
-- إذا كانت جميع الفحوصات ✅، يمكنك تطبيق 01_bom_system_setup.sql
-- إذا كان هناك ❌، يجب إنشاء الجداول المطلوبة أولاً
-- =============================================
