-- =====================================
-- فحص 4: اختبار عمل الـ Trigger
-- =====================================

-- هذا السكريبت يقوم بإنشاء دور تجريبي ثم حذفه للتحقق من عمل الـ trigger

-- 4.1: عدد السجلات قبل الاختبار
SELECT COUNT(*) as "عدد السجلات قبل الاختبار" FROM audit_logs;

-- 4.2: إنشاء دور تجريبي (سيتم تسجيله في audit_logs)
INSERT INTO roles (org_id, name, name_ar, description_ar, is_system_role, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'test_role_for_audit',
    'دور تجريبي للتدقيق',
    'هذا دور تجريبي لاختبار نظام التدقيق',
    false,
    true
)
RETURNING id, name, name_ar;

-- 4.3: عدد السجلات بعد الإنشاء
SELECT COUNT(*) as "عدد السجلات بعد الإنشاء" FROM audit_logs;

-- 4.4: التحقق من آخر سجل
SELECT 
    action,
    entity_type,
    entity_id,
    created_at
FROM audit_logs 
WHERE entity_type = 'roles'
ORDER BY created_at DESC 
LIMIT 1;

-- 4.5: حذف الدور التجريبي
DELETE FROM roles WHERE name = 'test_role_for_audit';

-- 4.6: عدد السجلات بعد الحذف
SELECT COUNT(*) as "عدد السجلات بعد الحذف" FROM audit_logs;

-- 4.7: التحقق من تسجيل عملية الحذف
SELECT 
    action,
    entity_type,
    entity_id,
    created_at
FROM audit_logs 
WHERE entity_type = 'roles'
ORDER BY created_at DESC 
LIMIT 2;

-- النتيجة المتوقعة:
-- - يجب أن يزيد عدد السجلات بمقدار 2 (create + delete)
-- - يجب أن تظهر عمليتي 'create' و 'delete' على جدول 'roles'

