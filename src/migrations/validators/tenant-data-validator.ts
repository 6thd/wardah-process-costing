/**
 * Tenant Data Validator
 * 
 * Validates tenant data integrity and isolation
 */

import { supabase } from '@/lib/supabase';
import { getEffectiveTenantId } from '@/lib/supabase';
import { AppError } from '@/lib/errors/AppError';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    total_records: number;
    invalid_records: number;
    orphaned_records: number;
  };
}

/**
 * Tenant Data Validator
 */
class TenantDataValidator {
  /**
   * Validate that all records have org_id
   */
  async validateOrgIdPresence(tableName: string): Promise<ValidationResult> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      stats: {
        total_records: 0,
        invalid_records: 0,
        orphaned_records: 0,
      },
    };

    try {
      // Check for records without org_id
      const { data, error } = await supabase
        .from(tableName)
        .select('id, org_id, tenant_id')
        .is('org_id', null)
        .limit(1000);

      if (error) {
        result.errors.push(`Failed to validate ${tableName}: ${error.message}`);
        result.valid = false;
        return result;
      }

      if (data && data.length > 0) {
        result.errors.push(
          `Found ${data.length} records in ${tableName} without org_id`
        );
        result.stats.invalid_records = data.length;
        result.valid = false;
      }

      // Get total count
      const { count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      result.stats.total_records = count || 0;
    } catch (error) {
      result.errors.push(
        `Validation error for ${tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      result.valid = false;
    }

    return result;
  }

  /**
   * Validate tenant isolation (no cross-tenant data)
   */
  async validateTenantIsolation(tableName: string): Promise<ValidationResult> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      stats: {
        total_records: 0,
        invalid_records: 0,
        orphaned_records: 0,
      },
    };

    try {
      // Check for records with different org_id (should not be accessible)
      // This is more of a security check - RLS should prevent this
      const { data, error } = await supabase
        .from(tableName)
        .select('id, org_id')
        .neq('org_id', orgId)
        .limit(100);

      if (error && error.code !== 'PGRST116') {
        // PGRST116 means no rows found, which is expected
        result.warnings.push(
          `Could not validate isolation for ${tableName}: ${error.message}`
        );
      }

      // If we can see records from other tenants, that's a problem
      // (RLS should prevent this, but we check anyway)
      if (data && data.length > 0) {
        result.errors.push(
          `⚠️ SECURITY: Found ${data.length} records from other tenants in ${tableName}`
        );
        result.valid = false;
      }
    } catch (error) {
      result.warnings.push(
        `Isolation check error for ${tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return result;
  }

  /**
   * Validate foreign key relationships
   */
  async validateForeignKeys(
    tableName: string,
    foreignKeys: Array<{ column: string; references: string }>
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      stats: {
        total_records: 0,
        invalid_records: 0,
        orphaned_records: 0,
      },
    };

    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    for (const fk of foreignKeys) {
      try {
        // Check for orphaned records (FK points to non-existent record)
        const { data, error } = await supabase.rpc('validate_foreign_key', {
          p_table_name: tableName,
          p_column_name: fk.column,
          p_reference_table: fk.references,
          p_org_id: orgId,
        });

        if (error) {
          result.warnings.push(
            `Could not validate FK ${fk.column}: ${error.message}`
          );
          continue;
        }

        if (data && data.orphaned_count > 0) {
          result.errors.push(
            `Found ${data.orphaned_count} orphaned records in ${tableName}.${fk.column}`
          );
          result.stats.orphaned_records += data.orphaned_count;
          result.valid = false;
        }
      } catch (error) {
        result.warnings.push(
          `FK validation error for ${tableName}.${fk.column}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return result;
  }

  /**
   * Validate all tables
   */
  async validateAll(tables: string[]): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    for (const table of tables) {
      const orgIdResult = await this.validateOrgIdPresence(table);
      const isolationResult = await this.validateTenantIsolation(table);

      // Combine results
      const combined: ValidationResult = {
        valid: orgIdResult.valid && isolationResult.valid,
        errors: [...orgIdResult.errors, ...isolationResult.errors],
        warnings: [...orgIdResult.warnings, ...isolationResult.warnings],
        stats: {
          total_records: orgIdResult.stats.total_records,
          invalid_records: orgIdResult.stats.invalid_records,
          orphaned_records: isolationResult.stats.orphaned_records,
        },
      };

      results.set(table, combined);
    }

    return results;
  }
}

// Export singleton instance
export const tenantDataValidator = new TenantDataValidator();

export default tenantDataValidator;

