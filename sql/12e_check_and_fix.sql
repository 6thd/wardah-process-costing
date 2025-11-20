-- فحص شامل لجدول journals

-- 1. التحقق من وجود الجدول
SELECT 
    table_name, 
    table_type 
FROM information_schema.tables 
WHERE table_name = 'journals';

-- 2. عرض البنية (الأعمدة)
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'journals'
ORDER BY ordinal_position;

-- 3. عد السجلات الحالية
SELECT count(*) as total_records FROM journals;

-- 4. عرض جميع السجلات (إن وجدت)
SELECT * FROM journals LIMIT 10;

-- 5. محاولة الإدراج (سيفشل إذا كان هناك خطأ في البنية)
DO $$
BEGIN
    -- حذف السجلات القديمة أولاً
    DELETE FROM journals WHERE org_id = '00000000-0000-0000-0000-000000000001';
    
    -- إدراج سجلات جديدة
    INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
    VALUES 
    ('GEN', 'General Journal', 'قيد عام', 'general', 'JE-', true, '00000000-0000-0000-0000-000000000001'::uuid),
    ('SALES', 'Sales Journal', 'قيد المبيعات', 'sales', 'SJ-', true, '00000000-0000-0000-0000-000000000001'::uuid),
    ('PURCH', 'Purchase Journal', 'قيد المشتريات', 'purchase', 'PJ-', true, '00000000-0000-0000-0000-000000000001'::uuid),
    ('BANK', 'Bank Journal', 'قيد البنك', 'bank', 'BJ-', true, '00000000-0000-0000-0000-000000000001'::uuid),
    ('CASH', 'Cash Journal', 'قيد الصندوق', 'cash', 'CJ-', true, '00000000-0000-0000-0000-000000000001'::uuid);
    
    RAISE NOTICE '✅ تم إدراج % سجلات', (SELECT count(*) FROM journals WHERE org_id = '00000000-0000-0000-0000-000000000001');
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ خطأ: %', SQLERRM;
END $$;

-- 6. التحقق النهائي
SELECT 
    code, 
    name, 
    name_ar, 
    sequence_prefix,
    is_active,
    org_id
FROM journals 
ORDER BY code;

