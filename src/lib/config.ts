export interface AppConfig {
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
}

let _config: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config
  
  try {
    const response = await fetch('/config.json')
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.statusText}`)
    }
    _config = await response.json()
    return _config!
  } catch (error) {
    console.error('Failed to load application configuration:', error)
    // Fallback configuration
    _config = {
      TABLE_NAMES: {
        items: 'items',
        boms: 'boms',
        manufacturing_orders: 'manufacturing_orders',
        stage_costs: 'stage_costs',
        labor_time_logs: 'labor_time_logs',
        moh_applied: 'moh_applied',
        stock_moves: 'stock_moves'
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
      }
    }
    return _config
  }
}

export function getConfig(): AppConfig | null {
  return _config
}

export function getTableName(key: string): string {
  const config = getConfig()
  return config?.TABLE_NAMES[key] || key
}