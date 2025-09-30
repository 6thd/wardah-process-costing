@echo off
echo WARDAH ERP - Chart of Accounts Import
echo ====================================
echo.

echo This script provides instructions for importing the complete Chart of Accounts.
echo.

echo STEP 1: Open Supabase SQL Editor
echo --------------------------------
echo 1. Go to your Supabase project dashboard
echo 2. Navigate to SQL Editor
echo.

echo STEP 2: Bypass RLS ^(if needed^)
echo --------------------------
echo If you encounter RLS permission errors during import, you may need to:
echo 1. Temporarily disable RLS on the gl_accounts table, or
echo 2. Use a service role account, or
echo 3. Contact your Supabase administrator to grant appropriate permissions
echo.

echo STEP 3: Create the temporary staging table
echo ------------------------------------------
echo Copy and paste this into the SQL Editor:
echo.
echo DROP TABLE IF EXISTS stg_coa;
echo CREATE TEMP TABLE stg_coa ^(
echo   code text, 
echo   name text, 
echo   category text, 
echo   subtype text, 
echo   parent_code text,
echo   normal_balance text, 
echo   allow_posting boolean, 
echo   is_active boolean,
echo   currency text, 
echo   notes text
echo ^);
echo.

echo STEP 4: Import the CSV file
echo --------------------------
echo 1. In SQL Editor, click the "Import" button
echo 2. Select file: wardah_erp_handover/wardah_enhanced_coa.csv
echo 3. Set target table to: stg_coa
echo 4. Click "Import"
echo.

echo STEP 5: Insert data into gl_accounts
echo -----------------------------------
echo After CSV import is complete, copy and paste this into the SQL Editor:
echo.
echo INSERT INTO gl_accounts ^(
echo   org_id, code, name, category, subtype, parent_code,
echo   normal_balance, allow_posting, is_active, currency, notes
echo ^)
echo SELECT
echo   '00000000-0000-0000-0000-000000000001'::uuid,
echo   code, name, category, subtype, NULLIF^(parent_code,''^^),
echo   normal_balance, COALESCE^(allow_posting,true^), COALESCE^(is_active,true^),
echo   COALESCE^(currency,'SAR'^), NULLIF^(notes,''^^)
echo FROM stg_coa
echo ON CONFLICT ^(org_id, code^) DO UPDATE SET
echo   name = EXCLUDED.name,
echo   category = EXCLUDED.category,
echo   subtype = EXCLUDED.subtype,
echo   parent_code = EXCLUDED.parent_code,
echo   normal_balance = EXCLUDED.normal_balance,
echo   allow_posting = EXCLUDED.allow_posting,
echo   is_active = EXCLUDED.is_active,
echo   currency = EXCLUDED.currency,
echo   notes = EXCLUDED.notes,
echo   updated_at = NOW^(^);
echo.

echo STEP 6: Verify the import
echo ------------------------
echo Copy and paste this into the SQL Editor:
echo.
echo SELECT COUNT^(^*^) as total_accounts FROM gl_accounts
echo WHERE org_id = '00000000-0000-0000-0000-000000000001';
echo.

echo STEP 7: Add anonymous read policy ^(for demo^)
echo --------------------------------------------
echo Copy and paste this into the SQL Editor:
echo.
echo DROP POLICY IF EXISTS "read gl anon demo" ON gl_accounts;
echo CREATE POLICY "read gl anon demo"
echo ON gl_accounts FOR SELECT TO anon
echo USING ^(org_id = '00000000-0000-0000-0000-000000000001'^);
echo.

echo STEP 8: Display the complete chart of accounts
echo ---------------------------------------------
echo To view all accounts in hierarchical structure, use the DISPLAY_WARDAH_COA_TREE.sql script
echo or run the query from that file in your SQL Editor.
echo.

echo For detailed instructions, see: EXECUTE_CHART_OF_ACCOUNTS_IMPORT.md
echo.

pause