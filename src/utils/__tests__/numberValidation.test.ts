/**
 * Integration tests for utils/numberValidation.ts
 * 
 * Tests the safe number validation utilities
 * that replace regex patterns vulnerable to ReDoS
 */

import { describe, it, expect } from 'vitest'
import { isValidDecimalInput } from '../numberValidation'

describe('Integration: utils/numberValidation', () => {
  describe('isValidDecimalInput()', () => {
    describe('Valid inputs', () => {
      it('should accept empty string', () => {
        expect(isValidDecimalInput('')).toBe(true)
      })

      it('should accept single digit', () => {
        expect(isValidDecimalInput('5')).toBe(true)
      })

      it('should accept multiple digits', () => {
        expect(isValidDecimalInput('12345')).toBe(true)
      })

      it('should accept decimal with leading digit', () => {
        expect(isValidDecimalInput('123.456')).toBe(true)
      })

      it('should accept decimal without leading digit', () => {
        expect(isValidDecimalInput('.5')).toBe(true)
      })

      it('should accept just a dot', () => {
        expect(isValidDecimalInput('.')).toBe(true)
      })

      it('should accept integer with trailing dot', () => {
        expect(isValidDecimalInput('123.')).toBe(true)
      })

      it('should accept zero', () => {
        expect(isValidDecimalInput('0')).toBe(true)
      })

      it('should accept zero with decimal', () => {
        expect(isValidDecimalInput('0.0')).toBe(true)
      })

      it('should accept long decimal numbers', () => {
        expect(isValidDecimalInput('1234567890.1234567890')).toBe(true)
      })
    })

    describe('Invalid inputs', () => {
      it('should reject letters', () => {
        expect(isValidDecimalInput('abc')).toBe(false)
      })

      it('should reject mixed letters and numbers', () => {
        expect(isValidDecimalInput('123abc')).toBe(false)
      })

      it('should reject multiple dots', () => {
        expect(isValidDecimalInput('1.2.3')).toBe(false)
      })

      it('should reject negative sign', () => {
        expect(isValidDecimalInput('-5')).toBe(false)
      })

      it('should reject positive sign', () => {
        expect(isValidDecimalInput('+5')).toBe(false)
      })

      it('should reject spaces', () => {
        expect(isValidDecimalInput('1 2')).toBe(false)
      })

      it('should reject special characters', () => {
        expect(isValidDecimalInput('12@34')).toBe(false)
      })

      it('should reject comma as decimal separator', () => {
        expect(isValidDecimalInput('123,456')).toBe(false)
      })

      it('should reject scientific notation', () => {
        expect(isValidDecimalInput('1e5')).toBe(false)
      })

      it('should reject currency symbols', () => {
        expect(isValidDecimalInput('$100')).toBe(false)
      })

      it('should reject Arabic numerals', () => {
        expect(isValidDecimalInput('١٢٣')).toBe(false)
      })
    })

    describe('Security (ReDoS prevention)', () => {
      it('should reject extremely long inputs', () => {
        const longInput = '1'.repeat(51)
        expect(isValidDecimalInput(longInput)).toBe(false)
      })

      it('should accept inputs up to 50 characters', () => {
        const validLongInput = '1'.repeat(50)
        expect(isValidDecimalInput(validLongInput)).toBe(true)
      })

      it('should handle potentially malicious patterns quickly', () => {
        // These patterns could cause ReDoS with naive regex
        const start = performance.now()
        
        // Pattern that might cause catastrophic backtracking
        const maliciousInput = '0'.repeat(30) + 'a'
        isValidDecimalInput(maliciousInput)
        
        const duration = performance.now() - start
        // Should complete in under 10ms (safe from ReDoS)
        expect(duration).toBeLessThan(10)
      })
    })

    describe('Edge cases', () => {
      it('should handle leading zeros', () => {
        expect(isValidDecimalInput('007')).toBe(true)
      })

      it('should handle many decimal places', () => {
        expect(isValidDecimalInput('0.123456789012345')).toBe(true)
      })

      it('should handle dot at the end', () => {
        expect(isValidDecimalInput('100.')).toBe(true)
      })

      it('should handle single zero', () => {
        expect(isValidDecimalInput('0')).toBe(true)
      })
    })
  })
})
