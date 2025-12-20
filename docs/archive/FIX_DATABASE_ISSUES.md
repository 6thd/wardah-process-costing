# Fixing Database Issues for Wardah ERP

## Problem Summary

The debug screen is empty because:
1. Database tables are not properly created
2. Authentication is failing
3. The gl_accounts table cannot be queried

## Solution Steps

### Step 1: Verify Database Connection

First, let's make sure we can connect to the database:

1. Go to your Supabase project dashboard: https://rytzljjlthouptdqeuxh.supabase.co
2. Navigate to the SQL Editor
3. Run this query to check if tables exist:

```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('organizations', 'user_organizations', 'gl_accounts', 'users');
```

### Step 2: Create Database Schema

If the tables don't exist, run these scripts in order in the Supabase SQL Editor:

1. First, create the core schema (01_schema.sql):
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Organizations (Multi-tenant support)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users and Organization Access
CREATE TABLE user_organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL, -- References auth.users
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'manager', 'admin')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, org_id)
);

-- Chart of Accounts (Enhanced)
CREATE TABLE gl_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    subtype VARCHAR(50) NOT NULL,
    parent_code VARCHAR(20),
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    allow_posting BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    currency VARCHAR(3) DEFAULT 'SAR',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- GL Mappings for Events (Enhanced for Manufacturing)
CREATE TABLE gl_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_type VARCHAR(50) NOT NULL, -- 'EVENT', 'WORK_CENTER', 'PRODUCT_TYPE', etc.
    key_value VARCHAR(100) NOT NULL,
    debit_account_code VARCHAR(20) NOT NULL,
    credit_account_code VARCHAR(20) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, key_type, key_value)
);
```

### Step 3: Create Sample Organization and User

```sql
-- Insert sample organization
INSERT INTO organizations (id, name, code, settings) 
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'وردة البيان للصناعات البلاستيكية',
    'WRD001',
    '{"currency": "SAR", "timezone": "Asia/Riyadh", "fiscal_year_start": "01-01"}'::jsonb
);

-- You'll need to create a user in the Supabase Authentication dashboard
-- Email: admin@wardah.sa
-- Password: admin123
```

### Step 4: Associate User with Organization

After creating the user in the Supabase Authentication dashboard:

```sql
-- Replace 'USER_ID_FROM_DASHBOARD' with the actual user ID from the Supabase Auth dashboard
INSERT INTO user_organizations (user_id, org_id, role, is_active)
VALUES (
    'USER_ID_FROM_DASHBOARD',  -- Replace with actual user ID
    '00000000-0000-0000-0000-000000000001',
    'admin',
    true
);
```

### Step 5: Import Chart of Accounts Data

Use the generated SQL file to import the chart of accounts:

1. Open the file `sql/wardah_implementation/import-coa-generated.sql`
2. Copy its contents
3. Paste and run in the Supabase SQL Editor

### Step 6: Verify Data Import

```sql
-- Check if data was imported correctly
SELECT COUNT(*) as account_count FROM gl_accounts;
SELECT * FROM gl_accounts LIMIT 10;
```

### Step 7: Update Application Configuration

Make sure your `public/config.json` file has the correct settings:

> ⚠️ **SECURITY NOTE**: Never commit actual keys. Get them from Supabase Dashboard.

```json
{
  "SUPABASE_URL": "<YOUR_SUPABASE_PROJECT_URL>",
  "SUPABASE_ANON_KEY": "<YOUR_SUPABASE_ANON_KEY>",
  "TABLE_NAMES": {
    "work_centers": "work_centers",
    "stage_costs": "stage_costs",
    "labor_time_logs": "labor_time_logs",
    "moh_applied": "moh_applied",
    "inventory_ledger": "inventory_ledger",
    "manufacturing_orders": "manufacturing_orders",
    "boms": "boms",
    "items": "items",
    "stock_moves": "stock_moves",
    "users": "users",
    "suppliers": "suppliers",
    "customers": "customers",
    "categories": "categories",
    "purchase_orders": "purchase_orders",
    "purchase_order_items": "purchase_order_items",
    "sales_orders": "sales_orders",
    "sales_order_items": "sales_order_items",
    "process_costs": "process_costs",
    "audit_trail": "audit_trail",
    "gl_accounts": "gl_accounts",
    "journals": "journals",
    "journal_entries": "journal_entries",
    "journal_entry_lines": "journal_entry_lines"
  },
  "APP_SETTINGS": {
    "default_currency": "SAR",
    "default_language": "ar",
    "items_per_page": 25,
    "auto_save_interval": 30000,
    "cost_precision": 6,
    "amount_precision": 4,
    "costing_method": "AVCO"
  },
  "FEATURES": {
    "realtime_updates": true,
    "advanced_costing": true,
    "multi_tenant": true,
    "demo_mode": false,
    "process_costing": true,
    "avco_inventory": true,
    "audit_trail": true
  },
  "COSTING_CONFIG": {
    "default_overhead_rate": 0.15,
    "regrind_processing_rate": 0.05,
    "waste_credit_rate": 0.02,
    "labor_overhead_rate": 0.25
  }
}
```

### Step 8: Restart the Application

1. Stop the development server (Ctrl+C)
2. Run `npm run dev` again
3. Navigate to http://localhost:3001/test-gl

## Troubleshooting

If you still see issues:

1. Check the browser console for errors
2. Make sure you're logged in with the correct credentials (admin@wardah.sa / admin123)
3. Verify that the user is properly associated with the organization
4. Check that the gl_accounts table has data

## Additional Notes

- The application should now be able to query the gl_accounts table
- The Chart of Accounts tree should appear in the accounting module
- The test page at /test-gl should show the accounts data