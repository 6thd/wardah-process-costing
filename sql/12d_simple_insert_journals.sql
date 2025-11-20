-- إدراج أنواع القيود مباشرة (بدون شروط معقدة)

-- التحقق من البيانات الحالية
SELECT 'Before insert:' as step, count(*) as total_journals FROM journals;

-- إدراج البيانات مباشرة
INSERT INTO journals (id, code, name, name_ar, journal_type, sequence_prefix, is_active, org_id, created_at, updated_at)
VALUES 
(gen_random_uuid(), 'GEN', 'General Journal', 'قيد عام', 'general', 'JE-', true, '00000000-0000-0000-0000-000000000001', now(), now()),
(gen_random_uuid(), 'SALES', 'Sales Journal', 'قيد المبيعات', 'sales', 'SJ-', true, '00000000-0000-0000-0000-000000000001', now(), now()),
(gen_random_uuid(), 'PURCH', 'Purchase Journal', 'قيد المشتريات', 'purchase', 'PJ-', true, '00000000-0000-0000-0000-000000000001', now(), now()),
(gen_random_uuid(), 'BANK', 'Bank Journal', 'قيد البنك', 'bank', 'BJ-', true, '00000000-0000-0000-0000-000000000001', now(), now()),
(gen_random_uuid(), 'CASH', 'Cash Journal', 'قيد الصندوق', 'cash', 'CJ-', true, '00000000-0000-0000-0000-000000000001', now(), now());

-- التحقق من النتيجة
SELECT 'After insert:' as step, count(*) as total_journals FROM journals;

-- عرض البيانات المُدرجة
SELECT code, name, name_ar, sequence_prefix, is_active 
FROM journals 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;

