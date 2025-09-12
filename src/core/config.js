/**
 * Configuration Management
 * Centralized config loading with caching and validation
 */

let configCache = null

/**
 * Load configuration from config.json
 */
export const loadConfig = async () => {
  if (configCache) return configCache

  try {
    const response = await fetch('/config.json')
    if (!response.ok) {
      throw new Error(`Failed to load config.json: ${response.status}`)
    }
    
    configCache = await response.json()
    
    // Validate required fields
    validateConfig(configCache)
    
    console.log('✅ Configuration loaded successfully')
    return configCache
    
  } catch (error) {
    console.error('❌ Failed to load configuration:', error)
    throw error
  }
}

/**
 * Validate configuration structure
 */
const validateConfig = (config) => {
  const required = ['TABLE_NAMES', 'APP_SETTINGS', 'FEATURES']
  
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing required configuration field: ${field}`)
    }
  }
  
  // Validate TABLE_NAMES
  const requiredTables = [
    'items', 'manufacturing_orders', 'stage_costs', 'work_centers',
    'labor_time_logs', 'moh_applied', 'inventory_ledger', 'users'
  ]
  
  for (const table of requiredTables) {
    if (!config.TABLE_NAMES[table]) {
      throw new Error(`Missing table name configuration: ${table}`)
    }
  }
}

/**
 * Get table name from configuration
 */
export const getTableName = (logicalName) => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call loadConfig() first.')
  }
  
  const tableName = configCache.TABLE_NAMES[logicalName]
  if (!tableName) {
    console.warn(`⚠️ Table name not found for: ${logicalName}, using as-is`)
    return logicalName
  }
  
  return tableName
}

/**
 * Get app setting
 */
export const getAppSetting = (settingName, defaultValue = null) => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call loadConfig() first.')
  }
  
  return configCache.APP_SETTINGS[settingName] || defaultValue
}

/**
 * Check if feature is enabled
 */
export const isFeatureEnabled = (featureName) => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call loadConfig() first.')
  }
  
  return Boolean(configCache.FEATURES[featureName])
}

/**
 * Get costing configuration
 */
export const getCostingConfig = (configName, defaultValue = 0) => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call loadConfig() first.')
  }
  
  return configCache.COSTING_CONFIG?.[configName] || defaultValue
}

/**
 * Get all configuration
 */
export const getFullConfig = () => {
  if (!configCache) {
    throw new Error('Configuration not loaded. Call loadConfig() first.')
  }
  
  return { ...configCache }
}

/**
 * Clear configuration cache (for testing)
 */
export const clearConfigCache = () => {
  configCache = null
}

export default {
  loadConfig,
  getTableName,
  getAppSetting,
  isFeatureEnabled,
  getCostingConfig,
  getFullConfig,
  clearConfigCache
}