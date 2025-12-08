/**
 * PurchaseOrderController - ERPNext Pattern Implementation
 * 
 * Example implementation using BuyingController
 * Shows how to extend base controllers for specific documents
 */

import { BuyingController, BuyingDocument, PurchaseLine } from '../core/BuyingController'
import { supabase } from '@/lib/supabase'

export interface PurchaseOrder extends BuyingDocument {
  order_number?: string
  expected_delivery_date?: string
  shipping_address?: string
  notes?: string
  status?: 'Draft' | 'Submitted' | 'Partially Received' | 'Fully Received' | 'Cancelled'
}

export interface PurchaseOrderLine extends PurchaseLine {
  id?: string
  purchase_order_id?: string
  product_code?: string
  product_name?: string
  description?: string
  received_quantity?: number
  invoiced_quantity?: number
}

export class PurchaseOrderController extends BuyingController<PurchaseOrder> {
  private lines: PurchaseOrderLine[] = []

  constructor(doc: Partial<PurchaseOrder> = {}) {
    super('purchase_orders', doc)
  }

  /**
   * Implement getLines() from BuyingController
   */
  protected async getLines(): Promise<PurchaseLine[]> {
    if (this.doc.id && this.lines.length === 0) {
      await this.loadLines()
    }
    return this.lines
  }

  /**
   * Implement getLineTableName() from BuyingController
   */
  protected getLineTableName(): string {
    return 'purchase_order_lines'
  }

  /**
   * Load lines from database
   */
  private async loadLines(): Promise<void> {
    if (!this.doc.id) return

    const { data, error } = await supabase
      .from('purchase_order_lines')
      .select('*')
      .eq('purchase_order_id', this.doc.id)
      .order('line_number')

    if (error) {
      throw new Error(`Failed to load PO lines: ${error.message}`)
    }

    this.lines = data || []
  }

  /**
   * Set lines (for new documents)
   */
  setLines(lines: PurchaseOrderLine[]): void {
    this.lines = lines
  }

  /**
   * Override validate to add PO-specific validations
   */
  protected async validate(): Promise<void> {
    // Call parent validation
    await super.validate()

    // PO-specific validations
    if (this.doc.expected_delivery_date) {
      const deliveryDate = new Date(this.doc.expected_delivery_date)
      const orderDate = new Date(this.doc.order_date || new Date())

      if (deliveryDate < orderDate) {
        throw new Error('Expected delivery date cannot be before order date')
      }
    }
  }

  /**
   * Override before_save to set order number
   */
  protected async before_save(): Promise<void> {
    await super.before_save()

    if (!this.doc.order_number && this.isNew()) {
      this.doc.order_number = await this.getNextNumber('PO')
      this.doc.name = this.doc.order_number
    }

    // Set initial status
    if (this.isNew()) {
      this.doc.status = 'Draft'
    }
  }

  /**
   * Override after_save to save lines
   */
  protected async after_save(): Promise<void> {
    await this.saveLines()
  }

  /**
   * Save lines to database
   */
  private async saveLines(): Promise<void> {
    if (!this.doc.id || this.lines.length === 0) return

    // Delete existing lines
    await supabase
      .from('purchase_order_lines')
      .delete()
      .eq('purchase_order_id', this.doc.id)

    // Insert new lines
    const linesToInsert = this.lines.map((line, index) => ({
      ...line,
      purchase_order_id: this.doc.id,
      line_number: index + 1,
      received_quantity: line.received_quantity || 0,
      invoiced_quantity: line.invoiced_quantity || 0
    }))

    const { error } = await supabase
      .from('purchase_order_lines')
      .insert(linesToInsert)

    if (error) {
      throw new Error(`Failed to save PO lines: ${error.message}`)
    }
  }

  /**
   * Override on_submit
   */
  protected async on_submit(): Promise<void> {
    this.doc.status = 'Submitted'
    await this.updatePurchaseAnalytics()
  }

  /**
   * Override on_cancel
   */
  protected async on_cancel(): Promise<void> {
    // Check if any Goods Receipt created
    const { data: goodsReceipts, error } = await supabase
      .from('goods_receipts')
      .select('id')
      .eq('purchase_order_id', this.doc.id)
      .eq('docstatus', 1)
      .limit(1)

    if (error) {
      throw new Error(`Failed to check for goods receipts: ${error.message}`)
    }

    if (goodsReceipts && goodsReceipts.length > 0) {
      throw new Error('Cannot cancel Purchase Order with submitted Goods Receipts')
    }

    this.doc.status = 'Cancelled'
  }

  /**
   * Get receipt status (how much has been received)
   */
  async getReceiptStatus(): Promise<{
    totalQty: number
    receivedQty: number
    percentageReceived: number
    status: string
  }> {
    await this.loadLines()

    let totalQty = 0
    let receivedQty = 0

    for (const line of this.lines) {
      totalQty += line.quantity
      receivedQty += line.received_quantity || 0
    }

    const percentageReceived = totalQty > 0 ? (receivedQty / totalQty) * 100 : 0

    let status: string
    if (percentageReceived === 0) {
      status = 'Submitted'
    } else if (percentageReceived < 100) {
      status = 'Partially Received'
    } else {
      status = 'Fully Received'
    }

    return { totalQty, receivedQty, percentageReceived, status }
  }

  /**
   * Update received quantities (called from Goods Receipt)
   */
  async updateReceivedQuantities(lineUpdates: { lineId: string; receivedQty: number }[]): Promise<void> {
    for (const update of lineUpdates) {
      const { error } = await supabase
        .from('purchase_order_lines')
        .update({ 
          received_quantity: update.receivedQty,
          updated_at: new Date().toISOString()
        })
        .eq('id', update.lineId)

      if (error) {
        throw new Error(`Failed to update received quantity: ${error.message}`)
      }
    }

    // Update PO status based on receipt status
    const receiptStatus = await this.getReceiptStatus()
    
    const { error } = await supabase
      .from('purchase_orders')
      .update({ 
        status: receiptStatus.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.doc.id)

    if (error) {
      throw new Error(`Failed to update PO status: ${error.message}`)
    }
  }

  /**
   * Create Goods Receipt from this Purchase Order
   * Returns the GR ID
   */
  async createGoodsReceipt(selectedLines?: string[]): Promise<string> {
    if (this.doc.docstatus !== 1) {
      throw new Error('Can only create Goods Receipt from submitted Purchase Order')
    }

    await this.loadLines()

    // Filter lines if specific lines selected
    let linesToReceive = this.lines
    if (selectedLines && selectedLines.length > 0) {
      linesToReceive = this.lines.filter(line => line.id && selectedLines.includes(line.id))
    }

    // Filter out fully received lines
    linesToReceive = linesToReceive.filter(line => {
      const remainingQty = line.quantity - (line.received_quantity || 0)
      return remainingQty > 0
    })

    if (linesToReceive.length === 0) {
      throw new Error('No lines available for receipt')
    }

    // Create Goods Receipt
    const grData = {
      purchase_order_id: this.doc.id,
      vendor_id: this.doc.vendor_id,
      receipt_date: new Date().toISOString().split('T')[0],
      docstatus: 0,
      status: 'Draft'
    }

    const { data: gr, error: grError } = await supabase
      .from('goods_receipts')
      .insert(grData)
      .select()
      .single()

    if (grError) {
      throw new Error(`Failed to create Goods Receipt: ${grError.message}`)
    }

    // Create GR lines
    const grLines = linesToReceive.map((line, index) => ({
      goods_receipt_id: gr.id,
      purchase_order_line_id: line.id,
      product_id: line.product_id,
      quantity: line.quantity - (line.received_quantity || 0), // Remaining quantity
      unit_price: line.unit_price,
      line_number: index + 1
    }))

    const { error: lineError } = await supabase
      .from('goods_receipt_lines')
      .insert(grLines)

    if (lineError) {
      throw new Error(`Failed to create GR lines: ${lineError.message}`)
    }

    return gr.id
  }
}

// ==================== Factory Method ====================

/**
 * Create PurchaseOrderController instance
 * Usage: const po = await PurchaseOrderController.create(id)
 */
export async function createPurchaseOrder(id?: string): Promise<PurchaseOrderController> {
  const controller = new PurchaseOrderController()
  
  if (id) {
    await controller.load(id)
  }
  
  return controller
}
