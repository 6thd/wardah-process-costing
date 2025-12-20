import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformanceMonitor } from '../performance-monitor';

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    // Clear measurements before each test
    PerformanceMonitor.clear();
    // Mock console.log to avoid noise in tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('measure', () => {
    it('should measure execution time of async function', async () => {
      const mockFn = vi.fn().mockResolvedValue('result');
      
      const result = await PerformanceMonitor.measure('test-operation', mockFn);
      
      expect(result).toBe('result');
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('should record measurement in map', async () => {
      await PerformanceMonitor.measure('test-op', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done';
      });
      
      const measurements = PerformanceMonitor.measurements.get('test-op');
      expect(measurements).toBeDefined();
      expect(measurements!.length).toBe(1);
      expect(measurements![0]).toBeGreaterThan(0);
    });

    it('should accumulate multiple measurements for same label', async () => {
      await PerformanceMonitor.measure('repeated-op', async () => 'first');
      await PerformanceMonitor.measure('repeated-op', async () => 'second');
      await PerformanceMonitor.measure('repeated-op', async () => 'third');
      
      const measurements = PerformanceMonitor.measurements.get('repeated-op');
      expect(measurements!.length).toBe(3);
    });

    it('should handle function that throws', async () => {
      const error = new Error('Test error');
      
      await expect(
        PerformanceMonitor.measure('error-op', async () => {
          throw error;
        })
      ).rejects.toThrow('Test error');
      
      // Should still record measurement even on error
      const measurements = PerformanceMonitor.measurements.get('error-op');
      expect(measurements).toBeDefined();
      expect(measurements!.length).toBe(1);
    });

    it('should return correct result from measured function', async () => {
      const result = await PerformanceMonitor.measure('result-test', async () => {
        return { data: [1, 2, 3], success: true };
      });
      
      expect(result).toEqual({ data: [1, 2, 3], success: true });
    });

    it('should log measurement to console', async () => {
      await PerformanceMonitor.measure('console-test', async () => 'done');
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('⏱️ console-test:')
      );
    });
  });

  describe('getReport', () => {
    it('should return empty report when no measurements', () => {
      const report = PerformanceMonitor.getReport();
      expect(report).toEqual({});
    });

    it('should return report with stats for single measurement', async () => {
      await PerformanceMonitor.measure('single-op', async () => 'done');
      
      const report = PerformanceMonitor.getReport();
      
      expect(report['single-op']).toBeDefined();
      expect(report['single-op'].count).toBe(1);
      expect(report['single-op'].avg).toMatch(/\d+\.\d+ms/);
      expect(report['single-op'].min).toMatch(/\d+\.\d+ms/);
      expect(report['single-op'].max).toMatch(/\d+\.\d+ms/);
      expect(report['single-op'].last).toMatch(/\d+\.\d+ms/);
    });

    it('should calculate correct stats for multiple measurements', async () => {
      // Mock performance.now to have predictable results
      let callCount = 0;
      const mockTimes = [0, 100, 100, 200, 200, 300]; // pairs of start/end
      vi.spyOn(performance, 'now').mockImplementation(() => mockTimes[callCount++]);
      
      await PerformanceMonitor.measure('multi-op', async () => 'first'); // 100ms
      await PerformanceMonitor.measure('multi-op', async () => 'second'); // 100ms
      await PerformanceMonitor.measure('multi-op', async () => 'third'); // 100ms
      
      const report = PerformanceMonitor.getReport();
      
      expect(report['multi-op'].count).toBe(3);
      // All measurements are 100ms
      expect(report['multi-op'].avg).toBe('100.00ms');
      expect(report['multi-op'].min).toBe('100.00ms');
      expect(report['multi-op'].max).toBe('100.00ms');
      
      vi.restoreAllMocks();
    });

    it('should handle multiple different operations', async () => {
      await PerformanceMonitor.measure('op-1', async () => 'one');
      await PerformanceMonitor.measure('op-2', async () => 'two');
      await PerformanceMonitor.measure('op-3', async () => 'three');
      
      const report = PerformanceMonitor.getReport();
      
      expect(Object.keys(report).length).toBe(3);
      expect(report['op-1']).toBeDefined();
      expect(report['op-2']).toBeDefined();
      expect(report['op-3']).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all measurements', async () => {
      await PerformanceMonitor.measure('to-clear', async () => 'data');
      expect(PerformanceMonitor.measurements.size).toBe(1);
      
      PerformanceMonitor.clear();
      
      expect(PerformanceMonitor.measurements.size).toBe(0);
    });

    it('should allow new measurements after clear', async () => {
      await PerformanceMonitor.measure('first-batch', async () => 'data');
      PerformanceMonitor.clear();
      await PerformanceMonitor.measure('second-batch', async () => 'new data');
      
      expect(PerformanceMonitor.measurements.has('first-batch')).toBe(false);
      expect(PerformanceMonitor.measurements.has('second-batch')).toBe(true);
    });
  });

  describe('real-world scenarios', () => {
    it('should measure database query simulation', async () => {
      const mockDbQuery = async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return [{ id: 1, name: 'Product 1' }];
      };
      
      const result = await PerformanceMonitor.measure('db-query', mockDbQuery);
      
      expect(result).toEqual([{ id: 1, name: 'Product 1' }]);
      expect(PerformanceMonitor.measurements.get('db-query')![0]).toBeGreaterThanOrEqual(5);
    });

    it('should measure API call simulation', async () => {
      const mockApiCall = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { status: 200, data: { success: true } };
      };
      
      const result = await PerformanceMonitor.measure('api-call', mockApiCall);
      
      expect(result.status).toBe(200);
    });

    it('should track multiple related operations', async () => {
      // Simulate a typical workflow
      await PerformanceMonitor.measure('fetch-orders', async () => []);
      await PerformanceMonitor.measure('process-orders', async () => 'processed');
      await PerformanceMonitor.measure('save-results', async () => true);
      
      const report = PerformanceMonitor.getReport();
      
      expect(report['fetch-orders']).toBeDefined();
      expect(report['process-orders']).toBeDefined();
      expect(report['save-results']).toBeDefined();
    });
  });
});
