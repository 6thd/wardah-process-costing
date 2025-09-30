-- Diagnostic script to check table structures in the database

-- Check labor_entries table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'labor_entries'
ORDER BY ordinal_position;

-- Check if the mo_id column exists
SELECT 
    column_name
FROM information_schema.columns 
WHERE table_name = 'labor_entries' 
AND column_name = 'mo_id';

-- Check manufacturing_orders table structure for reference
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'manufacturing_orders'
ORDER BY ordinal_position;

-- Check if there are any foreign key constraints on labor_entries
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'labor_entries';