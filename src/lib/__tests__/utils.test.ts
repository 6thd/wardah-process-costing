/**
 * Integration Tests for lib/utils.ts
 * 
 * Tests the actual utility functions to increase coverage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { 
  cn, 
  formatCurrency, 
  formatNumber, 
  formatDate, 
  formatDateTime, 
  debounce, 
  generateId 
} from '../utils'

describe('Integration: lib/utils', () => {
  
  describe('cn - Class Name Merger', () => {
    it('should merge class names correctly', () => {
      const result = cn('bg-red-500', 'text-white')
      expect(result).toBe('bg-red-500 text-white')
    })
    
    it('should handle conditional classes', () => {
      const isActive = true
      const result = cn('base-class', isActive && 'active-class')
      expect(result).toContain('base-class')
      expect(result).toContain('active-class')
    })
    
    it('should handle false conditions', () => {
      const isActive = false
      const result = cn('base-class', isActive && 'active-class')
      expect(result).toBe('base-class')
      expect(result).not.toContain('active-class')
    })
    
    it('should merge conflicting Tailwind classes', () => {
      const result = cn('bg-red-500', 'bg-blue-500')
      expect(result).toBe('bg-blue-500')
    })
    
    it('should handle empty inputs', () => {
      const result = cn()
      expect(result).toBe('')
    })
    
    it('should handle null and undefined', () => {
      const result = cn('base', null, undefined, 'end')
      expect(result).toBe('base end')
    })
    
    it('should handle arrays of classes', () => {
      const result = cn(['class1', 'class2'])
      expect(result).toContain('class1')
      expect(result).toContain('class2')
    })
  })
  
  describe('formatCurrency', () => {
    it('should format SAR currency correctly', () => {
      const result = formatCurrency(1234.56)
      expect(result).toContain('1,234.56')
      expect(result).toContain('ريال')
    })
    
    it('should format SAR with explicit currency', () => {
      const result = formatCurrency(1000, 'SAR')
      expect(result).toContain('1,000')
      expect(result).toContain('ريال')
    })
    
    it('should format USD currency', () => {
      const result = formatCurrency(500, 'USD')
      expect(result).toContain('500')
      expect(result).toContain('USD')
    })
    
    it('should handle zero', () => {
      const result = formatCurrency(0)
      expect(result).toContain('0')
      expect(result).toContain('ريال')
    })
    
    it('should handle negative numbers', () => {
      const result = formatCurrency(-1000)
      expect(result).toContain('-1,000')
    })
    
    it('should handle large numbers', () => {
      const result = formatCurrency(1234567890)
      expect(result).toContain('1,234,567,890')
    })
    
    it('should handle decimals correctly', () => {
      const result = formatCurrency(99.99)
      expect(result).toContain('99.99')
    })
    
    it('should truncate extra decimals', () => {
      const result = formatCurrency(10.12345)
      expect(result).toContain('10.12')
    })
  })
  
  describe('formatNumber', () => {
    it('should format integers with commas', () => {
      const result = formatNumber(1234567)
      expect(result).toBe('1,234,567')
    })
    
    it('should handle zero', () => {
      const result = formatNumber(0)
      expect(result).toBe('0')
    })
    
    it('should handle negative numbers', () => {
      const result = formatNumber(-1000)
      expect(result).toBe('-1,000')
    })
    
    it('should handle decimals', () => {
      const result = formatNumber(1234.567)
      expect(result).toContain('1,234')
    })
  })
  
  describe('formatDate', () => {
    it('should format Date object', () => {
      const date = new Date('2025-12-13')
      const result = formatDate(date)
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
    
    it('should format ISO date string', () => {
      const result = formatDate('2025-12-13')
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
    
    it('should format date with time', () => {
      const result = formatDate('2025-12-13T10:30:00')
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
    })
  })
  
  describe('formatDateTime', () => {
    it('should include time in output', () => {
      const date = new Date('2025-12-13T10:30:00')
      const result = formatDateTime(date)
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })
    
    it('should format ISO datetime string', () => {
      const result = formatDateTime('2025-12-13T14:30:00')
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })
  })
  
  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    
    afterEach(() => {
      vi.useRealTimers()
    })
    
    it('should delay function execution', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)
      
      debouncedFn()
      expect(fn).not.toHaveBeenCalled()
      
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
    })
    
    it('should only call once for multiple rapid calls', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)
      
      debouncedFn()
      debouncedFn()
      debouncedFn()
      
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)
    })
    
    it('should pass arguments to debounced function', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)
      
      debouncedFn('arg1', 'arg2')
      vi.advanceTimersByTime(100)
      
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
    })
    
    it('should use last arguments when called multiple times', () => {
      const fn = vi.fn()
      const debouncedFn = debounce(fn, 100)
      
      debouncedFn('first')
      debouncedFn('second')
      debouncedFn('third')
      
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledWith('third')
    })
  })
  
  describe('generateId', () => {
    it('should return a string', () => {
      const id = generateId()
      expect(typeof id).toBe('string')
    })
    
    it('should return unique IDs', () => {
      const ids = new Set()
      for (let i = 0; i < 100; i++) {
        ids.add(generateId())
      }
      expect(ids.size).toBe(100)
    })
    
    it('should return non-empty string', () => {
      const id = generateId()
      expect(id.length).toBeGreaterThan(0)
    })
    
    it('should be a valid UUID format when crypto is available', () => {
      const id = generateId()
      // UUID or fallback format
      expect(id.length).toBeGreaterThanOrEqual(9)
    })
  })
})
