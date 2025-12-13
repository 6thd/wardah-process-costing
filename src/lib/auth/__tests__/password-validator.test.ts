/**
 * Integration tests for lib/auth/password-validator.ts
 * 
 * Tests the password validation functionality including:
 * - Password strength validation (synchronous)
 * - Length, uppercase, lowercase, digits, special chars requirements
 */

import { describe, it, expect } from 'vitest'
import { validatePasswordStrength } from '../password-validator'

describe('Integration: lib/auth/password-validator', () => {
  describe('validatePasswordStrength()', () => {
    describe('Length validation', () => {
      it('should reject passwords shorter than 8 characters', () => {
        const result = validatePasswordStrength('Ab1@xxx')
        
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      })

      it('should accept passwords with exactly 8 characters', () => {
        const result = validatePasswordStrength('Abcd1@xy')
        
        expect(result.errors).not.toContain('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      })

      it('should accept long passwords', () => {
        const result = validatePasswordStrength('Abcdefgh1@ijk')
        
        expect(result.errors).not.toContain('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
      })
    })

    describe('Uppercase validation', () => {
      it('should reject passwords without uppercase letters', () => {
        const result = validatePasswordStrength('abcdefgh1@')
        
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('يجب أن تحتوي على حرف كبير')
      })

      it('should accept passwords with at least one uppercase letter', () => {
        const result = validatePasswordStrength('Abcdefgh1@')
        
        expect(result.errors).not.toContain('يجب أن تحتوي على حرف كبير')
      })
    })

    describe('Lowercase validation', () => {
      it('should reject passwords without lowercase letters', () => {
        const result = validatePasswordStrength('ABCDEFGH1@')
        
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('يجب أن تحتوي على حرف صغير')
      })

      it('should accept passwords with at least one lowercase letter', () => {
        const result = validatePasswordStrength('ABCDEFGh1@')
        
        expect(result.errors).not.toContain('يجب أن تحتوي على حرف صغير')
      })
    })

    describe('Number validation', () => {
      it('should reject passwords without numbers', () => {
        const result = validatePasswordStrength('Abcdefgh@!')
        
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('يجب أن تحتوي على رقم')
      })

      it('should accept passwords with at least one number', () => {
        const result = validatePasswordStrength('Abcdefgh1@')
        
        expect(result.errors).not.toContain('يجب أن تحتوي على رقم')
      })
    })

    describe('Special character validation', () => {
      it('should reject passwords without special characters', () => {
        const result = validatePasswordStrength('Abcdefgh12')
        
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('يجب أن تحتوي على رمز خاص')
      })

      it('should accept passwords with at least one special character', () => {
        const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '+', '=']
        
        for (const char of specialChars) {
          const result = validatePasswordStrength(`Abcdefgh1${char}`)
          expect(result.errors).not.toContain('يجب أن تحتوي على رمز خاص')
        }
      })
    })

    describe('Valid passwords', () => {
      it('should accept a strong password', () => {
        const result = validatePasswordStrength('MyStr0ng@Pass')
        
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should accept another strong password', () => {
        const result = validatePasswordStrength('Passw0rd!')
        
        expect(result.isValid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should accept password with Arabic characters plus requirements', () => {
        // Arabic characters are neither A-Z nor a-z nor 0-9
        // So we need to add those explicitly
        const result = validatePasswordStrength('مرحباAbc1@!')
        
        expect(result.isValid).toBe(true)
      })
    })

    describe('Invalid passwords', () => {
      it('should report multiple errors for weak passwords', () => {
        const result = validatePasswordStrength('123')
        
        expect(result.isValid).toBe(false)
        expect(result.errors.length).toBeGreaterThan(1)
      })

      it('should report all missing requirements', () => {
        const result = validatePasswordStrength('abc')
        
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
        expect(result.errors).toContain('يجب أن تحتوي على حرف كبير')
        expect(result.errors).toContain('يجب أن تحتوي على رقم')
        expect(result.errors).toContain('يجب أن تحتوي على رمز خاص')
      })

      it('should handle empty string', () => {
        const result = validatePasswordStrength('')
        
        expect(result.isValid).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)
      })
    })

    describe('Edge cases', () => {
      it('should handle password with only spaces', () => {
        const result = validatePasswordStrength('        ')
        
        expect(result.isValid).toBe(false)
      })

      it('should handle password with unicode special chars', () => {
        // Unicode special chars count as "not A-Za-z0-9"
        const result = validatePasswordStrength('Abcdefg1™')
        
        expect(result.isValid).toBe(true)
      })

      it('should handle very long passwords', () => {
        const longPassword = 'Abc123@' + 'x'.repeat(100)
        const result = validatePasswordStrength(longPassword)
        
        expect(result.isValid).toBe(true)
      })
    })
  })
})
