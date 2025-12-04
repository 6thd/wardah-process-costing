// src/lib/cache-manager.ts
// نظام إدارة التخزين المحلي (LocalStorage Cache) لتحسين الأداء

import { safeLocalStorage, safeSessionStorage } from './safe-storage';

// =====================================
// Types
// =====================================

interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface CacheConfig {
  ttl?: number; // Time to live in milliseconds
  useSessionStorage?: boolean; // Use sessionStorage instead of localStorage
}

// =====================================
// Cache Manager Class
// =====================================

class CacheManager {
  private prefix = 'wardah_cache_';
  private defaultTTL = 24 * 60 * 60 * 1000; // 24 hours default

  /**
   * Set cache item
   */
  set<T>(key: string, data: T, config: CacheConfig = {}): boolean {
    try {
      const ttl = config.ttl || this.defaultTTL;
      const expiresAt = Date.now() + ttl;
      
      const cacheItem: CacheItem<T> = {
        data,
        timestamp: Date.now(),
        expiresAt,
      };

      const storage = config.useSessionStorage ? safeSessionStorage : safeLocalStorage;
      const fullKey = `${this.prefix}${key}`;
      
      return storage.setItem(fullKey, JSON.stringify(cacheItem));
    } catch (error) {
      console.error(`Error setting cache for key "${key}":`, error);
      return false;
    }
  }

  /**
   * Get cache item
   */
  get<T>(key: string, config: CacheConfig = {}): T | null {
    try {
      const storage = config.useSessionStorage ? safeSessionStorage : safeLocalStorage;
      const fullKey = `${this.prefix}${key}`;
      const item = storage.getItem(fullKey);

      if (!item) {
        return null;
      }

      const cacheItem: CacheItem<T> = JSON.parse(item);

      // Check if expired
      if (Date.now() > cacheItem.expiresAt) {
        this.remove(key, config);
        return null;
      }

      return cacheItem.data;
    } catch (error) {
      console.error(`Error getting cache for key "${key}":`, error);
      this.remove(key, config);
      return null;
    }
  }

  /**
   * Remove cache item
   */
  remove(key: string, config: CacheConfig = {}): boolean {
    try {
      const storage = config.useSessionStorage ? safeSessionStorage : safeLocalStorage;
      const fullKey = `${this.prefix}${key}`;
      return storage.removeItem(fullKey);
    } catch (error) {
      console.error(`Error removing cache for key "${key}":`, error);
      return false;
    }
  }

  /**
   * Check if cache exists and is valid
   */
  has(key: string, config: CacheConfig = {}): boolean {
    return this.get(key, config) !== null;
  }

  /**
   * Clear all cache
   */
  clear(config: CacheConfig = {}): boolean {
    try {
      const storage = config.useSessionStorage ? safeSessionStorage : safeLocalStorage;
      const nativeStorage = config.useSessionStorage ? window.sessionStorage : window.localStorage;
      
      // Get all keys with prefix
      const keys: string[] = [];
      try {
        for (let i = 0; i < nativeStorage.length; i++) {
          const key = nativeStorage.key(i);
          if (key && key.startsWith(this.prefix)) {
            keys.push(key);
          }
        }
      } catch (e) {
        // If we can't iterate, try to clear common cache keys
        console.warn('Could not iterate storage, clearing known cache keys');
      }

      // Remove all cache keys
      keys.forEach(key => {
        storage.removeItem(key.replace(this.prefix, ''));
      });

      return true;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  }

  /**
   * Get cache age in milliseconds
   */
  getAge(key: string, config: CacheConfig = {}): number | null {
    try {
      const storage = config.useSessionStorage ? safeSessionStorage : safeLocalStorage;
      const fullKey = `${this.prefix}${key}`;
      const item = storage.getItem(fullKey);

      if (!item) {
        return null;
      }

      const cacheItem: CacheItem<any> = JSON.parse(item);
      return Date.now() - cacheItem.timestamp;
    } catch (error) {
      return null;
    }
  }
}

// =====================================
// Cache Keys Constants
// =====================================

export const CACHE_KEYS = {
  // Auth & User
  USER_ORGANIZATIONS: 'user_organizations',
  CURRENT_ORG: 'current_org',
  USER_PERMISSIONS: 'user_permissions',
  
  // Config
  APP_CONFIG: 'app_config',
  
  // Data
  GL_ACCOUNTS: 'gl_accounts',
  ITEMS: 'items',
  CATEGORIES: 'categories',
  SUPPLIERS: 'suppliers',
  CUSTOMERS: 'customers',
  
  // UI State
  SIDEBAR_STATE: 'sidebar_state',
  LAST_VISITED_PAGE: 'last_visited_page',
} as const;

// =====================================
// Cache TTL Constants (in milliseconds)
// =====================================

export const CACHE_TTL = {
  SHORT: 5 * 60 * 1000,        // 5 minutes
  MEDIUM: 30 * 60 * 1000,      // 30 minutes
  LONG: 2 * 60 * 60 * 1000,    // 2 hours
  VERY_LONG: 24 * 60 * 60 * 1000, // 24 hours
  PERMANENT: Infinity,         // Never expires (until manually cleared)
} as const;

// =====================================
// Export Singleton Instance
// =====================================

export const cacheManager = new CacheManager();

// =====================================
// Helper Functions
// =====================================

/**
 * Cache user organizations
 */
export function cacheUserOrganizations(userId: string, organizations: any[]): boolean {
  return cacheManager.set(
    `${CACHE_KEYS.USER_ORGANIZATIONS}_${userId}`,
    organizations,
    { ttl: CACHE_TTL.LONG }
  );
}

/**
 * Get cached user organizations
 */
export function getCachedUserOrganizations(userId: string): any[] | null {
  return cacheManager.get(`${CACHE_KEYS.USER_ORGANIZATIONS}_${userId}`);
}

/**
 * Cache app config
 */
export function cacheAppConfig(config: any): boolean {
  return cacheManager.set(
    CACHE_KEYS.APP_CONFIG,
    config,
    { ttl: CACHE_TTL.VERY_LONG }
  );
}

/**
 * Get cached app config
 */
export function getCachedAppConfig(): any | null {
  return cacheManager.get(CACHE_KEYS.APP_CONFIG);
}

/**
 * Cache GL accounts
 */
export function cacheGLAccounts(orgId: string, accounts: any[]): boolean {
  return cacheManager.set(
    `${CACHE_KEYS.GL_ACCOUNTS}_${orgId}`,
    accounts,
    { ttl: CACHE_TTL.MEDIUM }
  );
}

/**
 * Get cached GL accounts
 */
export function getCachedGLAccounts(orgId: string): any[] | null {
  return cacheManager.get(`${CACHE_KEYS.GL_ACCOUNTS}_${orgId}`);
}

export default cacheManager;

