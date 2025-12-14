/**
 * @fileoverview Inventory Queries
 * @description استعلامات المخزون (CQRS Queries)
 */

import type { IQuery, PaginationParams, SortParams, FilterParams, QueryMetadata } from '../types'

// ===== Query Types =====

export const InventoryQueryTypes = {
  GET_PRODUCT: 'inventory.getProduct',
  GET_PRODUCTS: 'inventory.getProducts',
  GET_STOCK_BALANCE: 'inventory.getStockBalance',
  GET_STOCK_MOVEMENTS: 'inventory.getStockMovements',
  GET_LOW_STOCK_ITEMS: 'inventory.getLowStockItems',
  GET_WAREHOUSE_SUMMARY: 'inventory.getWarehouseSummary',
  GET_PRODUCT_VALUATION: 'inventory.getProductValuation',
  GET_RESERVATIONS: 'inventory.getReservations'
} as const

// ===== Get Product Query =====

export interface GetProductQuery extends IQuery<GetProductResult> {
  queryType: typeof InventoryQueryTypes.GET_PRODUCT
  productId: string
  includeStock?: boolean
  includeMovements?: boolean
}

export interface GetProductResult {
  id: string
  code: string
  name: string
  nameEn?: string
  categoryId?: string
  categoryName?: string
  unitOfMeasure: string
  description?: string
  minStockLevel?: number
  reorderPoint?: number
  standardCost?: number
  sellingPrice?: number
  isActive: boolean
  stockBalance?: number
  reservedQuantity?: number
  availableQuantity?: number
  warehouseStock?: WarehouseStockInfo[]
  recentMovements?: StockMovementInfo[]
}

export interface WarehouseStockInfo {
  warehouseId: string
  warehouseName: string
  quantity: number
  reservedQuantity: number
  availableQuantity: number
}

export interface StockMovementInfo {
  id: string
  date: Date
  type: string
  quantity: number
  reference?: string
  warehouseId: string
  warehouseName: string
}

export function createGetProductQuery(
  params: Omit<GetProductQuery, 'queryType' | 'timestamp'>
): GetProductQuery {
  return {
    queryType: InventoryQueryTypes.GET_PRODUCT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Products Query =====

export interface GetProductsQuery extends IQuery<GetProductsResult> {
  queryType: typeof InventoryQueryTypes.GET_PRODUCTS
  pagination?: PaginationParams
  sort?: SortParams
  filters?: FilterParams[]
  searchTerm?: string
  categoryId?: string
  isActive?: boolean
}

export interface GetProductsResult {
  products: ProductSummary[]
  metadata: QueryMetadata
}

export interface ProductSummary {
  id: string
  code: string
  name: string
  categoryName?: string
  unitOfMeasure: string
  stockBalance: number
  standardCost?: number
  isActive: boolean
}

export function createGetProductsQuery(
  params: Omit<GetProductsQuery, 'queryType' | 'timestamp'>
): GetProductsQuery {
  return {
    queryType: InventoryQueryTypes.GET_PRODUCTS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Stock Balance Query =====

export interface GetStockBalanceQuery extends IQuery<GetStockBalanceResult> {
  queryType: typeof InventoryQueryTypes.GET_STOCK_BALANCE
  productId: string
  warehouseId?: string
  asOfDate?: Date
}

export interface GetStockBalanceResult {
  productId: string
  productName: string
  totalBalance: number
  reservedQuantity: number
  availableQuantity: number
  valuationAmount: number
  averageCost: number
  warehouseBalances: WarehouseBalance[]
  batchBalances?: BatchBalance[]
}

export interface WarehouseBalance {
  warehouseId: string
  warehouseName: string
  quantity: number
  reservedQuantity: number
  availableQuantity: number
  valuationAmount: number
}

export interface BatchBalance {
  batchNumber: string
  quantity: number
  expiryDate?: Date
  unitCost: number
}

export function createGetStockBalanceQuery(
  params: Omit<GetStockBalanceQuery, 'queryType' | 'timestamp'>
): GetStockBalanceQuery {
  return {
    queryType: InventoryQueryTypes.GET_STOCK_BALANCE,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Stock Movements Query =====

export interface GetStockMovementsQuery extends IQuery<GetStockMovementsResult> {
  queryType: typeof InventoryQueryTypes.GET_STOCK_MOVEMENTS
  productId?: string
  warehouseId?: string
  movementType?: string
  fromDate?: Date
  toDate?: Date
  pagination?: PaginationParams
  sort?: SortParams
}

export interface GetStockMovementsResult {
  movements: StockMovement[]
  metadata: QueryMetadata
}

export interface StockMovement {
  id: string
  date: Date
  productId: string
  productName: string
  warehouseId: string
  warehouseName: string
  movementType: string
  quantity: number
  unitCost: number
  totalValue: number
  balanceAfter: number
  reference?: string
  createdBy?: string
  createdAt: Date
}

export function createGetStockMovementsQuery(
  params: Omit<GetStockMovementsQuery, 'queryType' | 'timestamp'>
): GetStockMovementsQuery {
  return {
    queryType: InventoryQueryTypes.GET_STOCK_MOVEMENTS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Low Stock Items Query =====

export interface GetLowStockItemsQuery extends IQuery<GetLowStockItemsResult> {
  queryType: typeof InventoryQueryTypes.GET_LOW_STOCK_ITEMS
  warehouseId?: string
  includeZeroStock?: boolean
}

export interface GetLowStockItemsResult {
  items: LowStockItem[]
  totalCount: number
}

export interface LowStockItem {
  productId: string
  productCode: string
  productName: string
  currentStock: number
  minStockLevel: number
  reorderPoint: number
  shortfall: number
  warehouseId?: string
  warehouseName?: string
}

export function createGetLowStockItemsQuery(
  params: Omit<GetLowStockItemsQuery, 'queryType' | 'timestamp'>
): GetLowStockItemsQuery {
  return {
    queryType: InventoryQueryTypes.GET_LOW_STOCK_ITEMS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Warehouse Summary Query =====

export interface GetWarehouseSummaryQuery extends IQuery<GetWarehouseSummaryResult> {
  queryType: typeof InventoryQueryTypes.GET_WAREHOUSE_SUMMARY
  warehouseId: string
  asOfDate?: Date
}

export interface GetWarehouseSummaryResult {
  warehouseId: string
  warehouseName: string
  totalProducts: number
  totalQuantity: number
  totalValue: number
  categoryBreakdown: CategoryStock[]
  topProducts: TopProduct[]
  recentActivity: RecentActivity[]
}

export interface CategoryStock {
  categoryId: string
  categoryName: string
  productCount: number
  totalQuantity: number
  totalValue: number
}

export interface TopProduct {
  productId: string
  productName: string
  quantity: number
  value: number
}

export interface RecentActivity {
  date: Date
  type: string
  productName: string
  quantity: number
  reference?: string
}

export function createGetWarehouseSummaryQuery(
  params: Omit<GetWarehouseSummaryQuery, 'queryType' | 'timestamp'>
): GetWarehouseSummaryQuery {
  return {
    queryType: InventoryQueryTypes.GET_WAREHOUSE_SUMMARY,
    timestamp: new Date(),
    ...params
  }
}

// ===== Get Reservations Query =====

export interface GetReservationsQuery extends IQuery<GetReservationsResult> {
  queryType: typeof InventoryQueryTypes.GET_RESERVATIONS
  productId?: string
  warehouseId?: string
  status?: 'active' | 'fulfilled' | 'cancelled' | 'expired'
  pagination?: PaginationParams
}

export interface GetReservationsResult {
  reservations: Reservation[]
  metadata: QueryMetadata
}

export interface Reservation {
  id: string
  productId: string
  productName: string
  warehouseId: string
  warehouseName: string
  quantity: number
  reference: string
  referenceType: string
  status: string
  expiryDate?: Date
  createdAt: Date
}

export function createGetReservationsQuery(
  params: Omit<GetReservationsQuery, 'queryType' | 'timestamp'>
): GetReservationsQuery {
  return {
    queryType: InventoryQueryTypes.GET_RESERVATIONS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Union Type =====

export type InventoryQuery =
  | GetProductQuery
  | GetProductsQuery
  | GetStockBalanceQuery
  | GetStockMovementsQuery
  | GetLowStockItemsQuery
  | GetWarehouseSummaryQuery
  | GetReservationsQuery
