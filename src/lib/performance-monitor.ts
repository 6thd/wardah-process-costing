/**
 * Performance Monitor Utility
 * Used to measure and log execution times for critical operations.
 */
export class PerformanceMonitor {
  static readonly measurements: Map<string, number[]> = new Map();
  
  /**
   * Measure the execution time of an asynchronous function.
   * @param label Label for the measurement
   * @param fn Async function to execute
   */
  static async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      return result;
    } finally {
      const duration = performance.now() - start;
      const existing = this.measurements.get(label) || [];
      existing.push(duration);
      this.measurements.set(label, existing);
      
      // Log to console with a distinctive emoji for visibility
      console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
    }
  }
  
  /**
   * Get a summary report of all measurements.
   */
  static getReport() {
    const report: Record<string, any> = {};
    this.measurements.forEach((times, label) => {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      report[label] = {
        avg: avg.toFixed(2) + 'ms',
        min: Math.min(...times).toFixed(2) + 'ms',
        max: Math.max(...times).toFixed(2) + 'ms',
        count: times.length,
        last: times.at(-1)?.toFixed(2) + 'ms' || '0ms'
      };
    });
    return report;
  }

  /**
   * Clear all measurements.
   */
  static clear() {
    this.measurements.clear();
  }
}
