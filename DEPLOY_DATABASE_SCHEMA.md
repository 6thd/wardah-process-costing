# Deploy Database Schema for Advanced Reports

This document explains how to deploy the database schema for the advanced reports system.

## Prerequisites

1. Access to the Supabase project dashboard
2. Service role key (already configured in config.json)

## Deployment Options

### Option 1: Using Supabase SQL Editor (Recommended)

1. Open your Supabase project dashboard
2. Navigate to the SQL editor
3. Copy the contents of `WARDAH_ADVANCED_REPORTS_SCHEMA.sql`
4. Paste it into the SQL editor
5. Click "Run" to execute the script

### Option 2: Using psql or other PostgreSQL clients

1. Connect to your Supabase database using psql or another PostgreSQL client
2. Execute the `WARDAH_ADVANCED_REPORTS_SCHEMA.sql` file:
   ```bash
   psql -h [your-supabase-db-host] -d [your-database-name] -U [your-username] -f WARDAH_ADVANCED_REPORTS_SCHEMA.sql
   ```

### Option 3: Manual execution

If you prefer to execute the functions and views separately:

1. Execute the material variances function from `src/database/migrations/001_create_variance_functions.sql`
2. Execute the WIP view from `src/database/migrations/002_create_wip_view.sql`

## Verification

After deployment, you can verify the functions and views were created successfully:

1. In the Supabase dashboard, navigate to "Database" → "Functions"
2. You should see:
   - `calculate_material_variances`
   - `calculate_labor_variances`

3. In the Supabase dashboard, navigate to "Database" → "Views"
4. You should see:
   - `wip_by_stage`

## Testing

To test the functions, you can run these queries in the SQL editor (replace the UUID with an actual manufacturing order ID from your database):

```sql
-- Test material variances function
SELECT * FROM calculate_material_variances('00000000-0000-0000-0000-000000000000');

-- Test labor variances function
SELECT * FROM calculate_labor_variances('00000000-0000-0000-0000-000000000000');

-- Test WIP view
SELECT * FROM wip_by_stage LIMIT 10;
```

## Troubleshooting

### Common Issues

1. **Permission denied errors**: Make sure you're using the service role key, not the anon key
2. **Function already exists errors**: The script includes DROP statements, but you can manually drop them first:
   ```sql
   DROP FUNCTION IF EXISTS calculate_material_variances(UUID, DATE, DATE);
   DROP FUNCTION IF EXISTS calculate_labor_variances(UUID);
   DROP VIEW IF EXISTS wip_by_stage;
   ```

3. **Syntax errors**: Make sure you're using a PostgreSQL-compatible database (Supabase is PostgreSQL-based)

### Schema Notes

- The functions use table names as defined in your `config.json` file
- The functions assume standard ERP table structures for manufacturing orders, BOMs, products, etc.
- The WIP view aggregates data from multiple tables to provide a consolidated view

## Next Steps

After deploying the database schema:

1. Start the application: `npm run dev`
2. Navigate to the Reports module
3. Click on "التقارير المتقدمة" (Advanced Reports)
4. Select a manufacturing order to view variance analysis