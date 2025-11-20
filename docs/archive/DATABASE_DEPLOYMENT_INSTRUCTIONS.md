# Database Deployment Instructions for Advanced Reports System

## Overview
This document provides step-by-step instructions for deploying the advanced reports system SQL schema to your Supabase database. The system includes:
- Material variance calculation functions
- Labor variance calculation functions
- WIP by stage view
- React components for reporting dashboard

## Prerequisites
1. Supabase CLI installed
2. Database connection configured in `config.json`
3. Proper database schema already deployed

## Deployment Steps

### 1. Verify Database Connection
First, verify that you can connect to your Supabase database:

```bash
# Check if Supabase CLI is working
npx supabase --version

# If using local development
npx supabase status
```

### 2. Deploy SQL Migrations
Deploy the SQL functions and views using the migration files:

```bash
# Deploy the variance calculation functions
npx supabase migration up

# Or deploy individual files
npx supabase sql -f src/database/migrations/001_create_variance_functions.sql
npx supabase sql -f src/database/migrations/002_create_wip_view.sql
```

### 3. Alternative Deployment Method
If the Supabase CLI is not available, you can deploy the combined SQL file directly:

```bash
# Using psql (if available)
psql -h your-db-host -d your-db-name -U your-username -f WARDAH_ADVANCED_REPORTS_SCHEMA.sql

# Or copy and paste the contents into the Supabase SQL editor in the dashboard
```

## Troubleshooting

### Common Issues and Solutions

1. **UUID Comparison Errors**
   - Error: `operator does not exist: uuid = text`
   - Solution: Cast both sides to text using `::text`
   - Example: `sm.reference_id::text = mo.id::text`

2. **Missing Column Errors**
   - Error: `column X does not exist`
   - Solution: Check actual table structure and use correct column names
   - We identified that `labor_entries` table uses `manufacturing_order_id` instead of `mo_id`

3. **Permission Errors**
   - Ensure you're using the service role key for deployment
   - Service role key can be found in `config.json` under `SUPABASE_SERVICE_KEY`

### Diagnostic Commands

To check table structures and diagnose issues:

```sql
-- Check labor_entries table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'labor_entries'
ORDER BY ordinal_position;

-- Check if the manufacturing_order_id column exists
SELECT 
    column_name
FROM information_schema.columns 
WHERE table_name = 'labor_entries' 
AND column_name = 'manufacturing_order_id';

-- Check manufacturing_orders table structure for reference
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'manufacturing_orders'
ORDER BY ordinal_position;
```

### Verification Steps

After deployment, verify that the functions and views were created successfully:

```sql
-- Check if functions exist
SELECT proname FROM pg_proc WHERE proname LIKE '%variance%';

-- Check if view exists
SELECT viewname FROM pg_views WHERE viewname = 'wip_by_stage';

-- Test the functions with sample data
SELECT * FROM calculate_material_variances('00000000-0000-0000-0000-000000000001');
SELECT * FROM calculate_labor_variances('00000000-0000-0000-0000-000000000001');
```

## Notes
- The functions and views use proper casting to avoid type mismatch errors
- Column names have been corrected to match the actual database schema
- All SQL files have been updated to use `manufacturing_order_id` instead of `mo_id` in the `labor_entries` table