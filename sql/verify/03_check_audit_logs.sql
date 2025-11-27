-- =====================================
-- فحص 3: التحقق من بيانات سجل التدقيق
-- =====================================

-- 3.1: آخر 20 سجل
SELECT 
    id,
    action as "العملية",
    entity_type as "نوع الكيان",
    LEFT(entity_id::text, 8) as "معرف الكيان",
    created_at as "التاريخ"
FROM audit_logs
ORDER BY created_at DESC
LIMIT 20;

-- 3.2: إحصائيات حسب نوع العملية
SELECT 
    action as "نوع العملية",
    COUNT(*) as "العدد"
FROM audit_logs
GROUP BY action
ORDER BY COUNT(*) DESC;

-- 3.3: إحصائيات حسب نوع الكيان
SELECT 
    entity_type as "نوع الكيان",
    COUNT(*) as "العدد"
FROM audit_logs
GROUP BY entity_type
ORDER BY COUNT(*) DESC;

-- 3.4: عدد السجلات الإجمالي
SELECT COUNT(*) as "إجمالي سجلات التدقيق" FROM audit_logs;

-- 3.5: التحقق من بنية الجدول
SELECT 
    column_name as "اسم العمود",
    data_type as "نوع البيانات",
    is_nullable as "قابل للإفراغ"
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

