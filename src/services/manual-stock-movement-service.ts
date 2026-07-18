import { getSupabase } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ManualStockMovementType = 'in' | 'out' | 'adjustment'

export interface ManualStockMovementInput {
  productId: string
  quantity: number
  movementType: ManualStockMovementType
  warehouseId?: string
  notes?: string
}

export interface ManualStockMovementResult {
  applied: boolean
  reason?: string
  new_qty?: number
  new_rate?: number
  new_value?: number
  cogs?: number
  method?: string
}

export const manualStockMovementService = {
  apply: async (
    input: ManualStockMovementInput,
  ): Promise<ManualStockMovementResult> => {
    if (!input.productId) throw new Error('Product ID is required')
    if (!Number.isFinite(input.quantity) || input.quantity < 0) {
      throw new Error('Quantity must be a non-negative number')
    }

    const supabase = getSupabase() as SupabaseClient
    const { data, error } = await supabase.rpc('rpc_manual_stock_movement', {
      p_product_id: input.productId,
      p_quantity: input.quantity,
      p_movement_type: input.movementType,
      p_warehouse_id: input.warehouseId || null,
      p_notes: input.notes || null,
    })

    if (error) throw error
    return data as ManualStockMovementResult
  },
}

export default manualStockMovementService
