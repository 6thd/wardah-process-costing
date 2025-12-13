/**
 * IInventoryRepository - Domain Interface (Port)
 * 
 * واجهة المخزون للفصل بين طبقة المجال وطبقة البنية التحتية
 */

import type { ValuationMethod, StockBatch } from '@/services/valuation'

// ===== Types =====

export interface ProductData {
  id: string
  code: string
  name: string
  nameAr?: string
  valuationMethod: ValuationMethod
  stockQuantity: number
  costPrice: number
  stockValue: number
  stockQueue?: StockBatch[]
  minStockLevel?: number
  maxStockLevel?: number
  reorderPoint?: number
  category?: string
  unit?: string
}

export interface BinData {
  id: string
  productId: string
  warehouseId: string
  actualQty: number
  reservedQty: number
  availableQty: number
  stockValue: number
  avgRate: number
  lastMovementDate?: string
}

export interface StockMovementData {
  id?: string
  productId: string
  warehouseId?: string
  binId?: string
  moveType: 'IN' | 'OUT' | 'TRANSFER'
  quantity: number
  rate: number
  totalValue: number
  referenceType?: string
  referenceId?: string
  notes?: string
  createdAt?: string
  createdBy?: string
}

export interface StockBalanceData {
  productId: string
  productCode: string
  productName: string
  warehouseId?: string
  warehouseName?: string
  quantity: number
  avgRate: number
  totalValue: number
}

export interface AvailabilityCheckResult {
  productId: string
  requiredQty: number
  availableQty: number
  isAvailable: boolean
  shortfall: number
}

// ===== Interface =====

export interface IInventoryRepository {
  // Product operations
  getProduct(productId: string): Promise<ProductData | null>
  getProductByCode(code: string): Promise<ProductData | null>
  getProducts(filters?: { category?: string; active?: boolean }): Promise<ProductData[]>
  updateProductStock(
    productId: string, 
    quantity: number, 
    rate: number, 
    value: number,
    queue?: StockBatch[]
  ): Promise<void>

  // Bin operations
  getBin(productId: string, warehouseId: string): Promise<BinData | null>
  getBinsByProduct(productId: string): Promise<BinData[]>
  getBinsByWarehouse(warehouseId: string): Promise<BinData[]>
  updateBin(binId: string, data: Partial<BinData>): Promise<void>
  createBin(data: Omit<BinData, 'id'>): Promise<BinData>

  // Stock movements
  recordStockMovement(movement: StockMovementData): Promise<StockMovementData>
  getStockMovements(
    productId: string, 
    options?: { 
      fromDate?: string
      toDate?: string
      warehouseId?: string
      moveType?: 'IN' | 'OUT' | 'TRANSFER'
    }
  ): Promise<StockMovementData[]>

  // Stock queries
  getStockBalance(productId: string, warehouseId?: string): Promise<StockBalanceData>
  getTotalStockValue(warehouseId?: string): Promise<number>
  getLowStockItems(threshold?: number): Promise<ProductData[]>

  // Availability
  checkAvailability(requirements: Array<{ productId: string; quantity: number }>): Promise<AvailabilityCheckResult[]>
  
  // Reservations
  createReservation(productId: string, quantity: number, referenceType: string, referenceId: string): Promise<string>
  releaseReservation(reservationId: string): Promise<void>
  getReservations(productId: string): Promise<Array<{ id: string; quantity: number; referenceType: string; referenceId: string }>>
}
