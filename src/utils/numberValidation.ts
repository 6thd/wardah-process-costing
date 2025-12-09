/**
 * Safe number validation utilities
 * Replaces regex patterns vulnerable to ReDoS with simple string checks
 */

/**
 * Validate decimal number input (safe from ReDoS)
 * Replaces regex /^\d*\.?\d*$/ with simple string validation
 * 
 * @param value - Input string to validate
 * @returns true if value is a valid decimal number format
 */
export function isValidDecimalInput(value: string): boolean {
  if (value === '') return true;
  
  // Fast length check
  if (value.length > 50) return false; // Prevent extremely long inputs
  
  // Check for valid decimal format without regex
  let hasDot = false;
  let hasDigit = false;
  
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    
    if (char === '.') {
      if (hasDot) return false; // Only one dot allowed
      hasDot = true;
    } else if (char >= '0' && char <= '9') {
      hasDigit = true;
    } else {
      return false; // Invalid character
    }
  }
  
  return hasDigit || value === '.'; // At least one digit or just a dot
}

