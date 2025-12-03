/**
 * Data Migration Runner
 * 
 * Handles data migrations with rollback support and progress tracking
 */

import { supabase } from '@/lib/supabase';
import { getEffectiveTenantId } from '@/lib/supabase';
import { AppError } from '@/lib/errors/AppError';

/**
 * Migration definition
 */
export interface DataMigration {
  id: string;
  name: string;
  description: string;
  version: string;
  up: (client: typeof supabase) => Promise<void>;
  down?: (client: typeof supabase) => Promise<void>; // Rollback function
  dependencies?: string[]; // Migration IDs this depends on
}

/**
 * Migration status
 */
export interface MigrationStatus {
  id: string;
  name: string;
  version: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
  started_at?: string;
  completed_at?: string;
  error?: string;
  execution_time_ms?: number;
}

/**
 * Data Migration Runner
 */
class DataMigrationRunner {
  private migrations: Map<string, DataMigration> = new Map();
  private executedMigrations: Set<string> = new Set();

  /**
   * Register a migration
   */
  register(migration: DataMigration): void {
    this.migrations.set(migration.id, migration);
  }

  /**
   * Get all registered migrations
   */
  getMigrations(): DataMigration[] {
    return Array.from(this.migrations.values());
  }

  /**
   * Get migration by ID
   */
  getMigration(id: string): DataMigration | undefined {
    return this.migrations.get(id);
  }

  /**
   * Check if migration has been executed
   */
  async isExecuted(migrationId: string): Promise<boolean> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) return false;

    const { data } = await supabase
      .from('data_migrations')
      .select('id')
      .eq('migration_id', migrationId)
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .maybeSingle();

    return !!data;
  }

  /**
   * Record migration execution
   */
  private async recordMigration(
    migration: DataMigration,
    status: 'completed' | 'failed' | 'rolled_back',
    error?: string,
    executionTime?: number
  ): Promise<void> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    await supabase.from('data_migrations').upsert({
      org_id: orgId,
      migration_id: migration.id,
      migration_name: migration.name,
      migration_version: migration.version,
      status,
      error: error || null,
      execution_time_ms: executionTime || null,
      executed_at: new Date().toISOString(),
    });
  }

  /**
   * Run a single migration
   */
  async runMigration(migration: DataMigration): Promise<void> {
    const startTime = Date.now();

    try {
      // Check dependencies
      if (migration.dependencies) {
        for (const depId of migration.dependencies) {
          const depExecuted = await this.isExecuted(depId);
          if (!depExecuted) {
            throw new AppError(
              'MIGRATION_DEPENDENCY',
              `Migration ${migration.id} depends on ${depId} which has not been executed`,
              400
            );
          }
        }
      }

      // Check if already executed
      const alreadyExecuted = await this.isExecuted(migration.id);
      if (alreadyExecuted) {
        console.log(`Migration ${migration.id} already executed, skipping`);
        return;
      }

      console.log(`Running migration: ${migration.name} (${migration.id})`);

      // Execute migration
      await migration.up(supabase);

      const executionTime = Date.now() - startTime;

      // Record success
      await this.recordMigration(migration, 'completed', undefined, executionTime);

      console.log(`✓ Migration ${migration.id} completed in ${executionTime}ms`);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failure
      await this.recordMigration(migration, 'failed', errorMessage, executionTime);

      console.error(`✗ Migration ${migration.id} failed:`, errorMessage);
      throw error;
    }
  }

  /**
   * Rollback a migration
   */
  async rollbackMigration(migrationId: string): Promise<void> {
    const migration = this.migrations.get(migrationId);
    if (!migration) {
      throw new AppError('MIGRATION_NOT_FOUND', `Migration ${migrationId} not found`, 404);
    }

    if (!migration.down) {
      throw new AppError(
        'ROLLBACK_NOT_SUPPORTED',
        `Migration ${migrationId} does not support rollback`,
        400
      );
    }

    const startTime = Date.now();

    try {
      console.log(`Rolling back migration: ${migration.name} (${migration.id})`);

      // Execute rollback
      await migration.down(supabase);

      const executionTime = Date.now() - startTime;

      // Record rollback
      await this.recordMigration(migration, 'rolled_back', undefined, executionTime);

      console.log(`✓ Migration ${migrationId} rolled back in ${executionTime}ms`);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.recordMigration(migration, 'failed', errorMessage, executionTime);

      console.error(`✗ Rollback of ${migrationId} failed:`, errorMessage);
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async runAll(): Promise<void> {
    const migrations = this.getMigrations().sort((a, b) => 
      a.version.localeCompare(b.version)
    );

    for (const migration of migrations) {
      const executed = await this.isExecuted(migration.id);
      if (!executed) {
        await this.runMigration(migration);
      }
    }
  }

  /**
   * Get migration status
   */
  async getStatus(): Promise<MigrationStatus[]> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      return [];
    }

    const { data } = await supabase
      .from('data_migrations')
      .select('*')
      .eq('org_id', orgId)
      .order('executed_at', { ascending: false });

    return (data || []).map(m => ({
      id: m.migration_id,
      name: m.migration_name,
      version: m.migration_version,
      status: m.status,
      started_at: m.executed_at,
      completed_at: m.status === 'completed' ? m.executed_at : undefined,
      error: m.error || undefined,
      execution_time_ms: m.execution_time_ms || undefined,
    })) as MigrationStatus[];
  }
}

// Create singleton instance
export const migrationRunner = new DataMigrationRunner();

/**
 * Create migration table if it doesn't exist
 */
export async function ensureMigrationTable(): Promise<void> {
  // This would typically be done via SQL migration
  // For now, we'll assume the table exists or will be created by a migration
}

export default migrationRunner;

