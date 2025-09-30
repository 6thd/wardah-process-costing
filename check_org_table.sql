-- Check the structure of the organizations table
-- This will help us understand what columns are required

-- Check table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'organizations'
ORDER BY ordinal_position;

-- Check if there are any existing organizations
SELECT * FROM organizations LIMIT 5;

-- Check the first few gl_accounts to see their tenant_id values
SELECT id, code, name, tenant_id::text FROM gl_accounts LIMIT 5;