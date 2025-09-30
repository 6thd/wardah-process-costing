-- =======================================
-- Import Actual Chart of Accounts Data
-- =======================================

-- First, read the JSON data
\set coa_data `cat coa_data.json`

-- Import the chart of accounts data
SELECT import_chart_of_accounts(
    '00000000-0000-0000-0000-000000000001',
    :'coa_data'::JSONB
);

-- Verify the import
SELECT COUNT(*) as total_accounts FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001';