/**
 * @fileoverview Event Sourcing Tests
 * @description اختبارات Event Sourcing و Audit Trail
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { 
  EventFactory,
  EventTypes,
  type DomainEvent,
  type StockMovementCreatedPayload,
  type JournalEntryCreatedPayload,
  type AnyDomainEvent
} from '@/domain/events'
import { InMemoryEventStore, resetEventStore } from '@/infrastructure/event-store'

describe('Event Sourcing', () => {
  let eventStore: InMemoryEventStore

  beforeEach(() => {
    resetEventStore()
    eventStore = new InMemoryEventStore()
  })

  describe('EventFactory', () => {
    it('should create stock movement event with correct structure', () => {
      const payload: StockMovementCreatedPayload = {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 100,
        movementType: 'receipt',
        reference: 'PO-001',
        previousBalance: 0,
        newBalance: 100
      }

      const event = EventFactory.stockMovementCreated(
        'movement-1',
        payload,
        1,
        { userId: 'user-1', organizationId: 'org-1' }
      )

      expect(event.id).toBeDefined()
      expect(event.type).toBe(EventTypes.STOCK_MOVEMENT_CREATED)
      expect(event.aggregateId).toBe('movement-1')
      expect(event.aggregateType).toBe('StockMovement')
      expect(event.version).toBe(1)
      expect(event.occurredAt).toBeInstanceOf(Date)
      expect(event.payload).toEqual(payload)
      expect(event.metadata.userId).toBe('user-1')
      expect(event.metadata.organizationId).toBe('org-1')
      expect(event.metadata.correlationId).toBeDefined()
    })

    it('should create journal entry event', () => {
      const payload: JournalEntryCreatedPayload = {
        entryId: 'je-1',
        date: new Date('2025-01-15'),
        reference: 'JV-001',
        description: 'قيد مبيعات',
        lines: [
          { accountId: 'acc-1', accountCode: '1100', accountName: 'النقدية', debit: 1000, credit: 0 },
          { accountId: 'acc-2', accountCode: '4100', accountName: 'المبيعات', debit: 0, credit: 1000 }
        ],
        totalDebit: 1000,
        totalCredit: 1000
      }

      const event = EventFactory.journalEntryCreated('je-1', payload, 1)

      expect(event.type).toBe(EventTypes.JOURNAL_ENTRY_CREATED)
      expect(event.payload.totalDebit).toBe(1000)
      expect(event.payload.lines).toHaveLength(2)
    })

    it('should create manufacturing order events', () => {
      const created = EventFactory.manufacturingOrderCreated(
        'mo-1',
        {
          orderId: 'mo-1',
          productId: 'prod-1',
          quantity: 100,
          plannedStartDate: new Date('2025-01-20'),
          plannedEndDate: new Date('2025-01-25')
        },
        1
      )

      const started = EventFactory.manufacturingOrderStarted(
        'mo-1',
        {
          orderId: 'mo-1',
          actualStartDate: new Date('2025-01-20'),
          startedBy: 'user-1'
        },
        2
      )

      const completed = EventFactory.manufacturingOrderCompleted(
        'mo-1',
        {
          orderId: 'mo-1',
          actualEndDate: new Date('2025-01-24'),
          actualQuantity: 98,
          completedBy: 'user-1',
          wastageQuantity: 2
        },
        3
      )

      expect(created.type).toBe(EventTypes.MANUFACTURING_ORDER_CREATED)
      expect(started.type).toBe(EventTypes.MANUFACTURING_ORDER_STARTED)
      expect(completed.type).toBe(EventTypes.MANUFACTURING_ORDER_COMPLETED)
      expect(completed.version).toBe(3)
    })

    it('should generate unique IDs for each event', () => {
      const event1 = EventFactory.productStockUpdated(
        'prod-1',
        { productId: 'prod-1', previousStock: 0, newStock: 100, changeAmount: 100, reason: 'استلام' },
        1
      )

      const event2 = EventFactory.productStockUpdated(
        'prod-1',
        { productId: 'prod-1', previousStock: 100, newStock: 150, changeAmount: 50, reason: 'استلام' },
        2
      )

      expect(event1.id).not.toBe(event2.id)
      expect(event1.metadata.correlationId).not.toBe(event2.metadata.correlationId)
    })
  })

  describe('InMemoryEventStore', () => {
    it('should append and retrieve events', async () => {
      const event = EventFactory.stockMovementCreated(
        'movement-1',
        {
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 50,
          movementType: 'receipt',
          reference: 'PO-001',
          previousBalance: 0,
          newBalance: 50
        },
        1
      )

      await eventStore.append(event)
      const events = await eventStore.getEvents('movement-1')

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(event)
    })

    it('should append batch of events', async () => {
      const events = [
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 0, newStock: 50, changeAmount: 50, reason: 'استلام' }, 1),
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 50, newStock: 75, changeAmount: 25, reason: 'استلام' }, 2),
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 75, newStock: 50, changeAmount: -25, reason: 'صرف' }, 3)
      ]

      await eventStore.appendBatch(events)
      const storedEvents = await eventStore.getEvents('prod-1')

      expect(storedEvents).toHaveLength(3)
    })

    it('should get events from specific version', async () => {
      const events = [
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 0, newStock: 50, changeAmount: 50, reason: 'استلام' }, 1),
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 50, newStock: 75, changeAmount: 25, reason: 'استلام' }, 2),
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 75, newStock: 50, changeAmount: -25, reason: 'صرف' }, 3)
      ]

      await eventStore.appendBatch(events)
      const fromVersion2 = await eventStore.getEventsFromVersion('prod-1', 2)

      expect(fromVersion2).toHaveLength(2)
      expect(fromVersion2[0].version).toBe(2)
      expect(fromVersion2[1].version).toBe(3)
    })

    it('should get events by type', async () => {
      await eventStore.append(
        EventFactory.stockMovementCreated('m-1', { productId: 'p-1', warehouseId: 'w-1', quantity: 10, movementType: 'receipt', reference: 'R-1', previousBalance: 0, newBalance: 10 }, 1)
      )
      await eventStore.append(
        EventFactory.journalEntryCreated('je-1', { entryId: 'je-1', date: new Date(), description: 'test', lines: [], totalDebit: 0, totalCredit: 0 }, 1)
      )
      await eventStore.append(
        EventFactory.stockMovementCreated('m-2', { productId: 'p-2', warehouseId: 'w-1', quantity: 20, movementType: 'receipt', reference: 'R-2', previousBalance: 0, newBalance: 20 }, 1)
      )

      const stockEvents = await eventStore.getEventsByType(EventTypes.STOCK_MOVEMENT_CREATED)

      expect(stockEvents).toHaveLength(2)
    })

    it('should get events by date range', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      await eventStore.append(
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 0, newStock: 50, changeAmount: 50, reason: 'test' }, 1)
      )

      const events = await eventStore.getEventsByDateRange(yesterday, tomorrow)

      expect(events.length).toBeGreaterThan(0)
    })

    it('should get latest version', async () => {
      await eventStore.append(
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 0, newStock: 50, changeAmount: 50, reason: 'r1' }, 1)
      )
      await eventStore.append(
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 50, newStock: 75, changeAmount: 25, reason: 'r2' }, 2)
      )
      await eventStore.append(
        EventFactory.productStockUpdated('prod-1', { productId: 'prod-1', previousStock: 75, newStock: 100, changeAmount: 25, reason: 'r3' }, 5)
      )

      const version = await eventStore.getLatestVersion('prod-1')

      expect(version).toBe(5)
    })

    it('should return 0 for non-existent aggregate', async () => {
      const version = await eventStore.getLatestVersion('non-existent')
      expect(version).toBe(0)
    })

    it('should search events with multiple criteria', async () => {
      await eventStore.append(
        EventFactory.stockMovementCreated('m-1', { productId: 'p-1', warehouseId: 'w-1', quantity: 10, movementType: 'receipt', reference: 'R-1', previousBalance: 0, newBalance: 10 }, 1, { userId: 'user-1', organizationId: 'org-1' })
      )
      await eventStore.append(
        EventFactory.stockMovementCreated('m-2', { productId: 'p-2', warehouseId: 'w-1', quantity: 20, movementType: 'receipt', reference: 'R-2', previousBalance: 0, newBalance: 20 }, 1, { userId: 'user-2', organizationId: 'org-1' })
      )
      await eventStore.append(
        EventFactory.journalEntryCreated('je-1', { entryId: 'je-1', date: new Date(), description: 'test', lines: [], totalDebit: 0, totalCredit: 0 }, 1, { userId: 'user-1', organizationId: 'org-1' })
      )

      const result = await eventStore.searchEvents({
        userId: 'user-1',
        organizationId: 'org-1'
      })

      expect(result.events).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should paginate search results', async () => {
      for (let i = 1; i <= 10; i++) {
        await eventStore.append(
          EventFactory.productStockUpdated(`prod-${i}`, { productId: `prod-${i}`, previousStock: 0, newStock: i * 10, changeAmount: i * 10, reason: `r${i}` }, 1)
        )
      }

      const page1 = await eventStore.searchEvents({ limit: 3, offset: 0 })
      const page2 = await eventStore.searchEvents({ limit: 3, offset: 3 })

      expect(page1.events).toHaveLength(3)
      expect(page1.hasMore).toBe(true)
      expect(page2.events).toHaveLength(3)
    })
  })

  describe('Event Subscription', () => {
    it('should notify subscribers when event is appended', async () => {
      const handler = vi.fn()
      eventStore.subscribe(EventTypes.STOCK_MOVEMENT_CREATED, handler)

      await eventStore.append(
        EventFactory.stockMovementCreated('m-1', { productId: 'p-1', warehouseId: 'w-1', quantity: 10, movementType: 'receipt', reference: 'R-1', previousBalance: 0, newBalance: 10 }, 1)
      )

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: EventTypes.STOCK_MOVEMENT_CREATED
      }))
    })

    it('should notify global subscribers for all events', async () => {
      const globalHandler = vi.fn()
      eventStore.subscribeToAll(globalHandler)

      await eventStore.append(
        EventFactory.stockMovementCreated('m-1', { productId: 'p-1', warehouseId: 'w-1', quantity: 10, movementType: 'receipt', reference: 'R-1', previousBalance: 0, newBalance: 10 }, 1)
      )
      await eventStore.append(
        EventFactory.journalEntryCreated('je-1', { entryId: 'je-1', date: new Date(), description: 'test', lines: [], totalDebit: 0, totalCredit: 0 }, 1)
      )

      expect(globalHandler).toHaveBeenCalledTimes(2)
    })

    it('should allow unsubscribe', async () => {
      const handler = vi.fn()
      eventStore.subscribe(EventTypes.STOCK_MOVEMENT_CREATED, handler)
      eventStore.unsubscribe(EventTypes.STOCK_MOVEMENT_CREATED, handler)

      await eventStore.append(
        EventFactory.stockMovementCreated('m-1', { productId: 'p-1', warehouseId: 'w-1', quantity: 10, movementType: 'receipt', reference: 'R-1', previousBalance: 0, newBalance: 10 }, 1)
      )

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('Audit Trail', () => {
    it('should track complete history of stock changes', async () => {
      // سيناريو: منتج يمر بعدة عمليات
      const productId = 'prod-1'

      // استلام مبدئي
      await eventStore.append(
        EventFactory.stockMovementCreated('m-1', {
          productId,
          warehouseId: 'wh-1',
          quantity: 100,
          movementType: 'receipt',
          reference: 'PO-001',
          previousBalance: 0,
          newBalance: 100
        }, 1, { userId: 'user-1' })
      )

      // صرف للتصنيع
      await eventStore.append(
        EventFactory.stockMovementCreated('m-2', {
          productId,
          warehouseId: 'wh-1',
          quantity: -30,
          movementType: 'issue',
          reference: 'MO-001',
          previousBalance: 100,
          newBalance: 70
        }, 2, { userId: 'user-2' })
      )

      // نقل بين المستودعات
      await eventStore.append(
        EventFactory.stockMovementCreated('m-3', {
          productId,
          warehouseId: 'wh-1',
          quantity: -20,
          movementType: 'transfer_out',
          reference: 'TRF-001',
          previousBalance: 70,
          newBalance: 50
        }, 3, { userId: 'user-1' })
      )

      await eventStore.append(
        EventFactory.stockMovementCreated('m-4', {
          productId,
          warehouseId: 'wh-2',
          quantity: 20,
          movementType: 'transfer_in',
          reference: 'TRF-001',
          previousBalance: 0,
          newBalance: 20
        }, 4, { userId: 'user-1' })
      )

      // الحصول على السجل الكامل
      const allEvents = eventStore.getAllEvents()
      const stockMovements = await eventStore.getEventsByType(EventTypes.STOCK_MOVEMENT_CREATED)

      expect(stockMovements).toHaveLength(4)
      
      // التحقق من تسلسل الأحداث
      expect((stockMovements[0].payload as StockMovementCreatedPayload).newBalance).toBe(100)
      expect((stockMovements[1].payload as StockMovementCreatedPayload).newBalance).toBe(70)
      expect((stockMovements[2].payload as StockMovementCreatedPayload).newBalance).toBe(50)
      expect((stockMovements[3].payload as StockMovementCreatedPayload).newBalance).toBe(20)

      // التحقق من تتبع المستخدمين
      expect(stockMovements[0].metadata.userId).toBe('user-1')
      expect(stockMovements[1].metadata.userId).toBe('user-2')
    })

    it('should track journal entry lifecycle', async () => {
      const entryId = 'je-1'

      // إنشاء القيد
      await eventStore.append(
        EventFactory.journalEntryCreated(entryId, {
          entryId,
          date: new Date('2025-01-15'),
          reference: 'JV-001',
          description: 'قيد مبيعات نقدية',
          lines: [
            { accountId: 'acc-1', accountCode: '1100', accountName: 'النقدية', debit: 5000, credit: 0 },
            { accountId: 'acc-2', accountCode: '4100', accountName: 'المبيعات', debit: 0, credit: 5000 }
          ],
          totalDebit: 5000,
          totalCredit: 5000
        }, 1, { userId: 'accountant-1' })
      )

      // ترحيل القيد
      await eventStore.append(
        EventFactory.journalEntryPosted(entryId, {
          entryId,
          postedAt: new Date(),
          postedBy: 'manager-1'
        }, 2, { userId: 'manager-1' })
      )

      const entryEvents = await eventStore.getEvents(entryId)

      expect(entryEvents).toHaveLength(2)
      expect(entryEvents[0].type).toBe(EventTypes.JOURNAL_ENTRY_CREATED)
      expect(entryEvents[1].type).toBe(EventTypes.JOURNAL_ENTRY_POSTED)
    })

    it('should rebuild state from events', async () => {
      // إعادة بناء رصيد المنتج من الأحداث
      const productId = 'prod-1'
      
      await eventStore.appendBatch([
        EventFactory.productStockUpdated(productId, { productId, previousStock: 0, newStock: 100, changeAmount: 100, reason: 'استلام' }, 1),
        EventFactory.productStockUpdated(productId, { productId, previousStock: 100, newStock: 80, changeAmount: -20, reason: 'صرف' }, 2),
        EventFactory.productStockUpdated(productId, { productId, previousStock: 80, newStock: 130, changeAmount: 50, reason: 'استلام' }, 3)
      ])

      const events = await eventStore.getEvents(productId)
      
      // إعادة حساب الرصيد
      let currentStock = 0
      for (const event of events) {
        if (event.type === EventTypes.PRODUCT_STOCK_UPDATED) {
          currentStock += (event.payload as any).changeAmount
        }
      }

      expect(currentStock).toBe(130)
    })
  })
})
