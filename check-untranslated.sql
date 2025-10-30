-- عرض الحسابات التي تحتاج ترجمة
SELECT 
    code,
    name,
    name_ar,
    name_en,
    category
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (name_en IS NULL OR name_en = name OR name_en = '')
ORDER BY code;
