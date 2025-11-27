-- =====================================
-- ملخص سريع لحالة نظام RBAC + Audit
-- =====================================

-- 1. عدد الـ Triggers
SELECT 
    'Triggers' as "الفحص",
    COUNT(*) as "العدد"
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
AND trigger_name LIKE 'audit_%'

UNION ALL

-- 2. عدد الموديولات
SELECT 
    'Modules' as "الفحص",
    COUNT(*) as "العدد"
FROM modules

UNION ALL

-- 3. عدد الصلاحيات
SELECT 
    'Permissions' as "الفحص",
    COUNT(*) as "العدد"
FROM permissions

UNION ALL

-- 4. عدد قوالب الأدوار
SELECT 
    'Role Templates' as "الفحص",
    COUNT(*) as "العدد"
FROM role_templates

UNION ALL

-- 5. عدد الأدوار
SELECT 
    'Roles' as "الفحص",
    COUNT(*) as "العدد"
FROM roles

UNION ALL

-- 6. عدد ربط الصلاحيات بالأدوار
SELECT 
    'Role-Permission Links' as "الفحص",
    COUNT(*) as "العدد"
FROM role_permissions

UNION ALL

-- 7. عدد سجلات التدقيق
SELECT 
    'Audit Logs' as "الفحص",
    COUNT(*) as "العدد"
FROM audit_logs;

