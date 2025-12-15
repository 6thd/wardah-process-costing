/**
 * @fileoverview Event Factory
 * @description مصنع لإنشاء الأحداث بشكل موحد
 */

// Helper function to generate UUID using cryptographically secure random
function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers and Node.js 19+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  
  // Fallback using crypto.getRandomValues (cryptographically secure)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const array = new Uint8Array(1)
      crypto.getRandomValues(array)
      const r = array[0] % 16
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }
  
  // If crypto is not available, throw an error
  throw new Error('Crypto API is not available. Cannot generate secure UUID.')
}

import { 
  DomainEvent, 
  EventMetadata,
  EventTypes,
  StockMovementCreatedPayload,
  ProductStockUpdatedPayload,
  ReservationCreatedPayload,
  ReservationCancelledPayload,
  JournalEntryCreatedPayload,
  JournalEntryPostedPayload,
  JournalEntryReversedPayload,
  AccountCreatedPayload,
  AccountBalanceChangedPayload,
  ManufacturingOrderCreatedPayload,
  ManufacturingOrderStartedPayload,
  ManufacturingOrderCompletedPayload,
  ProcessCostCalculatedPayload
} from './DomainEvents'

// ===== Event Factory =====

export class EventFactory {
  private static createBaseEvent<T>(
    type: string,
    aggregateId: string,
    aggregateType: string,
    payload: T,
    version: number,
    metadata: Partial<EventMetadata> = {}
  ): DomainEvent<T> {
    return {
      id: generateUUID(),
      type,
      aggregateId,
      aggregateType,
      version,
      occurredAt: new Date(),
      payload,
      metadata: {
        correlationId: metadata.correlationId || generateUUID(),
        ...metadata
      }
    }
  }

  // ===== Inventory Events =====

  static stockMovementCreated(
    aggregateId: string,
    payload: StockMovementCreatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<StockMovementCreatedPayload> {
    return this.createBaseEvent(
      EventTypes.STOCK_MOVEMENT_CREATED,
      aggregateId,
      'StockMovement',
      payload,
      version,
      metadata
    )
  }

  static productStockUpdated(
    aggregateId: string,
    payload: ProductStockUpdatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ProductStockUpdatedPayload> {
    return this.createBaseEvent(
      EventTypes.PRODUCT_STOCK_UPDATED,
      aggregateId,
      'Product',
      payload,
      version,
      metadata
    )
  }

  static reservationCreated(
    aggregateId: string,
    payload: ReservationCreatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ReservationCreatedPayload> {
    return this.createBaseEvent(
      EventTypes.RESERVATION_CREATED,
      aggregateId,
      'Reservation',
      payload,
      version,
      metadata
    )
  }

  static reservationCancelled(
    aggregateId: string,
    payload: ReservationCancelledPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ReservationCancelledPayload> {
    return this.createBaseEvent(
      EventTypes.RESERVATION_CANCELLED,
      aggregateId,
      'Reservation',
      payload,
      version,
      metadata
    )
  }

  // ===== Accounting Events =====

  static journalEntryCreated(
    aggregateId: string,
    payload: JournalEntryCreatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<JournalEntryCreatedPayload> {
    return this.createBaseEvent(
      EventTypes.JOURNAL_ENTRY_CREATED,
      aggregateId,
      'JournalEntry',
      payload,
      version,
      metadata
    )
  }

  static journalEntryPosted(
    aggregateId: string,
    payload: JournalEntryPostedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<JournalEntryPostedPayload> {
    return this.createBaseEvent(
      EventTypes.JOURNAL_ENTRY_POSTED,
      aggregateId,
      'JournalEntry',
      payload,
      version,
      metadata
    )
  }

  static journalEntryReversed(
    aggregateId: string,
    payload: JournalEntryReversedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<JournalEntryReversedPayload> {
    return this.createBaseEvent(
      EventTypes.JOURNAL_ENTRY_REVERSED,
      aggregateId,
      'JournalEntry',
      payload,
      version,
      metadata
    )
  }

  static accountCreated(
    aggregateId: string,
    payload: AccountCreatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<AccountCreatedPayload> {
    return this.createBaseEvent(
      EventTypes.ACCOUNT_CREATED,
      aggregateId,
      'Account',
      payload,
      version,
      metadata
    )
  }

  static accountBalanceChanged(
    aggregateId: string,
    payload: AccountBalanceChangedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<AccountBalanceChangedPayload> {
    return this.createBaseEvent(
      EventTypes.ACCOUNT_BALANCE_CHANGED,
      aggregateId,
      'Account',
      payload,
      version,
      metadata
    )
  }

  // ===== Manufacturing Events =====

  static manufacturingOrderCreated(
    aggregateId: string,
    payload: ManufacturingOrderCreatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ManufacturingOrderCreatedPayload> {
    return this.createBaseEvent(
      EventTypes.MANUFACTURING_ORDER_CREATED,
      aggregateId,
      'ManufacturingOrder',
      payload,
      version,
      metadata
    )
  }

  static manufacturingOrderStarted(
    aggregateId: string,
    payload: ManufacturingOrderStartedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ManufacturingOrderStartedPayload> {
    return this.createBaseEvent(
      EventTypes.MANUFACTURING_ORDER_STARTED,
      aggregateId,
      'ManufacturingOrder',
      payload,
      version,
      metadata
    )
  }

  static manufacturingOrderCompleted(
    aggregateId: string,
    payload: ManufacturingOrderCompletedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ManufacturingOrderCompletedPayload> {
    return this.createBaseEvent(
      EventTypes.MANUFACTURING_ORDER_COMPLETED,
      aggregateId,
      'ManufacturingOrder',
      payload,
      version,
      metadata
    )
  }

  static processCostCalculated(
    aggregateId: string,
    payload: ProcessCostCalculatedPayload,
    version: number,
    metadata?: Partial<EventMetadata>
  ): DomainEvent<ProcessCostCalculatedPayload> {
    return this.createBaseEvent(
      EventTypes.PROCESS_COST_CALCULATED,
      aggregateId,
      'ProcessCost',
      payload,
      version,
      metadata
    )
  }
}
