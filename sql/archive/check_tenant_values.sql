-- Check what values are actually in the tenant_id column
-- This will help us understand how to properly fix the issue

-- Check distinct tenant_id values (limited to avoid stack depth issues)
SELECT DISTINCT tenant_id
FROM gl_accounts
WHERE tenant_id IS NOT NULL
LIMIT 20;

-- Check count of each distinct tenant_id value
SELECT tenant_id, COUNT(*) as count
FROM gl_accounts
GROUP BY tenant_id
ORDER BY count DESC
LIMIT 20;

-- Check for NULL tenant_id values
SELECT COUNT(*) as null_count
FROM gl_accounts
WHERE tenant_id IS NULL;

-- Check for any accounts with specific problematic values
-- First, let's see what we can safely check without casting
SELECT 
  CASE 
    WHEN tenant_id IS NULL THEN 'NULL'
    ELSE 'HAS_VALUE'
  END as tenant_status,
  COUNT(*) as count
FROM gl_accounts
GROUP BY 
  CASE 
    WHEN tenant_id IS NULL THEN 'NULL'
    ELSE 'HAS_VALUE'
  END;