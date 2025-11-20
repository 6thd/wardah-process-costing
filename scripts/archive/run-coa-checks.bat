@echo off
echo WARDAH ERP - Chart of Accounts Verification
echo ==========================================
echo.

echo 1. Checking GL Accounts Structure...
echo -----------------------------------
psql -f CHECK_GL_ACCOUNTS_STRUCTURE.sql
echo.

echo 2. Verifying Account Mapping...
echo -----------------------------
psql -f VERIFY_ACCOUNT_MAPPING.sql
echo.

echo 3. Running Complete Account Analysis...
echo ------------------------------------
psql -f DETAILED_ACCOUNT_ANALYSIS.sql
echo.

echo Verification complete.
echo For detailed tree view, open DISPLAY_COMPLETE_CHART_OF_ACCOUNTS.sql in your SQL editor.
echo For interactive view, open display-coa-tree.html in your browser.
pause