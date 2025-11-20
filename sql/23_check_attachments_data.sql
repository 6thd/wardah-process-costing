-- فحص بيانات المرفقات الموجودة
-- Check existing attachments data

SELECT 
    id,
    entry_id,
    file_name,
    file_path,
    file_size,
    file_type,
    created_at,
    CASE 
        WHEN file_path IS NULL THEN '❌ NULL'
        WHEN file_path = '' THEN '❌ Empty'
        WHEN file_path LIKE 'http%' THEN '🌐 Full URL'
        WHEN file_path LIKE 'journal-attachments/%' THEN '✅ Storage Path'
        ELSE '⚠️ Unknown: ' || LEFT(file_path, 50)
    END as path_type
FROM journal_entry_attachments
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY created_at DESC
LIMIT 20;

