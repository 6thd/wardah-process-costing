-- فحص جدول journals الحالي
SELECT 
    id,
    code, 
    name, 
    name_ar, 
    journal_type,
    sequence_prefix,
    is_active,
    org_id
FROM journals 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;

