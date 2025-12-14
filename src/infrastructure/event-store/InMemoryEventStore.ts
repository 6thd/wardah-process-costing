/**
 * @fileoverview In-Memory Event Store Implementation
 * @description تنفيذ مخزن الأحداث في الذاكرة (للاختبارات والتطوير)
 */

import type { 
  IEventStore, 
  EventQueryOptions, 
  EventSearchQuery, 
  EventSearchResult,
  IEventPublisher,
  IEventSubscriber,
  EventHandler
} from '@/domain/events'
import type { DomainEvent, AnyDomainEvent } from '@/domain/events'

// ===== In-Memory Event Store =====

export class InMemoryEventStore implements IEventStore, IEventPublisher, IEventSubscriber {
  private events: Map<string, AnyDomainEvent[]> = new Map()
  private allEvents: AnyDomainEvent[] = []
  private handlers: Map<string, Set<EventHandler>> = new Map()
  private globalHandlers: Set<EventHandler> = new Set()

  // ===== IEventStore Implementation =====

  async append<T>(event: DomainEvent<T>): Promise<void> {
    const aggregateEvents = this.events.get(event.aggregateId) || []
    aggregateEvents.push(event as AnyDomainEvent)
    this.events.set(event.aggregateId, aggregateEvents)
    this.allEvents.push(event as AnyDomainEvent)
    
    // نشر الحدث للمشتركين
    await this.publish(event)
  }

  async appendBatch(events: AnyDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.append(event as DomainEvent<unknown>)
    }
  }

  async getEvents(aggregateId: string): Promise<AnyDomainEvent[]> {
    return this.events.get(aggregateId) || []
  }

  async getEventsFromVersion(aggregateId: string, fromVersion: number): Promise<AnyDomainEvent[]> {
    const events = this.events.get(aggregateId) || []
    return events.filter(e => e.version >= fromVersion)
  }

  async getEventsByType(eventType: string, options: EventQueryOptions = {}): Promise<AnyDomainEvent[]> {
    let filtered = this.allEvents.filter(e => e.type === eventType)
    
    if (options.aggregateType) {
      filtered = filtered.filter(e => e.aggregateType === options.aggregateType)
    }
    
    if (options.userId) {
      filtered = filtered.filter(e => e.metadata.userId === options.userId)
    }
    
    if (options.organizationId) {
      filtered = filtered.filter(e => e.metadata.organizationId === options.organizationId)
    }

    if (options.orderBy === 'desc') {
      filtered = filtered.reverse()
    }

    const offset = options.offset || 0
    const limit = options.limit || filtered.length

    return filtered.slice(offset, offset + limit)
  }

  async getEventsByDateRange(
    startDate: Date, 
    endDate: Date, 
    options: EventQueryOptions = {}
  ): Promise<AnyDomainEvent[]> {
    let filtered = this.allEvents.filter(e => 
      e.occurredAt >= startDate && e.occurredAt <= endDate
    )

    if (options.aggregateType) {
      filtered = filtered.filter(e => e.aggregateType === options.aggregateType)
    }

    if (options.userId) {
      filtered = filtered.filter(e => e.metadata.userId === options.userId)
    }

    if (options.orderBy === 'desc') {
      filtered = filtered.reverse()
    }

    const offset = options.offset || 0
    const limit = options.limit || filtered.length

    return filtered.slice(offset, offset + limit)
  }

  async getLatestVersion(aggregateId: string): Promise<number> {
    const events = this.events.get(aggregateId) || []
    if (events.length === 0) return 0
    return Math.max(...events.map(e => e.version))
  }

  async searchEvents(query: EventSearchQuery): Promise<EventSearchResult> {
    let filtered = [...this.allEvents]

    if (query.aggregateId) {
      filtered = filtered.filter(e => e.aggregateId === query.aggregateId)
    }

    if (query.aggregateType) {
      filtered = filtered.filter(e => e.aggregateType === query.aggregateType)
    }

    if (query.eventTypes && query.eventTypes.length > 0) {
      filtered = filtered.filter(e => query.eventTypes!.includes(e.type))
    }

    if (query.startDate) {
      filtered = filtered.filter(e => e.occurredAt >= query.startDate!)
    }

    if (query.endDate) {
      filtered = filtered.filter(e => e.occurredAt <= query.endDate!)
    }

    if (query.userId) {
      filtered = filtered.filter(e => e.metadata.userId === query.userId)
    }

    if (query.organizationId) {
      filtered = filtered.filter(e => e.metadata.organizationId === query.organizationId)
    }

    const total = filtered.length
    const offset = query.offset || 0
    const limit = query.limit || total
    const events = filtered.slice(offset, offset + limit)

    return {
      events,
      total,
      hasMore: offset + events.length < total
    }
  }

  // ===== IEventPublisher Implementation =====

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    // إرسال للمشتركين المحددين لهذا النوع
    const typeHandlers = this.handlers.get(event.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event as AnyDomainEvent)
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error)
        }
      }
    }

    // إرسال للمشتركين العامين
    for (const handler of this.globalHandlers) {
      try {
        await handler(event as AnyDomainEvent)
      } catch (error) {
        console.error(`Error in global event handler:`, error)
      }
    }
  }

  async publishBatch(events: AnyDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event as DomainEvent<unknown>)
    }
  }

  // ===== IEventSubscriber Implementation =====

  subscribe<T>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set())
    }
    this.handlers.get(eventType)!.add(handler as EventHandler)
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  subscribeToAll(handler: EventHandler): void {
    this.globalHandlers.add(handler)
  }

  // ===== Helper Methods =====

  /**
   * مسح جميع الأحداث (للاختبارات)
   */
  clear(): void {
    this.events.clear()
    this.allEvents = []
  }

  /**
   * الحصول على عدد الأحداث
   */
  count(): number {
    return this.allEvents.length
  }

  /**
   * الحصول على جميع الأحداث
   */
  getAllEvents(): AnyDomainEvent[] {
    return [...this.allEvents]
  }
}

// ===== Singleton Instance =====

let eventStoreInstance: InMemoryEventStore | null = null

export function getEventStore(): InMemoryEventStore {
  if (!eventStoreInstance) {
    eventStoreInstance = new InMemoryEventStore()
  }
  return eventStoreInstance
}

export function resetEventStore(): void {
  if (eventStoreInstance) {
    eventStoreInstance.clear()
  }
  eventStoreInstance = null
}
