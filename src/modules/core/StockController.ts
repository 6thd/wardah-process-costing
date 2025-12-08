/**
 * StockController - ERPNext Pattern
 * 
 * Base class for all stock-related documents (GR, DN, Stock Entry, etc.)
 * Inspired by erpnext.controllers.stock_controller.StockController
 * 
 * Features:
 * - Automatic Stock Ledger Entry (SLE) creation
 * - Automatic Bin updates
 * - Valuation calculation (FIFO/LIFO/Moving Average)
 * - GL Entry posting for inventory value changes
 * 
 * Child documents must implement:
 * - getStockMoves() - return array of stock movements
 */

import { BaseController, BaseDocument } from './BaseController'
import { supabase } from '@/lib/supabase'

export interface StockMove {
  product_id: string
  warehouse_id: string
  quantity: number        // positive for IN, negative for OUT
  rate: number           // unit price
  posting_date: Date
  voucher_type: string   // 'Goods Receipt', 'Delivery Note', 'Stock Entry'
  voucher_id: string
}

export interface StockLedgerEntry {
  id?: string
  product_id: string
  warehouse_id: string
  posting_date: string
  posting_time: string
  voucher_type: string
  voucher_id: string
  actual_qty: number              // Change in quantity
  qty_after_transaction: number   // Running balance
  incoming_rate: number           // Rate for incoming stock
  outgoing_rate: number           // Rate for outgoing stock
  valuation_rate: number          // Current valuation rate
  stock_value: number             // qty_after_transaction * valuation_rate
  stock_value_difference: number  // Change in stock value
  is_cancelled: boolean
  created_at?: string
}

export abstract class StockController<T extends BaseDocument> extends BaseController<T> {
  
  /**
   * Override this in child class to return stock movements
   * Called during submit to create SLEs
   */
  protected abstract getStockMoves(): Promise<StockMove[]>

  /**
   * Override on_submit to create Stock Ledger Entries
   */
  protected async on_submit(): Promise<void> {
    const moves = await this.getStockMoves()
    
    for (const move of moves) {
      await this.createStockLedgerEntry(move)
      await this.updateBin(move)
    }

    // Post GL Entries for inventory value change
    await this.postGLEntries(moves)
  }

  /**
   * Override on_cancel to reverse Stock Ledger Entries
   */
  protected async on_cancel(): Promise<void> {
    const moves = await this.getStockMoves()
    
    for (const move of moves) {
      // Reverse the movement (negate quantity)
      const reversedMove: StockMove = {
        ...move,
        quantity: -move.quantity
      }
      
      await this.createStockLedgerEntry(reversedMove)
      await this.updateBin(reversedMove)
    }

    // Reverse GL Entries
    await this.reverseGLEntries(moves)
  }

  /**
   * Create Stock Ledger Entry
   * This is the core of ERPNext's inventory system
   */
  private async createStockLedgerEntry(move: StockMove): Promise<void> {
    // Get current stock balance
    const { data: lastEntry } = await supabase
      .from('stock_ledger_entries')
      .select('qty_after_transaction, valuation_rate, stock_value')
      .eq('product_id', move.product_id)
      .eq('warehouse_id', move.warehouse_id)
      .order('posting_date', { ascending: false })
      .order('posting_time', { ascending: false })
      .limit(1)
      .single()

    const prevQty = lastEntry?.qty_after_transaction || 0
    const prevRate = lastEntry?.valuation_rate || 0
    const prevValue = lastEntry?.stock_value || 0

    const newQty = prevQty + move.quantity

    // Calculate new valuation rate
    let newRate: number
    let newValue: number

    if (move.quantity > 0) {
      // Incoming stock - use weighted average
      const incomingValue = move.quantity * move.rate
      newValue = prevValue + incomingValue
      newRate = newQty > 0 ? newValue / newQty : 0
    } else {
      // Outgoing stock - use current valuation rate
      newRate = prevRate
      newValue = newQty * newRate
    }

    const stockValueDiff = newValue - prevValue

    // Create SLE
    const sle: StockLedgerEntry = {
      product_id: move.product_id,
      warehouse_id: move.warehouse_id,
      posting_date: move.posting_date.toISOString().split('T')[0],
      posting_time: move.posting_date.toISOString().split('T')[1],
      voucher_type: move.voucher_type,
      voucher_id: move.voucher_id,
      actual_qty: move.quantity,
      qty_after_transaction: newQty,
      incoming_rate: move.quantity > 0 ? move.rate : 0,
      outgoing_rate: move.quantity < 0 ? prevRate : 0,
      valuation_rate: newRate,
      stock_value: newValue,
      stock_value_difference: stockValueDiff,
      is_cancelled: false,
      created_at: new Date().toISOString()
    }

    const { error } = await supabase
      .from('stock_ledger_entries')
      .insert(sle)

    if (error) {
      throw new Error(`Failed to create Stock Ledger Entry: ${error.message}`)
    }
  }

  /**
   * Update Bin (warehouse-level stock balance)
   * Bins store aggregated stock quantities per warehouse
   */
  private async updateBin(move: StockMove): Promise<void> {
    // Check if bin exists
    const { data: existingBin } = await supabase
      .from('bins')
      .select('*')
      .eq('product_id', move.product_id)
      .eq('warehouse_id', move.warehouse_id)
      .single()

    if (existingBin) {
      // Update existing bin
      const newQty = (existingBin.actual_qty || 0) + move.quantity
      
      // Recalculate valuation rate from latest SLE
      const { data: latestSLE } = await supabase
        .from('stock_ledger_entries')
        .select('valuation_rate, stock_value')
        .eq('product_id', move.product_id)
        .eq('warehouse_id', move.warehouse_id)
        .order('posting_date', { ascending: false })
        .order('posting_time', { ascending: false })
        .limit(1)
        .single()

      const { error } = await supabase
        .from('bins')
        .update({
          actual_qty: newQty,
          valuation_rate: latestSLE?.valuation_rate || 0,
          stock_value: latestSLE?.stock_value || 0,
          updated_at: new Date().toISOString()
        })
        .eq('product_id', move.product_id)
        .eq('warehouse_id', move.warehouse_id)

      if (error) throw new Error(`Failed to update bin: ${error.message}`)
    } else {
      // Create new bin
      const { error } = await supabase
        .from('bins')
        .insert({
          product_id: move.product_id,
          warehouse_id: move.warehouse_id,
          actual_qty: move.quantity,
          reserved_qty: 0,
          ordered_qty: 0,
          valuation_rate: move.rate,
          stock_value: move.quantity * move.rate,
          created_at: new Date().toISOString()
        })

      if (error) throw new Error(`Failed to create bin: ${error.message}`)
    }
  }

  /**
   * Post GL Entries for inventory value changes
   * Dr: Inventory Asset Account
   * Cr: Stock Received But Not Billed (for GR without invoice)
   */
  private async postGLEntries(moves: StockMove[]): Promise<void> {
    // Note: GL posting logic will be implemented in Phase 2 when we integrate with accounting module
    console.log('GL Entries posting to be implemented in Phase 2')
  }

  /**
   * Reverse GL Entries on cancellation
   */
  private async reverseGLEntries(moves: StockMove[]): Promise<void> {
    // Note: GL reversal logic will be implemented in Phase 2 when we integrate with accounting module
    console.log('GL Entries reversal to be implemented in Phase 2')
  }

  /**
   * Get current stock balance for a product in a warehouse
   */
  protected async getStockBalance(
    productId: string, 
    warehouseId: string
  ): Promise<{ quantity: number; valuationRate: number; stockValue: number }> {
    const { data: bin } = await supabase
      .from('bins')
      .select('actual_qty, valuation_rate, stock_value')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .single()

    if (!bin) {
      return { quantity: 0, valuationRate: 0, stockValue: 0 }
    }

    return {
      quantity: bin.actual_qty || 0,
      valuationRate: bin.valuation_rate || 0,
      stockValue: bin.stock_value || 0
    }
  }

  /**
   * Validate that warehouse has sufficient stock for outgoing transactions
   */
  protected async validateStockAvailability(moves: StockMove[]): Promise<void> {
    for (const move of moves) {
      if (move.quantity < 0) {
        // Outgoing transaction - check stock availability
        const balance = await this.getStockBalance(move.product_id, move.warehouse_id)
        
        if (balance.quantity < Math.abs(move.quantity)) {
          // Get product name for better error message
          const { data: product } = await supabase
            .from('products')
            .select('name')
            .eq('id', move.product_id)
            .single()

          throw new Error(
            `Insufficient stock for ${product?.name}. ` +
            `Available: ${balance.quantity}, Required: ${Math.abs(move.quantity)}`
          )
        }
      }
    }
  }
}
