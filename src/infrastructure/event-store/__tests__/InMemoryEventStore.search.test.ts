/**
 * InMemoryEventStore searchEvents filters tests
 */
import { describe, it, expect } from 'vitest'
import { InMemoryEventStore } from '../InMemoryEventStore'
import type { DomainEvent } from '@/domain/events'

function buildEvent(id: string, overrides: Partial<DomainEvent<unknown>> = {}): DomainEvent<unknown> {
  return {
    id,
    type: 'TEST_EVENT',
    aggregateId: 'agg-1',
    aggregateType: 'AggType',
    version: 1,
    occurredAt: new Date('2023-01-01T00:00:00Z'),
    payload: {},
    metadata: {
      userId: 'user-1',
      organizationId: 'org-1',
      correlationId: 'corr-1',
    },
    ...overrides,
  }
}

describe('InMemoryEventStore.searchEvents', () => {
  it('filters by aggregateId, eventTypes, date range, and metadata', async () => {
    const store = new InMemoryEventStore()

    await store.append(buildEvent('1'))
    await store.append(buildEvent('2', { aggregateId: 'agg-2' }))
    await store.append(buildEvent('3', { type: 'OTHER', occurredAt: new Date('2023-02-01') }))
    await store.append(buildEvent('4', { metadata: { userId: 'user-2', organizationId: 'org-2', correlationId: 'c2' } }))

    const result = await store.searchEvents({
      aggregateId: 'agg-1',
      eventTypes: ['TEST_EVENT'],
      startDate: new Date('2023-01-01'),
      endDate: new Date('2023-01-31'),
      userId: 'user-1',
      organizationId: 'org-1',
    })

    expect(result.total).toBe(1)
    expect(result.events[0]?.id).toBe('1')
  })
})

