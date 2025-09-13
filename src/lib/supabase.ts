import { createClient } from '@supabase/supabase-js'
import { loadConfig, getTableName } from './config.ts'

// Re-export config functions for backwards compatibility
export { getTableName }

// Initialize configuration and client
let supabaseClient: any = null
let configData: any = null

/**
 * Initialize Supabase client with dynamic configuration
 */
const initializeClient = async () => {
  if (supabaseClient) return supabaseClient

  try {
    console.log('🔧 Initializing Supabase client...')
    // Load configuration
    const response = await fetch('/config.json')
    if (!response.ok) {
      throw new Error(`Failed to load config.json: ${response.status}`)
    }
    configData = await response.json()
    console.log('✅ Config loaded:', configData)

    // Use config values or fallback to environment variables
    const supabaseUrl = configData.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
    const supabaseAnonKey = configData.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

    // If we're in demo mode, use demo credentials
    if (configData.FEATURES?.demo_mode) {
      console.log('⚠️ DEMO MODE: Using placeholder Supabase configuration')
      // We'll still create a client but it won't be used for actual authentication
      // The auth store has a fallback for demo credentials
    } else if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables')
    }

    // Create client with valid or placeholder values
    const url = supabaseUrl || 'https://placeholder.supabase.co'
    const key = supabaseAnonKey || 'placeholder-key'
    
    console.log('🔧 Creating Supabase client with:', { url, key })
    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    })

    console.log('✅ Supabase client initialized successfully')
    return supabaseClient

  } catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error)
    // Create a fallback client to prevent app crash
    supabaseClient = createClient(
      'https://placeholder.supabase.co', 
      'placeholder-key',
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      }
    )
    console.log('⚠️ Created fallback Supabase client to prevent app crash')
    return supabaseClient
  }
}

// Initialize client immediately
console.log('🔧 Starting Supabase client initialization...')
const clientPromise = initializeClient()

// Export client (will be initialized)
export const supabase = await clientPromise
console.log('✅ Supabase client ready:', supabase)

// Tenant management functions
export const getTenantId = async (): Promise<string | null> => {
  const client = await clientPromise
  const { data: { session } } = await client.auth.getSession()
  return session?.user?.user_metadata?.tenant_id || 
         (session?.access_token && JSON.parse(atob(session.access_token.split('.')[1])).tenant_id) ||
         null
}

export const getCurrentUser = async () => {
  const client = await clientPromise
  const { data: { session } } = await client.auth.getSession()
  return session?.user || null
}

// Helper function for tenant-aware queries
export const withTenant = async <T>(tableName: string) => {
  const client = await clientPromise
  const tenantId = await getTenantId()
  
  if (!configData) {
    throw new Error('Configuration not loaded')
  }
  
  const table = configData.TABLE_NAMES[tableName] || tableName
  
  // Return an object with properly initialized query methods
  return {
    select: (columns: string = '*') => {
      const query = client.from(table).select(columns)
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    insert: (data: any) => {
      const insertData = tenantId ? { ...data, tenant_id: tenantId } : data
      return client.from(table).insert(insertData)
    },
    update: (data: any) => {
      const query = client.from(table).update(data)
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    delete: () => {
      const query = client.from(table).delete()
      return tenantId ? query.eq('tenant_id', tenantId) : query
    },
    upsert: (data: any) => {
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

// Connection status check
export const checkConnection = async (): Promise<boolean> => {
  try {
    const client = await clientPromise
    if (!configData) return false
    
    const { error } = await client.from(configData.TABLE_NAMES.users || 'users').select('count').limit(1)
    return !error
  } catch {
    return false
  }
}

// Database Types
export interface User {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'manager' | 'employee'
  tenant_id?: string
  created_at: string
  updated_at: string
}

export interface StageCost {
  id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  good_quantity: number
  defective_quantity?: number
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  unit_cost: number
  status: 'precosted' | 'actual' | 'completed'
  tenant_id?: string
  created_at: string
  updated_at: string
}

export interface LaborTimeLog {
  id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  employee_id: string
  start_time: string
  end_time?: string
  hours_worked?: number
  labor_rate: number
  total_cost: number
  tenant_id?: string
  created_at: string
}

export interface MOHApplied {
  id: string
  manufacturing_order_id: string
  stage_number: number
  work_center_id: string
  overhead_rate: number
  allocation_base: number
  total_applied: number
  tenant_id?: string
  created_at: string
}

export interface Category {
  id: string
  name: string
  name_ar: string
  description?: string
  created_at: string
  updated_at: string
}

export interface Item {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  unit: string
  category_id?: string
  category?: Category
  cost_price: number
  selling_price: number
  stock_quantity: number
  minimum_stock: number
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  code: string
  name: string
  name_ar: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  code: string
  name: string
  name_ar: string
  contact_person?: string
  phone?: string
  email?: string
  address?: string
  created_at: string
  updated_at: string
}

export interface ManufacturingOrder {
  id: string
  order_number: string
  item_id: string
  item?: Item
  quantity: number
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  start_date: string
  end_date?: string
  total_cost: number
  created_by: string
  user?: User
  created_at: string
  updated_at: string
}

export interface ProcessCost {
  id: string
  manufacturing_order_id: string
  process_name: string
  process_name_ar: string
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  created_at: string
}

export interface StockMovement {
  id: string
  item_id: string
  item?: Item
  movement_type: 'in' | 'out' | 'adjustment'
  quantity: number
  reference_type?: string
  reference_id?: string
  notes?: string
  created_by: string
  user?: User
  created_at: string
}

export interface PurchaseOrder {
  id: string
  order_number: string
  supplier_id: string
  supplier?: Supplier
  status: 'draft' | 'sent' | 'received' | 'cancelled'
  order_date: string
  delivery_date?: string
  total_amount: number
  created_by: string
  user?: User
  created_at: string
  updated_at: string
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  item_id: string
  item?: Item
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

export interface SalesOrder {
  id: string
  order_number: string
  customer_id: string
  customer?: Customer
  status: 'draft' | 'confirmed' | 'delivered' | 'cancelled'
  order_date: string
  delivery_date?: string
  total_amount: number
  created_by: string
  user?: User
  created_at: string
  updated_at: string
}

export interface SalesOrderItem {
  id: string
  sales_order_id: string
  item_id: string
  item?: Item
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
}

export interface Account {
  id: string
  code: string
  name: string
  name_ar?: string
  account_type: string
  is_leaf: boolean
  is_active: boolean
  tenant_id?: string
  created_at: string
  updated_at: string
}

export interface Journal {
  id: string
  name: string
  name_ar: string
  code: string
  created_at: string
  updated_at: string
}

export interface JournalEntry {
  id: string
  journal_id: string
  journals?: Journal
  entry_number: string
  entry_date: string
  posting_date?: string
  reference_type?: string
  reference_id?: string
  reference_number?: string
  description?: string
  description_ar?: string
  status: 'draft' | 'posted' | 'reversed'
  posted_at?: string
  posted_by?: string
  total_debit: number
  total_credit: number
  tenant_id?: string
  created_at: string
  updated_at: string
  created_by?: string
  updated_by?: string
}

// Database enums
export type UserRole = 'admin' | 'manager' | 'employee'
export type OrderStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type MovementType = 'in' | 'out' | 'adjustment'
export type PurchaseStatus = 'draft' | 'sent' | 'received' | 'cancelled'
export type SalesStatus = 'draft' | 'confirmed' | 'delivered' | 'cancelled'