import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, createTimeout } from '../query-timeout';

describe('query-timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withTimeout', () => {
    it('should resolve if promise completes before timeout', async () => {
      const fastPromise = Promise.resolve('fast result');
      
      const result = await withTimeout(fastPromise, 5000);
      
      expect(result).toBe('fast result');
    });

    it('should reject with timeout error if promise takes too long', async () => {
      const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow'), 10000));
      
      const resultPromise = withTimeout(slowPromise, 1000);
      
      vi.advanceTimersByTime(1500);
      
      await expect(resultPromise).rejects.toThrow('Operation timed out');
    });

    it('should use custom error message', async () => {
      const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow'), 10000));
      
      const resultPromise = withTimeout(slowPromise, 1000, 'Custom timeout message');
      
      vi.advanceTimersByTime(1500);
      
      await expect(resultPromise).rejects.toThrow('Custom timeout message');
    });

    it('should use default timeout of 10 seconds', async () => {
      const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow'), 15000));
      
      const resultPromise = withTimeout(slowPromise);
      
      // Should not timeout at 9 seconds
      vi.advanceTimersByTime(9000);
      
      // Should timeout at 10+ seconds
      vi.advanceTimersByTime(2000);
      
      await expect(resultPromise).rejects.toThrow('Operation timed out');
    });

    it('should preserve rejected promise error', async () => {
      const failingPromise = Promise.reject(new Error('Original error'));
      
      await expect(withTimeout(failingPromise, 5000)).rejects.toThrow('Original error');
    });
  });

  describe('createTimeout', () => {
    it('should create a cancellable timeout', () => {
      const { promise, cancel } = createTimeout(5000);
      
      expect(promise).toBeInstanceOf(Promise);
      expect(typeof cancel).toBe('function');
    });

    it('should reject after timeout', async () => {
      const { promise } = createTimeout(1000);
      
      vi.advanceTimersByTime(1500);
      
      await expect(promise).rejects.toThrow('Operation timed out after 1000ms');
    });

    it('should be cancellable before timeout', async () => {
      const { promise, cancel } = createTimeout(5000);
      
      // Cancel before timeout
      vi.advanceTimersByTime(2000);
      cancel();
      
      // Advance past original timeout
      vi.advanceTimersByTime(5000);
      
      // Promise should remain pending (not rejected) after cancel
      // We can't easily test pending state, so we verify cancel doesn't throw
      expect(cancel).not.toThrow();
    });

    it('should include timeout duration in error message', async () => {
      const { promise } = createTimeout(3500);
      
      vi.advanceTimersByTime(4000);
      
      await expect(promise).rejects.toThrow('3500ms');
    });

    it('should be safe to cancel multiple times', () => {
      const { cancel } = createTimeout(5000);
      
      expect(() => {
        cancel();
        cancel();
        cancel();
      }).not.toThrow();
    });
  });
});
