import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'

type SubmissionItem = {
  product_id: string
}

type SubmissionAdjustment = {
  status: string
  warehouse_id: string | null
}

interface SubmitStockAdjustmentDraftParams {
  supabase: SupabaseClient<Database>
  adjustmentId: string
  orgId: string
  userId: string
  validateUom: (items: Array<{ product_id: string }>) => string | null
  onJournalWarning: (message: string) => void
}

type SubmitStockAdjustmentDraftResult =
  | { ok: true }
  | { ok: false; message: string }

async function loadSubmissionContext(
  supabase: SupabaseClient<Database>, adjustmentId: string, orgId: string,
): Promise<{ adjustment: SubmissionAdjustment; items: SubmissionItem[] } | { message: string }> {
  const { data: adjustment, error: adjError } = await supabase
    .from('stock_adjustments')
    .select('status, warehouse_id')
    .eq('id', adjustmentId)
    .eq('organization_id', orgId)
    .single()
  if (adjError || !adjustment) return { message: 'لم يتم العثور على التسوية' }
  if (adjustment.status !== 'DRAFT') return { message: 'يمكن فقط ترحيل التسويات بحالة مسودة' }

  const { data: items, error: itemsError } = await supabase
    .from('stock_adjustment_items')
    .select('product_id')
    .eq('adjustment_id', adjustmentId)
    .eq('organization_id', orgId)
  if (itemsError || !items || items.length === 0) return { message: 'لم يتم العثور على بنود التسوية' }
  return { adjustment: adjustment as SubmissionAdjustment, items: items as SubmissionItem[] }
}

/**
 * Submit a stock-adjustment draft through the atomic server boundary.
 *
 * The old browser implementation wrote stock ledger rows first, attempted a
 * generic journal RPC second, swallowed journal failure as a warning, and then
 * marked the adjustment submitted. Closing the generic journal primitive in
 * Migration 178 would therefore have turned that legacy flow into stock-without-
 * GL state. The canonical rpc_submit_stock_adjustment performs stock, GL and
 * status mutation in one transaction, so failure is fail-closed.
 *
 * Exact stock-adjustment permission semantics remain tracked by #153; this
 * helper intentionally does not weaken the server's current admin boundary.
 */
export async function submitStockAdjustmentDraft({
  supabase, adjustmentId, orgId, userId, validateUom, onJournalWarning,
}: SubmitStockAdjustmentDraftParams): Promise<SubmitStockAdjustmentDraftResult> {
  // Keep the existing lightweight UI validation/messages before the atomic RPC.
  const context = await loadSubmissionContext(supabase, adjustmentId, orgId)
  if ('message' in context) return { ok: false, message: context.message }

  const uomError = validateUom(context.items)
  if (uomError) return { ok: false, message: uomError }
  if (!context.adjustment.warehouse_id) return { ok: false, message: 'لم يتم تحديد المخزن في التسوية' }

  // These callbacks/actor values belonged to the removed client-side partial
  // posting path. Actor identity is now auth.uid() on the server and journal
  // failure aborts the whole transaction, so no warning-only continuation exists.
  void userId
  void onJournalWarning

  const { data, error } = await supabase.rpc('rpc_submit_stock_adjustment', {
    p_adjustment_id: adjustmentId,
  })
  if (error) return { ok: false, message: error.message || 'فشل ترحيل التسوية' }

  const result = data as { success?: boolean; error?: string } | null
  if (!result?.success) {
    return { ok: false, message: result?.error || 'فشل ترحيل التسوية' }
  }
  return { ok: true }
}
