/**
 * Tenant Validation Middleware
 * 
 * This module provides utilities to validate tenant access
 * and ensure tenant isolation is maintained.
 */

import { getEffectiveTenantId } from './supabase';
import { getTenantClient } from './tenant-client';

/**
 * Tenant validation error
 */
export class TenantValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantValidationError';
  }
}

/**
 * Validate that a tenant ID is set
 */
export async function validateTenantId(): Promise<string> {
  const tenantId = await getEffectiveTenantId();
  
  if (!tenantId) {
    throw new TenantValidationError(
      'Tenant ID not found. User must be authenticated and belong to an organization.'
    );
  }
  
  return tenantId;
}

/**
 * Validate that a resource belongs to the current tenant
 */
export async function validateTenantAccess(
  tableName: string,
  resourceId: string,
  tenantColumn: string = 'org_id'
): Promise<boolean> {
  const tenantId = await validateTenantId();
  
  const client = getTenantClient();
  const query = await client.from(tableName);
  
  const { data, error } = await query
    .select('id')
    .eq('id', resourceId)
    .eq(tenantColumn, tenantId)
    .maybeSingle();
  
  if (error) {
    throw new TenantValidationError(
      `Failed to validate tenant access: ${error.message}`
    );
  }
  
  if (!data) {
    throw new TenantValidationError(
      'Resource not found or access denied. Resource does not belong to your organization.'
    );
  }
  
  return true;
}

/**
 * Validate tenant ID matches current tenant
 */
export async function validateTenantMatch(
  providedTenantId: string
): Promise<boolean> {
  const currentTenantId = await validateTenantId();
  
  if (providedTenantId !== currentTenantId) {
    throw new TenantValidationError(
      'Tenant ID mismatch. Cannot access resources from another organization.'
    );
  }
  
  return true;
}

/**
 * Validate data includes correct tenant ID
 */
export async function validateTenantData(
  data: Record<string, any>,
  tenantColumn: string = 'org_id'
): Promise<Record<string, any>> {
  const tenantId = await validateTenantId();
  
  // If data already has tenant ID, validate it matches
  if (data[tenantColumn]) {
    if (data[tenantColumn] !== tenantId) {
      throw new TenantValidationError(
        'Cannot create/update resource with different tenant ID.'
      );
    }
  } else {
    // Add tenant ID if missing
    data[tenantColumn] = tenantId;
  }
  
  return data;
}

/**
 * Middleware function to validate tenant access for API routes
 */
export async function requireTenantAccess(
  tableName: string,
  resourceId: string
): Promise<void> {
  try {
    await validateTenantAccess(tableName, resourceId);
  } catch (error) {
    if (error instanceof TenantValidationError) {
      throw error;
    }
    throw new TenantValidationError(
      `Tenant access validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Check if user is super admin (bypasses tenant checks)
 */
export async function isSuperAdmin(): Promise<boolean> {
  const client = getTenantClient();
  return client.isSuperAdmin();
}

/**
 * Validate tenant access with super admin override
 */
export async function validateTenantAccessWithOverride(
  tableName: string,
  resourceId: string
): Promise<boolean> {
  // Super admins can access any resource
  if (await isSuperAdmin()) {
    return true;
  }
  
  // Regular users must pass tenant validation
  return validateTenantAccess(tableName, resourceId);
}

