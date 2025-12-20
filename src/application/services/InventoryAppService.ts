/**
 * @fileoverview Inventory Application Service
 * @description خدمة تطبيق المخزون - الطبقة التي تربط الواجهة الأمامية بـ Repository
 * 
 * هذه الخدمة تتبع Clean Architecture:
 * - تستخدم Repository Pattern للوصول للبيانات
 * - تحتوي على Business Logic للعمليات المعقدة
 * - توفر واجهة موحدة للواجهة الأمامية
 */

import { getInventoryRepository } from '@/infrastructure/di/container'
import type { 
  IInventoryRepository, 
  ProductData, 
  BinData, 
  StockMovementData,
  StockBalanceData,
  AvailabilityCheckResult 
} from '@/domain/interfaces'

// ===== Types =====

export interface ProductListFilters {
  search?: string
  category?: string
  active?: boolean
  lowStock?: boolean
  page?: number
  pageSize?: number
}

export interface ProductListResult {
  products: ProductData[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface StockMovementFilters {
  productId?: string
  warehouseId?: string
  moveType?: 'IN' | 'OUT' | 'TRANSFER'
  fromDate?: string
  toDate?: string
  page?: number
  pageSize?: number
}

export interface StockMovementResult {
  movements: StockMovementData[]
  total: number
  page: number
  pageSize: number
}

export interface StockAdjustmentInput {
  productId: string
  warehouseId: string
  binId?: string
  quantity: number
  reason: string
  reference?: string
  notes?: string
}

export interface StockTransferInput {
  productId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: number
  reference?: string
  notes?: string
}

// ===== Service =====

/**
 * خدمة تطبيق المخزون
 * توفر واجهة عالية المستوى لعمليات المخزون
 */
export class InventoryAppService {
  private repository: IInventoryRepository

  constructor(repository?: IInventoryRepository) {
    this.repository = repository || getInventoryRepository()
  }

  // ===== Products =====

  /**
   * الحصول على قائمة المنتجات مع الفلترة والترقيم
   */
  async getProducts(filters: ProductListFilters = {}): Promise<ProductListResult> {
    const { page = 1, pageSize = 20, search, category, active, lowStock } = filters
    
    const allProducts = await this.repository.getProducts({ category, active })
    
    // تطبيق الفلاتر
    let filtered = allProducts
    
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        p.code.toLowerCase().includes(searchLower)
      )
    }
    
    if (lowStock) {
      filtered = filtered.filter(p => 
        p.stockQuantity !== undefined && 
        p.minStockLevel !== undefined && 
        p.stockQuantity <= p.minStockLevel
      )
    }
    
    // ترقيم الصفحات
    const total = filtered.length
    const start = (page - 1) * pageSize
    const products = filtered.slice(start, start + pageSize)
    
    return {
      products,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    }
  }

  /**
   * الحصول على منتج واحد
   */
  async getProduct(productId: string): Promise<ProductData | null> {
    return this.repository.getProduct(productId)
  }

  /**
   * الحصول على منتج بالكود
   */
  async getProductByCode(code: string): Promise<ProductData | null> {
    return this.repository.getProductByCode(code)
  }

  /**
   * الحصول على المنتجات ذات المخزون المنخفض
   */
  async getLowStockProducts(threshold?: number): Promise<ProductData[]> {
    return this.repository.getLowStockItems(threshold)
  }

  /**
   * تحديث مخزون منتج
   */
  async updateProductStock(
    productId: string, 
    quantity: number, 
    rate: number,
    operation: 'add' | 'subtract' | 'set'
  ): Promise<void> {
    const product = await this.repository.getProduct(productId)
    if (!product) {
      throw new Error(`المنتج غير موجود: ${productId}`)
    }

    let newQuantity: number
    const currentStock = product.stockQuantity || 0

    switch (operation) {
      case 'add':
        newQuantity = currentStock + quantity
        break
      case 'subtract':
        newQuantity = currentStock - quantity
        if (newQuantity < 0) {
          throw new Error('لا يمكن أن يكون المخزون سالباً')
        }
        break
      case 'set':
        newQuantity = quantity
        break
    }

    const newValue = newQuantity * rate
    await this.repository.updateProductStock(productId, newQuantity, rate, newValue)
  }

  // ===== Stock Movements =====

  /**
   * تسجيل حركة مخزون
   */
  async recordStockMovement(
    movement: Omit<StockMovementData, 'id' | 'createdAt'>
  ): Promise<StockMovementData> {
    // التحقق من توفر المخزون للحركات الصادرة
    if (movement.moveType === 'OUT' || movement.moveType === 'TRANSFER') {
      const availability = await this.repository.checkAvailability([{
        productId: movement.productId,
        quantity: movement.quantity
      }])

      const result = availability[0]
      if (!result?.isAvailable) {
        throw new Error(
          `المخزون غير كافٍ. المتاح: ${result?.availableQty || 0}, المطلوب: ${movement.quantity}`
        )
      }
    }

    // تسجيل الحركة
    return this.repository.recordStockMovement(movement as StockMovementData)
  }

  /**
   * الحصول على حركات المخزون
   */
  async getStockMovements(
    productId: string,
    filters: Omit<StockMovementFilters, 'productId'> = {}
  ): Promise<StockMovementResult> {
    const { page = 1, pageSize = 20, ...options } = filters
    
    const movements = await this.repository.getStockMovements(productId, options)
    
    const total = movements.length
    const start = (page - 1) * pageSize
    const paginatedMovements = movements.slice(start, start + pageSize)
    
    return {
      movements: paginatedMovements,
      total,
      page,
      pageSize
    }
  }

  /**
   * تعديل المخزون (زيادة أو نقص)
   */
  async adjustStock(input: StockAdjustmentInput): Promise<StockMovementData> {
    const product = await this.repository.getProduct(input.productId)
    if (!product) {
      throw new Error(`المنتج غير موجود: ${input.productId}`)
    }

    const moveType = input.quantity >= 0 ? 'IN' : 'OUT'
    const quantity = Math.abs(input.quantity)

    return this.recordStockMovement({
      productId: input.productId,
      warehouseId: input.warehouseId,
      binId: input.binId,
      moveType,
      quantity,
      rate: product.costPrice,
      totalValue: quantity * product.costPrice,
      referenceType: 'adjustment',
      referenceId: input.reference || `ADJ-${Date.now()}`,
      notes: `${input.reason}${input.notes ? ': ' + input.notes : ''}`
    })
  }

  /**
   * نقل مخزون بين المستودعات
   */
  async transferStock(input: StockTransferInput): Promise<{ outMovement: StockMovementData; inMovement: StockMovementData }> {
    const product = await this.repository.getProduct(input.productId)
    if (!product) {
      throw new Error(`المنتج غير موجود: ${input.productId}`)
    }

    // التحقق من توفر المخزون
    const availability = await this.repository.checkAvailability([{
      productId: input.productId,
      quantity: input.quantity
    }])
    
    const result = availability[0]
    if (!result?.isAvailable) {
      throw new Error(
        `المخزون غير كافٍ للنقل. المتاح: ${result?.availableQty || 0}, المطلوب: ${input.quantity}`
      )
    }

    const reference = input.reference || `TRF-${Date.now()}`

    // تسجيل حركة الخروج
    const outMovement = await this.repository.recordStockMovement({
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      moveType: 'TRANSFER',
      quantity: input.quantity,
      rate: product.costPrice,
      totalValue: input.quantity * product.costPrice,
      referenceType: 'transfer_out',
      referenceId: reference,
      notes: input.notes
    })

    // تسجيل حركة الدخول
    const inMovement = await this.repository.recordStockMovement({
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      moveType: 'TRANSFER',
      quantity: input.quantity,
      rate: product.costPrice,
      totalValue: input.quantity * product.costPrice,
      referenceType: 'transfer_in',
      referenceId: reference,
      notes: input.notes
    })

    return { outMovement, inMovement }
  }

  // ===== Stock Balance =====

  /**
   * الحصول على رصيد المخزون
   */
  async getStockBalance(productId: string, warehouseId?: string): Promise<StockBalanceData> {
    return this.repository.getStockBalance(productId, warehouseId)
  }

  /**
   * الحصول على إجمالي قيمة المخزون
   */
  async getTotalStockValue(warehouseId?: string): Promise<number> {
    return this.repository.getTotalStockValue(warehouseId)
  }

  /**
   * التحقق من توفر المخزون
   */
  async checkAvailability(
    requirements: Array<{ productId: string; quantity: number }>
  ): Promise<AvailabilityCheckResult[]> {
    return this.repository.checkAvailability(requirements)
  }

  // ===== Bins =====

  /**
   * الحصول على بيانات حاوية
   */
  async getBin(productId: string, warehouseId: string): Promise<BinData | null> {
    return this.repository.getBin(productId, warehouseId)
  }

  /**
   * الحصول على حاويات منتج
   */
  async getBinsByProduct(productId: string): Promise<BinData[]> {
    return this.repository.getBinsByProduct(productId)
  }

  /**
   * الحصول على حاويات مستودع
   */
  async getBinsByWarehouse(warehouseId: string): Promise<BinData[]> {
    return this.repository.getBinsByWarehouse(warehouseId)
  }

  // ===== Reservations =====

  /**
   * إنشاء حجز
   */
  async createReservation(
    productId: string,
    quantity: number,
    referenceType: string,
    referenceId: string
  ): Promise<string> {
    // التحقق من توفر الكمية
    const availability = await this.repository.checkAvailability([{
      productId,
      quantity
    }])

    const result = availability[0]
    if (!result?.isAvailable) {
      throw new Error(`الكمية غير متوفرة للحجز. المتاح: ${result?.availableQty || 0}`)
    }

    return this.repository.createReservation(productId, quantity, referenceType, referenceId)
  }

  /**
   * تحرير حجز
   */
  async releaseReservation(reservationId: string): Promise<void> {
    return this.repository.releaseReservation(reservationId)
  }

  /**
   * الحصول على الحجوزات
   */
  async getReservations(productId: string): Promise<Array<{ id: string; quantity: number; referenceType: string; referenceId: string }>> {
    return this.repository.getReservations(productId)
  }

  // ===== Dashboard Metrics =====

  /**
   * الحصول على إحصائيات المخزون للوحة التحكم
   */
  async getDashboardMetrics(): Promise<{
    totalProducts: number
    totalValue: number
    lowStockCount: number
    outOfStockCount: number
  }> {
    const products = await this.repository.getProducts()
    const totalValue = await this.repository.getTotalStockValue()
    const lowStockItems = await this.repository.getLowStockItems()
    
    return {
      totalProducts: products.length,
      totalValue,
      lowStockCount: lowStockItems.length,
      outOfStockCount: products.filter(p => p.stockQuantity === 0).length
    }
  }
}

// ===== Singleton Instance =====

let inventoryAppServiceInstance: InventoryAppService | null = null

/**
 * الحصول على instance من خدمة المخزون (Singleton)
 */
export function getInventoryAppService(): InventoryAppService {
  if (!inventoryAppServiceInstance) {
    inventoryAppServiceInstance = new InventoryAppService()
  }
  return inventoryAppServiceInstance
}

/**
 * إعادة تعيين الـ singleton (مفيد للاختبارات)
 */
export function resetInventoryAppService(): void {
  inventoryAppServiceInstance = null
}