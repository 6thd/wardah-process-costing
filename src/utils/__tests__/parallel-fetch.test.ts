import { describe, it, expect, vi } from 'vitest';
import { fetchParallel, fetchWithRetry } from '../parallel-fetch';

describe('parallel-fetch', () => {
  describe('fetchParallel', () => {
    it('should fetch multiple resources in parallel', async () => {
      const promises = {
        users: Promise.resolve(['user1', 'user2']),
        products: Promise.resolve(['product1']),
        orders: Promise.resolve([]),
      };

      const result = await fetchParallel(promises);

      expect(result.users).toEqual(['user1', 'user2']);
      expect(result.products).toEqual(['product1']);
      expect(result.orders).toEqual([]);
    });

    it('should return empty object for empty input', async () => {
      const result = await fetchParallel({});
      
      expect(result).toEqual({});
    });

    it('should handle single promise', async () => {
      const promises = {
        single: Promise.resolve({ id: 1, name: 'test' }),
      };

      const result = await fetchParallel(promises);

      expect(result.single).toEqual({ id: 1, name: 'test' });
    });

    it('should handle mixed resolved values', async () => {
      const promises = {
        number: Promise.resolve(42),
        string: Promise.resolve('hello'),
        array: Promise.resolve([1, 2, 3]),
        object: Promise.resolve({ key: 'value' }),
        boolean: Promise.resolve(true),
      };

      const result = await fetchParallel(promises);

      expect(result.number).toBe(42);
      expect(result.string).toBe('hello');
      expect(result.array).toEqual([1, 2, 3]);
      expect(result.object).toEqual({ key: 'value' });
      expect(result.boolean).toBe(true);
    });
  });

  describe('fetchWithRetry', () => {
    it('should return result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await fetchWithRetry(fn, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should work with default options', async () => {
      const fn = vi.fn().mockResolvedValue('default-success');

      const result = await fetchWithRetry(fn);

      expect(result).toBe('default-success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should return correct data types', async () => {
      const objFn = vi.fn().mockResolvedValue({ id: 1 });
      const arrFn = vi.fn().mockResolvedValue([1, 2, 3]);
      const numFn = vi.fn().mockResolvedValue(42);

      expect(await fetchWithRetry(objFn)).toEqual({ id: 1 });
      expect(await fetchWithRetry(arrFn)).toEqual([1, 2, 3]);
      expect(await fetchWithRetry(numFn)).toBe(42);
    });

    it('should not retry on immediate success', async () => {
      const fn = vi.fn().mockResolvedValue('immediate');

      await fetchWithRetry(fn, { maxRetries: 5 });

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
