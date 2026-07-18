/**
 * Stock Adjustment Service
 *
 * Write operations are delegated to PostgreSQL RPCs so the adjustment header,
 * stock ledger, bins, product aggregate, and canonical GL entry commit or roll
 * back as one transaction. Read-only/reporting helpers remain client-side.
 */

import { getSupabase as _getSupabase } from '../lib/supabase'

const getSupabase = () =>
  _getSupabase() as import('@supabase/supabase-js').SupabaseClient

const getClient = async () => {
  const client = getSupabase()
  if (!client) throw new Error('Supabase client not initialized')
  return client
}

export interface StockAdjustmentItem {
  id?: string
  product_id: string
  current_qty: number
  new_qty: number
  difference_qty: number
  current_rate: number
  new_rate?: number
  value_difference: number
  reason?: string
  warehouse_id?: string
  batch_no?: string
  serial_nos?: string[]
}

export interface StockAdjustment {
  id?: string
  org_id?: string
  adjustment_number?: string
  adjustment_date: string
  posting_date?: string
  adjustment_type:
    | 'PHYSICAL_COUNT'
    | 'DAMAGE'
    | 'THEFT'
    | 'EXPIRY'
    | 'QUALITY_ISSUE'
    | 'REVALUATION'
    | 'OTHER'
  reason: string
  reference_number?: string
  warehouse_id?: string
  total_value_difference: number
  status: 'DRAFT' | 'SUBMITTED' | 'CANCELLED'
  items: StockAdjustmentItem[]

  // Canonical account names used by the current schema.
  increase_account_id?: string
  decrease_account_id?: string

  // Legacy caller aliases are retained for compatibility; they are mapped to
  // the canonical increase/decrease accounts before the RPC call.
  expense_account_id?: string
  gain_account_id?: string
  inventory_account_id?: string

  requires_approval: boolean
  approved_by?: string
  approved_at?: string
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
  items: Array<{
    product_id: string
    system_qty: number
    counted_qty: number
    difference: number
  }>
  created_at?: string
}

type RpcResult = {
  success?: boolean
  error?: string
  adjustment_id?: string
  adjustment_number?: string
  duplicate?: boolean
  gl_entry_id?: string | null
  reversal_gl_entry_id?: string | null
}

function assertRpcSuccess(result: RpcResult | null, fallback: string): RpcResult {
  if (!result?.success) throw new Error(result?.error || fallback)
  return result
}

function resolveAccounts(adjustment: StockAdjustment): {
  increase_account_id?: string
  decrease_account_id?: string
} {
  const total = adjustment.items.reduce(
    (sum, item) => sum + Number(item.value_difference || 0),
    0,
  )

  return {
    increase_account_id:
      adjustment.increase_account_id || adjustment.inventory_account_id,
    decrease_account_id:
      adjustment.decrease_account_id ||
      (total >= 0 ? adjustment.gain_account_id : adjustment.expense_account_id),
  }
}

export const stockAdjustmentService = {
  createAdjustment: async (adjustment: StockAdjustment) => {
    if (!adjustment.items?.length) {
      throw new Error('يجب إضافة منتج واحد على الأقل')
    }

    const supabase = await getClient()
    const accounts = resolveAccounts(adjustment)
    const totalValueDifference = adjustment.items.reduce(
      (sum, item) => sum + Number(item.value_difference || 0),
      0,
    )

    const { data, error } = await supabase.rpc('rpc_create_stock_adjustment', {
      p_payload: {
        org_id: adjustment.org_id,
        adjustment_number: adjustment.adjustment_number,
        adjustment_date: adjustment.adjustment_date,
        posting_date: adjustment.posting_date || adjustment.adjustment_date,
        adjustment_type: adjustment.adjustment_type,
        reason: adjustment.reason,
        reference_number: adjustment.reference_number,
        warehouse_id: adjustment.warehouse_id,
        requires_approval:
          adjustment.requires_approval || Math.abs(totalValueDifference) > 10000,
        increase_account_id: accounts.increase_account_id,
        decrease_account_id: accounts.decrease_account_id,
        items: adjustment.items,
      },
    })

    if (error) throw error
    const result = assertRpcSuccess(
      data as RpcResult | null,
      'فشل إنشاء تسوية المخزون',
    )

    return {
      id: result.adjustment_id,
      adjustment_number: result.adjustment_number,
      status: 'DRAFT' as const,
    }
  },

  submitAdjustment: async (adjustmentId: string, _userId: string) => {
    const supabase = await getClient()
    const { data, error } = await supabase.rpc('rpc_submit_stock_adjustment', {
      p_adjustment_id: adjustmentId,
    })
    if (error) throw error
    const result = assertRpcSuccess(
      data as RpcResult | null,
      'فشل ترحيل تسوية المخزون',
    )
    return {
      success: true,
      duplicate: Boolean(result.duplicate),
      glEntryId: result.gl_entry_id || null,
      message: result.duplicate
        ? 'التسوية مرحلة مسبقاً'
        : 'تم ترحيل التسوية بنجاح',
    }
  },

  cancelAdjustment: async (adjustmentId: string, reason: string) => {
    if (!reason.trim()) throw new Error('سبب الإلغاء مطلوب')

    const supabase = await getClient()
    const { data, error } = await supabase.rpc('rpc_cancel_stock_adjustment', {
      p_adjustment_id: adjustmentId,
      p_reason: reason,
    })
    if (error) throw error
    const result = assertRpcSuccess(
      data as RpcResult | null,
      'فشل إلغاء تسوية المخزون',
    )
    return {
      success: true,
      duplicate: Boolean(result.duplicate),
      reversalGlEntryId: result.reversal_gl_entry_id || null,
      message: result.duplicate
        ? 'التسوية ملغاة مسبقاً'
        : 'تم إلغاء التسوية وعكس آثارها بنجاح',
    }
  },

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
        warehouse:warehouses(name)
      `)
      .order('adjustment_date', { ascending: false })

    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.adjustment_type) {
      query = query.eq('adjustment_type', filters.adjustment_type)
    }
    if (filters?.from_date) query = query.gte('adjustment_date', filters.from_date)
    if (filters?.to_date) query = query.lte('adjustment_date', filters.to_date)

    const { data, error } = await query
    if (error) throw error
    return data
  },

  startPhysicalCount: async (session: PhysicalCountSession) => {
    const supabase = await getClient()
    const { data, error } = await supabase
      .from('physical_count_sessions')
      .insert({
        count_date: session.count_date,
        warehouse_id: session.warehouse_id,
        counted_by: session.counted_by,
        status: 'IN_PROGRESS',
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  convertCountToAdjustment: async (sessionId: string) => {
    const supabase = await getClient()
    const { data: session, error: fetchError } = await supabase
      .from('physical_count_sessions')
      .select('*, items:physical_count_items(*)')
      .eq('id', sessionId)
      .single()

    if (fetchError) throw fetchError

    const productIds = (session.items || []).map(
      (item: { product_id: string }) => item.product_id,
    )
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, stock_quantity, cost_price')
      .in('id', productIds)
    if (productsError) throw productsError

    const productsMap = new Map(
      (products || []).map((product) => [product.id, product]),
    )
    const adjustmentItems = (session.items || [])
      .map(
        (item: {
          product_id: string
          system_qty: number
          counted_qty: number
        }): StockAdjustmentItem | null => {
          const product = productsMap.get(item.product_id)
          if (!product) return null
          const difference = item.counted_qty - item.system_qty
          if (difference === 0) return null
          return {
            product_id: item.product_id,
            current_qty: item.system_qty,
            new_qty: item.counted_qty,
            difference_qty: difference,
            current_rate: Number(product.cost_price || 0),
            value_difference: difference * Number(product.cost_price || 0),
            warehouse_id: session.warehouse_id,
          }
        },
      )
      .filter((item: StockAdjustmentItem | null): item is StockAdjustmentItem =>
        Boolean(item),
      )

    if (!adjustmentItems.length) {
      throw new Error('لا توجد فروقات تتطلب تسوية')
    }

    const createdAdjustment = await stockAdjustmentService.createAdjustment({
      adjustment_date: session.count_date,
      adjustment_type: 'PHYSICAL_COUNT',
      reason: `جرد فعلي - ${new Date(session.count_date).toLocaleDateString('ar-SA')}`,
      reference_number: `PC-${sessionId.slice(0, 8)}`,
      warehouse_id: session.warehouse_id,
      total_value_difference: adjustmentItems.reduce(
        (sum, item) => sum + item.value_difference,
        0,
      ),
      status: 'DRAFT',
      requires_approval: true,
      items: adjustmentItems,
      remarks: `تسوية من جرد فعلي #${sessionId}`,
    })

    const { error: updateError } = await supabase
      .from('physical_count_sessions')
      .update({ status: 'ADJUSTED', adjustment_id: createdAdjustment.id })
      .eq('id', sessionId)
    if (updateError) throw updateError

    return createdAdjustment
  },
}

export default stockAdjustmentService
