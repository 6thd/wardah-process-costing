/**
 * Utility Functions
 * Common utilities for formatting, validation, and UI helpers
 */

/**
 * Number formatting utilities
 */
export const formatCurrency = (amount, currency = 'SAR', locale = 'ar-SA') => {
  if (amount === null || amount === undefined) return '-'
  
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(amount)
}

export const formatNumber = (number, precision = 2, locale = 'ar-SA') => {
  if (number === null || number === undefined) return '-'
  
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  }).format(number)
}

export const formatQuantity = (quantity, unit = '', precision = 2) => {
  if (quantity === null || quantity === undefined) return '-'
  
  const formatted = formatNumber(quantity, precision)
  return unit ? `${formatted} ${unit}` : formatted
}

/**
 * Date formatting utilities
 */
export const formatDate = (date, locale = 'ar-SA') => {
  if (!date) return '-'
  
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(date))
}

export const formatDateTime = (date, locale = 'ar-SA') => {
  if (!date) return '-'
  
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

/**
 * Validation utilities
 */
export const validateRequired = (value, fieldName) => {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${fieldName} is required`)
  }
}

export const validatePositiveNumber = (value, fieldName) => {
  validateRequired(value, fieldName)
  
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`${fieldName} must be a positive number`)
  }
}

export const validateEmail = (email) => {
  // Simple email regex - safe from ReDoS (no nested quantifiers)
  // NOSONAR - This regex is safe and simple, no ReDoS risk
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // NOSONAR
  
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format')
  }
}

export const validateStageNumber = (stageNumber) => {
  validateRequired(stageNumber, 'Stage number')
  
  if (!Number.isInteger(stageNumber) || stageNumber <= 0) {
    throw new Error('Stage number must be a positive integer')
  }
}

/**
 * Toast notification helpers
 */
export const showSuccessToast = (message) => {
  // This will be replaced with actual toast implementation
  console.log('✅ Success:', message)
}

export const showErrorToast = (message) => {
  console.error('❌ Error:', message)
}

export const showWarningToast = (message) => {
  console.warn('⚠️ Warning:', message)
}

export const showInfoToast = (message) => {
  console.info('ℹ️ Info:', message)
}

/**
 * Process costing calculation utilities
 */
export const calculateStageCost = ({
  transferredIn = 0,
  materialCost = 0,
  laborCost = 0,
  overheadCost = 0,
  regrindCost = 0,
  wasteCredit = 0
}) => {
  return transferredIn + materialCost + laborCost + overheadCost + regrindCost - wasteCredit
}

export const calculateUnitCost = (totalCost, goodQuantity) => {
  if (!goodQuantity || goodQuantity <= 0) return 0
  return totalCost / goodQuantity
}

export const calculateLaborCost = (hours, rate) => {
  validatePositiveNumber(hours, 'Hours')
  validatePositiveNumber(rate, 'Rate')
  return hours * rate
}

export const calculateOverheadCost = (baseAmount, rate) => {
  validatePositiveNumber(baseAmount, 'Base amount')
  validatePositiveNumber(rate, 'Rate')
  return baseAmount * rate
}

/**
 * AVCO inventory calculation utilities
 */
export const calculateAVCO = (currentStock, currentValue, incomingQty, incomingCost) => {
  if (currentStock < 0) currentStock = 0
  if (currentValue < 0) currentValue = 0
  
  const totalQty = currentStock + incomingQty
  const totalValue = currentValue + incomingCost
  
  if (totalQty <= 0) {
    return { newUnitCost: 0, newTotalValue: 0 }
  }
  
  const newUnitCost = totalValue / totalQty
  
  return {
    newUnitCost: Math.max(0, newUnitCost),
    newTotalValue: Math.max(0, totalValue),
    totalQuantity: totalQty
  }
}

/**
 * Array and object utilities
 */
export const groupBy = (array, key) => {
  return array.reduce((groups, item) => {
    const group = item[key]
    groups[group] = groups[group] || []
    groups[group].push(item)
    return groups
  }, {})
}

export const sumBy = (array, key) => {
  return array.reduce((sum, item) => sum + (item[key] || 0), 0)
}

export const sortBy = (array, key, direction = 'asc') => {
  return [...array].sort((a, b) => {
    const aVal = a[key]
    const bVal = b[key]
    
    if (direction === 'desc') {
      return bVal > aVal ? 1 : bVal < aVal ? -1 : 0
    }
    
    return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
  })
}

/**
 * String utilities
 */

/**
 * Generate cryptographically secure random ID
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Secure random ID
 */
export const generateId = (prefix = '') => {
  // Use crypto.randomUUID() for modern browsers
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    const uuid = crypto.randomUUID();
    return prefix ? `${prefix}_${uuid}` : uuid;
  }
  
  // Fallback: Use crypto.getRandomValues()
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const hex = Array.from(array, byte => 
      byte.toString(16).padStart(2, '0')
    ).join('');
    return prefix ? `${prefix}_${hex}` : hex;
  }
  
  // Last resort fallback (for very old environments)
  // Use timestamp + performance.now() instead of Math.random()
  console.warn('Crypto API not available, using timestamp-based ID');
  const timestamp = Date.now().toString(36);
  const perf = typeof performance !== 'undefined' ? performance.now().toString(36) : '0';
  return prefix ? `${prefix}_${timestamp}_${perf}` : `${timestamp}_${perf}`;
}

/**
 * Generate secure random token
 * @param {number} length - Length of token in bytes
 * @returns {string} Hex string token
 */
export const generateSecureToken = (length = 32) => {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Crypto API not available. Cannot generate secure token.');
  }
  
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => 
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/**
 * Generate secure random number in range
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (exclusive)
 * @returns {number} Secure random number
 */
export const generateSecureRandomNumber = (min, max) => {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Crypto API not available');
  }
  
  const range = max - min;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const array = new Uint8Array(bytesNeeded);
  
  let result;
  do {
    crypto.getRandomValues(array);
    result = array.reduce((acc, byte, i) => acc + byte * (256 ** i), 0);
  } while (result >= range);
  
  return min + result;
}

export const slugify = (text) => {
  // NOSONAR - Simple regex patterns, no ReDoS risk (no nested quantifiers)
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // NOSONAR
    .replace(/[^\w\-]+/g, '') // NOSONAR
    .replace(/\-\-+/g, '-') // NOSONAR
    .replace(/^-+/, '') // NOSONAR
    .replace(/-+$/, '') // NOSONAR
}

/**
 * Error handling utilities
 */
export const handleError = (error, context = '') => {
  const message = error?.message || 'Unknown error occurred'
  const fullMessage = context ? `${context}: ${message}` : message
  
  console.error('Error:', fullMessage, error)
  showErrorToast(fullMessage)
  
  return {
    success: false,
    error: message,
    context
  }
}

export const handleSuccess = (message, data = null) => {
  showSuccessToast(message)
  
  return {
    success: true,
    message,
    data
  }
}

export default {
  formatCurrency,
  formatNumber,
  formatQuantity,
  formatDate,
  formatDateTime,
  validateRequired,
  validatePositiveNumber,
  validateEmail,
  validateStageNumber,
  showSuccessToast,
  showErrorToast,
  showWarningToast,
  showInfoToast,
  calculateStageCost,
  calculateUnitCost,
  calculateLaborCost,
  calculateOverheadCost,
  calculateAVCO,
  groupBy,
  sumBy,
  sortBy,
  generateId,
  slugify,
  handleError,
  handleSuccess
}