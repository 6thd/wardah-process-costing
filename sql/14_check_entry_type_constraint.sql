-- فحص constraint على entry_type

-- 1. عرض الـ constraint
SELECT 
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'gl_entries'::regclass
AND conname LIKE '%entry_type%';

-- 2. عرض بعض القيم الموجودة في entry_type
SELECT DISTINCT entry_type 
FROM gl_entries 
LIMIT 10;

-- 3. محاولة معرفة القيم المسموحة من الـ enum (إن وجد)
SELECT 
    t.typname AS enum_name,
    e.enumlabel AS enum_value
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE t.typname LIKE '%entry%type%'
ORDER BY e.enumsortorder;

