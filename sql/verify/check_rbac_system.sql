-- =====================================
-- بسم الله الرحمن الرحيم
-- فحص نظام RBAC والـ Audit Log
-- =====================================

-- =====================================
-- 1. التحقق من وجود الـ Triggers
-- =====================================

SELECT '=== 1. TRIGGERS ===' as section;

SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
AND trigger_name LIKE 'audit_%'
ORDER BY event_object_table;

-- =====================================
-- 2. التحقق من الموديولات
-- =====================================

SELECT '=== 2. MODULES ===' as section;

SELECT 
    id,
    name,
    name_ar,
    icon,
    display_order,
    is_active
FROM modules
ORDER BY display_order;

-- =====================================
-- 3. التحقق من الصلاحيات
-- =====================================

SELECT '=== 3. PERMISSIONS ===' as section;

SELECT 
    p.id,
    m.name as module_name,
    p.resource,
    p.action,
    p.permission_key,
    p.resource_ar
FROM permissions p
JOIN modules m ON p.module_id = m.id
ORDER BY m.display_order, p.resource, p.action
LIMIT 50;

-- =====================================
-- 4. التحقق من قوالب الأدوار
-- =====================================

SELECT '=== 4. ROLE TEMPLATES ===' as section;

SELECT 
    id,
    name,
    name_ar,
    category,
    array_length(permission_keys, 1) as permissions_count,
    is_active
FROM role_templates
ORDER BY category, name;

-- =====================================
-- 5. التحقق من الأدوار المنشأة
-- =====================================

SELECT '=== 5. ROLES ===' as section;

SELECT 
    r.id,
    r.org_id,
    r.name,
    r.name_ar,
    r.is_system_role,
    r.is_active,
    (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) as permissions_count
FROM roles r
ORDER BY r.org_id, r.name;

-- =====================================
-- 6. التحقق من ربط الصلاحيات بالأدوار
-- =====================================

SELECT '=== 6. ROLE PERMISSIONS ===' as section;

SELECT 
    r.name as role_name,
    r.name_ar as role_name_ar,
    m.name as module_name,
    p.action,
    p.resource
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
JOIN permissions p ON rp.permission_id = p.id
JOIN modules m ON p.module_id = m.id
ORDER BY r.name, m.name, p.action
LIMIT 50;

-- =====================================
-- 7. التحقق من سجلات التدقيق
-- =====================================

SELECT '=== 7. AUDIT LOGS (Last 20) ===' as section;

SELECT 
    id,
    org_id,
    user_id,
    action,
    entity_type,
    entity_id,
    created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 20;

-- =====================================
-- 8. إحصائيات سجل التدقيق
-- =====================================

SELECT '=== 8. AUDIT LOG STATS ===' as section;

SELECT 
    action,
    entity_type,
    COUNT(*) as count
FROM audit_logs
GROUP BY action, entity_type
ORDER BY count DESC;

-- =====================================
-- 9. التحقق من جدول audit_logs
-- =====================================

SELECT '=== 9. AUDIT_LOGS TABLE STRUCTURE ===' as section;

SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

-- =====================================
-- 10. التحقق من الـ Functions
-- =====================================

SELECT '=== 10. AUDIT FUNCTIONS ===' as section;

SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND (routine_name LIKE '%activity%' OR routine_name LIKE '%audit%' OR routine_name LIKE '%log%')
ORDER BY routine_name;

