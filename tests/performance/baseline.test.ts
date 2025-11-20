// tests/performance/baseline.test.ts
// Performance Regression Tests
// اختبارات تراجع الأداء

import { describe, it, expect, beforeAll } from 'vitest';
import { PerformanceMonitor } from '@/lib/performance-monitor';

/**
 * Performance Baselines (established 2025-01-20)
 * These are the target times we want to maintain
 */
const PERFORMANCE_BASELINES = {
  manufacturingOrders: 500, // ms
  journalEntries: 600,      // ms
  trialBalance: 600,        // ms
  workCenters: 300,         // ms
  glAccounts: 400,          // ms
};

/**
 * Tolerance: Allow 20% variance
 * (e.g., 500ms baseline = 600ms max acceptable)
 */
const TOLERANCE = 1.2;

describe('Performance Regression Tests', () => {
  beforeAll(() => {
    // Clear any existing measurements
    PerformanceMonitor.clear();
  });

  describe('Manufacturing Module', () => {
    it('should load Manufacturing Orders in < 500ms', async () => {
      const { manufacturingService } = await import('@/services/supabase-service');
      
      const duration = await PerformanceMonitor.measure(
        'Test: Manufacturing Orders',
        async () => {
          await manufacturingService.getAll();
        }
      );

      const baseline = PERFORMANCE_BASELINES.manufacturingOrders;
      const maxAcceptable = baseline * TOLERANCE;

      expect(duration).toBeLessThan(maxAcceptable);
      
      if (duration > baseline) {
        console.warn(
          `⚠️ Manufacturing Orders: ${duration.toFixed(0)}ms (baseline: ${baseline}ms)`
        );
      }
    });

    it('should load Work Centers in < 300ms', async () => {
      const { supabase } = await import('@/lib/supabase');
      
      const start = performance.now();
      await supabase.from('work_centers').select('*').eq('is_active', true);
      const duration = performance.now() - start;

      const baseline = PERFORMANCE_BASELINES.workCenters;
      const maxAcceptable = baseline * TOLERANCE;

      expect(duration).toBeLessThan(maxAcceptable);
    });
  });

  describe('Accounting Module', () => {
    it('should load Journal Entries in < 600ms', async () => {
      const { journalEntriesService } = await import('@/services/supabase-service');
      
      const duration = await PerformanceMonitor.measure(
        'Test: Journal Entries',
        async () => {
          await journalEntriesService.getAll();
        }
      );

      const baseline = PERFORMANCE_BASELINES.journalEntries;
      const maxAcceptable = baseline * TOLERANCE;

      expect(duration).toBeLessThan(maxAcceptable);
      
      if (duration > baseline) {
        console.warn(
          `⚠️ Journal Entries: ${duration.toFixed(0)}ms (baseline: ${baseline}ms)`
        );
      }
    });

    it('should load Trial Balance in < 600ms', async () => {
      const { trialBalanceService } = await import('@/services/supabase-service');
      
      const duration = await PerformanceMonitor.measure(
        'Test: Trial Balance',
        async () => {
          await trialBalanceService.get();
        }
      );

      const baseline = PERFORMANCE_BASELINES.trialBalance;
      const maxAcceptable = baseline * TOLERANCE;

      expect(duration).toBeLessThan(maxAcceptable);
      
      if (duration > baseline) {
        console.warn(
          `⚠️ Trial Balance: ${duration.toFixed(0)}ms (baseline: ${baseline}ms)`
        );
      }
    });

    it('should load GL Accounts in < 400ms', async () => {
      const { supabase } = await import('@/lib/supabase');
      
      const start = performance.now();
      await supabase.from('gl_accounts').select('*').eq('is_active', true);
      const duration = performance.now() - start;

      const baseline = PERFORMANCE_BASELINES.glAccounts;
      const maxAcceptable = baseline * TOLERANCE;

      expect(duration).toBeLessThan(maxAcceptable);
    });
  });

  describe('Performance Report', () => {
    it('should generate performance report', () => {
      const report = PerformanceMonitor.getReport();
      
      console.log('\n📊 Performance Report:');
      console.log('═══════════════════════════════════════');
      
      Object.entries(report).forEach(([label, stats]: [string, any]) => {
        const baseline = Object.values(PERFORMANCE_BASELINES).find(
          b => Math.abs(parseFloat(stats.avg) - b) < b * 0.5
        ) || 0;
        
        const status = parseFloat(stats.avg) < baseline * TOLERANCE ? '✅' : '⚠️';
        
        console.log(`${status} ${label}:`);
        console.log(`   Avg: ${stats.avg}`);
        console.log(`   Min: ${stats.min}`);
        console.log(`   Max: ${stats.max}`);
        console.log(`   Count: ${stats.count}`);
      });
      
      console.log('═══════════════════════════════════════\n');
      
      // This test always passes, it's just for reporting
      expect(report).toBeDefined();
    });
  });
});

/**
 * How to run these tests:
 * 
 * 1. npm test -- baseline.test.ts
 * 2. Check console for warnings
 * 3. If any test fails, investigate:
 *    - Check if indexes are still active
 *    - Check if views are accessible
 *    - Check network latency
 *    - Check database load
 * 
 * Run these tests:
 * - After every major change
 * - Weekly (automated CI/CD)
 * - Before production deployment
 */

