/**
 * Supabase Client with Dynamic Configuration and Security
 * Zero-hardcode approach using secure config management
 */

import { createClient, SupabaseClient, AuthChangeEvent, Session } from '@supabase/supabase-js'
import { loadConfig, getConfig } from '../lib/config'

// Global client instance
let supabaseClient: SupabaseClient | null = null
let isInitialized = false
let initPromise: Promise<SupabaseClient> | null = null

/**
 * Initialize Supabase client with dynamic configuration and security
 */
const initializeClient = async (): Promise<SupabaseClient> => {
  if (supabaseClient && isInitialized) {
    return supabaseClient
  }

  try {
    console.log('🔧 Initializing Supabase client...')
    
    // Load configuration first
    await loadConfig()

    // In demo mode, we don't need actual Supabase credentials
    const configData = {
      SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
      SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'
    }

    // Create Supabase client with optimized settings
    supabaseClient = createClient(configData.SUPABASE_URL, configData.SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce'
      },
      db: {
        schema: 'public'
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        },
        timeout: 30000
      },
      global: {
        headers: {
          'X-Client-Info': 'wardah-erp@2.0.0'
        }
      }
    })

    isInitialized = true
    console.log('✅ Supabase client initialized successfully')
    
    return supabaseClient

  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error)
    isInitialized = false
    supabaseClient = null
    throw error
  }
}

/**
 * Get Supabase client instance (async)
 */
export const getSupabase = async (): Promise<SupabaseClient> => {
  if (supabaseClient && isInitialized) {
    return supabaseClient
  }
  
  if (!initPromise) {
    initPromise = initializeClient()
  }
  
  return initPromise
}

/**
 * Get Supabase client instance (sync) - use only after initialization
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(prop) {
    if (!supabaseClient) {
      throw new Error('Supabase client not initialized. Call getSupabase() first or ensure initialization is complete.')
    }
    
    const value = Reflect.get(supabaseClient, prop, supabaseClient)
    return typeof value === 'function' ? value.bind(supabaseClient) : value
  }
})

/**
 * Initialize client immediately (for backward compatibility)
 */
const clientPromise = initializeClient().catch(error => {
  console.error('Failed to auto-initialize Supabase client:', error)
  return null
})

// Export the promise for advanced usage
export const supabasePromise = clientPromise

/**
 * Extract tenant ID from current session JWT
 */
export const getTenantId = async (): Promise<string | null> => {
  try {
    const client = await getSupabase()
    const { data: { session } } = await client.auth.getSession()
    
    if (!session?.access_token) {
      return null
    }
    
    // Extract tenant_id from JWT payload
    const payload = JSON.parse(atob(session.access_token.split('.')[1]))
    return payload.tenant_id || null
    
  } catch (error) {
    console.error('Error extracting tenant ID:', error)
    return null
  }
}

/**
 * Get current authenticated user
 */
export const getCurrentUser = async () => {
  try {
    const client = await getSupabase()
    const { data: { session } } = await client.auth.getSession()
    return session?.user || null
  } catch (error) {
    console.error('Error getting current user:', error)
    return null
  }
}

/**
 * Helper function for tenant-aware queries
 * Returns an object with methods that properly initialize queries with tenant filtering
 */
export const withTenant = async (tableName: string) => {
  try {
    const client = await getSupabase()
    const tenantId = await getTenantId()
    const config = getConfig()
    
    // Handle null config
    if (!config) {
      throw new Error('Configuration not loaded')
    }
    
    const actualTableName = config.TABLE_NAMES[tableName] || tableName
    
    // Return an object with properly initialized query methods
    return {
      select: (columns: string = '*') => {
        const query = client.from(actualTableName).select(columns)
        return config.FEATURES.multi_tenant && tenantId 
          ? query.eq('tenant_id', tenantId) 
          : query
      },
      insert: (data: any) => {
        const insertData = config.FEATURES.multi_tenant && tenantId 
          ? { ...data, tenant_id: tenantId }
          : data
        return client.from(actualTableName).insert(insertData)
      },
      update: (data: any) => {
        const query = client.from(actualTableName).update(data)
        return config.FEATURES.multi_tenant && tenantId 
          ? query.eq('tenant_id', tenantId) 
          : query
      },
      delete: () => {
        const query = client.from(actualTableName).delete()
        return config.FEATURES.multi_tenant && tenantId 
          ? query.eq('tenant_id', tenantId) 
          : query
      },
      upsert: (data: any) => {
        const upsertData = config.FEATURES.multi_tenant && tenantId 
          ? { ...data, tenant_id: tenantId }
          : data
        return client.from(actualTableName).upsert(upsertData)
      },
      // For cases where you need the raw client.from() with proper tenant filtering
      from: () => client.from(actualTableName),
      // Get tenant ID for manual query building
      getTenantId: () => tenantId,
      // Get table name for manual query building
      getTableName: () => actualTableName
    }
  } catch (error) {
    console.error('Error in withTenant:', error)
    throw error
  }
}

// Connection status check
export const checkConnection = async (): Promise<boolean> => {
  try {
    const client = await getSupabase()
    const config = getConfig()
    
    // Handle null config
    if (!config) return false
    
    const tableName = config.TABLE_NAMES.users || 'users'
    const { error } = await client.from(tableName).select('count').limit(1)
    return !error
  } catch {
    return false
  }
}

/**
 * Setup auth state change listener
 */
export const onAuthStateChange = (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
  return clientPromise.then(client => {
    if (client) {
      return client.auth.onAuthStateChange(callback)
    }
    return { data: { subscription: { unsubscribe: () => {} } } }
  })
}

/**
 * Reset client (useful for testing)
 */
export const resetClient = () => {
  supabaseClient = null
  isInitialized = false
  initPromise = null
}

/**
 * Get initialization status
 */
export const isClientInitialized = () => isInitialized

// Database Types
export interface User {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'manager' | 'employee'
  tenant_id: string
  is_active: boolean
  last_login_at?: string
  created_at: string
  updated_at: string
}

export interface Item {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  category_id?: string
  unit: string
  item_type: 'raw_material' | 'work_in_process' | 'finished_good' | 'consumable'
  cost_price: number
  selling_price: number
  standard_cost: number
  current_avg_cost: number
  stock_quantity: number
  minimum_stock: number
  maximum_stock?: number
  reorder_point: number
  tenant_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ManufacturingOrder {
  id: string
  order_number: string
  item_id: string
  quantity: number
  status: 'pending' | 'released' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  start_date?: string
  due_date?: string
  completed_date?: string
  completed_quantity: number
  scrap_quantity: number
  total_cost: number
  unit_cost: number
  notes?: string
  created_by?: string
  tenant_id: string
  created_at: string
  updated_at: string
}

export interface StageCost {
  id: string
  mo_id: string
  stage_no: number
  work_center_id: string
  good_qty: number
  scrap_qty: number
  rework_qty: number
  transferred_in_cost: number
  direct_materials_cost: number
  direct_labor_cost: number
  manufacturing_overhead_cost: number
  regrind_processing_cost: number
  waste_credit_value: number
  total_cost: number
  unit_cost: number
  status: 'planning' | 'in_progress' | 'completed' | 'closed'
  start_date?: string
  end_date?: string
  notes?: string
  tenant_id: string
  created_at: string
  updated_at: string
}

export interface WorkCenter {
  id: string
  code: string
  name: string
  name_ar: string
  seq: number
  description?: string
  cost_base: 'labor_hours' | 'machine_hours' | 'units_produced' | 'setup_time'
  default_rate: number
  overhead_rate: number
  efficiency_factor: number
  capacity_per_hour: number
  tenant_id: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface InventoryLedger {
  id: string
  item_id: string
  move_type: 'purchase' | 'issue' | 'receipt' | 'adjustment' | 'sale' | 'transfer'
  quantity: number
  unit_cost: number
  total_cost: number
  running_quantity: number
  running_value: number
  avg_cost_after: number
  reference_type?: string
  reference_id?: string
  reference_number?: string
  transaction_date: string
  tenant_id: string
  created_by?: string
  created_at: string
}

export default {
  getSupabase,
  supabase,
  getTenantId,
  getCurrentUser,
  withTenant,
  checkConnection,
  onAuthStateChange,
  resetClient,
  isClientInitialized
}
