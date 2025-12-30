/**
 * Performance Monitoring
 * 
 * Tracks and reports performance metrics
 */

import { PerformanceMonitor } from '../performance-monitor';

/**
 * Performance metrics
 */
export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Performance Monitor Service
 */
class PerformanceMonitoringService {
  private metrics: PerformanceMetric[] = [];
  private readonly maxMetrics = 1000; // Keep last 1000 metrics

  /**
   * Track a performance metric
   */
  track(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log slow operations
    if (metric.duration > 3000) {
      console.warn(`Slow operation: ${metric.name} took ${metric.duration}ms`, metric.metadata);
      
      // Send to monitoring if available
      if (typeof globalThis.window !== 'undefined' && (globalThis.window as { Sentry?: { captureMessage: (message: string, level: string) => void } }).Sentry) {
        (globalThis.window as { Sentry: { captureMessage: (message: string, level: string) => void } }).Sentry.captureMessage(
          `Slow operation: ${metric.name}`,
          'warning'
        );
      }
    }
  }

  /**
   * Measure function execution time
   */
  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await fn();
      const duration = performance.now() - startTime;

      this.track({
        name,
        duration,
        timestamp: Date.now(),
        metadata,
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      this.track({
        name: `${name} (error)`,
        duration,
        timestamp: Date.now(),
        metadata: {
          ...metadata,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(filter?: { name?: string; minDuration?: number }): PerformanceMetric[] {
    let filtered = [...this.metrics];

    if (filter?.name) {
      const name = filter.name;
      filtered = filtered.filter(m => m.name.includes(name));
    }

    if (filter?.minDuration) {
      const minDuration = filter.minDuration;
      filtered = filtered.filter(m => m.duration >= minDuration);
    }

    return filtered;
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    total_operations: number;
    average_duration: number;
    slowest_operations: PerformanceMetric[];
    fastest_operations: PerformanceMetric[];
  } {
    if (this.metrics.length === 0) {
      return {
        total_operations: 0,
        average_duration: 0,
        slowest_operations: [],
        fastest_operations: [],
      };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const averageDuration = totalDuration / this.metrics.length;

    const sorted = [...this.metrics].sort((a, b) => b.duration - a.duration);
    const slowest = sorted.slice(0, 10);
    const fastest = sorted.slice(-10).reverse();

    return {
      total_operations: this.metrics.length,
      average_duration: averageDuration,
      slowest_operations: slowest,
      fastest_operations: fastest,
    };
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

// Export singleton instance
export const performanceMonitoring = new PerformanceMonitoringService();

// Integrate with existing PerformanceMonitor
if (typeof PerformanceMonitor !== 'undefined') {
  // Wrap PerformanceMonitor.measure to also track in our service
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const originalMeasure = (PerformanceMonitor as { measure: <T>(name: string, fn: () => Promise<T>) => Promise<T> }).measure;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  (PerformanceMonitor as { measure: <T>(name: string, fn: () => Promise<T>) => Promise<T> }).measure = async function<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return performanceMonitoring.measure(name, fn);
  };
}

export default performanceMonitoring;

