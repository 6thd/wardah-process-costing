# Deploying the Advanced Reports System

## Overview
This document provides instructions for deploying and using the Advanced Reports System in the Wardah ERP application. The system includes variance analysis, WIP reporting, and a comprehensive dashboard.

## Prerequisites
1. Supabase project with the Wardah ERP schema deployed
2. Node.js and npm installed
3. Supabase CLI (optional but recommended)

## Deployment Steps

### 1. Deploy SQL Functions and Views

#### Option A: Using Supabase CLI (Recommended)
```bash
# Navigate to project root
cd wardah-process-costing

# Deploy migrations
npx supabase migration up
```

#### Option B: Deploy Individual Files
```bash
# Deploy variance functions
npx supabase sql -f src/database/migrations/001_create_variance_functions.sql

# Deploy WIP view
npx supabase sql -f src/database/migrations/002_create_wip_view.sql
```

#### Option C: Manual Deployment
1. Open the Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `WARDAH_ADVANCED_REPORTS_SCHEMA.sql`
4. Run the SQL script

### 2. Verify SQL Deployment

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

## React Components

The React components are automatically available through the existing reports module. No additional deployment steps are required for the frontend components.

### Available Components
1. `VarianceAnalysisReport` - Displays material and labor variances
2. `WIPReport` - Shows work in progress by stage
3. `ProfitabilityReport` - Placeholder for profitability analysis
4. `ReportsDashboard` - Main dashboard integrating all reports

## Accessing the Reports

### Via Navigation
1. Open the Wardah ERP application
2. Navigate to the Reports section
3. Click on "Advanced Reports" in the reports categories
4. Access the dashboard at: `/reports/advanced`

### Direct URL Access
- Advanced Reports Dashboard: `http://your-app-url/reports/advanced`

## Using the Reports

### 1. Variance Analysis Report
- Select a manufacturing order from the dropdown
- View material and labor variances
- Analyze quantity, price, rate, and efficiency variances
- Unfavorable variances are shown in red, favorable in green

### 2. WIP Report
- View work in progress by manufacturing order
- See planned vs. produced quantities
- Analyze cost breakdown (materials, labor, overhead)
- Monitor current unit costs

### 3. Profitability Report
- Placeholder for future implementation
- Ready for revenue and cost integration

## Troubleshooting

### Common Issues

1. **UUID Comparison Errors**
   - Error: `operator does not exist: uuid = text`
   - Solution: All SQL functions now use proper casting (`::text`)

2. **Missing Column Errors**
   - Error: `column X does not exist`
   - Solution: Functions updated to use correct column names
   - `manufacturing_order_id` instead of `mo_id` in labor_entries table

3. **Permission Errors**
   - Ensure you're using the service role key for deployment
   - Check that the deploying user has adequate permissions

### Diagnostic Queries

If you encounter issues, run these diagnostic queries:

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

-- Check manufacturing_orders table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'manufacturing_orders'
ORDER BY ordinal_position;
```

## Future Enhancements

1. **Profitability Analysis**
   - Implement actual profitability calculations
   - Add revenue data integration

2. **Export Functionality**
   - Add PDF and Excel export options
   - Implement print-friendly layouts

3. **Advanced Filtering**
   - Add product-based filtering
   - Implement date range presets

## Support

For issues with the Advanced Reports System, please contact the development team or refer to the implementation documentation in `ADVANCED_REPORTS_IMPLEMENTATION_SUMMARY.md`.