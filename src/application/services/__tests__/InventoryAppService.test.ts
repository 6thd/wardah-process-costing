/**
 * @fileoverview Inventory App Service Tests
 * @description اختبارات خدمة تطبيق المخزون
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InventoryAppService } from '../InventoryAppService'
import type { 
  IInventoryRepository, 
  ProductData, 
  StockMovementData,
  StockBalanceData,
  AvailabilityCheckResult 
} from '@/domain/interfaces'

// Mock products matching ProductData interface
const mockProducts: ProductData[] = [
  {
    id: 'prod-1',
    code: 'SKU-001',
    name: 'منتج 1',
    nameAr: 'منتج 1',
    valuationMethod: 'Weighted Average',
    stockQuantity: 50,
    costPrice: 10,
    stockValue: 500,
    minStockLevel: 10,
    maxStockLevel: 100,
    category: 'cat-1',
    unit: 'unit'
  },
  {
    id: 'prod-2',
    code: 'SKU-002',
    name: 'منتج 2',
    nameAr: 'منتج 2',
    valuationMethod: 'FIFO',
    stockQuantity: 100,
    costPrice: 20,
    stockValue: 2000,
    minStockLevel: 20,
    maxStockLevel: 200,
    category: 'cat-2',
    unit: 'unit'
  },
  {
    id: 'prod-3',
    code: 'SKU-003',
    name: 'منتج 3',
    nameAr: 'منتج 3',
    valuationMethod: 'Weighted Average',
    stockQuantity: 5, // low stock
    costPrice: 15,
    stockValue: 75,
    minStockLevel: 10,
    maxStockLevel: 50,
    category: 'cat-1',
    unit: 'unit'
  }
]

describe('InventoryAppService', () => {
  let service: InventoryAppService
  let mockRepository: IInventoryRepository

  beforeEach(() => {
    mockRepository = {
      getProduct: vi.fn(),
      getProducts: vi.fn().mockResolvedValue(mockProducts),
      getProductByCode: vi.fn(),
      updateProductStock: vi.fn().mockResolvedValue(undefined),
      recordStockMovement: vi.fn(),
      getStockMovements: vi.fn().mockResolvedValue([]),
      getStockBalance: vi.fn(),
      getTotalStockValue: vi.fn().mockResolvedValue(2575),
      checkAvailability: vi.fn(),
      getLowStockItems: vi.fn(),
      getBin: vi.fn(),
      getBinsByProduct: vi.fn().mockResolvedValue([]),
      getBinsByWarehouse: vi.fn().mockResolvedValue([]),
      updateBin: vi.fn().mockResolvedValue(undefined),
      createBin: vi.fn(),
      createReservation: vi.fn(),
      releaseReservation: vi.fn(),
      getReservations: vi.fn().mockResolvedValue([])
    }
    
    service = new InventoryAppService(mockRepository)
  })

  describe('getProducts', () => {
    it('should return paginated products', async () => {
      const result = await service.getProducts({ page: 1, pageSize: 10 })
      
      expect(result.products).toHaveLength(3)
      expect(result.total).toBe(3)
      expect(result.hasMore).toBe(false)
    })

    it('should filter by category', async () => {
      const result = await service.getProducts({ category: 'cat-1' })
      
      expect(mockRepository.getProducts).toHaveBeenCalledWith({ category: 'cat-1', active: undefined })
    })

    it('should filter by search', async () => {
      const result = await service.getProducts({ search: 'SKU-001' })
      
      expect(result.products).toHaveLength(1)
      expect(result.products[0].code).toBe('SKU-001')
    })

    it('should filter by low stock', async () => {
      const result = await service.getProducts({ lowStock: true })
      
      // Only prod-3 has stockQuantity (5) <= minStockLevel (10)
      expect(result.products).toHaveLength(1)
      expect(result.products[0].id).toBe('prod-3')
    })
  })

  describe('getProduct', () => {
    it('should return single product', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      
      const result = await service.getProduct('prod-1')
      
      expect(result).toEqual(mockProducts[0])
      expect(mockRepository.getProduct).toHaveBeenCalledWith('prod-1')
    })

    it('should return null for non-existent product', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(null)
      
      const result = await service.getProduct('non-existent')
      
      expect(result).toBeNull()
    })
  })

  describe('getLowStockProducts', () => {
    it('should return low stock items', async () => {
      vi.mocked(mockRepository.getLowStockItems).mockResolvedValue([mockProducts[2]])
      
      const result = await service.getLowStockProducts()
      
      expect(result).toHaveLength(1)
      expect(result[0].stockQuantity).toBeLessThanOrEqual(result[0].minStockLevel!)
    })
  })

  describe('updateProductStock', () => {
    beforeEach(() => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
    })

    it('should add stock', async () => {
      await service.updateProductStock('prod-1', 10, 10, 'add')
      
      // 50 + 10 = 60
      expect(mockRepository.updateProductStock).toHaveBeenCalledWith('prod-1', 60, 10, 600)
    })

    it('should subtract stock', async () => {
      await service.updateProductStock('prod-1', 10, 10, 'subtract')
      
      // 50 - 10 = 40
      expect(mockRepository.updateProductStock).toHaveBeenCalledWith('prod-1', 40, 10, 400)
    })

    it('should set stock', async () => {
      await service.updateProductStock('prod-1', 100, 10, 'set')
      
      expect(mockRepository.updateProductStock).toHaveBeenCalledWith('prod-1', 100, 10, 1000)
    })

    it('should throw error for negative stock', async () => {
      await expect(service.updateProductStock('prod-1', 100, 10, 'subtract'))
        .rejects.toThrow('لا يمكن أن يكون المخزون سالباً')
    })

    it('should throw error for non-existent product', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(null)
      
      await expect(service.updateProductStock('non-existent', 10, 10, 'add'))
        .rejects.toThrow('المنتج غير موجود')
    })
  })

  describe('recordStockMovement', () => {
    it('should record IN movement', async () => {
      const movement: Omit<StockMovementData, 'id' | 'createdAt'> = {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 10,
        moveType: 'IN',
        rate: 10,
        totalValue: 100,
        referenceType: 'receipt',
        referenceId: 'REC-001'
      }
      
      const expectedResult: StockMovementData = {
        id: 'mv-1',
        ...movement,
        createdAt: '2025-01-15'
      }
      
      vi.mocked(mockRepository.recordStockMovement).mockResolvedValue(expectedResult)
      
      const result = await service.recordStockMovement(movement)
      
      expect(result.id).toBe('mv-1')
      expect(mockRepository.recordStockMovement).toHaveBeenCalled()
    })

    it('should record OUT movement when stock is available', async () => {
      const movement: Omit<StockMovementData, 'id' | 'createdAt'> = {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 10,
        moveType: 'OUT',
        rate: 10,
        totalValue: 100,
        referenceType: 'issue',
        referenceId: 'ISS-001'
      }
      
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue([{
        productId: 'prod-1',
        requiredQty: 10,
        availableQty: 50,
        isAvailable: true, shortfall: 0 }])
      
      vi.mocked(mockRepository.recordStockMovement).mockResolvedValue({
        id: 'mv-1',
        ...movement,
        createdAt: '2025-01-15'
      })
      
      const result = await service.recordStockMovement(movement)
      
      expect(result.id).toBe('mv-1')
    })

    it('should throw error when stock is not available', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue([{
        productId: 'prod-1',
        requiredQty: 100,
        availableQty: 50,
        isAvailable: false, shortfall: 50 }])
      
      await expect(service.recordStockMovement({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 100,
        moveType: 'OUT',
        rate: 10,
        totalValue: 1000,
        referenceType: 'issue',
        referenceId: 'ISS-001'
      })).rejects.toThrow('المخزون غير كافٍ')
    })
  })

  describe('adjustStock', () => {
    it('should create adjustment movement', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      vi.mocked(mockRepository.recordStockMovement).mockResolvedValue({
        id: 'mv-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 5,
        moveType: 'IN',
        rate: 10,
        totalValue: 50,
        referenceType: 'adjustment',
        referenceId: 'ADJ-001',
        createdAt: '2025-01-15'
      })
      
      const result = await service.adjustStock({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 5,
        reason: 'جرد',
        reference: 'ADJ-001'
      })
      
      expect(result.referenceType).toBe('adjustment')
    })
  })

  describe('transferStock', () => {
    it('should transfer stock between warehouses', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue([{
        productId: 'prod-1',
        requiredQty: 10,
        availableQty: 50,
        isAvailable: true, shortfall: 0 }])
      
      const outMovement: StockMovementData = {
        id: 'mv-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 10,
        moveType: 'TRANSFER',
        rate: 10,
        totalValue: 100,
        referenceType: 'transfer_out',
        referenceId: 'TRF-001',
        createdAt: '2025-01-15'
      }
      
      const inMovement: StockMovementData = {
        id: 'mv-2',
        productId: 'prod-1',
        warehouseId: 'wh-2',
        quantity: 10,
        moveType: 'TRANSFER',
        rate: 10,
        totalValue: 100,
        referenceType: 'transfer_in',
        referenceId: 'TRF-001',
        createdAt: '2025-01-15'
      }
      
      vi.mocked(mockRepository.recordStockMovement)
        .mockResolvedValueOnce(outMovement)
        .mockResolvedValueOnce(inMovement)
      
      const result = await service.transferStock({
        productId: 'prod-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        quantity: 10
      })
      
      expect(result.outMovement.referenceType).toBe('transfer_out')
      expect(result.inMovement.referenceType).toBe('transfer_in')
    })

    it('should throw error when stock not available', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue([{
        productId: 'prod-1',
        requiredQty: 100,
        availableQty: 50,
        isAvailable: false, shortfall: 50 }])
      
      await expect(service.transferStock({
        productId: 'prod-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        quantity: 100
      })).rejects.toThrow('المخزون غير كافٍ')
    })
  })

  describe('getStockBalance', () => {
    it('should return stock balance', async () => {
      const balance: StockBalanceData = {
        productId: 'prod-1',
        productCode: 'SKU-001',
        productName: 'منتج 1',
        warehouseId: 'wh-1',
        warehouseName: 'المستودع الرئيسي',
        quantity: 50,
        avgRate: 10,
        totalValue: 500
      }
      
      vi.mocked(mockRepository.getStockBalance).mockResolvedValue(balance)
      
      const result = await service.getStockBalance('prod-1', 'wh-1')
      
      expect(result.quantity).toBe(50)
    })
  })

  describe('checkAvailability', () => {
    it('should check multiple products availability', async () => {
      const requirements = [
        { productId: 'prod-1', quantity: 10 },
        { productId: 'prod-2', quantity: 20 }
      ]
      
      const checkResult: AvailabilityCheckResult[] = [
        { productId: 'prod-1', requiredQty: 10, availableQty: 50, isAvailable: true, shortfall: 0 },
        { productId: 'prod-2', requiredQty: 20, availableQty: 100, isAvailable: true, shortfall: 0 }
      ]
      
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue(checkResult)
      
      const result = await service.checkAvailability(requirements)
      
      expect(result).toHaveLength(2)
      expect(result.every(r => r.isAvailable)).toBe(true)
    })
  })

  describe('createReservation', () => {
    it('should create reservation when stock available', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue([{
        productId: 'prod-1',
        requiredQty: 10,
        availableQty: 50,
        isAvailable: true, shortfall: 0 }])
      vi.mocked(mockRepository.createReservation).mockResolvedValue('res-1')
      
      const result = await service.createReservation('prod-1', 10, 'sale_order', 'SO-001')
      
      expect(result).toBe('res-1')
    })

    it('should throw error when stock not available', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue([{
        productId: 'prod-1',
        requiredQty: 100,
        availableQty: 50,
        isAvailable: false, shortfall: 50 }])
      
      await expect(service.createReservation('prod-1', 100, 'sale_order', 'SO-001'))
        .rejects.toThrow('الكمية غير متوفرة للحجز')
    })
  })

  describe('releaseReservation', () => {
    it('should release reservation', async () => {
      vi.mocked(mockRepository.releaseReservation).mockResolvedValue(undefined)
      
      await service.releaseReservation('res-1')
      
      expect(mockRepository.releaseReservation).toHaveBeenCalledWith('res-1')
    })
  })

  describe('getDashboardMetrics', () => {
    it('should return dashboard metrics', async () => {
      vi.mocked(mockRepository.getLowStockItems).mockResolvedValue([mockProducts[2]])
      
      const result = await service.getDashboardMetrics()
      
      expect(result.totalProducts).toBe(3)
      expect(result.totalValue).toBe(2575)
      expect(result.lowStockCount).toBe(1)
    })
  })
})
