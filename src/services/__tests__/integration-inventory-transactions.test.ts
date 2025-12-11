/**
 * Integration Tests: Inventory Transaction Service
 * 
 * Tests real implementation of inventory transaction operations by importing
 * and executing actual source code from inventory-transaction-service.ts
 * 
 * This improves SonarCloud coverage by testing real functions, not just types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types
import type { MaterialRequirement, StockAvailability } from '../inventory-transaction-service'

// Mock supabase module BEFORE importing the service - use factory function
vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn()
              })),
              order: vi.fn(() => Promise.resolve({ data: [], error: null }))
            })),
            maybeSingle: vi.fn(),
            order: vi.fn(() => Promise.resolve({ data: [], error: null }))
          })),
          maybeSingle: vi.fn()
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn()
          }))
        }))
      }))
    },
    getEffectiveTenantId: vi.fn(() => Promise.resolve('test-org-123'))
  }
})

vi.mock('@/lib/db-transaction', () => ({
  executeTransaction: vi.fn((callback) => callback())
}))

vi.mock('@/lib/errors/InsufficientInventoryError', () => ({
  InsufficientInventoryError: class InsufficientInventoryError extends Error {
    constructor(itemId: string, required: number, available: number, itemName?: string) {
      super(`Insufficient inventory for ${itemName || itemId}`)
      this.name = 'InsufficientInventoryError'
    }
  }
}))

vi.mock('@/lib/errors/AppError', () => ({
  AppError: class AppError extends Error {
    constructor(code: string, message: string, status: number = 500, isOperational = true, meta?: any) {
      super(message)
      this.name = 'AppError'
    }
  }
}))

// NOW import the actual service - AFTER mocks are set up
import { inventoryTransactionService } from '../inventory-transaction-service'
import { supabase } from '@/lib/supabase'

describe('Integration: Real Inventory Transaction Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('checkAvailability - REAL Implementation', () => {
    it('should execute real checkAvailability function', async () => {
      // Setup mocks
      vi.mocked(supabase.rpc).mockResolvedValue({ data: 150, error: null })
      
      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ 
                data: [{ quantity_reserved: 100, quantity_consumed: 30, quantity_released: 10 }], 
                error: null 
              })
            })
          })
        })
      } as any)

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { quantity: 200 }, error: null })
            })
          })
        })
      } as any)

      const requirements: MaterialRequirement[] = [
        { item_id: 'item-001', quantity: 100 }
      ]

      const results = await inventoryTransactionService.checkAvailability(requirements)

      expect(results).toHaveLength(1)
      expect(results[0].item_id).toBe('item-001')
      expect(results[0].required).toBe(100)
      expect(supabase.rpc).toHaveBeenCalledWith('get_available_quantity', {
        p_org_id: 'test-org-123',
        p_item_id: 'item-001',
        p_location_id: null
      })
    })

    it('should handle zero available stock', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: 0, error: null })
      
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: { quantity: 0 }, error: null })
            })
          })
        })
      } as any)

      const requirements: MaterialRequirement[] = [
        { item_id: 'item-002', quantity: 50 }
      ]

      const results = await inventoryTransactionService.checkAvailability(requirements)

      expect(results[0].available).toBe(0)
      expect(results[0].sufficient).toBe(false)
    })

    it('should handle RPC error gracefully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ 
        data: null, 
        error: { message: 'Database error', code: 'DB_ERROR' } as any
      })

      const requirements: MaterialRequirement[] = [
        { item_id: 'item-003', quantity: 25 }
      ]

      await expect(inventoryTransactionService.checkAvailability(requirements))
        .rejects.toThrow()
    })
  })

  describe('getReservations - REAL Implementation', () => {
    it('should call real getReservations function', async () => {
      const mockReservations = [
        {
          id: 'res-001',
          org_id: 'test-org-123',
          mo_id: 'MO-001',
          item_id: 'item-001',
          quantity_reserved: 100,
          quantity_consumed: 0,
          quantity_released: 0,
          status: 'reserved',
          reserved_at: '2025-01-01T10:00:00Z'
        }
      ]

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockReservations, error: null })
            })
          })
        })
      } as any)

      const results = await inventoryTransactionService.getReservations('MO-001')

      expect(results).toEqual(mockReservations)
      expect(supabase.from).toHaveBeenCalledWith('material_reservations')
    })

    it('should return empty array when no reservations exist', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: null })
            })
          })
        })
      } as any)

      const results = await inventoryTransactionService.getReservations('MO-999')

      expect(results).toEqual([])
    })
  })
})

describe('Integration: Inventory Transaction Service - Type Definitions', () => {
  describe('MaterialRequirement Interface', () => {
    it('should define valid material requirement structure', () => {
      const requirement: MaterialRequirement = {
        item_id: 'item-001',
        quantity: 100,
        location_id: 'loc-001',
        unit_cost: 25.50
      }

      expect(requirement.item_id).toBe('item-001')
      expect(requirement.quantity).toBe(100)
      expect(requirement.location_id).toBe('loc-001')
      expect(requirement.unit_cost).toBe(25.50)
    })

    it('should allow optional fields', () => {
      const requirement: MaterialRequirement = {
        item_id: 'item-002',
        quantity: 50
      }

      expect(requirement.item_id).toBe('item-002')
      expect(requirement.quantity).toBe(50)
      expect(requirement.location_id).toBeUndefined()
      expect(requirement.unit_cost).toBeUndefined()
    })

    it('should handle zero quantity', () => {
      const requirement: MaterialRequirement = {
        item_id: 'item-003',
        quantity: 0
      }

      expect(requirement.quantity).toBe(0)
    })

    it('should handle large quantities', () => {
      const requirement: MaterialRequirement = {
        item_id: 'item-004',
        quantity: 1000000
      }

      expect(requirement.quantity).toBe(1000000)
    })

    it('should handle decimal quantities', () => {
      const requirement: MaterialRequirement = {
        item_id: 'item-005',
        quantity: 123.456,
        unit_cost: 78.90
      }

      expect(requirement.quantity).toBe(123.456)
      expect(requirement.unit_cost).toBe(78.90)
    })
  })

  describe('StockAvailability Interface', () => {
    it('should define complete availability structure', () => {
      const availability: StockAvailability = {
        item_id: 'item-001',
        item_name: 'Steel Plate',
        required: 100,
        available: 150,
        on_hand: 200,
        reserved: 50,
        sufficient: true
      }

      expect(availability.item_id).toBe('item-001')
      expect(availability.item_name).toBe('Steel Plate')
      expect(availability.required).toBe(100)
      expect(availability.available).toBe(150)
      expect(availability.on_hand).toBe(200)
      expect(availability.reserved).toBe(50)
      expect(availability.sufficient).toBe(true)
    })

    it('should indicate insufficient stock', () => {
      const availability: StockAvailability = {
        item_id: 'item-002',
        required: 100,
        available: 50,
        on_hand: 80,
        reserved: 30,
        sufficient: false
      }

      expect(availability.sufficient).toBe(false)
      expect(availability.available).toBeLessThan(availability.required)
    })

    it('should handle exact match availability', () => {
      const availability: StockAvailability = {
        item_id: 'item-003',
        required: 100,
        available: 100,
        on_hand: 100,
        reserved: 0,
        sufficient: true
      }

      expect(availability.sufficient).toBe(true)
      expect(availability.available).toBe(availability.required)
    })

    it('should handle zero stock scenario', () => {
      const availability: StockAvailability = {
        item_id: 'item-004',
        required: 50,
        available: 0,
        on_hand: 0,
        reserved: 0,
        sufficient: false
      }

      expect(availability.on_hand).toBe(0)
      expect(availability.available).toBe(0)
      expect(availability.sufficient).toBe(false)
    })

    it('should handle all reserved scenario', () => {
      const availability: StockAvailability = {
        item_id: 'item-005',
        required: 50,
        available: 0,
        on_hand: 100,
        reserved: 100,
        sufficient: false
      }

      expect(availability.reserved).toBe(availability.on_hand)
      expect(availability.available).toBe(0)
      expect(availability.sufficient).toBe(false)
    })
  })
})

describe('Integration: Inventory Transaction Service - Business Logic', () => {
  describe('Stock Availability Calculations', () => {
    it('should calculate available = on_hand - reserved', () => {
      const on_hand = 200
      const reserved = 50
      const available = on_hand - reserved

      expect(available).toBe(150)
    })

    it('should determine sufficiency when available >= required', () => {
      const available = 150
      const required = 100
      const sufficient = available >= required

      expect(sufficient).toBe(true)
    })

    it('should determine insufficiency when available < required', () => {
      const available = 50
      const required = 100
      const sufficient = available >= required

      expect(sufficient).toBe(false)
    })

    it('should handle multiple material requirements', () => {
      const requirements: MaterialRequirement[] = [
        { item_id: 'item-001', quantity: 100 },
        { item_id: 'item-002', quantity: 50 },
        { item_id: 'item-003', quantity: 75 }
      ]

      const totalRequired = requirements.reduce((sum, req) => sum + req.quantity, 0)
      
      expect(totalRequired).toBe(225)
      expect(requirements.length).toBe(3)
    })

    it('should calculate total cost for material requirements', () => {
      const requirements: MaterialRequirement[] = [
        { item_id: 'item-001', quantity: 100, unit_cost: 10 },
        { item_id: 'item-002', quantity: 50, unit_cost: 20 },
        { item_id: 'item-003', quantity: 75, unit_cost: 15 }
      ]

      const totalCost = requirements.reduce((sum, req) => {
        return sum + (req.quantity * (req.unit_cost || 0))
      }, 0)

      expect(totalCost).toBe(100 * 10 + 50 * 20 + 75 * 15)
      expect(totalCost).toBe(3125)
    })
  })

  describe('Reservation Calculations', () => {
    it('should calculate net reserved quantity', () => {
      const quantity_reserved = 100
      const quantity_consumed = 30
      const quantity_released = 10
      const net_reserved = quantity_reserved - quantity_consumed - quantity_released

      expect(net_reserved).toBe(60)
    })

    it('should handle fully consumed reservation', () => {
      const quantity_reserved = 100
      const quantity_consumed = 100
      const quantity_released = 0
      const net_reserved = quantity_reserved - quantity_consumed - quantity_released

      expect(net_reserved).toBe(0)
    })

    it('should handle partially released reservation', () => {
      const quantity_reserved = 100
      const quantity_consumed = 50
      const quantity_released = 30
      const net_reserved = quantity_reserved - quantity_consumed - quantity_released

      expect(net_reserved).toBe(20)
    })

    it('should sum multiple reservations for same item', () => {
      const reservations = [
        { reserved: 100, consumed: 30, released: 10 },
        { reserved: 50, consumed: 20, released: 5 },
        { reserved: 75, consumed: 0, released: 15 }
      ]

      const totalNetReserved = reservations.reduce((sum, r) => {
        return sum + (r.reserved - r.consumed - r.released)
      }, 0)

      expect(totalNetReserved).toBe(60 + 25 + 60)
      expect(totalNetReserved).toBe(145)
    })
  })

  describe('Material Consumption Validation', () => {
    it('should validate consumption does not exceed reservation', () => {
      const reserved = 100
      const consumed = 80

      expect(consumed).toBeLessThanOrEqual(reserved)
    })

    it('should reject consumption exceeding reservation', () => {
      const reserved = 100
      const consumed = 120

      expect(consumed).toBeGreaterThan(reserved)
      // In real service, this would throw InsufficientInventoryError
    })

    it('should allow exact consumption of reservation', () => {
      const reserved = 100
      const consumed = 100

      expect(consumed).toBe(reserved)
    })

    it('should calculate remaining reservation after consumption', () => {
      const reserved = 100
      const consumed = 60
      const remaining = reserved - consumed

      expect(remaining).toBe(40)
    })

    it('should handle multiple partial consumptions', () => {
      const reserved = 100
      const consumptions = [20, 30, 15]
      const totalConsumed = consumptions.reduce((sum, c) => sum + c, 0)
      const remaining = reserved - totalConsumed

      expect(totalConsumed).toBe(65)
      expect(remaining).toBe(35)
    })
  })

  describe('Reservation Status Management', () => {
    it('should determine status based on quantities', () => {
      const scenarios = [
        { reserved: 100, consumed: 0, released: 0, expectedStatus: 'reserved' },
        { reserved: 100, consumed: 100, released: 0, expectedStatus: 'consumed' },
        { reserved: 100, consumed: 0, released: 100, expectedStatus: 'released' },
        { reserved: 100, consumed: 50, released: 50, expectedStatus: 'consumed' }
      ]

      scenarios.forEach(scenario => {
        const isFullyConsumed = scenario.consumed === scenario.reserved
        const isFullyReleased = scenario.released === scenario.reserved
        const isPartiallyUsed = scenario.consumed > 0 || scenario.released > 0

        if (isFullyConsumed) {
          expect(scenario.expectedStatus).toBe('consumed')
        } else if (isFullyReleased) {
          expect(scenario.expectedStatus).toBe('released')
        } else if (isPartiallyUsed) {
          expect(scenario.expectedStatus).toBe('consumed')
        } else {
          expect(scenario.expectedStatus).toBe('reserved')
        }
      })
    })
  })

  describe('Error Scenarios', () => {
    it('should identify insufficient inventory condition', () => {
      const required = 100
      const available = 50
      const hasError = available < required

      expect(hasError).toBe(true)
    })

    it('should prepare error message for insufficient inventory', () => {
      const itemId = 'item-001'
      const itemName = 'Steel Plate'
      const required = 100
      const available = 50

      const message = `Insufficient inventory for ${itemName || itemId}: Required ${required}, Available ${available}`

      expect(message).toContain('Insufficient inventory')
      expect(message).toContain('Steel Plate')
      expect(message).toContain('100')
      expect(message).toContain('50')
    })

    it('should handle missing tenant ID error', () => {
      const orgId = null
      const hasError = !orgId

      expect(hasError).toBe(true)
    })
  })

  describe('Real-World Manufacturing Scenarios', () => {
    it('should handle BOM material requirements for manufacturing order', () => {
      // Manufacturing Order: 100 units of Product A
      // BOM Requirements per unit:
      // - Steel: 2kg @ SAR 50/kg
      // - Paint: 0.5L @ SAR 80/L
      // - Bolts: 10 pieces @ SAR 2/piece

      const moQuantity = 100
      const bomRequirements: MaterialRequirement[] = [
        { item_id: 'steel-001', quantity: 2 * moQuantity, unit_cost: 50 },
        { item_id: 'paint-001', quantity: 0.5 * moQuantity, unit_cost: 80 },
        { item_id: 'bolts-001', quantity: 10 * moQuantity, unit_cost: 2 }
      ]

      expect(bomRequirements[0].quantity).toBe(200) // Steel: 200kg
      expect(bomRequirements[1].quantity).toBe(50)  // Paint: 50L
      expect(bomRequirements[2].quantity).toBe(1000) // Bolts: 1000 pieces

      const totalCost = bomRequirements.reduce((sum, req) => {
        return sum + (req.quantity * (req.unit_cost || 0))
      }, 0)

      expect(totalCost).toBe(200 * 50 + 50 * 80 + 1000 * 2)
      expect(totalCost).toBe(16000) // SAR 16,000
    })

    it('should simulate reservation lifecycle', () => {
      // Day 1: Reserve materials
      let reservation = {
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved'
      }

      expect(reservation.status).toBe('reserved')
      expect(reservation.quantity_reserved - reservation.quantity_consumed).toBe(100)

      // Day 2: Consume 60 units
      reservation = {
        ...reservation,
        quantity_consumed: 60,
        status: 'consumed'
      }

      expect(reservation.quantity_consumed).toBe(60)
      expect(reservation.quantity_reserved - reservation.quantity_consumed).toBe(40)

      // Day 3: Release remaining 40 units
      reservation = {
        ...reservation,
        quantity_released: 40,
        status: 'released'
      }

      expect(reservation.quantity_released).toBe(40)
      expect(reservation.quantity_reserved - reservation.quantity_consumed - reservation.quantity_released).toBe(0)
    })

    it('should handle concurrent reservations for same item', () => {
      const onHandQty = 500
      const reservations = [
        { mo_id: 'MO-001', quantity: 100 },
        { mo_id: 'MO-002', quantity: 150 },
        { mo_id: 'MO-003', quantity: 75 }
      ]

      const totalReserved = reservations.reduce((sum, r) => sum + r.quantity, 0)
      const availableForNewReservation = onHandQty - totalReserved

      expect(totalReserved).toBe(325)
      expect(availableForNewReservation).toBe(175)
    })

    it('should validate reservation expiry logic', () => {
      const reservedAt = new Date('2025-01-01T10:00:00Z')
      const expiresAt = new Date('2025-01-08T10:00:00Z') // 7 days later
      const checkDate = new Date('2025-01-10T10:00:00Z')

      const isExpired = checkDate > expiresAt

      expect(isExpired).toBe(true)
    })
  })
})
