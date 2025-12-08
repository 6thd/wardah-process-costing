/**
 * BuyingController - ERPNext Pattern
 * 
 * Base class for all buying documents (PO, GR, PI, etc.)
 * Inspired by erpnext.controllers.buying_controller.BuyingController
 * 
 * Features:
 * - Automatic calculation of amounts (subtotal, tax, discount, total)
 * - Vendor balance updates
 * - Purchase analytics tracking
 * - Exchange rate handling
 * 
 * Child documents must implement:
 * - getLines() - return array of document lines
 */

import { BaseController, BaseDocument } from './BaseController'
import { supabase } from '@/lib/supabase'

export interface PurchaseLine {
  product_id: string
  quantity: number
  unit_price: number
  discount_percentage?: number
  discount_amount?: number
  tax_percentage?: number
  tax_amount?: number
  line_total: number
}

export interface BuyingDocument extends BaseDocument {
  vendor_id: string
  order_date?: string
  delivery_date?: string
  subtotal?: number
  discount_total?: number
  tax_total?: number
  grand_total?: number
  payment_terms?: string
  currency?: string
  exchange_rate?: number
}

export abstract class BuyingController<T extends BuyingDocument> extends BaseController<T> {
  
  /**
   * Override this in child class to return document lines
   */
  protected abstract getLines(): Promise<PurchaseLine[]>

  /**
   * Override this in child class to get line table name
   */
  protected abstract getLineTableName(): string

  /**
   * Validate before save
   */
  protected async validate(): Promise<void> {
    await this.validateVendor()
    await this.validateLines()
    await this.calculateTotals()
  }

  /**
   * Validate vendor exists and is active
   */
  private async validateVendor(): Promise<void> {
    if (!this.doc.vendor_id) {
      throw new Error('Vendor is required')
    }

    const { data: vendor, error } = await supabase
      .from('vendors')
      .select('id, name, is_active')
      .eq('id', this.doc.vendor_id)
      .single()

    if (error || !vendor) {
      throw new Error('Invalid vendor')
    }

    if (vendor.is_active === false) {
      throw new Error(`Vendor ${vendor.name} is inactive`)
    }
  }

  /**
   * Validate document lines
   */
  private async validateLines(): Promise<void> {
    const lines = await this.getLines()

    if (!lines || lines.length === 0) {
      throw new Error('At least one line item is required')
    }

    for (const line of lines) {
      if (!line.product_id) {
        throw new Error('Product is required for all lines')
      }

      if (!line.quantity || line.quantity <= 0) {
        throw new Error('Quantity must be greater than zero')
      }

      if (!line.unit_price || line.unit_price < 0) {
        throw new Error('Unit price must be greater than or equal to zero')
      }

      // Validate product exists
      const { data: product, error } = await supabase
        .from('products')
        .select('id, name')
        .eq('id', line.product_id)
        .single()

      if (error || !product) {
        throw new Error(`Invalid product in line item`)
      }
    }
  }

  /**
   * Calculate document totals
   * ERPNext pattern: calculate_taxes_and_totals()
   */
  protected async calculateTotals(): Promise<void> {
    const lines = await this.getLines()
    let subtotal = 0
    let discountTotal = 0
    let taxTotal = 0

    for (const line of lines) {
      // Calculate line subtotal
      const lineSubtotal = line.quantity * line.unit_price

      // Calculate discount
      let discountAmount = 0
      if (line.discount_percentage) {
        discountAmount = lineSubtotal * (line.discount_percentage / 100)
      } else if (line.discount_amount) {
        discountAmount = line.discount_amount
      }

      // Amount after discount
      const amountAfterDiscount = lineSubtotal - discountAmount

      // Calculate tax
      let taxAmount = 0
      if (line.tax_percentage) {
        taxAmount = amountAfterDiscount * (line.tax_percentage / 100)
      } else if (line.tax_amount) {
        taxAmount = line.tax_amount
      }

      // Line total
      const lineTotal = amountAfterDiscount + taxAmount

      // Update line totals
      line.discount_amount = discountAmount
      line.tax_amount = taxAmount
      line.line_total = lineTotal

      // Accumulate document totals
      subtotal += lineSubtotal
      discountTotal += discountAmount
      taxTotal += taxAmount
    }

    // Set document totals
    this.doc.subtotal = subtotal
    this.doc.discount_total = discountTotal
    this.doc.tax_total = taxTotal
    this.doc.grand_total = subtotal - discountTotal + taxTotal

    // Handle exchange rate
    if (this.doc.currency && this.doc.currency !== 'SAR') {
      if (!this.doc.exchange_rate) {
        throw new Error('Exchange rate is required for foreign currency transactions')
      }
      // Convert to base currency
      this.doc.grand_total = this.doc.grand_total * this.doc.exchange_rate
    }
  }

  /**
   * Update vendor outstanding balance
   * Called on submit/cancel of Purchase Invoice
   */
  protected async updateVendorBalance(amount: number): Promise<void> {
    const { data: vendor } = await supabase
      .from('vendors')
      .select('outstanding_balance')
      .eq('id', this.doc.vendor_id)
      .single()

    const currentBalance = vendor?.outstanding_balance || 0
    const newBalance = currentBalance + amount

    const { error } = await supabase
      .from('vendors')
      .update({ 
        outstanding_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.doc.vendor_id)

    if (error) {
      throw new Error(`Failed to update vendor balance: ${error.message}`)
    }
  }

  /**
   * Get next document number
   * ERPNext pattern: naming_series
   */
  protected async getNextNumber(prefix: string = 'PO'): Promise<string> {
    // Get last document number
    const { data: lastDoc } = await supabase
      .from(this.tableName)
      .select('name')
      .ilike('name', `${prefix}-%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    let nextNum = 1
    if (lastDoc?.name) {
      const match = lastDoc.name.match(/-(\d+)$/)
      if (match) {
        nextNum = Number.parseInt(match[1], 10) + 1
      }
    }

    // Format with padding
    const paddedNum = nextNum.toString().padStart(5, '0')
    return `${prefix}-${paddedNum}`
  }

  /**
   * Set document name before save
   */
  protected async before_save(): Promise<void> {
    if (!this.doc.name && this.isNew()) {
      this.doc.name = await this.getNextNumber()
    }
  }

  /**
   * Get line items with product details
   */
  protected async getLinesWithProducts(): Promise<any[]> {
    if (!this.doc.id) return []

    const { data: lines, error } = await supabase
      .from(this.getLineTableName())
      .select(`
        *,
        product:products(id, code, name, name_ar, unit)
      `)
      .eq(this.getParentFieldName(), this.doc.id)
      .order('line_number')

    if (error) {
      throw new Error(`Failed to load lines: ${error.message}`)
    }

    return lines || []
  }

  /**
   * Get parent field name for line items
   * Override if different from table name + '_id'
   */
  protected getParentFieldName(): string {
    return `${this.tableName.slice(0, -1)}_id` // Remove 's' and add '_id'
  }

  /**
   * Calculate item-wise purchase analytics
   * Track average purchase price, last purchase date, etc.
   */
  protected async updatePurchaseAnalytics(): Promise<void> {
    const lines = await this.getLines()

    for (const line of lines) {
      // Update product's last purchase rate
      const { error } = await supabase
        .from('products')
        .update({
          last_purchase_rate: line.unit_price,
          last_purchase_date: this.doc.order_date || new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', line.product_id)

      if (error) {
        console.error('Failed to update purchase analytics:', error.message)
      }
    }
  }

  /**
   * Get purchase history for a vendor
   */
  protected async getVendorPurchaseHistory(vendorId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('vendor_id', vendorId)
      .eq('docstatus', 1) // Submitted only
      .order('order_date', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Failed to load purchase history:', error.message)
      return []
    }

    return data || []
  }
}
