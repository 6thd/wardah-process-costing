# WARDAH ERP Chart of Accounts Display

This directory contains tools to display the complete WARDAH ERP Chart of Accounts from the `wardah_erp_handover/wardah_enhanced_coa.csv` file in a proper hierarchical tree structure.

## Files Included

1. **DISPLAY_WARDAH_COA_TREE.sql** - SQL script to display all 190 accounts in hierarchical order from the database
2. **import-and-display-coa.js** - JavaScript utility to read the CSV file and display the tree structure
3. **display-wardah-coa-tree.html** - HTML page for interactive visualization of the chart of accounts
4. **README_WARDAH_COA.md** - This documentation file

## Usage Instructions

### 1. Display Accounts with SQL

To view all 190 accounts in hierarchical structure from the database:

```sql
-- Run this script in your Supabase SQL Editor
\i DISPLAY_WARDAH_COA_TREE.sql
```

This will show:
- Total account count
- Hierarchical tree view with proper indentation
- Account details (code, name, category, subtype, parent_code)
- Level indicators
- Statistics by category
- Validation of parent-child relationships

### 2. Import and Display from CSV

To read and display accounts directly from the CSV file:

```bash
# Run the import and display script
node import-and-display-coa.js
```

This will:
- Read accounts from `wardah_erp_handover/wardah_enhanced_coa.csv`
- Build hierarchical tree structure
- Display accounts with proper indentation
- Show detailed account information
- Generate statistics
- Create SQL insert statements

### 3. Interactive Tree View

To view accounts in an interactive browser-based tree:

1. Open `display-wardah-coa-tree.html` in a web browser
2. Use the search box to filter accounts by code or name
3. Use the category filter to display specific categories
4. Click on accounts to select them
5. Click on the triangle icons to expand/collapse children
6. View account details and statistics

## Account Structure

The WARDAH ERP Chart of Accounts contains 190 accounts organized in the following main hierarchy:

### الأصول (Assets) - Category: ASSET
- **100000** - الأصول (Root)
  - **110000** - الأصول المتداولة (Current Assets)
    - **110100** - النقد ومايعادله (Cash)
    - **110200** - النقدية في البنوك (Bank)
    - **130000** - المخزون (Inventory)
      - **131000** - مواد خام (Raw Materials)
      - **134000** - إنتاج تحت التشغيل (WIP)
      - **135000** - مخزون تام الصنع (Finished Goods)
  - **120000** - أصول غير متداولة (Non-Current Assets)

### الالتزامات (Liabilities) - Category: LIABILITY
- **200000** - الالتزامات (Root)
  - **210000** - الالتزامات المتداولة (Current Liabilities)
  - **220000** - التزامات غير متداولة (Non-Current Liabilities)

### حقوق الملكية (Equity) - Category: EQUITY
- **300000** - حقوق الملكية (Root)

### الإيرادات (Revenue) - Category: REVENUE
- **400000** - الإيرادات (Root)

### التكاليف والمصروفات (Expenses) - Category: EXPENSE
- **500000** - التكاليف والمصروفات (Root)
  - **510000** - التكاليف الصناعية (Manufacturing Costs)
  - **600000** - المصاريف التشغيلية (Operating Expenses)

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

- **Allow Posting (ترحيل)** - Can be used in transactions
- **No Posting (لا ترحيل)** - Header accounts only

## Troubleshooting

### If you see only a subset of accounts instead of all 190:

1. Check that all accounts were imported from the CSV file
2. Verify that the `gl_accounts` table contains all 190 records
3. Run the validation queries to check for missing accounts

### If hierarchy is not displaying correctly:

1. Check that `parent_code` references are correct
2. Verify there are no circular references
3. Ensure parent accounts exist for all child accounts

### If the JavaScript script fails:

1. Make sure you have Node.js installed
2. Install required dependencies: `npm install csv-parser`
3. Verify the CSV file path is correct

## Additional Resources

- **wardah_erp_handover/wardah_enhanced_coa.csv** - The source CSV file with all 190 accounts
- **wardah_erp_handover/wardah_gl_mappings.csv** - Account mappings for transactions
- **IMPLEMENTATION_SUMMARY.md** - Details about the account structure implementation