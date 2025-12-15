/**
 * EventFactory secure UUID and event creation tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventFactory } from '../EventFactory'
import { EventTypes } from '../DomainEvents'

// Helper to mock crypto.getRandomValues
function mockCryptoWithRandomValues(values: number[]) {
  const getRandomValues = vi.fn((array: Uint8Array) => {
    values.forEach((v, idx) => {
      array[idx] = v
    })
    return array
  })
  // @ts-expect-error override for tests
  globalThis.crypto = {
    getRandomValues,
  }
}

describe('EventFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates event with secure UUID and correlation id', () => {
    mockCryptoWithRandomValues([1])

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

  it('falls back to crypto.getRandomValues when randomUUID is unavailable', () => {
    mockCryptoWithRandomValues([15])
    // @ts-expect-error ensure randomUUID is absent
    delete (globalThis.crypto as any).randomUUID

    const event = EventFactory.journalEntryCreated(
      'agg-2',
      { entryId: 'J1', createdBy: 'u1' },
      1
    )

    expect(event.id.length).toBe(36)
    expect(event.metadata.correlationId).toBeTruthy()
  })
})

