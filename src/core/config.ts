/**
 * Configuration Management with Guards and Defaults
 * Zero-hardcode approach - all configuration loaded from config.json with fallbacks
 */

export interface AppConfig {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  TABLE_NAMES: Record<string, string>
  APP_SETTINGS: {
    default_currency: string
    default_language: string
    items_per_page: number
    auto_save_interval: number
  }
  FEATURES: {
    realtime_updates: boolean
    advanced_costing: boolean
    multi_tenant: boolean
    demo_mode: boolean
  }
  GEMINI_DASHBOARD?: {
    proxy_url: string
    proxy_auth_key: string
  }
}

// Default configuration (fallback values)
const DEFAULT_CONFIG: AppConfig = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  TABLE_NAMES: {
    // Core tables
    users: 'users',
    items: 'items',
    categories: 'categories',
    suppliers: 'suppliers',
    customers: 'customers',
    
    // Manufacturing tables
    work_centers: 'work_centers',
    boms: 'boms',
    manufacturing_orders: 'manufacturing_orders',
    stage_costs: 'stage_costs',
    labor_time_logs: 'labor_time_logs',
    moh_applied: 'moh_applied',
    
    // Inventory tables
    locations: 'locations',
    stock_moves: 'stock_moves',
    inventory_ledger: 'inventory_ledger',
    
    // Purchasing tables
    purchase_orders: 'purchase_orders',
    purchase_order_lines: 'purchase_order_lines',
    
    // Sales tables
    sales_orders: 'sales_orders',
    sales_order_lines: 'sales_order_lines'
  },
  APP_SETTINGS: {
    default_currency: 'SAR',
    default_language: 'ar',
    items_per_page: 25,
    auto_save_interval: 30000
  },
  FEATURES: {
    realtime_updates: true,
    advanced_costing: true,
    multi_tenant: true,
    demo_mode: true
  },
  GEMINI_DASHBOARD: {
    proxy_url: 'http://localhost:3001/api/wardah',
    proxy_auth_key: ''
  }
}

let configCache: AppConfig | null = null
let isLoading = false

/**
 * Load configuration from config.json with environment variable fallbacks
 */
export const loadConfig = async (): Promise<AppConfig> => {
  if (configCache) return configCache
  
  if (isLoading) {
    // Wait for ongoing load to complete
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return configCache || DEFAULT_CONFIG
  }
  
  isLoading = true
  
  try {
    console.log('🔧 Loading configuration...')
    
    // Try to load from config.json
    let remoteConfig: Partial<AppConfig> = {}
    
    try {
      const response = await fetch('/config.json')
      if (response.ok) {
        remoteConfig = await response.json()
        console.log('✅ Configuration loaded from config.json')
      } else {
        console.warn('⚠️ Could not load config.json, using defaults')
      }
    } catch (error) {
      console.warn('⚠️ Failed to fetch config.json:', error)
    }
    
    // Merge with environment variables and defaults
    configCache = {
      SUPABASE_URL: remoteConfig.SUPABASE_URL || 
                   import.meta.env.VITE_SUPABASE_URL || 
                   DEFAULT_CONFIG.SUPABASE_URL,
                   
      SUPABASE_ANON_KEY: remoteConfig.SUPABASE_ANON_KEY || 
                        import.meta.env.VITE_SUPABASE_ANON_KEY || 
                        DEFAULT_CONFIG.SUPABASE_ANON_KEY,
                        
      TABLE_NAMES: {
        ...DEFAULT_CONFIG.TABLE_NAMES,
        ...remoteConfig.TABLE_NAMES
      },
      
      APP_SETTINGS: {
        ...DEFAULT_CONFIG.APP_SETTINGS,
        ...remoteConfig.APP_SETTINGS
      },
      
      FEATURES: {
        ...DEFAULT_CONFIG.FEATURES,
        ...remoteConfig.FEATURES
      }
    }
    
    // Validate critical configuration
    validateConfig(configCache)
    
    console.log('✅ Configuration validated and cached')
    return configCache
    
  } catch (error) {
    console.error('❌ Configuration loading failed:', error)
    console.log('🔄 Falling back to default configuration')
    
    configCache = DEFAULT_CONFIG
    return configCache
    
  } finally {
    isLoading = false
  }
}

/**
 * Validate required configuration values
 */
const validateConfig = (config: AppConfig): void => {
  const errors: string[] = []
  
  // Check Supabase configuration
  if (!config.SUPABASE_URL || config.SUPABASE_URL === 'https://your-project.supabase.co') {
    errors.push('SUPABASE_URL is missing or using placeholder value')
  }
  
  if (!config.SUPABASE_ANON_KEY || config.SUPABASE_ANON_KEY === 'your-anon-key-here') {
    errors.push('SUPABASE_ANON_KEY is missing or using placeholder value')
  }
  
  // Check table names
  const requiredTables = ['items', 'manufacturing_orders', 'stage_costs', 'users']
  for (const table of requiredTables) {
    if (!config.TABLE_NAMES[table]) {
      errors.push(`Required table name missing: ${table}`)
    }
  }
  
  // In production, these should be actual values
  if (import.meta.env.PROD && errors.length > 0) {
    console.error('❌ Configuration validation errors:', errors)
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`)
  }
  
  // In development, just warn
  if (errors.length > 0) {
    console.warn('⚠️ Configuration warnings:', errors)
  }
}

/**
 * Get table name with tenant prefix if needed
 */
export const getTableName = (tableName: string, tenantId?: string): string => {
  const config = configCache || DEFAULT_CONFIG
  const baseName = config.TABLE_NAMES[tableName] || tableName
  
  // If multi-tenant is enabled and tenantId provided, add prefix
  if (config.FEATURES.multi_tenant && tenantId) {
    return `${tenantId}_${baseName}`
  }
  
  return baseName
}

/**
 * Get current configuration (must be loaded first)
 */
export const getConfig = (): AppConfig => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call loadConfig() first.')
  }
  return configCache
}

/**
 * Reset configuration cache (useful for testing)
 */
export const resetConfig = (): void => {
  configCache = null
  isLoading = false
}

/**
 * Get configuration value with fallback
 */
export const getConfigValue = <T>(path: string, fallback: T): T => {
  try {
    const config = getConfig()
    const value = path.split('.').reduce((obj: any, key) => obj?.[key], config)
    return value !== undefined ? value : fallback
  } catch {
    return fallback
  }
}

export default {
  loadConfig,
  getConfig,
  getTableName,
  resetConfig,
  getConfigValue
}