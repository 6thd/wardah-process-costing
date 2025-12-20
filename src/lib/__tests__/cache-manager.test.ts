import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cacheManager } from '../cache-manager';

// Mock safe-storage
vi.mock('../safe-storage', () => {
  const store = new Map<string, string>();
  return {
    safeLocalStorage: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => { store.set(key, value); return true; },
      removeItem: (key: string) => { store.delete(key); return true; },
    },
    safeSessionStorage: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => { store.set(key, value); return true; },
      removeItem: (key: string) => { store.delete(key); return true; },
    },
  };
});

describe('CacheManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear cache before each test
    cacheManager.clear();
    cacheManager.clear({ useSessionStorage: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('set and get', () => {
    it('should set and get a value', () => {
      const data = { name: 'test', value: 123 };
      cacheManager.set('testKey', data);
      
      const result = cacheManager.get('testKey');
      expect(result).toEqual(data);
    });

    it('should return null for non-existent key', () => {
      const result = cacheManager.get('nonExistent');
      expect(result).toBeNull();
    });

    it('should return null for expired cache', () => {
      const data = { name: 'test' };
      cacheManager.set('expiredKey', data, { ttl: 1000 }); // 1 second TTL
      
      // Advance time past expiration
      vi.advanceTimersByTime(2000);
      
      const result = cacheManager.get('expiredKey');
      expect(result).toBeNull();
    });

    it('should use sessionStorage when configured', () => {
      const data = { session: true };
      cacheManager.set('sessionKey', data, { useSessionStorage: true });
      
      const result = cacheManager.get('sessionKey', { useSessionStorage: true });
      expect(result).toEqual(data);
    });

    it('should handle string values', () => {
      cacheManager.set('stringKey', 'hello world');
      expect(cacheManager.get('stringKey')).toBe('hello world');
    });

    it('should handle number values', () => {
      cacheManager.set('numberKey', 42);
      expect(cacheManager.get('numberKey')).toBe(42);
    });

    it('should handle array values', () => {
      const arr = [1, 2, 3, 'four'];
      cacheManager.set('arrayKey', arr);
      expect(cacheManager.get('arrayKey')).toEqual(arr);
    });

    it('should handle nested objects', () => {
      const nested = {
        level1: {
          level2: {
            level3: 'deep value'
          }
        }
      };
      cacheManager.set('nestedKey', nested);
      expect(cacheManager.get('nestedKey')).toEqual(nested);
    });
  });

  describe('has', () => {
    it('should return true for existing cache', () => {
      cacheManager.set('existKey', 'value');
      expect(cacheManager.has('existKey')).toBe(true);
    });

    it('should return false for non-existent cache', () => {
      expect(cacheManager.has('noKey')).toBe(false);
    });

    it('should return false for expired cache', () => {
      cacheManager.set('expireKey', 'value', { ttl: 500 });
      vi.advanceTimersByTime(1000);
      expect(cacheManager.has('expireKey')).toBe(false);
    });
  });

  describe('remove', () => {
    it('should remove existing cache', () => {
      cacheManager.set('removeKey', 'value');
      expect(cacheManager.has('removeKey')).toBe(true);
      
      cacheManager.remove('removeKey');
      expect(cacheManager.has('removeKey')).toBe(false);
    });

    it('should return true when removing non-existent key', () => {
      const result = cacheManager.remove('nonExistent');
      expect(result).toBe(true);
    });
  });

  describe('TTL handling', () => {
    it('should use default TTL when not specified', () => {
      cacheManager.set('defaultTTL', 'value');
      
      // Should still exist after 23 hours
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);
      expect(cacheManager.has('defaultTTL')).toBe(true);
      
      // Should expire after 25 hours (default is 24h)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      expect(cacheManager.has('defaultTTL')).toBe(false);
    });

    it('should respect custom TTL', () => {
      cacheManager.set('customTTL', 'value', { ttl: 5000 }); // 5 seconds
      
      vi.advanceTimersByTime(4000);
      expect(cacheManager.has('customTTL')).toBe(true);
      
      vi.advanceTimersByTime(2000);
      expect(cacheManager.has('customTTL')).toBe(false);
    });
  });
});
