/**
 * @fileoverview Domain Events
 * @description كيانات أحداث المجال لـ Event Sourcing
 * 
 * Event Sourcing يحفظ جميع التغييرات كأحداث بدلاً من حفظ الحالة فقط
 * هذا يمكّن من:
 * - إعادة بناء الحالة في أي وقت
 * - تتبع كامل للتغييرات (Audit Trail)
 * - تحليل البيانات التاريخية
 */

// ===== Base Event Types =====

export interface DomainEvent<T = unknown> {
  /** معرف فريد للحدث */
  readonly id: string
  /** نوع الحدث */
  readonly type: string
  /** معرف الكيان المتأثر */
  readonly aggregateId: string
  /** نوع الكيان */
  readonly aggregateType: string
  /** رقم إصدار الحدث */
  readonly version: number
  /** وقت حدوث الحدث */
  readonly occurredAt: Date
  /** بيانات الحدث */
  readonly payload: T
  /** بيانات وصفية */
  readonly metadata: EventMetadata
}

export interface EventMetadata {
  /** معرف المستخدم */
  userId?: string
  /** معرف المؤسسة */
  organizationId?: string
  /** عنوان IP */
  ipAddress?: string
  /** معرف الجلسة */
  sessionId?: string
  /** معرف الارتباط للتتبع */
  correlationId?: string
  /** السبب/المبرر */
  causationId?: string
}

// ===== Inventory Events =====

export interface StockMovementCreatedPayload {
  productId: string
  warehouseId: string
  binId?: string
  quantity: number
  movementType: 'receipt' | 'issue' | 'transfer_in' | 'transfer_out' | 'adjustment'
  reference: string
  previousBalance: number
  newBalance: number
  unitCost?: number
  totalValue?: number
}

export interface ProductStockUpdatedPayload {
  productId: string
  previousStock: number
  newStock: number
  changeAmount: number
  reason: string
}

export interface ReservationCreatedPayload {
  reservationId: string
  productId: string
  quantity: number
  reference: string
  expiresAt?: Date
}

export interface ReservationCancelledPayload {
  reservationId: string
  productId: string
  quantity: number
  reason: string
}

// ===== Accounting Events =====

export interface JournalEntryCreatedPayload {
  entryId: string
  date: Date
  reference?: string
  description: string
  lines: Array<{
    accountId: string
    accountCode: string
    accountName: string
    debit: number
    credit: number
  }>
  totalDebit: number
  totalCredit: number
}

export interface JournalEntryPostedPayload {
  entryId: string
  postedAt: Date
  postedBy: string
}

export interface JournalEntryReversedPayload {
  originalEntryId: string
  reversalEntryId: string
  reversalDate: Date
  reason: string
}

export interface AccountCreatedPayload {
  accountId: string
  code: string
  name: string
  accountType: string
  parentId?: string
  level: number
}

export interface AccountBalanceChangedPayload {
  accountId: string
  previousBalance: number
  newBalance: number
  changeAmount: number
  entryId: string
}

// ===== Manufacturing Events =====

export interface ManufacturingOrderCreatedPayload {
  orderId: string
  productId: string
  quantity: number
  plannedStartDate: Date
  plannedEndDate: Date
  bomId?: string
}

export interface ManufacturingOrderStartedPayload {
  orderId: string
  actualStartDate: Date
  startedBy: string
}

export interface ManufacturingOrderCompletedPayload {
  orderId: string
  actualEndDate: Date
  actualQuantity: number
  completedBy: string
  wastageQuantity: number
}

export interface ProcessCostCalculatedPayload {
  orderId: string
  stageId: string
  materialCost: number
  laborCost: number
  overheadCost: number
  scrapCost: number
  totalCost: number
  costPerUnit: number
}

// ===== Event Type Constants =====

export const EventTypes = {
  // Inventory
  STOCK_MOVEMENT_CREATED: 'inventory.stock_movement.created',
  PRODUCT_STOCK_UPDATED: 'inventory.product.stock_updated',
  RESERVATION_CREATED: 'inventory.reservation.created',
  RESERVATION_CANCELLED: 'inventory.reservation.cancelled',
  
  // Accounting
  JOURNAL_ENTRY_CREATED: 'accounting.journal_entry.created',
  JOURNAL_ENTRY_POSTED: 'accounting.journal_entry.posted',
  JOURNAL_ENTRY_REVERSED: 'accounting.journal_entry.reversed',
  ACCOUNT_CREATED: 'accounting.account.created',
  ACCOUNT_BALANCE_CHANGED: 'accounting.account.balance_changed',
  
  // Manufacturing
  MANUFACTURING_ORDER_CREATED: 'manufacturing.order.created',
  MANUFACTURING_ORDER_STARTED: 'manufacturing.order.started',
  MANUFACTURING_ORDER_COMPLETED: 'manufacturing.order.completed',
  PROCESS_COST_CALCULATED: 'manufacturing.process_cost.calculated'
} as const

export type EventType = typeof EventTypes[keyof typeof EventTypes]

// ===== Typed Event Creators =====

export type StockMovementCreatedEvent = DomainEvent<StockMovementCreatedPayload>
export type ProductStockUpdatedEvent = DomainEvent<ProductStockUpdatedPayload>
export type ReservationCreatedEvent = DomainEvent<ReservationCreatedPayload>
export type ReservationCancelledEvent = DomainEvent<ReservationCancelledPayload>

export type JournalEntryCreatedEvent = DomainEvent<JournalEntryCreatedPayload>
export type JournalEntryPostedEvent = DomainEvent<JournalEntryPostedPayload>
export type JournalEntryReversedEvent = DomainEvent<JournalEntryReversedPayload>
export type AccountCreatedEvent = DomainEvent<AccountCreatedPayload>
export type AccountBalanceChangedEvent = DomainEvent<AccountBalanceChangedPayload>

export type ManufacturingOrderCreatedEvent = DomainEvent<ManufacturingOrderCreatedPayload>
export type ManufacturingOrderStartedEvent = DomainEvent<ManufacturingOrderStartedPayload>
export type ManufacturingOrderCompletedEvent = DomainEvent<ManufacturingOrderCompletedPayload>
export type ProcessCostCalculatedEvent = DomainEvent<ProcessCostCalculatedPayload>

// ===== All Domain Events Union =====

export type AnyDomainEvent = 
  | StockMovementCreatedEvent
  | ProductStockUpdatedEvent
  | ReservationCreatedEvent
  | ReservationCancelledEvent
  | JournalEntryCreatedEvent
  | JournalEntryPostedEvent
  | JournalEntryReversedEvent
  | AccountCreatedEvent
  | AccountBalanceChangedEvent
  | ManufacturingOrderCreatedEvent
  | ManufacturingOrderStartedEvent
  | ManufacturingOrderCompletedEvent
  | ProcessCostCalculatedEvent
