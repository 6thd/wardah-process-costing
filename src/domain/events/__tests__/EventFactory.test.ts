/**
 * EventFactory secure UUID and event creation tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventFactory } from '../EventFactory'
import { EventTypes } from '../DomainEvents'

describe('EventFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates event with secure UUID and correlation id', () => {
    // Use existing crypto API without mocking
    const event = EventFactory.stockMovementCreated(
      'agg-1',
      { productId: 'p1', quantity: 1, direction: 'IN' },
      1
    )

    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(event.metadata.correlationId).toBeTruthy()
    expect(event.type).toBe(EventTypes.STOCK_MOVEMENT_CREATED)
    expect(event.aggregateId).toBe('agg-1')
  })

  it('generates unique UUIDs for different events', () => {
    const event1 = EventFactory.journalEntryCreated(
      'agg-1',
      { entryId: 'J1', createdBy: 'u1' },
      1
    )

    const event2 = EventFactory.journalEntryCreated(
      'agg-2',
      { entryId: 'J2', createdBy: 'u2' },
      1
    )

    expect(event1.id).not.toBe(event2.id)
    expect(event1.id.length).toBe(36)
    expect(event2.id.length).toBe(36)
  })
})

