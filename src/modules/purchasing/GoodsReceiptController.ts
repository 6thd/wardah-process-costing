/**
 * GoodsReceiptController - ERPNext Pattern Implementation
 * 
 * Implements StockController for Goods Receipt document
 * Automatically creates Stock Ledger Entries on submit
 */

import { StockController, StockMove } from '../core/StockController'
import { BuyingDocument } from '../core/BuyingController'
import { supabase } from '@/lib/supabase'
import { StockLedgerService } from '../inventory/StockLedgerService'

export interface GoodsReceipt extends BuyingDocument {
  receipt_number?: string
  purchase_order_id?: string
  receipt_date?: string
  warehouse_id?: string
  notes?: string
  status?: 'Draft' | 'Submitted' | 'Cancelled'
}

export interface GoodsReceiptLine {
  id?: string
  goods_receipt_id?: string
  purchase_order_line_id?: string
  product_id: string
  product_code?: string
  product_name?: string
  description?: string
  quantity: number
  unit_price: number
  line_total?: number
  received_quantity?: number
}

export class GoodsReceiptController extends StockController<GoodsReceipt> {
  private lines: GoodsReceiptLine[] = []

  constructor(doc: Partial<GoodsReceipt> = {}) {
    super('goods_receipts', doc)
  }

  /**
   * Implement getStockMoves() from StockController
   * Returns array of stock movements to create SLEs
   */
  protected async getStockMoves(): Promise<StockMove[]> {
    if (!this.doc.warehouse_id) {
      throw new Error('Warehouse is required')
    }

    await this.loadLines()

    return this.lines.map(line => ({
      product_id: line.product_id,
      warehouse_id: this.doc.warehouse_id!,
      quantity: line.quantity,  // Positive for incoming stock
      rate: line.unit_price,
      posting_date: new Date(this.doc.receipt_date || new Date()),
      voucher_type: 'Goods Receipt',
      voucher_id: this.doc.id!
    }))
  }

  /**
   * Load lines from database
   */
  private async loadLines(): Promise<void> {
    if (!this.doc.id) return

    const { data, error } = await supabase
      .from('goods_receipt_lines')
      .select(`
        *,
        product:products(id, code, name, name_ar, unit)
      `)
      .eq('goods_receipt_id', this.doc.id)
      .order('line_number')

    if (error) {
      throw new Error(`Failed to load GR lines: ${error.message}`)
    }

    this.lines = (data || []).map(line => ({
      ...line,
      product_code: line.product?.code,
      product_name: line.product?.name
    }))
  }

  /**
   * Set lines (for new documents)
   */
  setLines(lines: GoodsReceiptLine[]): void {
    this.lines = lines
  }

  /**
   * Override validate to add GR-specific validations
   */
  protected async validate(): Promise<void> {
    if (!this.doc.vendor_id) {
      throw new Error('Vendor is required')
    }

    if (!this.doc.warehouse_id) {
      throw new Error('Warehouse is required')
    }

    if (!this.doc.receipt_date) {
      throw new Error('Receipt date is required')
    }

    if (!this.lines || this.lines.length === 0) {
      throw new Error('At least one line item is required')
    }

    // Validate each line
    for (const line of this.lines) {
      if (!line.product_id) {
        throw new Error('Product is required for all lines')
      }

      if (!line.quantity || line.quantity <= 0) {
        throw new Error('Quantity must be greater than zero')
      }

      if (!line.unit_price || line.unit_price < 0) {
        throw new Error('Unit price cannot be negative')
      }
    }

    // If GR is from PO, validate against PO quantities
    if (this.doc.purchase_order_id) {
      await this.validateAgainstPO()
    }
  }

  /**
   * Validate GR quantities against PO
   */
  private async validateAgainstPO(): Promise<void> {
    const { data: poLines, error } = await supabase
      .from('purchase_order_lines')
      .select('*')
      .eq('purchase_order_id', this.doc.purchase_order_id!)

    if (error) {
      throw new Error(`Failed to load PO lines: ${error.message}`)
    }

    for (const grLine of this.lines) {
      if (grLine.purchase_order_line_id) {
        const poLine = poLines?.find(pl => pl.id === grLine.purchase_order_line_id)
        
        if (!poLine) {
          throw new Error(`PO line ${grLine.purchase_order_line_id} not found`)
        }

        const receivedQty = poLine.received_quantity || 0
        const remainingQty = poLine.quantity - receivedQty

        if (grLine.quantity > remainingQty) {
          throw new Error(
            `Cannot receive more than ordered. ` +
            `Ordered: ${poLine.quantity}, Already Received: ${receivedQty}, ` +
            `Remaining: ${remainingQty}, Trying to receive: ${grLine.quantity}`
          )
        }
      }
    }
  }

  /**
   * Override before_save to set receipt number
   */
  protected async before_save(): Promise<void> {
    if (!this.doc.receipt_number && this.isNew()) {
      this.doc.receipt_number = await this.getNextNumber('GR')
      this.doc.name = this.doc.receipt_number
    }

    // Set initial status
    if (this.isNew()) {
      this.doc.status = 'Draft'
    }

    // Calculate line totals
    for (const line of this.lines) {
      line.line_total = line.quantity * line.unit_price
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
      .from('goods_receipt_lines')
      .delete()
      .eq('goods_receipt_id', this.doc.id)

    // Insert new lines
    const linesToInsert = this.lines.map((line, index) => ({
      ...line,
      goods_receipt_id: this.doc.id,
      line_number: index + 1
    }))

    const { error } = await supabase
      .from('goods_receipt_lines')
      .insert(linesToInsert)

    if (error) {
      throw new Error(`Failed to save GR lines: ${error.message}`)
    }
  }

  /**
   * Get next document number
   */
  private async getNextNumber(prefix: string = 'GR'): Promise<string> {
    const { data: lastDoc } = await supabase
      .from('goods_receipts')
      .select('receipt_number')
      .ilike('receipt_number', `${prefix}-%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    let nextNum = 1
    if (lastDoc?.receipt_number) {
      const match = lastDoc.receipt_number.match(/-(\d+)$/)
      if (match) {
        nextNum = parseInt(match[1]) + 1
      }
    }

    return `${prefix}-${nextNum.toString().padStart(5, '0')}`
  }

  /**
   * Override on_submit to create Stock Ledger Entries
   * This calls parent StockController.on_submit() which creates SLEs
   */
  protected async on_submit(): Promise<void> {
    // Parent class will create SLEs and update bins
    await super.on_submit()

    // Update PO received quantities
    if (this.doc.purchase_order_id) {
      await this.updatePOReceivedQuantities()
    }

    // Update product stock quantities (for backward compatibility)
    await this.updateProductStockQuantities()

    this.doc.status = 'Submitted'
  }

  /**
   * Override on_cancel to reverse Stock Ledger Entries
   */
  protected async on_cancel(): Promise<void> {
    // Parent class will reverse SLEs
    await super.on_cancel()

    // Reverse PO received quantities
    if (this.doc.purchase_order_id) {
      await this.updatePOReceivedQuantities(true)
    }

    // Reverse product stock quantities
    await this.updateProductStockQuantities(true)

    this.doc.status = 'Cancelled'
  }

  /**
   * Update PO received quantities
   */
  private async updatePOReceivedQuantities(reverse: boolean = false): Promise<void> {
    for (const line of this.lines) {
      if (line.purchase_order_line_id) {
        // Get current received quantity
        const { data: poLine } = await supabase
          .from('purchase_order_lines')
          .select('received_quantity, quantity')
          .eq('id', line.purchase_order_line_id)
          .single()

        if (poLine) {
          const currentReceived = poLine.received_quantity || 0
          const newReceived = reverse 
            ? currentReceived - line.quantity 
            : currentReceived + line.quantity

          await supabase
            .from('purchase_order_lines')
            .update({
              received_quantity: newReceived,
              updated_at: new Date().toISOString()
            })
            .eq('id', line.purchase_order_line_id)

          // Update PO status
          const percentReceived = (newReceived / poLine.quantity) * 100
          let poStatus = 'Submitted'
          if (percentReceived > 0 && percentReceived < 100) {
            poStatus = 'Partially Received'
          } else if (percentReceived >= 100) {
            poStatus = 'Fully Received'
          }

          await supabase
            .from('purchase_orders')
            .update({
              status: poStatus,
              updated_at: new Date().toISOString()
            })
            .eq('id', this.doc.purchase_order_id)
        }
      }
    }
  }

  /**
   * Update product stock quantities (for backward compatibility)
   * In Phase 2, we rely on Bins, but keep products.stock_quantity in sync
   */
  private async updateProductStockQuantities(reverse: boolean = false): Promise<void> {
    for (const line of this.lines) {
      // Get current stock from products table
      const { data: product } = await supabase
        .from('products')
        .select('stock_quantity')
        .eq('id', line.product_id)
        .single()

      if (product) {
        const currentStock = product.stock_quantity || 0
        const newStock = reverse 
          ? currentStock - line.quantity 
          : currentStock + line.quantity

        await supabase
          .from('products')
          .update({
            stock_quantity: newStock,
            updated_at: new Date().toISOString()
          })
          .eq('id', line.product_id)
      }
    }
  }

  /**
   * Create Stock Entries using StockLedgerService
   * This is called internally by StockController.on_submit()
   */
  private async createStockEntries(): Promise<void> {
    await this.loadLines()

    for (const line of this.lines) {
      await StockLedgerService.createEntry({
        voucher_type: 'Goods Receipt',
        voucher_id: this.doc.id!,
        voucher_number: this.doc.receipt_number,
        product_id: line.product_id,
        warehouse_id: this.doc.warehouse_id!,
        posting_date: this.doc.receipt_date || new Date().toISOString().split('T')[0],
        actual_qty: line.quantity,
        incoming_rate: line.unit_price,
        org_id: this.doc.org_id
      })
    }
  }

  /**
   * Get GR with lines (for display)
   */
  async loadWithLines(): Promise<{ gr: GoodsReceipt; lines: GoodsReceiptLine[] }> {
    await this.loadLines()
    return {
      gr: this.doc as GoodsReceipt,
      lines: this.lines
    }
  }

  /**
   * Create Purchase Invoice from this Goods Receipt
   */
  async createPurchaseInvoice(): Promise<string> {
    if (this.doc.docstatus !== 1) {
      throw new Error('Can only create Purchase Invoice from submitted Goods Receipt')
    }

    await this.loadLines()

    // Create Purchase Invoice
    const piData = {
      goods_receipt_id: this.doc.id,
      purchase_order_id: this.doc.purchase_order_id,
      vendor_id: this.doc.vendor_id,
      invoice_date: new Date().toISOString().split('T')[0],
      docstatus: 0,
      status: 'Draft'
    }

    const { data: pi, error: piError } = await supabase
      .from('purchase_invoices')
      .insert(piData)
      .select()
      .single()

    if (piError) {
      throw new Error(`Failed to create Purchase Invoice: ${piError.message}`)
    }

    // Create PI lines
    const piLines = this.lines.map((line, index) => ({
      purchase_invoice_id: pi.id,
      goods_receipt_line_id: line.id,
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      line_total: line.line_total,
      line_number: index + 1
    }))

    const { error: lineError } = await supabase
      .from('purchase_invoice_lines')
      .insert(piLines)

    if (lineError) {
      throw new Error(`Failed to create PI lines: ${lineError.message}`)
    }

    return pi.id
  }
}

/**
 * Factory method
 */
export async function createGoodsReceipt(id?: string): Promise<GoodsReceiptController> {
  const controller = new GoodsReceiptController()
  
  if (id) {
    await controller.load(id)
  }
  
  return controller
}
