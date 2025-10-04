// src/types/config.ts
// Configuration type definitions

export interface TableNames {
  // Core tables
  users: string
  items: string
  categories: string
  suppliers: string
  customers: string
  
  // Manufacturing tables
  work_centers: string
  boms: string
  manufacturing_orders: string
  stage_costs: string
  labor_time_logs: string
  moh_applied: string
  
  // Inventory tables
  locations: string
  stock_moves: string
  inventory_ledger: string
  
  // Purchasing tables
  purchase_orders: string
  purchase_order_lines: string
  
  // Sales tables
  sales_orders: string
  sales_order_lines: string
  
  // General Ledger
  gl_accounts: string
  journals: string
  journal_entries: string
  journal_entry_lines: string
}

export interface AppSettings {
  default_currency: string
  default_language: string
  items_per_page: number
  auto_save_interval: number
  cost_precision?: number
  amount_precision?: number
  costing_method?: string
}

export interface Features {
  realtime_updates: boolean
  advanced_costing: boolean
  multi_tenant: boolean
  demo_mode: boolean
  process_costing?: boolean
  avco_inventory?: boolean
  audit_trail?: boolean
}

export interface CostingConfig {
  default_overhead_rate: number
  regrind_processing_rate: number
  waste_credit_rate: number
  labor_overhead_rate: number
}

// Add the GeminiDashboardConfig interface
export interface GeminiDashboardConfig {
  proxy_url: string
  proxy_auth_key: string
}

export interface AppConfig {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  TABLE_NAMES: TableNames
  APP_SETTINGS: AppSettings
  FEATURES: Features
  COSTING_CONFIG?: CostingConfig
  // Add GEMINI_DASHBOARD property
  GEMINI_DASHBOARD?: GeminiDashboardConfig
}