let __cfg;

/**
 * Load configuration from config.json with fallback handling
 */
export async function loadConfig() {
  if (__cfg) return __cfg;
  
  try {
    const res = await fetch('config.json');
    if (!res.ok) throw new Error(`Cannot load config.json: ${res.status}`);
    __cfg = await res.json();
    
    // Ensure TABLE_NAMES exists with fallbacks
    if (!__cfg?.TABLE_NAMES) {
      __cfg.TABLE_NAMES = {};
    }
    
    return __cfg;
  } catch (error) {
    console.error('Config loading error:', error);
    // Fallback configuration
    __cfg = {
      TABLE_NAMES: {
        items: 'items',
        categories: 'categories',
        suppliers: 'suppliers',
        customers: 'customers',
        manufacturing_orders: 'manufacturing_orders',
        stage_costs: 'stage_costs',
        labor_time_logs: 'labor_time_logs',
        moh_applied: 'moh_applied',
        purchase_orders: 'purchase_orders',
        purchase_order_lines: 'purchase_order_lines',
        sales_orders: 'sales_orders',
        sales_order_lines: 'sales_order_lines',
        stock_moves: 'stock_moves',
        boms: 'boms'
      }
    };
    return __cfg;
  }
}

/**
 * Get table name from configuration
 */
export const table = (cfg, key) => {
  const t = cfg.TABLE_NAMES?.[key];
  if (!t) throw new Error(`Missing TABLE_NAMES["${key}"] in config.json`);
  return t;
};