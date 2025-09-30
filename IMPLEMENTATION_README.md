# Wardah ERP Implementation Guide

This document provides a comprehensive guide for implementing the Wardah ERP system based on the handover package.

## 📁 Project Structure

```
wardah-process-costing/
├── sql/
│   └── wardah_implementation/
│       ├── 01_schema.sql                 # Database schema creation
│       ├── 02_manufacturing.sql          # Manufacturing tables
│       ├── 03_inventory_costing.sql      # Inventory and costing tables
│       ├── 04_sales_purchasing.sql       # Sales and purchasing tables
│       ├── 05_indexes_constraints.sql    # Indexes and constraints
│       ├── 06_sample_data.sql            # Sample data
│       ├── 07_rls_policies.sql           # Row Level Security policies
│       ├── 08_rls_test_data.sql          # RLS test data
│       ├── 09_avco_functions.sql         # AVCO functions
│       ├── 10_mo_functions.sql           # Manufacturing order functions
│       ├── 11_overhead_functions.sql     # Overhead functions
│       ├── 12_variance_functions.sql     # Variance analysis functions
│       ├── 13_reporting_functions.sql    # Reporting functions
│       ├── 14_triggers.sql               # Database triggers
│       ├── 15_import_coa.sql             # Chart of accounts import function
│       ├── 16_import_gl_mappings.sql     # GL mappings import function
│       ├── 17_import_coa_data.sql        # Chart of accounts data import
│       ├── 18_import_gl_mappings_data.sql# GL mappings data import
│       ├── 19_test_setup.sql             # Test setup
│       ├── 20_sample_transactions_test.sql# Sample transactions test
│       ├── 21_reporting_test.sql         # Reporting functions test
│       └── wardah_implementation_master.sql # Master implementation script
├── scripts/
│   └── convert_csv_to_json.cjs           # CSV to JSON conversion script
├── wardah_erp_handover/
│   ├── wardah_enhanced_coa.csv           # Chart of accounts (CSV)
│   ├── wardah_gl_mappings.csv            # GL mappings (CSV)
│   └── ...                               # Other handover files
```

## 🚀 Implementation Steps

### 1. Database Schema Setup

Execute the following scripts in order:

```sql
-- Create database schema
\ir sql/wardah_implementation/01_schema.sql
\ir sql/wardah_implementation/02_manufacturing.sql
\ir sql/wardah_implementation/03_inventory_costing.sql
\ir sql/wardah_implementation/04_sales_purchasing.sql
\ir sql/wardah_implementation/05_indexes_constraints.sql
\ir sql/wardah_implementation/06_sample_data.sql
```

### 2. Security Implementation

```sql
-- Implement RLS policies
\ir sql/wardah_implementation/07_rls_policies.sql
\ir sql/wardah_implementation/08_rls_test_data.sql
```

### 3. Costing Functions

```sql
-- Create AVCO and manufacturing functions
\ir sql/wardah_implementation/09_avco_functions.sql
\ir sql/wardah_implementation/10_mo_functions.sql
\ir sql/wardah_implementation/11_overhead_functions.sql
\ir sql/wardah_implementation/12_variance_functions.sql
\ir sql/wardah_implementation/13_reporting_functions.sql
\ir sql/wardah_implementation/14_triggers.sql
```

### 4. Data Import Functions

```sql
-- Create import functions
\ir sql/wardah_implementation/15_import_coa.sql
\ir sql/wardah_implementation/16_import_gl_mappings.sql
```

### 5. Data Import

First, convert CSV files to JSON format:

```bash
cd wardah-process-costing
node scripts/convert_csv_to_json.cjs
```

Then import the data:

```sql
-- Import actual data
\ir sql/wardah_implementation/17_import_coa_data.sql
\ir sql/wardah_implementation/18_import_gl_mappings_data.sql
```

## 🧪 Testing

### Test Setup

```sql
-- Set up test environment
\ir sql/wardah_implementation/19_test_setup.sql
```

### Sample Transactions Test

```sql
-- Run sample transactions test
\ir sql/wardah_implementation/20_sample_transactions_test.sql
```

### Reporting Test

```sql
-- Run reporting functions test
\ir sql/wardah_implementation/21_reporting_test.sql
```

## 🔐 Security Testing

To test RLS policies with different user roles:

```sql
-- Test as admin user
SET request.jwt.claims.sub TO '11111111-1111-1111-1111-111111111111';

-- Test as manager user
SET request.jwt.claims.sub TO '22222222-2222-2222-2222-222222222222';

-- Test as regular user
SET request.jwt.claims.sub TO '33333333-3333-3333-3333-333333333333';
```

## 📊 Key Features Implemented

1. **Multi-tenant Architecture**: Organizations and user organizations with RLS
2. **Advanced Costing**: AVCO (Average Cost) inventory management
3. **Process Costing**: Manufacturing order costing with materials, labor, and overhead
4. **Chart of Accounts**: Enhanced 190+ account structure
5. **GL Mappings**: 72 event-based accounting mappings
6. **Reporting**: Inventory valuation, WIP analysis, variance reports
7. **Security**: Role-based access control with RLS policies

## 🛠️ Functions Available

- `apply_stock_move()`: Apply stock moves with AVCO calculation
- `issue_materials_to_mo()`: Issue materials to manufacturing orders
- `apply_overhead_to_mo()`: Apply overhead to manufacturing orders
- `complete_manufacturing_order()`: Complete manufacturing orders
- `get_inventory_valuation()`: Get current inventory valuation
- `get_wip_analysis()`: Get WIP analysis
- `calculate_overhead_variances()`: Calculate overhead variances
- `import_chart_of_accounts()`: Import chart of accounts from JSON
- `import_gl_mappings()`: Import GL mappings from JSON

## 📈 Testing Results

The implementation includes comprehensive testing scripts that demonstrate:

1. Product creation and management
2. BOM (Bill of Materials) setup
3. Manufacturing order processing
4. Material receipt and issuance
5. Labor tracking
6. Overhead application
7. Manufacturing order completion
8. Inventory valuation
9. WIP analysis
10. Variance reporting

## 🎯 Next Steps

1. Configure real user authentication with Supabase Auth
2. Set up proper organization and user management
3. Customize chart of accounts for specific business needs
4. Configure GL mappings for actual business events
5. Set up proper overhead rates
6. Implement additional reporting requirements
7. Configure user roles and permissions
8. Set up data backup and recovery procedures

## 🆘 Troubleshooting

### Common Issues

1. **RLS Policy Violations**: Ensure JWT claims are properly set for testing
2. **Cost Settings Missing**: Make sure cost_settings record exists for the organization
3. **Location Not Found**: Verify locations are properly created in sample data
4. **Product Not Found**: Check that products are created before using them in transactions

### Useful Queries

```sql
-- Check organizations
SELECT * FROM organizations;

-- Check users and organizations
SELECT * FROM user_organizations;

-- Check products
SELECT * FROM products;

-- Check locations
SELECT * FROM locations;

-- Check cost settings
SELECT * FROM cost_settings;
```

## 📞 Support

For implementation support, contact the development team or refer to the original Wardah ERP handover documentation.