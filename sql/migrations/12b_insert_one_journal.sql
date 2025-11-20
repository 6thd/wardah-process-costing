-- إضافة قيد عام فقط (للاختبار)
INSERT INTO journals (code, name, name_ar, journal_type, sequence_prefix, is_active, org_id)
SELECT 'GEN', 'General Journal', 'قيد عام', 'general', 'JE-', true, '00000000-0000-0000-0000-000000000001'::uuid
WHERE NOT EXISTS (
    SELECT 1 FROM journals 
    WHERE org_id = '00000000-0000-0000-0000-000000000001' 
    AND code = 'GEN'
);

-- عرض النتيجة
SELECT code, name, name_ar FROM journals 
WHERE org_id = '00000000-0000-0000-0000-000000000001' 
AND code = 'GEN';

