/**
 * @fileoverview Inventory Commands
 * @description أوامر المخزون (CQRS Commands)
 */

import type { ICommand } from '../types'

// ===== Command Types =====

export const InventoryCommandTypes = {
  ADJUST_STOCK: 'inventory.adjustStock',
  TRANSFER_STOCK: 'inventory.transferStock',
  CREATE_PRODUCT: 'inventory.createProduct',
  UPDATE_PRODUCT: 'inventory.updateProduct',
  CREATE_RESERVATION: 'inventory.createReservation',
  CANCEL_RESERVATION: 'inventory.cancelReservation',
  RECEIVE_GOODS: 'inventory.receiveGoods',
  ISSUE_GOODS: 'inventory.issueGoods'
} as const

// ===== Adjust Stock Command =====

export interface AdjustStockCommand extends ICommand<AdjustStockResult> {
  commandType: typeof InventoryCommandTypes.ADJUST_STOCK
  productId: string
  warehouseId: string
  quantity: number
  reason: string
  reference?: string
  batchNumber?: string
  unitCost?: number
}

export interface AdjustStockResult {
  movementId: string
  previousBalance: number
  newBalance: number
  adjustedAt: Date
}

export function createAdjustStockCommand(
  params: Omit<AdjustStockCommand, 'commandType' | 'timestamp'>
): AdjustStockCommand {
  return {
    commandType: InventoryCommandTypes.ADJUST_STOCK,
    timestamp: new Date(),
    ...params
  }
}

// ===== Transfer Stock Command =====

export interface TransferStockCommand extends ICommand<TransferStockResult> {
  commandType: typeof InventoryCommandTypes.TRANSFER_STOCK
  productId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: number
  reference?: string
  notes?: string
}

export interface TransferStockResult {
  transferId: string
  fromMovementId: string
  toMovementId: string
  transferredAt: Date
}

export function createTransferStockCommand(
  params: Omit<TransferStockCommand, 'commandType' | 'timestamp'>
): TransferStockCommand {
  return {
    commandType: InventoryCommandTypes.TRANSFER_STOCK,
    timestamp: new Date(),
    ...params
  }
}

// ===== Create Product Command =====

export interface CreateProductCommand extends ICommand<CreateProductResult> {
  commandType: typeof InventoryCommandTypes.CREATE_PRODUCT
  code: string
  name: string
  nameEn?: string
  categoryId?: string
  unitOfMeasure: string
  description?: string
  minStockLevel?: number
  reorderPoint?: number
  standardCost?: number
  sellingPrice?: number
  isActive?: boolean
}

export interface CreateProductResult {
  productId: string
  createdAt: Date
}

export function createCreateProductCommand(
  params: Omit<CreateProductCommand, 'commandType' | 'timestamp'>
): CreateProductCommand {
  return {
    commandType: InventoryCommandTypes.CREATE_PRODUCT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Update Product Command =====

export interface UpdateProductCommand extends ICommand<UpdateProductResult> {
  commandType: typeof InventoryCommandTypes.UPDATE_PRODUCT
  productId: string
  name?: string
  nameEn?: string
  description?: string
  minStockLevel?: number
  reorderPoint?: number
  standardCost?: number
  sellingPrice?: number
  isActive?: boolean
}

export interface UpdateProductResult {
  productId: string
  updatedAt: Date
}

export function createUpdateProductCommand(
  params: Omit<UpdateProductCommand, 'commandType' | 'timestamp'>
): UpdateProductCommand {
  return {
    commandType: InventoryCommandTypes.UPDATE_PRODUCT,
    timestamp: new Date(),
    ...params
  }
}

// ===== Create Reservation Command =====

export interface CreateReservationCommand extends ICommand<CreateReservationResult> {
  commandType: typeof InventoryCommandTypes.CREATE_RESERVATION
  productId: string
  warehouseId: string
  quantity: number
  reference: string
  referenceType: 'sales_order' | 'manufacturing_order' | 'transfer'
  expiryDate?: Date
  notes?: string
}

export interface CreateReservationResult {
  reservationId: string
  createdAt: Date
}

export function createCreateReservationCommand(
  params: Omit<CreateReservationCommand, 'commandType' | 'timestamp'>
): CreateReservationCommand {
  return {
    commandType: InventoryCommandTypes.CREATE_RESERVATION,
    timestamp: new Date(),
    ...params
  }
}

// ===== Cancel Reservation Command =====

export interface CancelReservationCommand extends ICommand<CancelReservationResult> {
  commandType: typeof InventoryCommandTypes.CANCEL_RESERVATION
  reservationId: string
  reason?: string
}

export interface CancelReservationResult {
  reservationId: string
  cancelledAt: Date
}

export function createCancelReservationCommand(
  params: Omit<CancelReservationCommand, 'commandType' | 'timestamp'>
): CancelReservationCommand {
  return {
    commandType: InventoryCommandTypes.CANCEL_RESERVATION,
    timestamp: new Date(),
    ...params
  }
}

// ===== Receive Goods Command =====

export interface ReceiveGoodsCommand extends ICommand<ReceiveGoodsResult> {
  commandType: typeof InventoryCommandTypes.RECEIVE_GOODS
  purchaseOrderId?: string
  warehouseId: string
  lines: ReceiveGoodsLine[]
  reference?: string
  notes?: string
}

export interface ReceiveGoodsLine {
  productId: string
  quantity: number
  unitCost: number
  batchNumber?: string
  expiryDate?: Date
}

export interface ReceiveGoodsResult {
  receiptId: string
  movementIds: string[]
  receivedAt: Date
}

export function createReceiveGoodsCommand(
  params: Omit<ReceiveGoodsCommand, 'commandType' | 'timestamp'>
): ReceiveGoodsCommand {
  return {
    commandType: InventoryCommandTypes.RECEIVE_GOODS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Issue Goods Command =====

export interface IssueGoodsCommand extends ICommand<IssueGoodsResult> {
  commandType: typeof InventoryCommandTypes.ISSUE_GOODS
  warehouseId: string
  lines: IssueGoodsLine[]
  reference?: string
  referenceType?: 'sales_order' | 'manufacturing_order' | 'internal'
  notes?: string
}

export interface IssueGoodsLine {
  productId: string
  quantity: number
  batchNumber?: string
}

export interface IssueGoodsResult {
  issueId: string
  movementIds: string[]
  issuedAt: Date
}

export function createIssueGoodsCommand(
  params: Omit<IssueGoodsCommand, 'commandType' | 'timestamp'>
): IssueGoodsCommand {
  return {
    commandType: InventoryCommandTypes.ISSUE_GOODS,
    timestamp: new Date(),
    ...params
  }
}

// ===== Union Type =====

export type InventoryCommand = 
  | AdjustStockCommand
  | TransferStockCommand
  | CreateProductCommand
  | UpdateProductCommand
  | CreateReservationCommand
  | CancelReservationCommand
  | ReceiveGoodsCommand
  | IssueGoodsCommand
