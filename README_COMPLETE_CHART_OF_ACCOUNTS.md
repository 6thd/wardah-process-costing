# Complete Chart of Accounts Display

This directory contains scripts and utilities to display the complete WARDAH ERP Chart of Accounts with all 190 accounts in a proper hierarchical structure.

## Files Included

1. **DISPLAY_COMPLETE_CHART_OF_ACCOUNTS.sql** - SQL script to display all accounts in hierarchical order
2. **VERIFY_ACCOUNT_MAPPING.sql** - SQL script to verify account mappings according to WARDAH ERP HANDOVER
3. **import-complete-coa.js** - JavaScript utility to import and validate the complete chart of accounts from CSV
4. **display-complete-coa.js** - JavaScript utility to display accounts from database in tree structure
5. **display-coa-tree.html** - HTML page to visualize the chart of accounts in an interactive tree view

## Usage Instructions

### 1. Display Accounts with SQL

To view all 190 accounts in hierarchical structure:

```sql
-- Run this script in your Supabase SQL Editor
\i DISPLAY_COMPLETE_CHART_OF_ACCOUNTS.sql
```

This will show:
- Total account count
- Hierarchical tree view with indentation
- Account details (code, name, category, subtype, parent_code)
- Level indicators

### 2. Verify Account Mapping

To verify that accounts are properly mapped according to the WARDAH ERP HANDOVER:

```sql
-- Run this script in your Supabase SQL Editor
\i VERIFY_ACCOUNT_MAPPING.sql
```

This will check:
- Account hierarchy integrity
- Parent-child relationships
- Account categories and subtypes
- Orphaned accounts

### 3. Import Complete Chart of Accounts

To import all 190 accounts from the CSV file:

```bash
# Run the import script
node import-complete-coa.js
```

This will:
- Read accounts from `wardah_erp_handover/wardah_enhanced_coa.csv`
- Validate account hierarchy
- Generate SQL insert statements
- Display account tree structure
- Show statistics by category

### 4. Display Accounts from Database

To display accounts from the database in a tree structure:

```bash
# Run the display script
node display-complete-coa.js
```

This will:
- Fetch all accounts from the database
- Build hierarchical tree structure
- Display accounts with proper indentation
- Show detailed account information
- Generate statistics

### 5. Interactive Tree View

To view accounts in an interactive browser-based tree:

1. Open `display-coa-tree.html` in a web browser
2. Use the search box to filter accounts
3. Click on accounts to expand/collapse children
4. View account details and statistics

## Account Structure

The WARDAH ERP Chart of Accounts contains 190 accounts organized in the following hierarchy:

- **100000 - الأصول (Assets)**
  - 110000 - الأصول المتداولة (Current Assets)
    - 110100 - النقد ومايعادله (Cash)
    - 110200 - النقدية في البنوك (Bank)
    - 130000 - المخزون (Inventory)
      - 131000 - مواد خام (Raw Materials)
      - 134000 - إنتاج تحت التشغيل (WIP)
      - 135000 - مخزون تام الصنع (Finished Goods)
  - 120000 - أصول غير متداولة (Non-Current Assets)

- **200000 - الالتزامات (Liabilities)**
  - 210000 - الالتزامات المتداولة (Current Liabilities)
  - 220000 - التزامات غير متداولة (Non-Current Liabilities)

- **300000 - حقوق الملكية (Equity)**

- **400000 - الإيرادات (Revenue)**

- **500000 - التكاليف والمصروفات (Expenses)**
  - 510000 - التكاليف الصناعية (Manufacturing Costs)
  - 600000 - المصاريف التشغيلية (Operating Expenses)

## Account Categories

- **ASSET** - الأصول
- **LIABILITY** - الالتزامات
- **EQUITY** - حقوق الملكية
- **REVENUE** - الإيرادات
- **EXPENSE** - المصروفات

## Account Subtypes

- **CASH** - النقدية
- **BANK** - البنوك
- **AR** - المدينون
- **AP** - الدائنون
- **INVENTORY** - المخزون
- **RM** - المواد الخام
- **WIP** - إنتاج تحت التشغيل
- **FG** - منتجات تامة الصنع
- **SALES** - المبيعات
- **MANUFACTURING** - التصنيع
- **OPEX** - المصروفات التشغيلية

## Posting Permissions

- **Allow Posting (P)** - Can be used in transactions
- **No Posting (NP)** - Header accounts only

## Troubleshooting

### If you see only 45 accounts instead of 190:

1. Check that all accounts were imported from the CSV file
2. Verify that the `gl_accounts` table contains all 190 records
3. Run the verification script to check for missing accounts

### If hierarchy is not displaying correctly:

1. Check that `parent_code` references are correct
2. Verify there are no circular references
3. Ensure parent accounts exist for all child accounts

## Additional Resources

- **WARDHA ERP HANDOVER Directory** - Contains the original CSV files
- **IMPLEMENTATION_SUMMARY.md** - Details about the account structure implementation
- **CHART_OF_ACCOUNTS_FIX_SUMMARY.md** - Information about fixes applied to the chart of accounts