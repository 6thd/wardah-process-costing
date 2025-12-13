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
  categoryId?: string
  isActive?: boolean
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
  binId?: string
  movementType?: string
  startDate?: Date
  endDate?: Date
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
  fromBinId?: string
  toBinId?: string
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
    const { page = 1, pageSize = 20, search, categoryId, isActive, lowStock } = filters
    
    const allProducts = await this.repository.getProducts()
    
    // تطبيق الفلاتر
    let filtered = allProducts
    
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        p.sku.toLowerCase().includes(searchLower)
      )
    }
    
    if (categoryId) {
      filtered = filtered.filter(p => p.categoryId === categoryId)
    }
    
    if (isActive !== undefined) {
      filtered = filtered.filter(p => p.isActive === isActive)
    }
    
    if (lowStock) {
      filtered = filtered.filter(p => 
        p.currentStock !== undefined && 
        p.minStock !== undefined && 
        p.currentStock <= p.minStock
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
   * الحصول على المنتجات ذات المخزون المنخفض
   */
  async getLowStockProducts(): Promise<ProductData[]> {
    const products = await this.repository.getProducts()
    return products.filter(p => 
      p.currentStock !== undefined && 
      p.minStock !== undefined && 
      p.currentStock <= p.minStock
    )
  }

  /**
   * تحديث مخزون منتج
   */
  async updateProductStock(
    productId: string, 
    quantity: number, 
    operation: 'add' | 'subtract' | 'set'
  ): Promise<ProductData> {
    const product = await this.repository.getProduct(productId)
    if (!product) {
      throw new Error(`المنتج غير موجود: ${productId}`)
    }

    let newQuantity: number
    const currentStock = product.currentStock || 0

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

    return this.repository.updateProductStock(productId, newQuantity)
  }

  // ===== Stock Movements =====

  /**
   * تسجيل حركة مخزون
   */
  async recordMovement(movement: Omit<StockMovementData, 'id' | 'createdAt'>): Promise<StockMovementData> {
    // التحقق من توفر المخزون للعمليات السالبة
    if (movement.quantity < 0) {
      const availability = await this.repository.checkAvailability(
        movement.productId,
        Math.abs(movement.quantity),
        movement.warehouseId,
        movement.binId
      )
      
      if (!availability.isAvailable) {
        throw new Error(
          `المخزون غير كافٍ. المتاح: ${availability.availableQuantity}, المطلوب: ${Math.abs(movement.quantity)}`
        )
      }
    }

    return this.repository.recordStockMovement(movement)
  }

  /**
   * تعديل المخزون
   */
  async adjustStock(input: StockAdjustmentInput): Promise<StockMovementData> {
    const movement: Omit<StockMovementData, 'id' | 'createdAt'> = {
      productId: input.productId,
      warehouseId: input.warehouseId,
      binId: input.binId,
      quantity: input.quantity,
      movementType: 'adjustment',
      reference: input.reference || `ADJ-${Date.now()}`,
      notes: `${input.reason}${input.notes ? ` - ${input.notes}` : ''}`
    }

    return this.recordMovement(movement)
  }

  /**
   * نقل مخزون بين المستودعات
   */
  async transferStock(input: StockTransferInput): Promise<{ out: StockMovementData; in: StockMovementData }> {
    // التحقق من التوفر
    const availability = await this.repository.checkAvailability(
      input.productId,
      input.quantity,
      input.fromWarehouseId,
      input.fromBinId
    )

    if (!availability.isAvailable) {
      throw new Error(
        `المخزون غير كافٍ للنقل. المتاح: ${availability.availableQuantity}, المطلوب: ${input.quantity}`
      )
    }

    const reference = input.reference || `TRF-${Date.now()}`

    // حركة خروج
    const outMovement = await this.recordMovement({
      productId: input.productId,
      warehouseId: input.fromWarehouseId,
      binId: input.fromBinId,
      quantity: -input.quantity,
      movementType: 'transfer_out',
      reference,
      notes: input.notes
    })

    // حركة دخول
    const inMovement = await this.recordMovement({
      productId: input.productId,
      warehouseId: input.toWarehouseId,
      binId: input.toBinId,
      quantity: input.quantity,
      movementType: 'transfer_in',
      reference,
      notes: input.notes
    })

    return { out: outMovement, in: inMovement }
  }

  // ===== Availability =====

  /**
   * التحقق من توفر المخزون
   */
  async checkAvailability(
    productId: string,
    quantity: number,
    warehouseId?: string,
    binId?: string
  ): Promise<AvailabilityCheckResult> {
    return this.repository.checkAvailability(productId, quantity, warehouseId, binId)
  }

  /**
   * الحصول على إجمالي قيمة المخزون
   */
  async getTotalStockValue(warehouseId?: string): Promise<number> {
    return this.repository.getTotalStockValue(warehouseId)
  }

  // ===== Bins =====

  /**
   * الحصول على bin محدد
   */
  async getBin(binId: string): Promise<BinData | null> {
    return this.repository.getBin(binId)
  }

  /**
   * إنشاء bin جديد
   */
  async createBin(bin: Omit<BinData, 'id'>): Promise<BinData> {
    return this.repository.createBin(bin)
  }

  // ===== Reservations =====

  /**
   * إنشاء حجز مخزون
   */
  async createReservation(
    productId: string,
    quantity: number,
    reference: string,
    expiresAt?: Date
  ): Promise<string> {
    // التحقق من التوفر
    const availability = await this.checkAvailability(productId, quantity)
    if (!availability.isAvailable) {
      throw new Error('المخزون غير كافٍ للحجز')
    }

    return this.repository.createReservation(productId, quantity, reference, expiresAt)
  }

  /**
   * إلغاء حجز
   */
  async cancelReservation(reservationId: string): Promise<void> {
    return this.repository.cancelReservation(reservationId)
  }
}

// ===== Singleton Instance =====

let inventoryAppServiceInstance: InventoryAppService | null = null

/**
 * الحصول على instance من خدمة المخزون
 */
export function getInventoryAppService(): InventoryAppService {
  if (!inventoryAppServiceInstance) {
    inventoryAppServiceInstance = new InventoryAppService()
  }
  return inventoryAppServiceInstance
}

/**
 * إعادة تعيين الـ instance (للاختبارات)
 */
export function resetInventoryAppService(): void {
  inventoryAppServiceInstance = null
}
