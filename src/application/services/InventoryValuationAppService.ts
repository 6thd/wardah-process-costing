/**
 * Inventory Valuation Application Service
 * 
 * High-level service that provides convenient methods for inventory
 * valuation operations. This service wraps the repository and adds
 * business-level operations like receivePurchase, shipSales, etc.
 * 
 * @layer Application
 * @pattern Facade Pattern
 */

import type { IInventoryValuationRepository, InventoryMovementInput } from '@/domain/interfaces/IInventoryValuationRepository'

export class InventoryValuationAppService {
  constructor(private readonly repository: IInventoryValuationRepository) {}

  /**
   * Purchase receipt - add inventory with purchase cost
   */
  async receivePurchase({
    itemId,
    quantity,
    unitCost,
    purchaseOrderId = null,
    lotNumber = null,
    expiryDate = null,
    notes = null
  }: {
    itemId: string
    quantity: number
    unitCost: number
    purchaseOrderId?: string | null
    lotNumber?: string | null
    expiryDate?: string | null
    notes?: string | null
  }) {
    this.validatePositiveNumber(quantity, 'Quantity')
    this.validatePositiveNumber(unitCost, 'Unit Cost')

    return await this.repository.recordInventoryMovement({
      itemId,
      moveType: 'PURCHASE_IN',
      refType: 'PO',
      refId: purchaseOrderId,
      qtyIn: quantity,
      unitCost,
      lotNumber,
      expiryDate,
      notes
    })
  }

  /**
   * Production receipt - add inventory from manufacturing
   */
  async receiveProduction({
    itemId,
    quantity,
    unitCost,
    manufacturingOrderId,
    batchNumber = null,
    notes = null
  }: {
    itemId: string
    quantity: number
    unitCost: number
    manufacturingOrderId: string
    batchNumber?: string | null
    notes?: string | null
  }) {
    this.validatePositiveNumber(quantity, 'Quantity')
    this.validatePositiveNumber(unitCost, 'Unit Cost')

    return await this.repository.recordInventoryMovement({
      itemId,
      moveType: 'PROD_IN',
      refType: 'MO',
      refId: manufacturingOrderId,
      refNumber: batchNumber,
      qtyIn: quantity,
      unitCost,
      notes
    })
  }

  /**
   * Sales shipment - reduce inventory for sales (COGS calculated by valuation method)
   */
  async shipSales({
    itemId,
    quantity,
    salesOrderId = null,
    notes = null
  }: {
    itemId: string
    quantity: number
    salesOrderId?: string | null
    notes?: string | null
  }) {
    this.validatePositiveNumber(quantity, 'Quantity')

    return await this.repository.recordInventoryMovement({
      itemId,
      moveType: 'SALE_OUT',
      refType: 'SO',
      refId: salesOrderId,
      qtyOut: quantity,
      notes
    })
  }

  /**
   * Manufacturing consumption - reduce inventory for production
   */
  async consumeForManufacturing({
    itemId,
    quantity,
    manufacturingOrderId,
    stageNumber = null,
    notes = null
  }: {
    itemId: string
    quantity: number
    manufacturingOrderId: string
    stageNumber?: number | null
    notes?: string | null
  }) {
    this.validatePositiveNumber(quantity, 'Quantity')

    return await this.repository.recordInventoryMovement({
      itemId,
      moveType: 'MO_CONS',
      refType: 'MO',
      refId: manufacturingOrderId,
      refNumber: stageNumber ? `Stage ${stageNumber}` : null,
      qtyOut: quantity,
      notes
    })
  }

  /**
   * Inventory adjustment - positive or negative adjustment
   */
  async adjustInventory({
    itemId,
    adjustmentQty,
    adjustmentCost = null,
    reason = null,
    notes = null
  }: {
    itemId: string
    adjustmentQty: number
    adjustmentCost?: number | null
    reason?: string | null
    notes?: string | null
  }) {
    if (adjustmentQty === 0) {
      throw new Error('Adjustment quantity cannot be zero')
    }

    const isPositive = adjustmentQty > 0
    const moveType = isPositive ? 'ADJ_IN' : 'ADJ_OUT'
    const qtyIn = isPositive ? adjustmentQty : 0
    const qtyOut = isPositive ? 0 : Math.abs(adjustmentQty)

    return await this.repository.recordInventoryMovement({
      itemId,
      moveType,
      refType: 'ADJ',
      qtyIn,
      qtyOut,
      unitCost: adjustmentCost || 0,
      notes: reason ? `${reason}: ${notes || ''}` : notes
    })
  }

  /**
   * Get product batches for FIFO/LIFO products
   */
  async getProductBatches(itemId: string) {
    if (!itemId) {
      throw new Error('Item ID is required')
    }

    return await this.repository.getProductBatches(itemId)
  }

  /**
   * Simulate COGS calculation without actually issuing stock
   */
  async simulateCOGS(itemId: string, quantity: number) {
    if (!itemId) {
      throw new Error('Item ID is required')
    }

    this.validatePositiveNumber(quantity, 'Quantity')

    return await this.repository.simulateCOGS(itemId, quantity)
  }

  /**
   * Get inventory valuation by method
   */
  async getInventoryValuationByMethod() {
    return await this.repository.getInventoryValuationByMethod()
  }

  /**
   * Get item valuation data
   */
  async getItemValuation(itemId: string) {
    if (!itemId) {
      throw new Error('Item ID is required')
    }

    return await this.repository.getItemValuation(itemId)
  }

  /**
   * Private helper: validate positive number
   */
  private validatePositiveNumber(value: number, fieldName: string): void {
    if (value <= 0) {
      throw new Error(`${fieldName} must be positive`)
    }
  }
}

// ⚠️ NOTE: For production use, prefer the DI Container version from 
// '@/infrastructure/di/container' which auto-initializes properly.
// These functions are kept for testing purposes only.

// Singleton instance (optional, for testing - prefer DI Container in production)
let instance: InventoryValuationAppService | null = null

/**
 * @deprecated Use getInventoryValuationService from '@/infrastructure/di/container' instead.
 * This version requires manual initialization and throws if not initialized.
 */
export function getInventoryValuationServiceInstance(): InventoryValuationAppService {
  if (!instance) {
    throw new Error('InventoryValuationAppService not initialized. Use DI Container instead.')
  }
  return instance
}

export function setInventoryValuationService(service: InventoryValuationAppService): void {
  instance = service
}

export function resetInventoryValuationService(): void {
  instance = null
}
