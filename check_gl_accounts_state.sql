-- Check the current state of gl_accounts table

-- Check total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Check how many have org_id set
SELECT COUNT(*) as accounts_with_org FROM gl_accounts WHERE org_id IS NOT NULL;

-- Check how many have NULL org_id
SELECT COUNT(*) as accounts_without_org FROM gl_accounts WHERE org_id IS NULL;

-- Check distinct org_id values
SELECT org_id::text, COUNT(*) as count
FROM gl_accounts
WHERE org_id IS NOT NULL
GROUP BY org_id::text
ORDER BY count DESC;

-- Check sample accounts with org_id
SELECT id, code, name, org_id::text
FROM gl_accounts
WHERE org_id IS NOT NULL
LIMIT 10;

-- Check sample accounts without org_id
SELECT id, code, name, org_id
FROM gl_accounts
WHERE org_id IS NULL
LIMIT 10;

-- Check if RLS is enabled on gl_accounts
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'gl_accounts';

-- Check RLS policies on gl_accounts
SELECT polname, polcmd, polroles, polqual 
FROM pg_policy 
WHERE polrelid = 'gl_accounts'::regclass;