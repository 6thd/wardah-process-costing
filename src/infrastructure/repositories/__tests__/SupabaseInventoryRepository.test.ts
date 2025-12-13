/**
 * Integration Tests for SupabaseInventoryRepository
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}))

import { SupabaseInventoryRepository } from '../SupabaseInventoryRepository'
import { supabase } from '@/lib/supabase'

describe('SupabaseInventoryRepository', () => {
  let repository: SupabaseInventoryRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repository = new SupabaseInventoryRepository()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===== Product Operations =====
  describe('getProduct', () => {
    it('should fetch product by ID', async () => {
      const mockProduct = {
        id: 'prod-001',
        code: 'PROD001',
        name: 'Test Product',
        name_ar: 'منتج تجريبي',
        valuation_method: 'AVCO',
        stock_quantity: 100,
        cost_price: 50,
        stock_value: 5000,
      }

      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: mockProduct, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getProduct('prod-001')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('prod-001')
      expect(result?.code).toBe('PROD001')
      expect(result?.valuationMethod).toBe('AVCO')
    })

    it('should return null for non-existent product', async () => {
      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ 
        data: null, 
        error: { code: 'PGRST116', message: 'Not found' } 
      })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getProduct('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getProducts', () => {
    it('should fetch all products', async () => {
      const mockProducts = [
        { id: '1', code: 'P1', name: 'Product 1', stock_quantity: 100 },
        { id: '2', code: 'P2', name: 'Product 2', stock_quantity: 200 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockProducts, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getProducts()

      expect(result).toHaveLength(2)
      expect(result[0].code).toBe('P1')
    })

    it('should filter by category', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await repository.getProducts({ category: 'Electronics' })

      expect(chainable.eq).toHaveBeenCalledWith('category', 'Electronics')
    })
  })

  describe('updateProductStock', () => {
    it('should update product stock', async () => {
      const chainable: any = {}
      chainable.update = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockResolvedValue({ error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await repository.updateProductStock('prod-001', 150, 55, 8250)

      expect(supabase.from).toHaveBeenCalledWith('products')
      expect(chainable.update).toHaveBeenCalled()
    })

    it('should throw error on failure', async () => {
      const chainable: any = {}
      chainable.update = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockResolvedValue({ error: { message: 'Update failed' } })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await expect(repository.updateProductStock('prod-001', 150, 55, 8250))
        .rejects.toThrow('فشل في تحديث مخزون المنتج')
    })
  })

  // ===== Bin Operations =====
  describe('getBin', () => {
    it('should fetch bin by product and warehouse', async () => {
      const mockBin = {
        id: 'bin-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        actual_qty: 100,
        reserved_qty: 10,
        available_qty: 90,
        stock_value: 5000,
        avg_rate: 50,
      }

      const chainable: any = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: mockBin, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getBin('prod-001', 'wh-001')

      expect(result).not.toBeNull()
      expect(result?.actualQty).toBe(100)
      expect(result?.availableQty).toBe(90)
    })
  })

  describe('createBin', () => {
    it('should create new bin', async () => {
      const newBin = {
        productId: 'prod-001',
        warehouseId: 'wh-001',
        actualQty: 100,
        reservedQty: 0,
        availableQty: 100,
        stockValue: 5000,
        avgRate: 50,
      }

      const mockResult = {
        id: 'bin-new',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        actual_qty: 100,
        reserved_qty: 0,
        available_qty: 100,
        stock_value: 5000,
        avg_rate: 50,
      }

      const chainable: any = {}
      chainable.insert = vi.fn().mockReturnValue(chainable)
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: mockResult, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.createBin(newBin)

      expect(result.id).toBe('bin-new')
      expect(result.actualQty).toBe(100)
    })
  })

  // ===== Stock Movements =====
  describe('recordStockMovement', () => {
    it('should record stock movement', async () => {
      const movement = {
        productId: 'prod-001',
        warehouseId: 'wh-001',
        moveType: 'IN' as const,
        quantity: 50,
        rate: 55,
        totalValue: 2750,
        referenceType: 'PO',
        referenceId: 'PO-001',
      }

      const mockResult = {
        id: 'mov-001',
        product_id: 'prod-001',
        warehouse_id: 'wh-001',
        move_type: 'IN',
        quantity: 50,
        rate: 55,
        total_value: 2750,
        reference_type: 'PO',
        reference_id: 'PO-001',
      }

      const chainable: any = {}
      chainable.insert = vi.fn().mockReturnValue(chainable)
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: mockResult, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.recordStockMovement(movement)

      expect(result.id).toBe('mov-001')
      expect(result.quantity).toBe(50)
      expect(result.moveType).toBe('IN')
    })
  })

  describe('getStockMovements', () => {
    it('should fetch stock movements with filters', async () => {
      const mockMovements = [
        { id: '1', product_id: 'p1', move_type: 'IN', quantity: 100, rate: 50, total_value: 5000 },
        { id: '2', product_id: 'p1', move_type: 'OUT', quantity: 30, rate: 50, total_value: 1500 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockMovements, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.lte = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getStockMovements('p1', {
        fromDate: '2025-01-01',
        toDate: '2025-12-31',
        moveType: 'IN',
      })

      expect(result).toHaveLength(2)
      expect(chainable.gte).toHaveBeenCalledWith('created_at', '2025-01-01')
    })
  })

  // ===== Stock Queries =====
  describe('getTotalStockValue', () => {
    it('should calculate total stock value', async () => {
      const mockBins = [
        { stock_value: 5000 },
        { stock_value: 3000 },
        { stock_value: 2000 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockBins, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getTotalStockValue()

      expect(result).toBe(10000)
    })

    it('should filter by warehouse', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: [{ stock_value: 5000 }], error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getTotalStockValue('wh-001')

      expect(result).toBe(5000)
      expect(chainable.eq).toHaveBeenCalledWith('warehouse_id', 'wh-001')
    })
  })

  describe('getLowStockItems', () => {
    it('should fetch low stock items', async () => {
      const mockProducts = [
        { id: '1', code: 'P1', name: 'Low Stock 1', stock_quantity: 5 },
        { id: '2', code: 'P2', name: 'Low Stock 2', stock_quantity: 3 },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockProducts, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.lt = vi.fn().mockReturnValue(chainable)
      chainable.gt = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getLowStockItems(10)

      expect(result).toHaveLength(2)
      expect(chainable.lt).toHaveBeenCalledWith('stock_quantity', 10)
    })
  })

  // ===== Availability =====
  describe('checkAvailability', () => {
    it('should check availability for multiple products', async () => {
      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ 
          data: [{ available_qty: 100 }], 
          error: null 
        }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.checkAvailability([
        { productId: 'p1', quantity: 50 },
        { productId: 'p2', quantity: 150 },
      ])

      expect(result).toHaveLength(2)
      expect(result[0].isAvailable).toBe(true)
      expect(result[0].shortfall).toBe(0)
    })
  })

  // ===== Reservations =====
  describe('createReservation', () => {
    it('should create reservation', async () => {
      const chainable: any = {}
      chainable.insert = vi.fn().mockReturnValue(chainable)
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.single = vi.fn().mockResolvedValue({ data: { id: 'res-001' }, error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.createReservation('p1', 50, 'SO', 'SO-001')

      expect(result).toBe('res-001')
    })
  })

  describe('releaseReservation', () => {
    it('should release reservation', async () => {
      const chainable: any = {}
      chainable.update = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockResolvedValue({ error: null })

      vi.mocked(supabase.from).mockReturnValue(chainable)

      await repository.releaseReservation('res-001')

      expect(chainable.update).toHaveBeenCalled()
    })
  })

  describe('getReservations', () => {
    it('should fetch active reservations', async () => {
      const mockReservations = [
        { id: 'r1', quantity: 50, reference_type: 'SO', reference_id: 'SO-001' },
      ]

      const chainable: any = {
        then: (resolve: any) => Promise.resolve({ data: mockReservations, error: null }).then(resolve)
      }
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)

      vi.mocked(supabase.from).mockReturnValue(chainable)

      const result = await repository.getReservations('p1')

      expect(result).toHaveLength(1)
      expect(result[0].quantity).toBe(50)
    })
  })
})
