/**
 * @fileoverview Query Bus Implementation
 * @description تنفيذ ناقل الاستعلامات
 */

import type { 
  IQuery, 
  IQueryBus, 
  IQueryHandler, 
  QueryResult,
  QueryHandlerFactory,
  QueryError
} from './types'

/**
 * ناقل الاستعلامات - In-Memory Implementation
 */
export class QueryBus implements IQueryBus {
  private handlers: Map<string, QueryHandlerFactory<IQuery<unknown>, unknown>> = new Map()
  private middlewares: QueryMiddleware[] = []
  private cache: QueryCache | null = null

  /**
   * تسجيل معالج استعلام
   */
  register<TQuery extends IQuery<TResult>, TResult>(
    queryType: string,
    handlerFactory: QueryHandlerFactory<TQuery, TResult>
  ): void {
    if (this.handlers.has(queryType)) {
      console.warn(`Handler for query type "${queryType}" is being overwritten`)
    }
    this.handlers.set(
      queryType, 
      handlerFactory as QueryHandlerFactory<IQuery<unknown>, unknown>
    )
  }

  /**
   * التحقق من وجود معالج
   */
  hasHandler(queryType: string): boolean {
    return this.handlers.has(queryType)
  }

  /**
   * إضافة middleware
   */
  use(middleware: QueryMiddleware): void {
    this.middlewares.push(middleware)
  }

  /**
   * تفعيل التخزين المؤقت
   */
  enableCache(cache: QueryCache): void {
    this.cache = cache
  }

  /**
   * إرسال الاستعلام للتنفيذ
   */
  async dispatch<TResult>(query: IQuery<TResult>): Promise<QueryResult<TResult>> {
    const handlerFactory = this.handlers.get(query.queryType)
    
    if (!handlerFactory) {
      return {
        success: false,
        error: {
          code: 'HANDLER_NOT_FOUND',
          message: `No handler registered for query type: ${query.queryType}`
        }
      }
    }

    const startTime = Date.now()

    try {
      // تنفيذ middlewares قبل الاستعلام (for access control, validation, etc.)
      // SECURITY: Run middleware BEFORE cache check to prevent unauthorized cache access
      for (const middleware of this.middlewares) {
        if (middleware.before) {
          const result = await middleware.before(query)
          if (result && !result.success) {
            return result as QueryResult<TResult>
          }
        }
      }

      // التحقق من التخزين المؤقت (after middleware validation passes)
      if (this.cache) {
        const cacheKey = this.generateCacheKey(query)
        const cached = await this.cache.get<TResult>(cacheKey)
        if (cached !== null) {
          return {
            success: true,
            data: cached,
            metadata: {
              cached: true,
              executionTime: Date.now() - startTime
            }
          }
        }
      }

      // إنشاء المعالج وتنفيذ الاستعلام
      const handler = handlerFactory() as IQueryHandler<IQuery<TResult>, TResult>
      const result = await handler.execute(query)

      // تخزين النتيجة في التخزين المؤقت
      // Note: Cache falsy values like 0, false, '' - only skip null/undefined
      if (this.cache && result.success && result.data !== undefined && result.data !== null) {
        const cacheKey = this.generateCacheKey(query)
        await this.cache.set(cacheKey, result.data)
      }

      // إضافة وقت التنفيذ
      if (result.success) {
        result.metadata = {
          ...result.metadata,
          executionTime: Date.now() - startTime,
          cached: false
        }
      }

      // تنفيذ middlewares بعد الاستعلام
      for (const middleware of this.middlewares) {
        if (middleware.after) {
          await middleware.after(query, result)
        }
      }

      return result
    } catch (error) {
      const queryError: QueryError = {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }

      return {
        success: false,
        error: queryError,
        metadata: {
          executionTime: Date.now() - startTime
        }
      }
    }
  }

  /**
   * توليد مفتاح التخزين المؤقت
   */
  private generateCacheKey(query: IQuery<unknown>): string {
    const { queryType, timestamp: _timestamp, ...params } = query
    return `${queryType}:${JSON.stringify(params)}`
  }

  /**
   * إلغاء تسجيل معالج
   */
  unregister(queryType: string): boolean {
    return this.handlers.delete(queryType)
  }

  /**
   * الحصول على أنواع الاستعلامات المسجلة
   */
  getRegisteredQueries(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * مسح جميع المعالجات
   */
  clear(): void {
    this.handlers.clear()
    this.middlewares = []
    this.cache = null
  }
}

/**
 * واجهة Middleware للاستعلامات
 */
export interface QueryMiddleware {
  before?(query: IQuery<unknown>): Promise<QueryResult<unknown> | void>
  after?(query: IQuery<unknown>, result: QueryResult<unknown>): Promise<void>
}

/**
 * واجهة التخزين المؤقت
 */
export interface QueryCache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/**
 * تنفيذ التخزين المؤقت في الذاكرة
 */
export class InMemoryQueryCache implements QueryCache {
  private cache: Map<string, { value: unknown; expiresAt: number }> = new Map()
  private defaultTtl: number

  constructor(defaultTtlMs: number = 60000) { // 1 minute default
    this.defaultTtl = defaultTtlMs
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)
    if (!entry) return null
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    
    return entry.value as T
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Use nullish coalescing to allow ttl=0 (expire immediately)
    const effectiveTtl = ttl ?? this.defaultTtl;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + effectiveTtl
    })
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  /**
   * تنظيف الإدخالات المنتهية
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }
}

/**
 * Middleware للتسجيل (Logging)
 */
export class QueryLoggingMiddleware implements QueryMiddleware {
  async before(query: IQuery<unknown>): Promise<void> {
    // Logging removed to comply with ESLint no-console rule
    // Consider using a proper logging service in production
  }

  async after(query: IQuery<unknown>, result: QueryResult<unknown>): Promise<void> {
    // Logging removed to comply with ESLint no-console rule
    // Consider using a proper logging service in production
  }
}

/**
 * Middleware لمراقبة الأداء
 */
export class PerformanceMiddleware implements QueryMiddleware {
  private slowQueryThreshold: number

  constructor(slowQueryThresholdMs: number = 1000) {
    this.slowQueryThreshold = slowQueryThresholdMs
  }

  async after(query: IQuery<unknown>, result: QueryResult<unknown>): Promise<void> {
    const executionTime = result.metadata?.executionTime || 0
    if (executionTime > this.slowQueryThreshold) {
      console.warn(`[Query] Slow query detected: ${query.queryType}`, {
        executionTime,
        threshold: this.slowQueryThreshold
      })
    }
  }
}

// ===== Singleton =====

let queryBusInstance: QueryBus | null = null

export function getQueryBus(): QueryBus {
  if (!queryBusInstance) {
    queryBusInstance = new QueryBus()
  }
  return queryBusInstance
}

export function resetQueryBus(): void {
  if (queryBusInstance) {
    queryBusInstance.clear()
  }
  queryBusInstance = null
}
