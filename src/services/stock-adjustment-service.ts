/**
 * Stock Adjustment Service
 * Based on ERPNext, SAP, and Oracle best practices
 * Handles inventory adjustments with proper accounting integration
 */

import { getSupabase } from '../lib/supabase'

// Helper function to get supabase client
const getClient = async () => {
  const client = getSupabase()
  if (!client) {
    throw new Error('Supabase client not initialized')
  }
  return client
}

export interface StockAdjustmentItem {
  id?: string
  product_id: string
  current_qty: number
  new_qty: number
  difference_qty: number
  current_rate: number
  value_difference: number
  reason?: string
  warehouse_id?: string
  batch_no?: string
  serial_nos?: string[]
}

export interface StockAdjustment {
  id?: string
  adjustment_date: string
  adjustment_type: 'PHYSICAL_COUNT' | 'DAMAGE' | 'THEFT' | 'EXPIRY' | 'QUALITY_ISSUE' | 'REVALUATION' | 'OTHER'
  reason: string
  reference_number?: string
  warehouse_id?: string
  total_value_difference: number
  status: 'DRAFT' | 'SUBMITTED' | 'CANCELLED'
  items: StockAdjustmentItem[]
  
  // Accounting Integration
  expense_account_id?: string  // For losses (e.g., 5950 - Inventory Adjustments)
  gain_account_id?: string     // For gains (e.g., 4900 - Other Income)
  inventory_account_id?: string // Inventory GL account
  
  // Approval
  requires_approval: boolean
  approved_by?: string
  approved_at?: string
  
  // Audit
  created_by?: string
  created_at?: string
  posted_by?: string
  posted_at?: string
  remarks?: string
}

export interface PhysicalCountSession {
  id?: string
  count_date: string
  warehouse_id?: string
  counted_by: string
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ADJUSTED'
  items: {
    product_id: string
    system_qty: number
    counted_qty: number
    difference: number
  }[]
  created_at?: string
}

export const stockAdjustmentService = {
  
  /**
   * Create a new stock adjustment (Draft)
   */
  createAdjustment: async (adjustment: StockAdjustment) => {
    const supabase = await getClient()
    
    // Validate
    if (!adjustment.items || adjustment.items.length === 0) {
      throw new Error('يجب إضافة منتج واحد على الأقل')
    }
    
    // Calculate total value difference
    const totalValueDiff = adjustment.items.reduce((sum, item) => 
      sum + item.value_difference, 0
    )
    
    // Create adjustment header
    const { data: headerData, error: headerError } = await supabase
      .from('stock_adjustments')
      .insert({
        adjustment_date: adjustment.adjustment_date,
        adjustment_type: adjustment.adjustment_type,
        reason: adjustment.reason,
        reference_number: adjustment.reference_number,
        warehouse_id: adjustment.warehouse_id,
        total_value_difference: totalValueDiff,
        status: 'DRAFT',
        requires_approval: Math.abs(totalValueDiff) > 10000, // Require approval for large adjustments
        expense_account_id: adjustment.expense_account_id,
        gain_account_id: adjustment.gain_account_id,
        inventory_account_id: adjustment.inventory_account_id,
        remarks: adjustment.remarks
      })
      .select()
      .single()
    
    if (headerError) throw headerError
    
    // Create adjustment items
    const itemsData = adjustment.items.map(item => ({
      adjustment_id: headerData.id,
      product_id: item.product_id,
      current_qty: item.current_qty,
      new_qty: item.new_qty,
      difference_qty: item.difference_qty,
      current_rate: item.current_rate,
      value_difference: item.value_difference,
      reason: item.reason,
      warehouse_id: item.warehouse_id,
      batch_no: item.batch_no,
      serial_nos: item.serial_nos
    }))
    
    const { error: itemsError } = await supabase
      .from('stock_adjustment_items')
      .insert(itemsData)
    
    if (itemsError) throw itemsError
    
    return headerData
  },
  
  /**
   * Submit and post adjustment (creates stock ledger entries)
   */
  submitAdjustment: async (adjustmentId: string, userId: string) => {
    const supabase = await getClient()
    
    // Get adjustment with items
    const { data: adjustment, error: fetchError } = await supabase
      .from('stock_adjustments')
      .select(`
        *,
        items:stock_adjustment_items(*)
      `)
      .eq('id', adjustmentId)
      .single()
    
    if (fetchError) throw fetchError
    
    // Check if requires approval
    if (adjustment.requires_approval && !adjustment.approved_by) {
      throw new Error('هذه التسوية تتطلب موافقة المدير')
    }
    
    // Check status
    if (adjustment.status !== 'DRAFT') {
      throw new Error('يمكن ترحيل التسويات بحالة مسودة فقط')
    }
    
    // Begin transaction: Create stock ledger entries
    for (const item of adjustment.items) {
      // Get current product valuation
      const { data: product } = await supabase
        .from('products')
        .select('stock_quantity, cost_price, stock_value, valuation_method')
        .eq('id', item.product_id)
        .single()
      
      if (!product) {
        throw new Error(`المنتج غير موجود: ${item.product_id}`)
      }
      
      // Create stock ledger entry
      const { error: sleError } = await supabase
        .from('stock_ledger_entries')
        .insert({
          voucher_type: 'Stock Adjustment',
          voucher_id: adjustmentId,
          voucher_number: adjustment.reference_number,
          product_id: item.product_id,
          warehouse_id: item.warehouse_id || adjustment.warehouse_id,
          posting_date: adjustment.adjustment_date,
          actual_qty: item.difference_qty,
          qty_after_transaction: product.stock_quantity + item.difference_qty,
          incoming_rate: item.difference_qty > 0 ? item.current_rate : 0,
          outgoing_rate: item.difference_qty < 0 ? item.current_rate : 0,
          valuation_rate: item.current_rate,
          stock_value: (product.stock_quantity + item.difference_qty) * item.current_rate,
          stock_value_difference: item.value_difference,
          batch_no: item.batch_no,
          serial_nos: item.serial_nos,
          docstatus: 1
        })
      
      if (sleError) throw sleError
      
      // Update product stock
      const { error: updateError } = await supabase
        .from('products')
        .update({
          stock_quantity: product.stock_quantity + item.difference_qty,
          stock_value: product.stock_value + item.value_difference,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.product_id)
      
      if (updateError) throw updateError
    }
    
    // Create accounting entries
    await createAdjustmentAccountingEntries(supabase, adjustment)
    
    // Update adjustment status
    const { error: statusError } = await supabase
      .from('stock_adjustments')
      .update({
        status: 'SUBMITTED',
        posted_by: userId,
        posted_at: new Date().toISOString()
      })
      .eq('id', adjustmentId)
    
    if (statusError) throw statusError
    
    return { success: true, message: 'تم ترحيل التسوية بنجاح' }
  },
  
  /**
   * Cancel adjustment
   */
  cancelAdjustment: async (adjustmentId: string, reason: string) => {
    const supabase = await getClient()
    
    // Get adjustment
    const { data: adjustment, error: fetchError } = await supabase
      .from('stock_adjustments')
      .select('*')
      .eq('id', adjustmentId)
      .single()
    
    if (fetchError) throw fetchError
    
    if (adjustment.status !== 'SUBMITTED') {
      throw new Error('يمكن إلغاء التسويات المرحلة فقط')
    }
    
    // Cancel stock ledger entries
    const { error: cancelSleError } = await supabase
      .from('stock_ledger_entries')
      .update({ is_cancelled: true })
      .eq('voucher_type', 'Stock Adjustment')
      .eq('voucher_id', adjustmentId)
    
    if (cancelSleError) throw cancelSleError
    
    // Create reversal entries
    const { data: originalEntries } = await supabase
      .from('stock_ledger_entries')
      .select('*')
      .eq('voucher_type', 'Stock Adjustment')
      .eq('voucher_id', adjustmentId)
    
    for (const entry of originalEntries || []) {
      await supabase
        .from('stock_ledger_entries')
        .insert({
          ...entry,
          id: undefined,
          actual_qty: -entry.actual_qty,
          stock_value_difference: -entry.stock_value_difference,
          voucher_number: `CANCEL-${entry.voucher_number}`,
          remarks: `إلغاء: ${reason}`
        })
    }
    
    // Update adjustment status
    const { error: statusError } = await supabase
      .from('stock_adjustments')
      .update({
        status: 'CANCELLED',
        remarks: `إلغاء: ${reason}`
      })
      .eq('id', adjustmentId)
    
    if (statusError) throw statusError
    
    return { success: true, message: 'تم إلغاء التسوية بنجاح' }
  },
  
  /**
   * Get all adjustments
   */
  getAll: async (filters?: {
    status?: string
    adjustment_type?: string
    from_date?: string
    to_date?: string
  }) => {
    const supabase = await getClient()
    let query = supabase
      .from('stock_adjustments')
      .select(`
        *,
        items:stock_adjustment_items(
          *,
          product:products(name, code)
        ),
        warehouse:warehouses(name),
        created_by_user:users!created_by(name)
      `)
      .order('adjustment_date', { ascending: false })
    
    if (filters?.status) {
      query = query.eq('status', filters.status)
    }
    
    if (filters?.adjustment_type) {
      query = query.eq('adjustment_type', filters.adjustment_type)
    }
    
    if (filters?.from_date) {
      query = query.gte('adjustment_date', filters.from_date)
    }
    
    if (filters?.to_date) {
      query = query.lte('adjustment_date', filters.to_date)
    }
    
    const { data, error } = await query
    
    if (error) throw error
    return data
  },
  
  /**
   * Start physical count session
   */
  startPhysicalCount: async (session: PhysicalCountSession) => {
    const supabase = await getClient()
    
    const { data, error } = await supabase
      .from('physical_count_sessions')
      .insert({
        count_date: session.count_date,
        warehouse_id: session.warehouse_id,
        counted_by: session.counted_by,
        status: 'IN_PROGRESS'
      })
      .select()
      .single()
    
    if (error) throw error
    return data
  },
  
  /**
   * Convert physical count to adjustment
   */
  convertCountToAdjustment: async (sessionId: string) => {
    const supabase = await getClient()
    
    // Get count session with items
    const { data: session, error: fetchError } = await supabase
      .from('physical_count_sessions')
      .select(`
        *,
        items:physical_count_items(*)
      `)
      .eq('id', sessionId)
      .single()
    
    if (fetchError) throw fetchError
    
    // Get products with current stock
    const productIds = session.items.map((i: any) => i.product_id)
    const { data: products } = await supabase
      .from('products')
      .select('id, stock_quantity, cost_price')
      .in('id', productIds)
    
    const productsMap = new Map(products?.map(p => [p.id, p]))
    
    // Create adjustment items
    const adjustmentItems: StockAdjustmentItem[] = session.items
      .map((item: any) => {
        const product = productsMap.get(item.product_id)
        if (!product) return null
        
        const difference = item.counted_qty - item.system_qty
        if (difference === 0) return null // No adjustment needed
        
        return {
          product_id: item.product_id,
          current_qty: item.system_qty,
          new_qty: item.counted_qty,
          difference_qty: difference,
          current_rate: product.cost_price,
          value_difference: difference * product.cost_price
        }
      })
      .filter(Boolean) as StockAdjustmentItem[]
    
    if (adjustmentItems.length === 0) {
      throw new Error('لا توجد فروقات تتطلب تسوية')
    }
    
    // Create adjustment
    const adjustment: StockAdjustment = {
      adjustment_date: session.count_date,
      adjustment_type: 'PHYSICAL_COUNT',
      reason: `جرد فعلي - ${new Date(session.count_date).toLocaleDateString('ar-SA')}`,
      reference_number: `PC-${sessionId.slice(0, 8)}`,
      warehouse_id: session.warehouse_id,
      total_value_difference: adjustmentItems.reduce((sum, i) => sum + i.value_difference, 0),
      status: 'DRAFT',
      requires_approval: true,
      items: adjustmentItems,
      remarks: `تسوية من جرد فعلي #${sessionId}`
    }
    
    const createdAdjustment = await stockAdjustmentService.createAdjustment(adjustment)
    
    // Update session status
    await supabase
      .from('physical_count_sessions')
      .update({ 
        status: 'ADJUSTED',
        adjustment_id: createdAdjustment.id
      })
      .eq('id', sessionId)
    
    return createdAdjustment
  }
}

/**
 * Create accounting entries for stock adjustment
 * Following double-entry accounting principles
 */
async function createAdjustmentAccountingEntries(
  supabase: any, 
  adjustment: any
) {
  const totalValueDiff = adjustment.total_value_difference
  
  if (totalValueDiff === 0) return // No accounting impact
  
  const entries = []
  
  if (totalValueDiff > 0) {
    // Stock increase (gain)
    // Dr: Inventory Asset
    // Cr: Gain on Inventory Adjustment (Other Income)
    
    entries.push({
      account_id: adjustment.inventory_account_id,
      debit: totalValueDiff,
      credit: 0,
      description: `تسوية مخزون - زيادة: ${adjustment.reference_number}`
    })
    
    entries.push({
      account_id: adjustment.gain_account_id,
      debit: 0,
      credit: totalValueDiff,
      description: `ربح تسوية مخزون: ${adjustment.reference_number}`
    })
    
  } else {
    // Stock decrease (loss)
    // Dr: Inventory Adjustment Expense
    // Cr: Inventory Asset
    
    entries.push({
      account_id: adjustment.expense_account_id,
      debit: Math.abs(totalValueDiff),
      credit: 0,
      description: `خسارة تسوية مخزون: ${adjustment.reference_number}`
    })
    
    entries.push({
      account_id: adjustment.inventory_account_id,
      debit: 0,
      credit: Math.abs(totalValueDiff),
      description: `تسوية مخزون - نقص: ${adjustment.reference_number}`
    })
  }
  
  // Create journal entry
  const { data: journalEntry, error: jeError } = await supabase
    .from('journal_entries')
    .insert({
      posting_date: adjustment.adjustment_date,
      voucher_type: 'Stock Adjustment',
      voucher_id: adjustment.id,
      total_debit: Math.abs(totalValueDiff),
      total_credit: Math.abs(totalValueDiff),
      remarks: adjustment.reason
    })
    .select()
    .single()
  
  if (jeError) throw jeError
  
  // Create journal entry lines
  for (const entry of entries) {
    await supabase
      .from('journal_entry_lines')
      .insert({
        journal_entry_id: journalEntry.id,
        ...entry
      })
  }
}

export default stockAdjustmentService
