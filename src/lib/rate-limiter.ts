/**
 * Rate Limiter Service
 * 
 * Prevents abuse by limiting the number of requests per user/action
 * Uses in-memory cache (can be upgraded to Redis for distributed systems)
 */

interface RateLimitConfig {
  limit: number;      // Maximum requests
  window: number;     // Time window in seconds
  action: string;    // Action identifier
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

class RateLimiter {
  private readonly cache: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Check if request is allowed
   */
  async checkLimit(
    userId: string,
    action: string,
    limit: number = 100,
    window: number = 60 // seconds
  ): Promise<RateLimitResult> {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const resetAt = now + (window * 1000);

    const entry = this.cache.get(key);

    if (!entry || entry.resetAt < now) {
      // New entry or expired
      this.cache.set(key, {
        count: 1,
        resetAt: resetAt,
      });

      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(resetAt),
      };
    }

    // Existing entry
    if (entry.count >= limit) {
      // Log rate limit exceeded event
      console.warn(`⚠️ Rate limit exceeded: ${userId} - ${action} (${entry.count}/${limit})`);
      
      // Audit log entry for security monitoring would go here
      // await auditLogger.log({
      //   action: 'rate_limit_exceeded',
      //   entityType: 'security',
      //   metadata: { userId, action, count: entry.count, limit }
      // });
      
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(entry.resetAt),
      };
    }

    // Increment count
    entry.count++;
    this.cache.set(key, entry);

    return {
      allowed: true,
      remaining: limit - entry.count,
      resetAt: new Date(entry.resetAt),
    };
  }

  /**
   * Check limit with default configs for common actions
   */
  async checkActionLimit(
    userId: string,
    action: string
  ): Promise<RateLimitResult> {
    const configs: Record<string, RateLimitConfig> = {
      // Authentication
      'auth.login': { limit: 5, window: 300, action: 'auth.login' },      // 5 per 5 minutes
      'auth.signup': { limit: 3, window: 3600, action: 'auth.signup' },   // 3 per hour
      
      // Manufacturing
      'manufacturing.orders.create': { limit: 50, window: 60, action: 'manufacturing.orders.create' },
      'manufacturing.orders.update': { limit: 100, window: 60, action: 'manufacturing.orders.update' },
      
      // Inventory
      'inventory.transactions.create': { limit: 200, window: 60, action: 'inventory.transactions.create' },
      
      // Reports
      'reports.generate': { limit: 20, window: 60, action: 'reports.generate' },
      'reports.export': { limit: 10, window: 300, action: 'reports.export' },
      
      // API
      'api.general': { limit: 1000, window: 60, action: 'api.general' },
    };

    const config = configs[action] || configs['api.general'];
    return this.checkLimit(userId, action, config.limit, config.window);
  }

  /**
   * Reset limit for a user/action
   */
  reset(userId: string, action: string): void {
    const key = `${userId}:${action}`;
    this.cache.delete(key);
  }

  /**
   * Reset all limits for a user
   */
  resetUser(userId: string): void {
    const prefix = `${userId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.resetAt < now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get current rate limit status
   */
  getStatus(userId: string, action: string): RateLimitResult | null {
    const key = `${userId}:${action}`;
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (entry.resetAt < now) {
      return null;
    }

    return {
      allowed: true,
      remaining: entry.count,
      resetAt: new Date(entry.resetAt),
    };
  }

  /**
   * Destroy rate limiter (cleanup)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Export class for testing
export { RateLimiter };
export type { RateLimitResult, RateLimitConfig };

