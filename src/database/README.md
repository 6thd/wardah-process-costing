# Database Utilities

This directory contains utilities for managing the Wardah Factory Process Costing database.

## Contents

1. `migrations/` - SQL migration scripts for database schema changes
2. `execute-migrations.ts` - TypeScript script to execute migrations
3. `test-functions.ts` - Script to test database functions
4. `README.md` - This file

## Migration Files

1. `001_create_variance_functions.sql` - Creates SQL functions for material and labor variance analysis
2. `002_create_wip_view.sql` - Creates the WIP by stage view

## How to Run Migrations

### Prerequisites

1. The `config.json` file must contain your Supabase service role key (already configured)
2. Node.js must be installed

### Running Migrations

You can deploy the database schema in two ways:

1. **Using the combined SQL file** (recommended):
   - Copy the contents of `WARDAH_ADVANCED_REPORTS_SCHEMA.sql` from the project root
   - Paste it into the Supabase SQL editor
   - Click "Run"

2. **Using the migration files**:
   - The migration files in the `migrations/` directory can be executed individually
   - Refer to `DEPLOY_DATABASE_SCHEMA.md` in the project root for detailed instructions

## Testing Database Functions

To test the database functions:

```bash
# Navigate to the project root
cd wardah-process-costing

# Run the test script
npx ts-node src/database/test-functions.ts
```

## Notes

- The migration script will drop existing functions/views before creating new ones
- Make sure to backup your database before running migrations in production
- Some functions may need to be adjusted based on your actual table schema