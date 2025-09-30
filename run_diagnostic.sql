
CREATE OR REPLACE FUNCTION run_diagnostic()
RETURNS TABLE(metric TEXT, value BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- 1. Check total count of accounts
  SELECT 'Total accounts' as metric, COUNT(*) as value FROM gl_accounts
  UNION ALL
  -- 2. Check accounts with org_id
  SELECT 'Accounts with org_id' as metric, COUNT(*) as value FROM gl_accounts WHERE org_id IS NOT NULL
  UNION ALL
  -- 3. Check accounts with default org_id
  SELECT 'Accounts with default org_id' as metric, COUNT(*) as value FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001'
  UNION ALL
  -- 4. Check accounts with NULL org_id
  SELECT 'Accounts with NULL org_id' as metric, COUNT(*) as value FROM gl_accounts WHERE org_id IS NULL
  UNION ALL
  -- 5. Check distinct org_id values
  SELECT 'Distinct org_id values' as metric, COUNT(DISTINCT org_id) as value FROM gl_accounts;
END;
$$;
