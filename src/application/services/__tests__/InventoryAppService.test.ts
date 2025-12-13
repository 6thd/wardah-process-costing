/**
 * @fileoverview InventoryAppService Tests
 * @description اختبارات خدمة تطبيق المخزون
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InventoryAppService } from '../InventoryAppService'
import type { IInventoryRepository, ProductData, StockMovementData, AvailabilityCheckResult } from '@/domain/interfaces'

describe('InventoryAppService', () => {
  let service: InventoryAppService
  let mockRepository: IInventoryRepository

  const mockProducts: ProductData[] = [
    {
      id: 'prod-1',
      sku: 'SKU-001',
      name: 'منتج أ',
      categoryId: 'cat-1',
      unitCost: 100,
      sellingPrice: 150,
      currentStock: 50,
      minStock: 10,
      isActive: true
    },
    {
      id: 'prod-2',
      sku: 'SKU-002',
      name: 'منتج ب',
      categoryId: 'cat-2',
      unitCost: 200,
      sellingPrice: 300,
      currentStock: 5,
      minStock: 10,
      isActive: true
    },
    {
      id: 'prod-3',
      sku: 'SKU-003',
      name: 'منتج غير نشط',
      categoryId: 'cat-1',
      unitCost: 50,
      sellingPrice: 80,
      currentStock: 100,
      minStock: 20,
      isActive: false
    }
  ]

  beforeEach(() => {
    mockRepository = {
      getProduct: vi.fn(),
      getProducts: vi.fn().mockResolvedValue(mockProducts),
      updateProductStock: vi.fn(),
      getBin: vi.fn(),
      createBin: vi.fn(),
      recordStockMovement: vi.fn(),
      getTotalStockValue: vi.fn().mockResolvedValue(15000),
      checkAvailability: vi.fn(),
      createReservation: vi.fn(),
      cancelReservation: vi.fn()
    }

    service = new InventoryAppService(mockRepository)
  })

  describe('getProducts', () => {
    it('should return paginated products', async () => {
      const result = await service.getProducts({ page: 1, pageSize: 2 })

      expect(result.products).toHaveLength(2)
      expect(result.total).toBe(3)
      expect(result.page).toBe(1)
      expect(result.hasMore).toBe(true)
    })

    it('should filter by search term', async () => {
      const result = await service.getProducts({ search: 'منتج أ' })

      expect(result.products).toHaveLength(1)
      expect(result.products[0].name).toBe('منتج أ')
    })

    it('should filter by category', async () => {
      const result = await service.getProducts({ categoryId: 'cat-1' })

      expect(result.products).toHaveLength(2)
    })

    it('should filter by active status', async () => {
      const result = await service.getProducts({ isActive: true })

      expect(result.products).toHaveLength(2)
      expect(result.products.every(p => p.isActive)).toBe(true)
    })

    it('should filter low stock products', async () => {
      const result = await service.getProducts({ lowStock: true })

      expect(result.products).toHaveLength(1)
      expect(result.products[0].id).toBe('prod-2')
    })
  })

  describe('getProduct', () => {
    it('should return a single product', async () => {
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
    it('should return products with stock below minimum', async () => {
      const result = await service.getLowStockProducts()

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('prod-2')
      expect(result[0].currentStock).toBeLessThanOrEqual(result[0].minStock!)
    })
  })

  describe('updateProductStock', () => {
    it('should add stock correctly', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      vi.mocked(mockRepository.updateProductStock).mockResolvedValue({
        ...mockProducts[0],
        currentStock: 60
      })

      const result = await service.updateProductStock('prod-1', 10, 'add')

      expect(mockRepository.updateProductStock).toHaveBeenCalledWith('prod-1', 60)
      expect(result.currentStock).toBe(60)
    })

    it('should subtract stock correctly', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      vi.mocked(mockRepository.updateProductStock).mockResolvedValue({
        ...mockProducts[0],
        currentStock: 40
      })

      const result = await service.updateProductStock('prod-1', 10, 'subtract')

      expect(mockRepository.updateProductStock).toHaveBeenCalledWith('prod-1', 40)
    })

    it('should set stock correctly', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])
      vi.mocked(mockRepository.updateProductStock).mockResolvedValue({
        ...mockProducts[0],
        currentStock: 100
      })

      const result = await service.updateProductStock('prod-1', 100, 'set')

      expect(mockRepository.updateProductStock).toHaveBeenCalledWith('prod-1', 100)
    })

    it('should throw error for negative stock', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(mockProducts[0])

      await expect(service.updateProductStock('prod-1', 100, 'subtract'))
        .rejects.toThrow('لا يمكن أن يكون المخزون سالباً')
    })

    it('should throw error for non-existent product', async () => {
      vi.mocked(mockRepository.getProduct).mockResolvedValue(null)

      await expect(service.updateProductStock('non-existent', 10, 'add'))
        .rejects.toThrow('المنتج غير موجود')
    })
  })

  describe('recordMovement', () => {
    it('should record positive movement', async () => {
      const movement: Omit<StockMovementData, 'id' | 'createdAt'> = {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 10,
        movementType: 'receipt',
        reference: 'REC-001'
      }

      vi.mocked(mockRepository.recordStockMovement).mockResolvedValue({
        ...movement,
        id: 'mov-1',
        createdAt: new Date()
      })

      const result = await service.recordMovement(movement)

      expect(result.id).toBe('mov-1')
      expect(mockRepository.recordStockMovement).toHaveBeenCalledWith(movement)
    })

    it('should check availability for negative movement', async () => {
      const movement: Omit<StockMovementData, 'id' | 'createdAt'> = {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: -10,
        movementType: 'issue',
        reference: 'ISS-001'
      }

      vi.mocked(mockRepository.checkAvailability).mockResolvedValue({
        isAvailable: true,
        availableQuantity: 50,
        reservedQuantity: 0
      })

      vi.mocked(mockRepository.recordStockMovement).mockResolvedValue({
        ...movement,
        id: 'mov-2',
        createdAt: new Date()
      })

      await service.recordMovement(movement)

      expect(mockRepository.checkAvailability).toHaveBeenCalledWith('prod-1', 10, 'wh-1', undefined)
    })

    it('should throw error if stock insufficient', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue({
        isAvailable: false,
        availableQuantity: 5,
        reservedQuantity: 0
      })

      await expect(service.recordMovement({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: -10,
        movementType: 'issue',
        reference: 'ISS-001'
      })).rejects.toThrow('المخزون غير كافٍ')
    })
  })

  describe('adjustStock', () => {
    it('should create adjustment movement', async () => {
      vi.mocked(mockRepository.recordStockMovement).mockResolvedValue({
        id: 'adj-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 5,
        movementType: 'adjustment',
        reference: 'ADJ-123',
        createdAt: new Date()
      })

      const result = await service.adjustStock({
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 5,
        reason: 'تصحيح جرد'
      })

      expect(result.movementType).toBe('adjustment')
      expect(mockRepository.recordStockMovement).toHaveBeenCalled()
    })
  })

  describe('transferStock', () => {
    it('should create transfer movements', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue({
        isAvailable: true,
        availableQuantity: 50,
        reservedQuantity: 0
      })

      vi.mocked(mockRepository.recordStockMovement)
        .mockResolvedValueOnce({
          id: 'trf-out',
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: -10,
          movementType: 'transfer_out',
          reference: 'TRF-123',
          createdAt: new Date()
        })
        .mockResolvedValueOnce({
          id: 'trf-in',
          productId: 'prod-1',
          warehouseId: 'wh-2',
          quantity: 10,
          movementType: 'transfer_in',
          reference: 'TRF-123',
          createdAt: new Date()
        })

      const result = await service.transferStock({
        productId: 'prod-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        quantity: 10
      })

      expect(result.out.movementType).toBe('transfer_out')
      expect(result.in.movementType).toBe('transfer_in')
      expect(mockRepository.recordStockMovement).toHaveBeenCalledTimes(2)
    })

    it('should throw error if insufficient stock', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue({
        isAvailable: false,
        availableQuantity: 5,
        reservedQuantity: 0
      })

      await expect(service.transferStock({
        productId: 'prod-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        quantity: 10
      })).rejects.toThrow('المخزون غير كافٍ للنقل')
    })
  })

  describe('getTotalStockValue', () => {
    it('should return total stock value', async () => {
      const result = await service.getTotalStockValue()

      expect(result).toBe(15000)
      expect(mockRepository.getTotalStockValue).toHaveBeenCalled()
    })

    it('should filter by warehouse', async () => {
      await service.getTotalStockValue('wh-1')

      expect(mockRepository.getTotalStockValue).toHaveBeenCalledWith('wh-1')
    })
  })

  describe('createReservation', () => {
    it('should create reservation when stock available', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue({
        isAvailable: true,
        availableQuantity: 50,
        reservedQuantity: 0
      })
      vi.mocked(mockRepository.createReservation).mockResolvedValue('res-123')

      const result = await service.createReservation('prod-1', 10, 'SO-001')

      expect(result).toBe('res-123')
    })

    it('should throw error if stock insufficient', async () => {
      vi.mocked(mockRepository.checkAvailability).mockResolvedValue({
        isAvailable: false,
        availableQuantity: 5,
        reservedQuantity: 0
      })

      await expect(service.createReservation('prod-1', 10, 'SO-001'))
        .rejects.toThrow('المخزون غير كافٍ للحجز')
    })
  })
})
