-- CHECK_DEFAULT_ORG_ACCOUNTS.sql
-- Check if there are any accounts with the default organization ID

SELECT COUNT(*) as default_org_account_count
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Also check if there are any accounts at all
SELECT COUNT(*) as total_account_count
FROM gl_accounts;