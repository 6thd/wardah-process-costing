-- ===================================
-- فحص حالة قاعدة البيانات
-- ===================================

-- 1. عرض جميع الجداول الموجودة
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. عد الجداول
SELECT 
    COUNT(*) as total_tables
FROM information_schema.tables 
WHERE table_schema = 'public';

-- 3. التحقق من الجداول الأساسية
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') 
        THEN '✅' ELSE '❌' 
    END as organizations,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_organizations') 
        THEN '✅' ELSE '❌' 
    END as user_organizations,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') 
        THEN '✅' ELSE '❌' 
    END as gl_accounts,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') 
        THEN '✅' ELSE '❌' 
    END as products,
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manufacturing_orders') 
        THEN '✅' ELSE '❌' 
    END as manufacturing_orders;

-- 4. عد السجلات في الجداول الموجودة
DO $$
DECLARE
    tbl_name TEXT;
    row_count INTEGER;
BEGIN
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE 'Records Count per Table:';
    RAISE NOTICE '═══════════════════════════════════════';
    
    FOR tbl_name IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', tbl_name) INTO row_count;
        RAISE NOTICE '% : % records', RPAD(tbl_name, 30), row_count;
    END LOOP;
    
    RAISE NOTICE '═══════════════════════════════════════';
END $$;

-- 5. التحقق من المنظمة الافتراضية
SELECT 
    'Default Organization Check' as check_name,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM organizations 
            WHERE id = '00000000-0000-0000-0000-000000000001'
        ) 
        THEN '✅ Exists' 
        ELSE '❌ Not Found' 
    END as status;

-- 6. عرض المنظمات الموجودة
SELECT 
    id,
    name,
    code,
    is_active,
    created_at
FROM organizations
ORDER BY created_at;
