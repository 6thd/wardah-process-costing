-- FIX_GL_ACCOUNTS_CONSTRAINTS.sql
-- Script to add necessary constraints for proper upsert operations

-- First, check if the constraint already exists
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
    AND kcu.column_name IN ('org_id', 'code')
ORDER BY tc.constraint_name, kcu.ordinal_position;

-- If no constraint exists on (org_id, code), create one
-- But first we need to check for duplicates
SELECT org_id, code, COUNT(*) as cnt
FROM gl_accounts
GROUP BY org_id, code
HAVING COUNT(*) > 1;

-- If there are duplicates, we need to handle them first
-- For now, let's just create a unique index (which will fail if there are duplicates)
-- CREATE UNIQUE INDEX CONCURRENTLY idx_gl_accounts_org_code ON gl_accounts (org_id, code);

-- Alternative approach: Add a composite primary key constraint if none exists
-- First check if there's already a primary key
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

-- If no primary key exists and we want to add one, we would need to:
-- 1. Ensure there are no duplicates on the columns we want to make primary key
-- 2. Add the primary key constraint
-- ALTER TABLE gl_accounts ADD CONSTRAINT pk_gl_accounts PRIMARY KEY (id);

-- For the upsert to work properly, we need a unique constraint on (org_id, code)
-- Let's check if we can add it:
-- ALTER TABLE gl_accounts ADD CONSTRAINT uk_gl_accounts_org_code UNIQUE (org_id, code);