-- فحص بنية جدول المرفقات والتعليقات

SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name IN ('journal_entry_attachments', 'journal_entry_comments')
ORDER BY table_name, column_name;

