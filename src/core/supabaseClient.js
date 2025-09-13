/**
 * Dynamic Supabase Client Configuration
 * Zero-hardcode approach - all configuration loaded from config.json
 */

import { createClient } from '@supabase/supabase-js'

// Use dynamic import to avoid circular dependencies
let configModule = null

const loadConfigModule = async () => {
  if (!configModule) {
    configModule = await import('./config.ts')
  }
  return configModule
}

let supabaseClient = null
let configCache = null

/**
 * Initialize Supabase client with dynamic configuration
 */
export const initializeSupabase = async () => {
  if (supabaseClient) return supabaseClient

  try {
    const config = await loadConfigModule()
    configCache = await config.loadConfig()
    
    // Use config.json values if available, otherwise fallback to env vars
    const supabaseUrl = configCache.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = configCache.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL and Anon Key must be provided in config.json or environment variables')
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      },
      db: {
        schema: 'public'
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    })

    console.log('✅ Supabase client initialized successfully')
    return supabaseClient

  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error)
    throw error
  }
}

/**
 * Get initialized Supabase client
 */
export const getSupabase = () => {
  if (!supabaseClient) {
    throw new Error('Supabase client not initialized. Call initializeSupabase() first.')
  }
  return supabaseClient
}

/**
 * Get configuration cache
 */
export const getConfig = () => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call initializeSupabase() first.')
  }
  return configCache
}

/**
 * Tenant management functions with JWT extraction
 */
export const getTenantId = async () => {
  const client = getSupabase()
  const { data: { session } } = await client.auth.getSession()
  
  // Extract tenant_id from JWT claims
  return session?.user?.user_metadata?.tenant_id || 
         (session?.access_token && JSON.parse(atob(session.access_token.split('.')[1])).tenant_id) ||
         null
}

export const getCurrentUser = async () => {
  const client = getSupabase()
  const { data: { session } } = await client.auth.getSession()
  return session?.user || null
}

/**
 * Connection health check
 */
export const checkConnection = async () => {
  try {
    const client = getSupabase()
    const config = getConfig()
    const { error } = await client
      .from(config.TABLE_NAMES.users)
      .select('count')
      .limit(1)
    
    return !error
  } catch {
    return false
  }
}

/**
 * Multi-tenant query helper
 */
export const withTenant = async (tableName) => {
  const client = getSupabase()
  const config = getConfig()
  const tenantId = await getTenantId()
  
  const table = config.TABLE_NAMES[tableName] || tableName
  
  // Return an object with properly initialized query methods
  return {
    select: (columns = '*') => {
      const query = client.from(table).select(columns)
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    insert: (data) => {
      const insertData = tenantId ? { ...data, tenant_id: tenantId } : data
      return client.from(table).insert(insertData)
    },
    update: (data) => {
      const query = client.from(table).update(data)
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    delete: () => {
      const query = client.from(table).delete()
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    upsert: (data) => {
      const upsertData = tenantId ? { ...data, tenant_id: tenantId } : data
      return client.from(table).upsert(upsertData)
    },
    // For cases where you need the raw client.from() with proper tenant filtering
    from: () => client.from(table),
    // Get tenant ID for manual query building
    getTenantId: () => tenantId,
    // Get table name for manual query building
    getTableName: () => table
  }
}

export default { 
  initializeSupabase, 
  getSupabase, 
  getConfig,
  getTenantId, 
  getCurrentUser, 
  checkConnection, 
  withTenant 
}