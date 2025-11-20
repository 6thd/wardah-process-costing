-- CHECK_GL_ACCOUNTS_CONSTRAINTS.sql
-- Script to check constraints on gl_accounts table

-- Check table structure (replacing \d gl_accounts with standard SQL)
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- Check constraints
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    conkey AS column_indexes,
    ARRAY(
        SELECT attname 
        FROM pg_attribute 
        WHERE attrelid = conrelid 
        AND attnum = ANY(conkey)
    ) AS columns
FROM pg_constraint 
WHERE conrelid = 'gl_accounts'::regclass
ORDER BY conname;

-- Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'gl_accounts'
ORDER BY indexname;

-- Check primary key
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_name = kcu.table_name
WHERE tc.table_name = 'gl_accounts'
    AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY kcu.ordinal_position;

-- Check unique constraints
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_name = kcu.table_name
WHERE tc.table_name = 'gl_accounts'
    AND tc.constraint_type = 'UNIQUE'
ORDER BY tc.constraint_name, kcu.ordinal_position;