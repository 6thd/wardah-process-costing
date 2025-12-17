/**
 * Data Migrations Registry
 * 
 * Register all data migrations here
 */

import { migrationRunner, type DataMigration } from './data-migration-runner';

/**
 * Example migration: Unify tenant_id to org_id
 */
const unifyTenantIdMigration: DataMigration = {
  id: 'unify_tenant_id_20250101',
  name: 'Unify tenant_id to org_id',
  description: 'Migrates all tenant_id columns to org_id for consistency',
  version: '2025.01.01',
  dependencies: [],
  up: async (client) => {
    // This is an example - actual migration would update data
    console.log('Running tenant_id unification migration...');
    
    // Example: Update tables that use tenant_id to use org_id
    // const tables = ['sales_orders', 'purchase_orders', ...];
    // for (const table of tables) {
    //   await client.rpc('migrate_tenant_to_org', { table_name: table });
    // }
  },
  down: async (client) => {
    // Rollback logic
    console.log('Rolling back tenant_id unification...');
  },
};

/**
 * Register all migrations
 */
export function registerMigrations(): void {
  // Register migrations in order
  migrationRunner.register(unifyTenantIdMigration);
  
  // Add more migrations here as needed
}

/**
 * Initialize migrations
 */
export function initializeMigrations(): void {
  registerMigrations();
}

// Auto-initialize on import
initializeMigrations();

// Re-export migrationRunner as default
export { migrationRunner as default } from './data-migration-runner';

