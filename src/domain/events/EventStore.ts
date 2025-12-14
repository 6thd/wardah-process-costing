/**
 * @fileoverview Event Store Interface
 * @description واجهة مخزن الأحداث لـ Event Sourcing
 */

import type { DomainEvent, EventMetadata, AnyDomainEvent } from './DomainEvents'

// ===== Event Store Interface =====

export interface IEventStore {
  /**
   * إضافة حدث جديد
   */
  append<T>(event: DomainEvent<T>): Promise<void>

  /**
   * إضافة عدة أحداث
   */
  appendBatch(events: AnyDomainEvent[]): Promise<void>

  /**
   * الحصول على جميع أحداث كيان معين
   */
  getEvents(aggregateId: string): Promise<AnyDomainEvent[]>

  /**
   * الحصول على أحداث من إصدار معين
   */
  getEventsFromVersion(aggregateId: string, fromVersion: number): Promise<AnyDomainEvent[]>

  /**
   * الحصول على أحداث حسب النوع
   */
  getEventsByType(eventType: string, options?: EventQueryOptions): Promise<AnyDomainEvent[]>

  /**
   * الحصول على أحداث في فترة زمنية
   */
  getEventsByDateRange(startDate: Date, endDate: Date, options?: EventQueryOptions): Promise<AnyDomainEvent[]>

  /**
   * الحصول على آخر إصدار للكيان
   */
  getLatestVersion(aggregateId: string): Promise<number>

  /**
   * البحث في الأحداث
   */
  searchEvents(query: EventSearchQuery): Promise<EventSearchResult>
}

// ===== Query Types =====

export interface EventQueryOptions {
  limit?: number
  offset?: number
  orderBy?: 'asc' | 'desc'
  aggregateType?: string
  userId?: string
  organizationId?: string
}

export interface EventSearchQuery {
  aggregateId?: string
  aggregateType?: string
  eventTypes?: string[]
  startDate?: Date
  endDate?: Date
  userId?: string
  organizationId?: string
  metadata?: Partial<EventMetadata>
  limit?: number
  offset?: number
}

export interface EventSearchResult {
  events: AnyDomainEvent[]
  total: number
  hasMore: boolean
}

// ===== Event Publisher Interface =====

export interface IEventPublisher {
  /**
   * نشر حدث
   */
  publish<T>(event: DomainEvent<T>): Promise<void>

  /**
   * نشر عدة أحداث
   */
  publishBatch(events: AnyDomainEvent[]): Promise<void>
}

// ===== Event Subscriber Interface =====

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>

export interface IEventSubscriber {
  /**
   * الاشتراك في نوع حدث معين
   */
  subscribe<T>(eventType: string, handler: EventHandler<T>): void

  /**
   * إلغاء الاشتراك
   */
  unsubscribe(eventType: string, handler: EventHandler): void

  /**
   * الاشتراك في جميع الأحداث
   */
  subscribeToAll(handler: EventHandler): void
}

// ===== Snapshot Interface =====

export interface Snapshot<T> {
  aggregateId: string
  aggregateType: string
  version: number
  state: T
  createdAt: Date
}

export interface ISnapshotStore {
  /**
   * حفظ snapshot
   */
  save<T>(snapshot: Snapshot<T>): Promise<void>

  /**
   * الحصول على آخر snapshot
   */
  getLatest<T>(aggregateId: string): Promise<Snapshot<T> | null>

  /**
   * الحصول على snapshot بإصدار معين
   */
  getByVersion<T>(aggregateId: string, version: number): Promise<Snapshot<T> | null>
}

// ===== Aggregate Root Interface =====

export interface AggregateRoot<T> {
  readonly id: string
  readonly version: number
  
  /**
   * الحصول على الأحداث غير المنشورة
   */
  getUncommittedEvents(): AnyDomainEvent[]

  /**
   * تطبيق حدث على الحالة
   */
  apply(event: AnyDomainEvent): void

  /**
   * إعادة بناء الحالة من الأحداث
   */
  loadFromHistory(events: AnyDomainEvent[]): void

  /**
   * الحصول على الحالة الحالية
   */
  getState(): T

  /**
   * مسح الأحداث غير المنشورة
   */
  clearUncommittedEvents(): void
}
