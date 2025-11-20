# Deploy HR Module Database Schema

This document explains how to deploy the database schema for the HR module in the Wardah ERP system.

## Prerequisites

1. Access to the Supabase project dashboard
2. Service role key (already configured in config.json)
3. The main Wardah ERP database schema should already be deployed

## Deployment Options

### Option 1: Using Supabase SQL Editor (Recommended)

1. Open your Supabase project dashboard
2. Navigate to the SQL editor
3. Copy the contents of `sql/15_hr_module.sql`
4. Paste it into the SQL editor
5. Click "Run" to execute the script
6. Repeat the same steps للملفات التالية:
   - `sql/hr/16_hr_operational_extensions.sql` (للتنبيهات، التسويات، سندات القبض والصرف)
   - `sql/hr/17_hr_core_extensions.sql` (لسياسات العمل، الحضور الشهري، إقفال الرواتب، وحسابات GL)

### Option 2: Using psql or other PostgreSQL clients

1. Connect to your Supabase database using psql or another PostgreSQL client
2. Execute the `sql/15_hr_module.sql` file:
   ```bash
   psql -h [your-supabase-db-host] -d [your-database-name] -U [your-username] -f sql/15_hr_module.sql
   ```
3. ثم نفّذ ملفات الامتدادات:
   ```bash
   psql -h [your-supabase-db-host] -d [your-database-name] -U [your-username] -f sql/hr/16_hr_operational_extensions.sql
   psql -h [your-supabase-db-host] -d [your-database-name] -U [your-username] -f sql/hr/17_hr_core_extensions.sql
   ```

### Option 3: Manual execution

If you prefer to execute the tables and constraints separately:

1. Execute the employees table from `sql/15_hr_module.sql`
2. Execute the departments table from `sql/15_hr_module.sql`
3. Execute the positions table from `sql/15_hr_module.sql`
4. Execute the salary components table from `sql/15_hr_module.sql`
5. Execute the employee salary structures table from `sql/15_hr_module.sql`
6. Execute the payroll periods table from `sql/15_hr_module.sql`
7. Execute the payroll runs table from `sql/15_hr_module.sql`
8. Execute the payroll details table from `sql/15_hr_module.sql`
9. Execute the attendance records table from `sql/15_hr_module.sql`
10. Execute the leave types table from `sql/15_hr_module.sql`
11. Execute the employee leaves table from `sql/15_hr_module.sql`
12. Execute the smart alerts, settlements, and payroll adjustments objects from `sql/hr/16_hr_operational_extensions.sql`
13. Execute سياسات العمل والحضور الشهري وإقفال الرواتب من `sql/hr/17_hr_core_extensions.sql`

## Verification

After deployment, you can verify the tables were created successfully:

1. In the Supabase dashboard, navigate to "Database" → "Tables"
2. You should see the following HR tables:
   - `employees`
   - `departments`
   - `positions`
   - `salary_components`
   - `employee_salary_structures`
   - `payroll_periods`
   - `payroll_runs`
   - `payroll_details`
   - `attendance_records`
   - `leave_types`
   - `employee_leaves`
   - `hr_alerts`
   - `hr_settlements`
   - `hr_settlement_lines`
   - `hr_payroll_adjustments`
   - `hr_policies`
   - `hr_attendance_monthly`
   - `hr_payroll_locks`
   - `hr_payroll_account_mappings`

3. Verify the indexes were created:
   - Check that indexes exist for performance optimization on all HR tables

4. Verify the RLS policies were applied:
   - تأكد من تفعيل RLS على جميع جداول الموارد البشرية، بما في ذلك الجداول الجديدة `hr_policies`, `hr_attendance_monthly`, `hr_payroll_locks`, `hr_payroll_account_mappings`.
   - Verify that policies exist for tenant-based data isolation

## Testing

To test the HR module functionality, you can run these queries in the SQL editor:

```sql
-- Test employees table
SELECT * FROM employees LIMIT 5;

-- Test departments table
SELECT * FROM departments LIMIT 5;

-- Test that sample data was inserted
SELECT COUNT(*) as department_count FROM departments;
SELECT COUNT(*) as position_count FROM positions;
SELECT COUNT(*) as salary_component_count FROM salary_components;
SELECT COUNT(*) as leave_type_count FROM leave_types;
```

## Troubleshooting

### Common Issues

1. **Permission denied errors**: Make sure you're using the service role key, not the anon key
2. **Table already exists errors**: The script includes `IF NOT EXISTS` clauses, but you can manually drop them first:
   ```sql
   DROP TABLE IF EXISTS employee_leaves, employee_salary_structures, payroll_details, payroll_runs, 
                        payroll_periods, attendance_records, leave_types, salary_components, 
                        positions, departments, employees CASCADE;
   ```

3. **Foreign key constraint errors**: Make sure the main Wardah ERP schema is deployed before deploying the HR module
4. **RLS policy errors**: Ensure that the required tables (organizations, user_organizations) exist in your database

### Schema Notes

- The HR module uses the same multi-tenant architecture as the main Wardah ERP system
- All tables include `org_id` references for organization-based data isolation
- Row Level Security policies ensure users can only access data from their organization
- Audit fields (`created_at`, `updated_at`) are automatically maintained through triggers
- The schema includes proper indexing for performance optimization
- Sample data is included for initial testing and setup

## Next Steps

After deploying the database schema:

1. Start the application: `npm run dev`
2. Navigate to the HR module
3. Configure HR settings in the application
4. Import or create employee data
5. Set up departments, positions, and salary structures
6. Configure payroll periods and components
7. Set up leave types and policies