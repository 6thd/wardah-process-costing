SELECT COUNT(*) as total_accounts FROM gl_accounts;
SELECT COUNT(*) as accounts_with_org_id FROM gl_accounts WHERE org_id IS NOT NULL;
SELECT COUNT(*) as accounts_with_org_id FROM gl_accounts WHERE org_id IS NOT NULL;
SELECT * FROM gl_accounts LIMIT 5;