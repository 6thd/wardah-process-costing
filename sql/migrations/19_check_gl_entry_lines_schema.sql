-- فحص جدول gl_entry_lines
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'gl_entry_lines'
ORDER BY ordinal_position;

