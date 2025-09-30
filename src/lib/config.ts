export interface AppConfig {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  TABLE_NAMES: Record<string, string>;
  APP_SETTINGS: {
    default_currency: string;
    default_language: string;
    items_per_page: number;
    auto_save_interval: number;
    cost_precision?: number;
    amount_precision?: number;
    costing_method?: string;
  };
  FEATURES: {
    realtime_updates: boolean;
    advanced_costing: boolean;
    multi_tenant: boolean;
    demo_mode: boolean;
    process_costing?: boolean;
    avco_inventory?: boolean;
    audit_trail?: boolean;
  };
  COSTING_CONFIG?: {
    default_overhead_rate: number;
    regrind_processing_rate: number;
    waste_credit_rate: number;
    labor_overhead_rate: number;
  };
}

let _config: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config;
  
  try {
    console.log('🔧 Loading application configuration...');
    const response = await fetch('/config.json');
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.statusText}`);
    }
    _config = await response.json();
    console.log('✅ Configuration loaded successfully:', _config);
    return _config!;
  } catch (error) {
    console.error('Failed to load application configuration:', error);
    // Fallback configuration
    _config = {
      TABLE_NAMES: {
        items: 'items',
        boms: 'boms',
        manufacturing_orders: 'manufacturing_orders',
        stage_costs: 'stage_costs',
        labor_time_logs: 'labor_time_logs',
        moh_applied: 'moh_applied',
        stock_moves: 'stock_moves',
        work_centers: 'work_centers',
        users: 'users',
        suppliers: 'suppliers',
        customers: 'customers',
        categories: 'categories',
        purchase_orders: 'purchase_orders',
        purchase_order_items: 'purchase_order_items',
        sales_orders: 'sales_orders',
        sales_order_items: 'sales_order_items',
        process_costs: 'process_costs',
        audit_trail: 'audit_trail',
        gl_accounts: 'gl_accounts',
        journals: 'journals',
        journal_entries: 'journal_entries',
        journal_entry_lines: 'journal_entry_lines'
      },
      APP_SETTINGS: {
        default_currency: 'SAR',
        default_language: 'ar',
        items_per_page: 25,
        auto_save_interval: 30000,
        cost_precision: 6,
        amount_precision: 4,
        costing_method: 'AVCO'
      },
      FEATURES: {
        realtime_updates: true,
        advanced_costing: true,
        multi_tenant: true,
        demo_mode: true,
        process_costing: true,
        avco_inventory: true,
        audit_trail: true
      },
      COSTING_CONFIG: {
        default_overhead_rate: 0.15,
        regrind_processing_rate: 0.05,
        waste_credit_rate: 0.02,
        labor_overhead_rate: 0.25
      }
    };
    console.log('⚠️ Using fallback configuration:', _config);
    return _config;
  }
}

export function getConfig(): AppConfig | null {
  return _config;
}

export function getTableName(key: string): string {
  const config = getConfig();
  return config?.TABLE_NAMES[key] || key;
}