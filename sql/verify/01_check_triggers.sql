-- =====================================
-- فحص 1: التحقق من وجود الـ Triggers
-- =====================================

SELECT 
    trigger_name as "اسم الـ Trigger",
    event_manipulation as "نوع العملية",
    event_object_table as "الجدول",
    action_timing as "التوقيت"
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
AND trigger_name LIKE 'audit_%'
ORDER BY event_object_table ASC;

-- النتيجة المتوقعة: يجب أن تظهر triggers على الجداول:
-- roles, user_roles, invitations, user_organizations, organizations, gl_accounts, etc.

