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
  private readonly handlers: Map<string, QueryHandlerFactory<IQuery<unknown>, unknown>> = new Map()
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
   * التحقق من التخزين المؤقت
   */
  private async checkCache<TResult>(
    query: IQuery<TResult>,
    startTime: number
  ): Promise<QueryResult<TResult> | null> {
    if (!this.cache) {
      return null
    }

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
    
    return null
  }

  /**
   * تنفيذ middlewares قبل الاستعلام
   */
  private async executeBeforeMiddlewares<TResult>(
    query: IQuery<TResult>
  ): Promise<QueryResult<TResult> | null> {
    for (const middleware of this.middlewares) {
      if (middleware.before) {
        const result = await middleware.before(query)
        if (result && !result.success) {
          return result as QueryResult<TResult>
        }
      }
    }
    return null
  }

  /**
   * تخزين النتيجة في Cache
   */
  private async saveToCache<TResult>(
    query: IQuery<TResult>,
    result: QueryResult<TResult>
  ): Promise<void> {
    if (this.cache && result.success && result.data) {
      const cacheKey = this.generateCacheKey(query)
      await this.cache.set(cacheKey, result.data)
    }
  }

  /**
   * تنفيذ middlewares بعد الاستعلام
   */
  private async executeAfterMiddlewares<TResult>(
    query: IQuery<TResult>,
    result: QueryResult<TResult>
  ): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.after) {
        await middleware.after(query, result)
      }
    }
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
      // التحقق من التخزين المؤقت
      const cachedResult = await this.checkCache(query, startTime)
      if (cachedResult) {
        return cachedResult
      }

      // تنفيذ middlewares قبل الاستعلام
      const beforeResult = await this.executeBeforeMiddlewares(query)
      if (beforeResult) {
        return beforeResult
      }

      // إنشاء المعالج وتنفيذ الاستعلام
      const handler = handlerFactory() as IQueryHandler<IQuery<TResult>, TResult>
      const result = await handler.execute(query)

      // تخزين النتيجة في التخزين المؤقت
      await this.saveToCache(query, result)

      // إضافة وقت التنفيذ
      if (result.success) {
        result.metadata = {
          ...result.metadata,
          executionTime: Date.now() - startTime,
          cached: false
        }
      }

      // تنفيذ middlewares بعد الاستعلام
      await this.executeAfterMiddlewares(query, result)

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
    const { queryType, timestamp, ...params } = query
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
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this.defaultTtl)
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
    console.log(`[Query] Executing: ${query.queryType}`, {
      timestamp: query.timestamp
    })
  }

  async after(query: IQuery<unknown>, result: QueryResult<unknown>): Promise<void> {
    console.log(`[Query] Completed: ${query.queryType}`, {
      success: result.success,
      cached: result.metadata?.cached,
      executionTime: result.metadata?.executionTime
    })
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
