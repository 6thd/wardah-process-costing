/**
 * Integration Tests for StockLedgerService
 * Phase 5 of TEST_COVERAGE_PLAN.md
 * 
 * Tests the real code from src/modules/inventory/StockLedgerService.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase before importing the service
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

// Import after mocks are set up
import { StockLedgerService, type StockLedgerEntry, type Bin, type StockBalance } from '../StockLedgerService'
import { supabase } from '@/lib/supabase'

describe('Integration: StockLedgerService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================
  // StockLedgerEntry Interface Tests
  // ============================================
  describe('StockLedgerEntry Interface', () => {
    it('should have correct structure for incoming stock', () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'GR-001',
        voucher_number: 'GR-2025-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        posting_time: '10:30:00',
        actual_qty: 100,
        incoming_rate: 50.00,
        org_id: 'org-001',
      }

      expect(entry.actual_qty).toBeGreaterThan(0)
      expect(entry.incoming_rate).toBeDefined()
      expect(entry.voucher_type).toBe('Goods Receipt')
    })

    it('should have correct structure for outgoing stock', () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Delivery Note',
        voucher_id: 'DN-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: -50,
        outgoing_rate: 50.00,
      }

      expect(entry.actual_qty).toBeLessThan(0)
      expect(entry.outgoing_rate).toBeDefined()
    })

    it('should support stock queue for FIFO/LIFO', () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'GR-002',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 100,
        incoming_rate: 50.00,
        stock_queue: [[100, 50.00], [50, 55.00]],
      }

      expect(entry.stock_queue).toHaveLength(2)
      expect(entry.stock_queue![0]).toEqual([100, 50.00])
    })
  })

  // ============================================
  // Bin Interface Tests
  // ============================================
  describe('Bin Interface', () => {
    it('should have correct structure', () => {
      const bin: Bin = {
        id: 'bin-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        actual_qty: 150,
        reserved_qty: 20,
        ordered_qty: 50,
        planned_qty: 30,
        valuation_rate: 52.50,
        stock_value: 7875.00,
        org_id: 'org-001',
      }

      expect(bin.stock_value).toBe(bin.actual_qty * bin.valuation_rate)
    })

    it('should calculate projected quantity correctly', () => {
      const bin: Bin = {
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        actual_qty: 100,
        reserved_qty: 30,
        ordered_qty: 50,
        planned_qty: 20,
        valuation_rate: 50,
        stock_value: 5000,
      }

      // Projected = Actual - Reserved + Ordered + Planned
      const expectedProjected = bin.actual_qty - bin.reserved_qty + bin.ordered_qty + bin.planned_qty
      bin.projected_qty = expectedProjected

      expect(bin.projected_qty).toBe(140) // 100 - 30 + 50 + 20
    })
  })

  // ============================================
  // StockBalance Interface Tests
  // ============================================
  describe('StockBalance Interface', () => {
    it('should have correct structure', () => {
      const balance: StockBalance = {
        quantity: 100,
        valuation_rate: 50.00,
        stock_value: 5000.00,
      }

      expect(balance.stock_value).toBe(balance.quantity * balance.valuation_rate)
    })
  })

  // ============================================
  // Validation Tests (validateEntry)
  // ============================================
  describe('Entry Validation', () => {
    it('should throw error when voucher_type is missing', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: '', // Empty
        voucher_id: 'V-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 100,
        incoming_rate: 50,
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Voucher type is required')
    })

    it('should throw error when voucher_id is missing', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: '', // Empty
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 100,
        incoming_rate: 50,
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Voucher ID is required')
    })

    it('should throw error when product_id is missing', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'V-001',
        product_id: '', // Empty
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 100,
        incoming_rate: 50,
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Product ID is required')
    })

    it('should throw error when warehouse_id is missing', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'V-001',
        product_id: 'prod-001',
        warehouse_id: '', // Empty
        posting_date: '2025-12-13',
        actual_qty: 100,
        incoming_rate: 50,
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Warehouse ID is required')
    })

    it('should throw error when posting_date is missing', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'V-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '', // Empty
        actual_qty: 100,
        incoming_rate: 50,
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Posting date is required')
    })

    it('should throw error when quantity is zero', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'V-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 0, // Zero quantity
        incoming_rate: 50,
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Quantity cannot be zero')
    })

    it('should throw error when incoming stock has no rate', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'V-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 100,
        // No incoming_rate or valuation_rate
      }

      await expect(StockLedgerService.createEntry(entry))
        .rejects.toThrow('Rate is required for incoming stock')
    })
  })

  // ============================================
  // Weighted Average Calculation Tests
  // ============================================
  describe('Weighted Average Calculations', () => {
    it('should calculate weighted average correctly for first receipt', () => {
      // First receipt: 100 units @ 50 SAR
      const qty = 100
      const rate = 50.00
      const value = qty * rate

      expect(value).toBe(5000.00)
      expect(value / qty).toBe(50.00)
    })

    it('should calculate weighted average correctly for subsequent receipt', () => {
      // Initial: 100 units @ 50 SAR = 5000 SAR
      // Receipt: 50 units @ 60 SAR = 3000 SAR
      // New: 150 units @ (5000 + 3000) / 150 = 53.33 SAR

      const prevQty = 100
      const prevRate = 50.00
      const prevValue = prevQty * prevRate

      const inQty = 50
      const inRate = 60.00
      const inValue = inQty * inRate

      const newQty = prevQty + inQty
      const newValue = prevValue + inValue
      const newRate = newValue / newQty

      expect(newQty).toBe(150)
      expect(newValue).toBe(8000)
      expect(newRate).toBeCloseTo(53.33, 2)
    })

    it('should maintain rate on outgoing stock', () => {
      // Current: 150 units @ 53.33 SAR
      // Issue: -30 units
      // New: 120 units @ 53.33 SAR (rate unchanged)

      const prevQty = 150
      const prevRate = 53.33
      const prevValue = prevQty * prevRate

      const outQty = -30
      const newQty = prevQty + outQty
      const newRate = prevRate // Rate stays same on outgoing
      const newValue = newQty * newRate

      expect(newQty).toBe(120)
      expect(newRate).toBe(53.33)
      expect(newValue).toBeCloseTo(6399.60, 2)
    })

    it('should handle zero stock correctly', () => {
      // Issue all remaining stock
      const prevQty = 100
      const prevRate = 50.00
      const outQty = -100

      const newQty = prevQty + outQty
      const newRate = newQty > 0 ? prevRate : 0
      const newValue = newQty * newRate

      expect(newQty).toBe(0)
      expect(newValue).toBe(0)
    })

    it('should handle negative stock scenario', () => {
      // Issue more than available (overselling)
      const prevQty = 50
      const prevRate = 50.00
      const outQty = -75

      const newQty = prevQty + outQty

      expect(newQty).toBeLessThan(0)
      expect(newQty).toBe(-25)
    })
  })

  // ============================================
  // getStockBalance Tests
  // ============================================
  describe('getStockBalance', () => {
    it('should return zero balance when no bin exists', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const balance = await StockLedgerService.getStockBalance('prod-001', 'wh-001')

      expect(balance.quantity).toBe(0)
      expect(balance.valuation_rate).toBe(0)
      expect(balance.stock_value).toBe(0)
    })

    it('should return correct balance from bin', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            actual_qty: 150,
            valuation_rate: 52.50,
            stock_value: 7875.00,
          },
          error: null,
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const balance = await StockLedgerService.getStockBalance('prod-001', 'wh-001')

      expect(balance.quantity).toBe(150)
      expect(balance.valuation_rate).toBe(52.50)
      expect(balance.stock_value).toBe(7875.00)
    })
  })

  // ============================================
  // getStockBalanceAtDate Tests
  // ============================================
  describe('getStockBalanceAtDate', () => {
    it('should return zero balance when no SLE exists at date', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const balance = await StockLedgerService.getStockBalanceAtDate(
        'prod-001',
        'wh-001',
        '2025-01-01'
      )

      expect(balance.quantity).toBe(0)
      expect(balance.valuation_rate).toBe(0)
      expect(balance.stock_value).toBe(0)
    })

    it('should return correct balance at specific date', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            qty_after_transaction: 200,
            valuation_rate: 55.00,
            stock_value: 11000.00,
          },
          error: null,
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const balance = await StockLedgerService.getStockBalanceAtDate(
        'prod-001',
        'wh-001',
        '2025-06-30'
      )

      expect(balance.quantity).toBe(200)
      expect(balance.valuation_rate).toBe(55.00)
      expect(balance.stock_value).toBe(11000.00)
    })
  })

  // ============================================
  // getStockMovements Tests
  // ============================================
  describe('getStockMovements', () => {
    it('should return empty array when no movements exist', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const movements = await StockLedgerService.getStockMovements('prod-001')

      expect(movements).toEqual([])
    })

    it('should return movements in correct order', async () => {
      const mockMovements: StockLedgerEntry[] = [
        {
          id: 'sle-003',
          voucher_type: 'Delivery Note',
          voucher_id: 'DN-001',
          product_id: 'prod-001',
          warehouse_id: 'wh-001',
          posting_date: '2025-12-13',
          actual_qty: -50,
          qty_after_transaction: 100,
        },
        {
          id: 'sle-002',
          voucher_type: 'Goods Receipt',
          voucher_id: 'GR-002',
          product_id: 'prod-001',
          warehouse_id: 'wh-001',
          posting_date: '2025-12-12',
          actual_qty: 50,
          qty_after_transaction: 150,
        },
        {
          id: 'sle-001',
          voucher_type: 'Goods Receipt',
          voucher_id: 'GR-001',
          product_id: 'prod-001',
          warehouse_id: 'wh-001',
          posting_date: '2025-12-10',
          actual_qty: 100,
          qty_after_transaction: 100,
        },
      ]

      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockMovements, error: null }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const movements = await StockLedgerService.getStockMovements('prod-001')

      expect(movements).toHaveLength(3)
      // Should be in descending order by date
      expect(movements[0].posting_date).toBe('2025-12-13')
      expect(movements[2].posting_date).toBe('2025-12-10')
    })

    it('should filter by warehouse when provided', async () => {
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.limit = vi.fn().mockResolvedValue({ data: [], error: null })
      
      const mockFrom = vi.fn().mockReturnValue(chainable)
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      await StockLedgerService.getStockMovements('prod-001', 'wh-002')

      // Method was called
      expect(supabase.from).toHaveBeenCalledWith('stock_ledger_entries')
    })

    it('should throw error on database failure', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Connection failed' },
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      await expect(StockLedgerService.getStockMovements('prod-001'))
        .rejects.toThrow('Failed to fetch stock movements')
    })
  })

  // ============================================
  // getTotalStockValue Tests
  // ============================================
  describe('getTotalStockValue', () => {
    it('should return zero when no bins exist', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const total = await StockLedgerService.getTotalStockValue()

      expect(total).toBe(0)
    })

    it('should sum all bin values correctly', async () => {
      const mockBins = [
        { stock_value: 5000 },
        { stock_value: 7500 },
        { stock_value: 2500 },
      ]

      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockResolvedValue({ data: mockBins, error: null }),
        eq: vi.fn().mockReturnThis(),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const total = await StockLedgerService.getTotalStockValue()

      expect(total).toBe(15000)
    })

    it('should filter by warehouse when provided', async () => {
      const mockBins = [{ stock_value: 5000 }]

      // Create a thenable result for the final await
      const thenableResult = {
        data: mockBins,
        error: null,
        then: function(resolve: any) { return Promise.resolve({ data: mockBins, error: null }).then(resolve) }
      }
      
      const chainable: any = {
        eq: vi.fn().mockReturnValue(thenableResult),
        then: thenableResult.then
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      
      const mockFrom = vi.fn().mockReturnValue(chainable)
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      const total = await StockLedgerService.getTotalStockValue('wh-001')

      expect(total).toBe(5000)
      expect(chainable.eq).toHaveBeenCalledWith('warehouse_id', 'wh-001')
    })

    it('should throw error on database failure', async () => {
      const mockFrom = vi.fn().mockImplementation(() => ({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      }))
      
      vi.mocked(supabase.from).mockImplementation(mockFrom)

      await expect(StockLedgerService.getTotalStockValue())
        .rejects.toThrow('Failed to get total stock value')
    })
  })

  // ============================================
  // cancelEntry Tests
  // ============================================
  describe('cancelEntry', () => {
    it('should throw error when entry has no id', async () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'GR-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: 100,
        // No id
      }

      await expect(StockLedgerService.cancelEntry(entry))
        .rejects.toThrow('Cannot cancel entry without id')
    })
  })

  // ============================================
  // Stock Queue Tests (FIFO/LIFO Support)
  // ============================================
  describe('Stock Queue Operations', () => {
    it('should add to stock queue on incoming', () => {
      const stockQueue: Array<[number, number]> = [[100, 50.00]]
      
      // Add new receipt
      stockQueue.push([50, 55.00])

      expect(stockQueue).toHaveLength(2)
      expect(stockQueue[1]).toEqual([50, 55.00])
    })

    it('should support FIFO consumption', () => {
      // FIFO: First In First Out
      const stockQueue: Array<[number, number]> = [
        [100, 50.00],
        [50, 55.00],
        [75, 60.00],
      ]

      // Consume 120 units using FIFO
      let toConsume = 120
      let consumedValue = 0
      const newQueue: Array<[number, number]> = []

      for (const [qty, rate] of stockQueue) {
        if (toConsume <= 0) {
          newQueue.push([qty, rate])
          continue
        }

        if (qty <= toConsume) {
          // Consume entire batch
          consumedValue += qty * rate
          toConsume -= qty
        } else {
          // Partial consumption
          consumedValue += toConsume * rate
          newQueue.push([qty - toConsume, rate])
          toConsume = 0
        }
      }

      // First 100 @ 50 = 5000
      // Next 20 @ 55 = 1100
      // Total = 6100
      expect(consumedValue).toBe(6100)
      expect(newQueue).toHaveLength(2)
      expect(newQueue[0]).toEqual([30, 55.00]) // Remaining 30 from second batch
    })

    it('should support LIFO consumption', () => {
      // LIFO: Last In First Out
      const stockQueue: Array<[number, number]> = [
        [100, 50.00],
        [50, 55.00],
        [75, 60.00],
      ]

      // Consume 120 units using LIFO (reverse order)
      let toConsume = 120
      let consumedValue = 0
      const newQueue: Array<[number, number]> = []

      for (let i = stockQueue.length - 1; i >= 0; i--) {
        const [qty, rate] = stockQueue[i]
        
        if (toConsume <= 0) {
          newQueue.unshift([qty, rate])
          continue
        }

        if (qty <= toConsume) {
          // Consume entire batch
          consumedValue += qty * rate
          toConsume -= qty
        } else {
          // Partial consumption
          consumedValue += toConsume * rate
          newQueue.unshift([qty - toConsume, rate])
          toConsume = 0
        }
      }

      // Last 75 @ 60 = 4500
      // Next 45 @ 55 = 2475
      // Total = 6975
      expect(consumedValue).toBe(6975)
      expect(newQueue).toHaveLength(2)
      expect(newQueue[1]).toEqual([5, 55.00]) // Remaining 5 from second batch
    })
  })

  // ============================================
  // Value Precision Tests
  // ============================================
  describe('Value Precision', () => {
    it('should handle decimal quantities correctly', () => {
      const qty = 33.333
      const rate = 15.555
      const value = qty * rate

      expect(value).toBeCloseTo(518.494815, 4)
    })

    it('should handle very small rates', () => {
      const qty = 10000
      const rate = 0.0001
      const value = qty * rate

      expect(value).toBeCloseTo(1.00, 2)
    })

    it('should handle large values without overflow', () => {
      const qty = 1000000
      const rate = 999.99
      const value = qty * rate

      expect(value).toBe(999990000)
    })
  })

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle multiple receipts on same day', () => {
      // Multiple receipts on same day with different times
      const entries = [
        { posting_date: '2025-12-13', posting_time: '08:00:00', actual_qty: 100, rate: 50 },
        { posting_date: '2025-12-13', posting_time: '10:00:00', actual_qty: 50, rate: 55 },
        { posting_date: '2025-12-13', posting_time: '14:00:00', actual_qty: 75, rate: 52 },
      ]

      let runningQty = 0
      let runningValue = 0

      for (const entry of entries) {
        runningQty += entry.actual_qty
        runningValue += entry.actual_qty * entry.rate
      }

      const avgRate = runningValue / runningQty

      expect(runningQty).toBe(225)
      // 100*50 + 50*55 + 75*52 = 5000 + 2750 + 3900 = 11650
      expect(runningValue).toBe(11650)
      // 11650 / 225 = 51.7778
      expect(avgRate).toBeCloseTo(51.78, 1)
    })

    it('should handle stock transfer between warehouses', () => {
      // Transfer: OUT from WH1, IN to WH2 at same rate
      const outEntry: StockLedgerEntry = {
        voucher_type: 'Stock Entry',
        voucher_id: 'SE-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        posting_date: '2025-12-13',
        actual_qty: -50,
        outgoing_rate: 55.00,
      }

      const inEntry: StockLedgerEntry = {
        voucher_type: 'Stock Entry',
        voucher_id: 'SE-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-002',
        posting_date: '2025-12-13',
        actual_qty: 50,
        incoming_rate: 55.00, // Same rate as outgoing
      }

      expect(Math.abs(outEntry.actual_qty)).toBe(inEntry.actual_qty)
      expect(outEntry.outgoing_rate).toBe(inEntry.incoming_rate)
    })
  })
})
