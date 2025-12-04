// src/lib/auth/password-validator.ts
// Password validation using Have I Been Pwned API (HIBP)
// Free alternative to Supabase Pro's leaked password protection

import { pwnedPassword } from 'hibp';

/**
 * Validates if a password has been leaked (compromised)
 * Uses Have I Been Pwned API (free tier)
 * 
 * @param password - The password to check
 * @returns Promise<{ isSafe: boolean; count?: number }> - true if password is safe, false if leaked
 */
export async function validatePasswordNotLeaked(
  password: string
): Promise<{ isSafe: boolean; count?: number }> {
  try {
    // Check if password appears in Have I Been Pwned database
    const count = await pwnedPassword(password);
    
    if (count > 0) {
      return {
        isSafe: false,
        count, // Number of times this password was found in breaches
      };
    }
    
    return { isSafe: true };
  } catch (error) {
    // If API fails, allow password (fail open for availability)
    // In production, you might want to fail closed
    console.error('Error checking password against HIBP:', error);
    return { isSafe: true }; // Fail open
  }
}

/**
 * Validates password strength and checks if it's leaked
 * 
 * @param password - The password to validate
 * @returns Promise<{ isValid: boolean; errors: string[] }>
 */
export async function validatePassword(
  password: string
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Basic strength checks
  if (password.length < 8) {
    errors.push('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('كلمة المرور يجب أن تحتوي على حرف كبير واحد على الأقل');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('كلمة المرور يجب أن تحتوي على حرف صغير واحد على الأقل');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('كلمة المرور يجب أن تحتوي على رقم واحد على الأقل');
  }
  
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('كلمة المرور يجب أن تحتوي على رمز خاص واحد على الأقل (!@#$%...)');
  }
  
  // Check if password is leaked (only if basic checks pass to avoid unnecessary API calls)
  if (errors.length === 0) {
    const { isSafe, count } = await validatePasswordNotLeaked(password);
    
    if (!isSafe && count) {
      errors.push(
        `⚠️ هذه كلمة المرور تم العثور عليها في ${count} خرق بيانات. يرجى اختيار كلمة مرور أخرى.`
      );
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Quick password strength check (synchronous, no API call)
 * Useful for real-time validation while user is typing
 * 
 * @param password - The password to check
 * @returns { isValid: boolean; errors: string[] }
 */
export function validatePasswordStrength(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('يجب أن تحتوي على حرف كبير');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('يجب أن تحتوي على حرف صغير');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('يجب أن تحتوي على رقم');
  }
  
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('يجب أن تحتوي على رمز خاص');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

