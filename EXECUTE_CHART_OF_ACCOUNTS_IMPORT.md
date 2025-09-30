# Import Complete Chart of Accounts - Step by Step Guide

This guide will help you import all 190 accounts from the `wardah_enhanced_coa.csv` file and display them in the hierarchical tree structure.

## Prerequisites

1. Ensure you have access to the Supabase SQL Editor
2. Verify that the `wardah_enhanced_coa.csv` file exists in the `wardah_erp_handover` directory
3. Confirm that the `gl_accounts` table exists in your database

## Step-by-Step Instructions

### Step 1: Prepare for Import (RLS Considerations)

Before importing, be aware that Row Level Security (RLS) may prevent the import. You have several options:

1. Temporarily disable RLS on the gl_accounts table
2. Use a service role account with appropriate permissions
3. Contact your Supabase administrator to grant necessary permissions

The specific method depends on your Supabase setup and security requirements.


### Step 2: Create Temporary Staging Table

Create a temporary table to hold the CSV data:

```sql
DROP TABLE IF EXISTS stg_coa;
CREATE TEMP TABLE stg_coa (
  code text, 
  name text, 
  category text, 
  subtype text, 
  parent_code text,
  normal_balance text, 
  allow_posting boolean, 
  is_active boolean,
  currency text, 
  notes text
);
```

### Step 3: Import CSV Data

This step must be done manually through the Supabase SQL Editor:

1. Open the Supabase SQL Editor
2. Click on the "Import" button
3. Select the file: `wardah_erp_handover/wardah_enhanced_coa.csv`
4. Set the target table to: `stg_coa`
5. Click "Import"

### Step 4: Insert Data into gl_accounts

After importing the CSV data, insert it into the `gl_accounts` table:

```sql
INSERT INTO gl_accounts (
  org_id, code, name, category, subtype, parent_code,
  normal_balance, allow_posting, is_active, currency, notes
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  code, name, category, subtype, NULLIF(parent_code,''),
  normal_balance, COALESCE(allow_posting,true), COALESCE(is_active,true),
  COALESCE(currency,'SAR'), NULLIF(notes,'')
FROM stg_coa
ON CONFLICT (org_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  subtype = EXCLUDED.subtype,
  parent_code = EXCLUDED.parent_code,
  normal_balance = EXCLUDED.normal_balance,
  allow_posting = EXCLUDED.allow_posting,
  is_active = EXCLUDED.is_active,
  currency = EXCLUDED.currency,
  notes = EXCLUDED.notes,
  updated_at = NOW();
```

### Step 5: Verify the Import

Check that all 190 accounts have been imported:

```sql
SELECT COUNT(*) as total_accounts FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';
```

You should see a count of 190 accounts.

### Step 6: Add Temporary Anonymous Read Policy (For Demo)

To allow viewing the accounts without logging in (for demo purposes):

```sql
DROP POLICY IF EXISTS "read gl anon demo" ON gl_accounts;
CREATE POLICY "read gl anon demo"
ON gl_accounts FOR SELECT TO anon
USING (org_id = '00000000-0000-0000-0000-000000000001');
```

### Step 7: Display the Complete Chart of Accounts Tree

To view all accounts in hierarchical structure:

```sql
WITH RECURSIVE account_hierarchy AS (
  -- Root accounts (those with no parent or empty parent)
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level,
    CAST(code AS VARCHAR(1000)) as sort_path
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1 as level,
    CAST(parent.sort_path || '.' || child.code AS VARCHAR(1000)) as sort_path
  FROM gl_accounts child
  JOIN account_hierarchy parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  level,
  REPEAT('  ', level) || code as indented_code,
  REPEAT('  ', level) || name as indented_name,
  category,
  subtype,
  parent_code
FROM account_hierarchy
ORDER BY sort_path;
```

## Expected Results

After completing these steps, you should see:

1. All 190 accounts imported into the `gl_accounts` table
2. Accounts organized in a proper hierarchical structure
3. The ability to view the complete chart of accounts tree without logging in (for demo purposes)

## Troubleshooting

### If you see fewer than 190 accounts:

1. Verify that the CSV import was successful
2. Check for any error messages during the INSERT operation
3. Confirm that the `org_id` is correct

### If the hierarchy is not displaying correctly:

1. Check that `parent_code` values are correctly set
2. Verify that parent accounts exist for all child accounts
3. Ensure there are no circular references

### If you cannot view accounts without logging in:

1. Confirm that the anonymous policy was created successfully
2. Check that your Supabase project allows anonymous access
3. Verify that RLS is properly configured

## Additional Verification Queries

### Show account statistics by category:

```sql
WITH RECURSIVE account_stats AS (
  -- Root accounts
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    allow_posting,
    is_active,
    0 as level
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    child.allow_posting,
    child.is_active,
    parent.level + 1 as level
  FROM gl_accounts child
  JOIN account_stats parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  category,
  COUNT(*) as total_accounts,
  COUNT(CASE WHEN allow_posting THEN 1 END) as posting_allowed,
  COUNT(CASE WHEN is_active THEN 1 END) as active_accounts,
  COUNT(CASE WHEN level = 0 THEN 1 END) as root_accounts
FROM account_stats
GROUP BY category
ORDER BY total_accounts DESC;
```

### Show accounts grouped by hierarchy levels:

```sql
WITH RECURSIVE account_levels AS (
  -- Level 0 (root accounts)
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts at each level
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1 as level
  FROM gl_accounts child
  JOIN account_levels parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  level,
  COUNT(*) as account_count,
  STRING_AGG(code || ' - ' || name, ', ' ORDER BY code) as accounts
FROM account_levels
GROUP BY level
ORDER BY level;
```