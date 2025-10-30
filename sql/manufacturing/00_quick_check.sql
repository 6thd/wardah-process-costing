-- =============================================
-- اختبار سريع - تحديد الجدول المستخدم
-- =============================================

-- التحقق من الجداول الموجودة
SELECT 
    table_name,
    CASE 
        WHEN table_name = 'items' THEN '✅ جدول items موجود'
        WHEN table_name = 'products' THEN '✅ جدول products موجود'
        WHEN table_name = 'organizations' THEN '✅ جدول organizations موجود'
        WHEN table_name = 'user_organizations' THEN '✅ جدول user_organizations موجود'
        ELSE '✅ ' || table_name
    END AS status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('items', 'products', 'organizations', 'user_organizations')
ORDER BY table_name;

-- عرض رسالة النتيجة
DO $$
DECLARE
    has_items BOOLEAN;
    has_products BOOLEAN;
    item_table_name TEXT;
BEGIN
    -- تحديد الجدول المستخدم
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'items'
    ) INTO has_items;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'products'
    ) INTO has_products;
    
    IF has_items THEN
        item_table_name := 'items';
        RAISE NOTICE '✅ سيتم استخدام جدول: %', item_table_name;
    ELSIF has_products THEN
        item_table_name := 'products';
        RAISE NOTICE '✅ سيتم استخدام جدول: %', item_table_name;
    ELSE
        RAISE NOTICE '⚠️ لم يتم العثور على جدول items أو products';
        RAISE NOTICE '💡 النظام سيعمل لكن بدون ربط بيانات الأصناف';
    END IF;
END $$;

-- عرض عدد الأصناف إذا كان الجدول موجوداً
DO $$
DECLARE
    item_count INTEGER;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
        SELECT COUNT(*) INTO item_count FROM items;
        RAISE NOTICE '📊 عدد الأصناف في items: %', item_count;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        SELECT COUNT(*) INTO item_count FROM products;
        RAISE NOTICE '📊 عدد الأصناف في products: %', item_count;
    END IF;
END $$;

-- =============================================
-- النتيجة: جاهز لتطبيق 01_bom_system_setup.sql
-- =============================================
