/**
 * StockLedgerService - ERPNext Pattern
 * 
 * Service for managing Stock Ledger Entries (SLE) and Bins
 * This is the CORE of the inventory system
 * 
 * Key Concepts:
 * 1. Every stock movement creates an SLE
 * 2. SLEs maintain running balance (qty_after_transaction)
 * 3. Bins store aggregated balances per warehouse
 * 4. Valuation rates are calculated using weighted average
 * 5. Stock queue supports FIFO/LIFO (Phase 3)
 */

import { supabase } from '@/lib/supabase'

export interface StockLedgerEntry {
  id?: string
  voucher_type: string          // 'Goods Receipt', 'Delivery Note', 'Stock Entry'
  voucher_id: string
  voucher_number?: string
  product_id: string
  warehouse_id: string
  posting_date: string           // ISO date string
  posting_time?: string          // HH:MM:SS
  actual_qty: number             // +ve for IN, -ve for OUT
  qty_after_transaction?: number // Running balance (calculated)
  incoming_rate?: number         // Rate for incoming stock
  outgoing_rate?: number         // Rate for outgoing stock
  valuation_rate?: number        // Calculated weighted average
  stock_value?: number           // qty_after_transaction * valuation_rate
  stock_value_difference?: number
  stock_queue?: Array<[number, number]>  // [[qty, rate], ...]
  batch_no?: string
  serial_nos?: string[]
  is_cancelled?: boolean
  docstatus?: number
  org_id?: string
}

export interface Bin {
  id?: string
  product_id: string
  warehouse_id: string
  actual_qty: number
  reserved_qty: number
  ordered_qty: number
  planned_qty: number
  projected_qty?: number         // Calculated
  valuation_rate: number
  stock_value: number
  stock_queue?: Array<[number, number]>
  org_id?: string
}

export interface StockBalance {
  quantity: number
  valuation_rate: number
  stock_value: number
}

export class StockLedgerService {
  
  /**
   * Create Stock Ledger Entry
   * This is the main method for recording stock movements
   */
  static async createEntry(entry: StockLedgerEntry): Promise<StockLedgerEntry> {
    // Validate entry
    this.validateEntry(entry)

    // Get previous balance
    const prevBalance = await this.getLastSLE(
      entry.product_id,
      entry.warehouse_id,
      entry.posting_date,
      entry.posting_time || '23:59:59'
    )

    const prevQty = prevBalance?.qty_after_transaction || 0
    const prevRate = prevBalance?.valuation_rate || 0
    const prevValue = prevBalance?.stock_value || 0

    // Calculate new balance
    const newQty = prevQty + entry.actual_qty

    // Calculate new valuation rate
    let newRate: number
    let newValue: number
    let stockQueue: Array<[number, number]> = prevBalance?.stock_queue || []

    if (entry.actual_qty > 0) {
      // INCOMING: Calculate weighted average
      const incomingRate = entry.incoming_rate || entry.valuation_rate || 0
      const incomingValue = entry.actual_qty * incomingRate
      newValue = prevValue + incomingValue
      newRate = newQty > 0 ? newValue / newQty : 0

      // Update stock queue (for FIFO/LIFO in Phase 3)
      stockQueue.push([entry.actual_qty, incomingRate])
      
      entry.incoming_rate = incomingRate
      entry.outgoing_rate = 0
    } else {
      // OUTGOING: Use current valuation rate
      newRate = prevRate
      newValue = newQty * newRate

      // Note: Phase 3 - FIFO/LIFO queue consumption will be implemented later
      
      entry.incoming_rate = 0
      entry.outgoing_rate = prevRate
    }

    const stockValueDiff = newValue - prevValue

    // Set calculated values
    entry.qty_after_transaction = newQty
    entry.valuation_rate = newRate
    entry.stock_value = newValue
    entry.stock_value_difference = stockValueDiff
    entry.stock_queue = stockQueue
    entry.is_cancelled = false
    entry.docstatus = 1

    // Set posting time if not provided
    if (!entry.posting_time) {
      entry.posting_time = new Date().toTimeString().split(' ')[0]
    }

    // Insert SLE
    const { data, error } = await supabase
      .from('stock_ledger_entries')
      .insert(entry)
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create Stock Ledger Entry: ${error.message}`)
    }

    // Update Bin
    await this.updateBin(entry.product_id, entry.warehouse_id)

    // Check for negative stock
    if (newQty < 0) {
      console.warn(`⚠️  Negative stock detected: Product ${entry.product_id}, Qty: ${newQty}`)
      // In production, you might want to throw an error here
    }

    return data as StockLedgerEntry
  }

  /**
   * Get last SLE for product-warehouse before given date/time
   */
  private static async getLastSLE(
    productId: string,
    warehouseId: string,
    postingDate: string,
    postingTime: string = '23:59:59'
  ): Promise<StockLedgerEntry | null> {
    const { data, error } = await supabase
      .from('stock_ledger_entries')
      .select('*')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .eq('is_cancelled', false)
      .or(`posting_date.lt.${postingDate},and(posting_date.eq.${postingDate},posting_time.lte.${postingTime})`)
      .order('posting_date', { ascending: false })
      .order('posting_time', { ascending: false })
      .limit(1)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      throw new Error(`Failed to get last SLE: ${error.message}`)
    }

    return data as StockLedgerEntry | null
  }

  /**
   * Update Bin (aggregated balance)
   */
  private static async updateBin(productId: string, warehouseId: string): Promise<void> {
    // Get latest SLE for this product-warehouse
    const { data: latestSLE } = await supabase
      .from('stock_ledger_entries')
      .select('qty_after_transaction, valuation_rate, stock_value, stock_queue')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .eq('is_cancelled', false)
      .order('posting_date', { ascending: false })
      .order('posting_time', { ascending: false })
      .limit(1)
      .single()

    if (!latestSLE) {
      // No SLEs found - bin should have zero stock
      await this.ensureBinExists(productId, warehouseId)
      
      await supabase
        .from('bins')
        .update({
          actual_qty: 0,
          valuation_rate: 0,
          stock_value: 0,
          stock_queue: [],
          updated_at: new Date().toISOString()
        })
        .eq('product_id', productId)
        .eq('warehouse_id', warehouseId)
      
      return
    }

    // Check if bin exists
    const { data: existingBin } = await supabase
      .from('bins')
      .select('id')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .single()

    if (existingBin) {
      // Update existing bin
      const { error } = await supabase
        .from('bins')
        .update({
          actual_qty: latestSLE.qty_after_transaction,
          valuation_rate: latestSLE.valuation_rate,
          stock_value: latestSLE.stock_value,
          stock_queue: latestSLE.stock_queue,
          updated_at: new Date().toISOString()
        })
        .eq('product_id', productId)
        .eq('warehouse_id', warehouseId)

      if (error) {
        throw new Error(`Failed to update bin: ${error.message}`)
      }
    } else {
      // Create new bin
      const { error } = await supabase
        .from('bins')
        .insert({
          product_id: productId,
          warehouse_id: warehouseId,
          actual_qty: latestSLE.qty_after_transaction,
          reserved_qty: 0,
          ordered_qty: 0,
          planned_qty: 0,
          valuation_rate: latestSLE.valuation_rate,
          stock_value: latestSLE.stock_value,
          stock_queue: latestSLE.stock_queue
        })

      if (error) {
        throw new Error(`Failed to create bin: ${error.message}`)
      }
    }
  }

  /**
   * Ensure bin exists for product-warehouse
   */
  private static async ensureBinExists(productId: string, warehouseId: string): Promise<void> {
    const { data: existingBin } = await supabase
      .from('bins')
      .select('id')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .single()

    if (!existingBin) {
      await supabase
        .from('bins')
        .insert({
          product_id: productId,
          warehouse_id: warehouseId,
          actual_qty: 0,
          reserved_qty: 0,
          ordered_qty: 0,
          planned_qty: 0,
          valuation_rate: 0,
          stock_value: 0
        })
    }
  }

  /**
   * Get current stock balance from Bin
   */
  static async getStockBalance(
    productId: string,
    warehouseId: string
  ): Promise<StockBalance> {
    const { data: bin } = await supabase
      .from('bins')
      .select('actual_qty, valuation_rate, stock_value')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .single()

    if (!bin) {
      return { quantity: 0, valuation_rate: 0, stock_value: 0 }
    }

    return {
      quantity: bin.actual_qty || 0,
      valuation_rate: bin.valuation_rate || 0,
      stock_value: bin.stock_value || 0
    }
  }

  /**
   * Get stock balance at a specific date
   */
  static async getStockBalanceAtDate(
    productId: string,
    warehouseId: string,
    date: string
  ): Promise<StockBalance> {
    const { data: sle } = await supabase
      .from('stock_ledger_entries')
      .select('qty_after_transaction, valuation_rate, stock_value')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .lte('posting_date', date)
      .eq('is_cancelled', false)
      .order('posting_date', { ascending: false })
      .order('posting_time', { ascending: false })
      .limit(1)
      .single()

    if (!sle) {
      return { quantity: 0, valuation_rate: 0, stock_value: 0 }
    }

    return {
      quantity: sle.qty_after_transaction || 0,
      valuation_rate: sle.valuation_rate || 0,
      stock_value: sle.stock_value || 0
    }
  }

  /**
   * Cancel Stock Ledger Entry (create reversal entry)
   */
  static async cancelEntry(sle: StockLedgerEntry): Promise<void> {
    if (!sle.id) {
      throw new Error('Cannot cancel entry without id')
    }

    // Create reversal entry
    const reversalEntry: StockLedgerEntry = {
      ...sle,
      id: undefined,
      actual_qty: -sle.actual_qty,
      incoming_rate: sle.outgoing_rate,
      outgoing_rate: sle.incoming_rate,
      is_cancelled: false
    }

    await this.createEntry(reversalEntry)

    // Mark original as cancelled
    await supabase
      .from('stock_ledger_entries')
      .update({ is_cancelled: true })
      .eq('id', sle.id)
  }

  /**
   * Repost stock valuation from a date
   * Used when rates are corrected retroactively
   */
  static async repostValuation(
    productId: string,
    warehouseId: string,
    fromDate: string
  ): Promise<void> {
    console.log(`📊 Reposting valuation for product ${productId} from ${fromDate}`)

    // Get all SLEs from date onwards
    const { data: sles, error } = await supabase
      .from('stock_ledger_entries')
      .select('*')
      .eq('product_id', productId)
      .eq('warehouse_id', warehouseId)
      .gte('posting_date', fromDate)
      .eq('is_cancelled', false)
      .order('posting_date')
      .order('posting_time')

    if (error) {
      throw new Error(`Failed to fetch SLEs for reposting: ${error.message}`)
    }

    if (!sles || sles.length === 0) {
      console.log('No entries to repost')
      return
    }

    // Get starting balance (before fromDate)
    const startBalance = await this.getStockBalanceAtDate(
      productId,
      warehouseId,
      fromDate
    )

    let runningQty = startBalance.quantity
    let runningValue = startBalance.stock_value

    // Recalculate each entry
    for (const sle of sles) {
      const prevRate = runningQty > 0 ? runningValue / runningQty : 0

      runningQty += sle.actual_qty

      let newRate: number
      let newValue: number

      if (sle.actual_qty > 0) {
        // Incoming: weighted average
        const incomingValue = sle.actual_qty * (sle.incoming_rate || 0)
        newValue = runningValue + incomingValue
        newRate = runningQty > 0 ? newValue / runningQty : 0
      } else {
        // Outgoing: use previous rate
        newRate = prevRate
        newValue = runningQty * newRate
      }

      runningValue = newValue

      // Update SLE
      await supabase
        .from('stock_ledger_entries')
        .update({
          qty_after_transaction: runningQty,
          valuation_rate: newRate,
          stock_value: newValue,
          stock_value_difference: newValue - (runningValue - (sle.actual_qty * newRate))
        })
        .eq('id', sle.id)
    }

    // Update bin
    await this.updateBin(productId, warehouseId)

    console.log(`✅ Reposted ${sles.length} entries`)
  }

  /**
   * Validate entry before creation
   */
  private static validateEntry(entry: StockLedgerEntry): void {
    if (!entry.voucher_type) {
      throw new Error('Voucher type is required')
    }

    if (!entry.voucher_id) {
      throw new Error('Voucher ID is required')
    }

    if (!entry.product_id) {
      throw new Error('Product ID is required')
    }

    if (!entry.warehouse_id) {
      throw new Error('Warehouse ID is required')
    }

    if (!entry.posting_date) {
      throw new Error('Posting date is required')
    }

    if (entry.actual_qty === 0) {
      throw new Error('Quantity cannot be zero')
    }

    if (entry.actual_qty > 0 && (!entry.incoming_rate && !entry.valuation_rate)) {
      throw new Error('Rate is required for incoming stock')
    }
  }

  /**
   * Get stock movement history
   */
  static async getStockMovements(
    productId: string,
    warehouseId?: string,
    fromDate?: string,
    toDate?: string,
    limit: number = 100
  ): Promise<StockLedgerEntry[]> {
    let query = supabase
      .from('stock_ledger_entries')
      .select('*')
      .eq('product_id', productId)
      .eq('is_cancelled', false)

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId)
    }

    if (fromDate) {
      query = query.gte('posting_date', fromDate)
    }

    if (toDate) {
      query = query.lte('posting_date', toDate)
    }

    const { data, error } = await query
      .order('posting_date', { ascending: false })
      .order('posting_time', { ascending: false })
      .limit(limit)

    if (error) {
      throw new Error(`Failed to fetch stock movements: ${error.message}`)
    }

    return (data || []) as StockLedgerEntry[]
  }

  /**
   * Get total stock value across all warehouses
   */
  static async getTotalStockValue(warehouseId?: string): Promise<number> {
    let query = supabase
      .from('bins')
      .select('stock_value')

    if (warehouseId) {
      query = query.eq('warehouse_id', warehouseId)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Failed to get total stock value: ${error.message}`)
    }

    return (data || []).reduce((sum, bin) => sum + (bin.stock_value || 0), 0)
  }
}
