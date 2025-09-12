/**
 * Security and Multi-Tenant Utilities
 * JWT token management and tenant isolation
 */

import { getSupabase } from './supabaseClient.js'

/**
 * Extract tenant ID from JWT token
 */
export const extractTenantFromJWT = (token) => {
  if (!token) return null
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.tenant_id || null
  } catch (error) {
    console.error('Failed to extract tenant from JWT:', error)
    return null
  }
}

/**
 * Get current tenant ID with multiple fallback methods
 */
export const getCurrentTenantId = async () => {
  try {
    const supabase = getSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.access_token) return null
    
    // Try multiple sources for tenant_id
    return session.user?.user_metadata?.tenant_id ||
           extractTenantFromJWT(session.access_token) ||
           session.user?.app_metadata?.tenant_id ||
           null
           
  } catch (error) {
    console.error('Failed to get current tenant ID:', error)
    return null
  }
}

/**
 * Verify tenant access for a given resource
 */
export const verifyTenantAccess = async (resourceTenantId) => {
  const currentTenantId = await getCurrentTenantId()
  
  if (!currentTenantId) {
    throw new Error('No tenant context available')
  }
  
  if (currentTenantId !== resourceTenantId) {
    throw new Error('Access denied: Tenant mismatch')
  }
  
  return true
}

/**
 * Create tenant-aware query filter
 */
export const createTenantFilter = async () => {
  const tenantId = await getCurrentTenantId()
  
  if (!tenantId) {
    throw new Error('No tenant context for query')
  }
  
  return { tenant_id: tenantId }
}

/**
 * Apply tenant filter to Supabase query
 */
export const applyTenantFilter = async (query) => {
  const tenantId = await getCurrentTenantId()
  
  if (tenantId) {
    return query.eq('tenant_id', tenantId)
  }
  
  return query
}

/**
 * Get current user with tenant context
 */
export const getCurrentUserWithTenant = async () => {
  try {
    const supabase = getSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session?.user) return null
    
    const tenantId = await getCurrentTenantId()
    
    return {
      ...session.user,
      tenant_id: tenantId,
      has_tenant_access: Boolean(tenantId)
    }
    
  } catch (error) {
    console.error('Failed to get current user with tenant:', error)
    return null
  }
}

/**
 * Validate JWT token structure and claims
 */
export const validateJWTStructure = (token) => {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Invalid token format' }
  }
  
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid JWT structure' }
  }
  
  try {
    const payload = JSON.parse(atob(parts[1]))
    
    // Check required claims
    const requiredClaims = ['sub', 'iat', 'exp']
    for (const claim of requiredClaims) {
      if (!payload[claim]) {
        return { valid: false, error: `Missing required claim: ${claim}` }
      }
    }
    
    // Check expiration
    if (payload.exp * 1000 < Date.now()) {
      return { valid: false, error: 'Token expired' }
    }
    
    return { 
      valid: true, 
      payload,
      tenant_id: payload.tenant_id || null
    }
    
  } catch (error) {
    return { valid: false, error: 'Failed to parse JWT payload' }
  }
}

/**
 * Security middleware for API calls
 */
export const withSecurity = (fn) => {
  return async (...args) => {
    try {
      const user = await getCurrentUserWithTenant()
      
      if (!user) {
        throw new Error('Authentication required')
      }
      
      if (!user.has_tenant_access) {
        throw new Error('Tenant access required')
      }
      
      return await fn(...args, user)
      
    } catch (error) {
      console.error('Security check failed:', error)
      throw error
    }
  }
}

export default {
  extractTenantFromJWT,
  getCurrentTenantId,
  verifyTenantAccess,
  createTenantFilter,
  applyTenantFilter,
  getCurrentUserWithTenant,
  validateJWTStructure,
  withSecurity
}