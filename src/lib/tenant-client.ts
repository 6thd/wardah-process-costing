/**
 * Tenant-Aware Supabase Client
 * 
 * This module provides a tenant-aware wrapper around Supabase client
 * that automatically applies tenant filtering to all queries.
 * 
 * It ensures that:
 * 1. All queries are automatically filtered by org_id
 * 2. Tenant ID is automatically added to inserts
 * 3. Cross-tenant access is prevented
 * 4. Consistent tenant isolation across the application
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase, getEffectiveTenantId } from './supabase';

/**
 * Tenant-aware query builder interface
 */
export interface TenantAwareQueryBuilder<T = any> {
  select(columns?: string): TenantAwareQueryBuilder<T>;
  insert(data: any): TenantAwareQueryBuilder<T>;
  update(data: any): TenantAwareQueryBuilder<T>;
  delete(): TenantAwareQueryBuilder<T>;
  upsert(data: any): TenantAwareQueryBuilder<T>;
  eq(column: string, value: any): TenantAwareQueryBuilder<T>;
  neq(column: string, value: any): TenantAwareQueryBuilder<T>;
  gt(column: string, value: any): TenantAwareQueryBuilder<T>;
  gte(column: string, value: any): TenantAwareQueryBuilder<T>;
  lt(column: string, value: any): TenantAwareQueryBuilder<T>;
  lte(column: string, value: any): TenantAwareQueryBuilder<T>;
  like(column: string, pattern: string): TenantAwareQueryBuilder<T>;
  ilike(column: string, pattern: string): TenantAwareQueryBuilder<T>;
  is(column: string, value: any): TenantAwareQueryBuilder<T>;
  in(column: string, values: any[]): TenantAwareQueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): TenantAwareQueryBuilder<T>;
  limit(count: number): TenantAwareQueryBuilder<T>;
  range(from: number, to: number): TenantAwareQueryBuilder<T>;
  single(): Promise<{ data: T | null; error: any }>;
  maybeSingle(): Promise<{ data: T | null; error: any }>;
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;
}

/**
 * Tenant-aware Supabase client wrapper
 */
class TenantAwareSupabaseClient {
  private client: SupabaseClient;
  private tenantId: string | null = null;
  private tenantIdPromise: Promise<string | null> | null = null;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /**
   * Get current tenant ID (cached)
   */
  private async getTenantId(): Promise<string | null> {
    if (this.tenantId) {
      return this.tenantId;
    }

    if (this.tenantIdPromise) {
      return this.tenantIdPromise;
    }

    this.tenantIdPromise = getEffectiveTenantId();
    this.tenantId = await this.tenantIdPromise;
    
    return this.tenantId;
  }

  /**
   * Clear tenant ID cache (useful after logout/login)
   */
  clearTenantCache(): void {
    this.tenantId = null;
    this.tenantIdPromise = null;
  }

  /**
   * Get tenant-aware query builder for a table
   */
  async from<T = any>(tableName: string): Promise<TenantAwareQueryBuilder<T>> {
    const tenantId = await this.getTenantId();
    
    if (!tenantId) {
      throw new Error('Tenant ID not found. User must be authenticated and belong to an organization.');
    }

    // Determine tenant column name (prefer org_id, fallback to tenant_id)
    const tenantColumn = await this.getTenantColumn(tableName);

    // Create a proxy that wraps the Supabase query builder
    return this.createQueryBuilder<T>(tableName, tenantId, tenantColumn);
  }

  /**
   * Determine the tenant column name for a table
   */
  private async getTenantColumn(tableName: string): Promise<string> {
    // Check if table has org_id column (preferred)
    // In a real implementation, you might query the schema
    // For now, we'll use a mapping or default to org_id
    
    // Common tenant column names
    const tenantColumns: Record<string, string> = {
      // Most tables use org_id
      'default': 'org_id',
      // Some legacy tables might use tenant_id
    };

    // Check if we have a specific mapping
    return tenantColumns[tableName] || tenantColumns['default'] || 'org_id';
  }

  /**
   * Create a tenant-aware query builder
   */
  private createQueryBuilder<T>(
    tableName: string,
    tenantId: string,
    tenantColumn: string
  ): TenantAwareQueryBuilder<T> {
    let query = this.client.from(tableName);

    // Apply tenant filter for SELECT, UPDATE, DELETE
    const applyTenantFilter = () => {
      // Check if tenant filter already applied
      // In Supabase, we need to apply it explicitly
      // Note: This is a simplified approach - in production, use RLS policies
      // @ts-ignore - Supabase query builder typing
      query = query.eq(tenantColumn, tenantId);
    };

    // Create proxy to intercept method calls
    const handler: ProxyHandler<any> = {
      get(target, prop: string) {
        // Methods that need tenant filtering
        if (['select', 'update', 'delete'].includes(prop)) {
          return function(...args: any[]) {
            applyTenantFilter();
            const result = (query as any)[prop](...args);
            
            // If result is a query builder, wrap it
            if (result && typeof result === 'object' && 'then' in result) {
              return result;
            }
            
            // Return wrapped query builder
            return new Proxy(result || query, handler);
          };
        }

        // Methods that need tenant ID injection
        if (prop === 'insert' || prop === 'upsert') {
          return function(data: any) {
            // Ensure data is an array
            const dataArray = Array.isArray(data) ? data : [data];
            
            // Add tenant ID to each record
            const dataWithTenant = dataArray.map((record: any) => ({
              ...record,
              [tenantColumn]: tenantId,
            }));

            const result = (query as any)[prop](dataWithTenant);
            return new Proxy(result || query, handler);
          };
        }

        // Chainable methods - return wrapped query builder
        if (typeof (query as any)[prop] === 'function') {
          return function(...args: any[]) {
            const result = (query as any)[prop](...args);
            
            // If it returns a promise (like single(), then()), return as-is
            if (result && typeof result.then === 'function') {
              return result;
            }
            
            // Otherwise, wrap in proxy for chaining
            return new Proxy(result || query, handler);
          };
        }

        // Properties - return as-is
        return (query as any)[prop];
      },
    };

    // Apply initial tenant filter for SELECT
    applyTenantFilter();

    return new Proxy(query, handler) as TenantAwareQueryBuilder<T>;
  }

  /**
   * Get raw Supabase client (use with caution)
   * Only use when you need to bypass tenant filtering (e.g., for super admin)
   */
  getRawClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Check if current user is super admin
   */
  async isSuperAdmin(): Promise<boolean> {
    try {
      const { data: { user } } = await this.client.auth.getUser();
      if (!user) return false;

      const { data, error } = await this.client
        .from('super_admins')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      return !error && data !== null;
    } catch {
      return false;
    }
  }
}

// Create singleton instance
let tenantClientInstance: TenantAwareSupabaseClient | null = null;

/**
 * Get tenant-aware Supabase client instance
 */
export function getTenantClient(): TenantAwareSupabaseClient {
  if (!tenantClientInstance) {
    tenantClientInstance = new TenantAwareSupabaseClient(supabase);
  }
  return tenantClientInstance;
}

/**
 * Clear tenant client cache (call after logout)
 */
export function clearTenantClientCache(): void {
  if (tenantClientInstance) {
    tenantClientInstance.clearTenantCache();
  }
}

/**
 * Convenience function to get tenant-aware query builder
 */
export async function fromTenant<T = any>(tableName: string): Promise<TenantAwareQueryBuilder<T>> {
  const client = getTenantClient();
  return client.from<T>(tableName);
}

export default getTenantClient;

