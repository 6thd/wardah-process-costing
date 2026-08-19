import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'

type SubmissionItem = {
  product_id: string
  warehouse_id: string | null
  difference_qty: number
  new_qty: number
  current_rate: number
  value_difference: number
}

type SubmissionAdjustment = {
  status: string
  warehouse_id: string | null
  posting_date: string
  adjustment_number: string | null
  reference_number: string | null
  adjustment_type: string
  increase_account_id: string | null
  decrease_account_id: string | null
  reason: string
}

type JournalEntryLine = {
  account_id: string
  debit: number
  credit: number
  description: string
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
    .select('*')
    .eq('id', adjustmentId)
    .eq('organization_id', orgId)
    .single()
  if (adjError || !adjustment) return { message: 'لم يتم العثور على التسوية' }
  if (adjustment.status !== 'DRAFT') return { message: 'يمكن فقط ترحيل التسويات بحالة مسودة' }

  const { data: items, error: itemsError } = await supabase
    .from('stock_adjustment_items')
    .select('*')
    .eq('adjustment_id', adjustmentId)
    .eq('organization_id', orgId)
  if (itemsError || !items || items.length === 0) return { message: 'لم يتم العثور على بنود التسوية' }
  return { adjustment: adjustment as SubmissionAdjustment, items: items as SubmissionItem[] }
}

async function insertStockLedgerEntries(
  supabase: SupabaseClient<Database>, adjustment: SubmissionAdjustment,
  items: SubmissionItem[], adjustmentId: string, orgId: string, userId: string,
): Promise<void> {
  const warehouseId = adjustment.warehouse_id as string
  const stockLedgerEntries = items.map((item) => ({
    org_id: orgId,
    posting_date: adjustment.posting_date,
    posting_time: new Date().toTimeString().split(' ')[0],
    voucher_type: 'Stock Adjustment',
    voucher_id: adjustmentId,
    voucher_number: adjustment.adjustment_number || adjustment.reference_number || `ADJ-${adjustmentId.substring(0, 8)}`,
    product_id: item.product_id,
    warehouse_id: item.warehouse_id || warehouseId,
    actual_qty: item.difference_qty,
    qty_after_transaction: item.new_qty,
    incoming_rate: item.difference_qty > 0 ? item.current_rate : 0,
    outgoing_rate: item.difference_qty < 0 ? item.current_rate : 0,
    valuation_rate: item.current_rate,
    stock_value: item.new_qty * item.current_rate,
    stock_value_difference: item.value_difference,
    is_cancelled: false,
    created_by: userId,
  }))
  const { error: ledgerError } = await supabase.from('stock_ledger_entries').insert(stockLedgerEntries)
  if (ledgerError) {
    console.error('Error creating stock ledger entries:', ledgerError)
    throw new Error('فشل في إنشاء قيود المخزون: ' + ledgerError.message)
  }
}

async function appendIncreaseJournalEntries(
  supabase: SupabaseClient<Database>, adjustment: SubmissionAdjustment,
  adjustmentId: string, orgId: string, totalIncrease: number, journalEntries: JournalEntryLine[],
): Promise<void> {
  if (!(totalIncrease > 0 && adjustment.increase_account_id)) return
  const { data: warehouseData } = await supabase
    .from('warehouses').select('inventory_account_id')
    .eq('id', adjustment.warehouse_id).eq('org_id', orgId).single()
  if (warehouseData?.inventory_account_id) {
    journalEntries.push({ account_id: warehouseData.inventory_account_id, debit: totalIncrease, credit: 0, description: `زيادة مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}` })
    journalEntries.push({ account_id: adjustment.increase_account_id, debit: 0, credit: totalIncrease, description: `زيادة مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}` })
  }
}

async function appendDecreaseJournalEntries(
  supabase: SupabaseClient<Database>, adjustment: SubmissionAdjustment,
  adjustmentId: string, orgId: string, totalDecrease: number, journalEntries: JournalEntryLine[],
): Promise<void> {
  if (!(totalDecrease > 0 && adjustment.decrease_account_id)) return
  const { data: warehouseData } = await supabase
    .from('warehouses').select('inventory_account_id')
    .eq('id', adjustment.warehouse_id).eq('org_id', orgId).single()
  if (warehouseData?.inventory_account_id) {
    journalEntries.push({ account_id: adjustment.decrease_account_id, debit: totalDecrease, credit: 0, description: `نقص مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}` })
    journalEntries.push({ account_id: warehouseData.inventory_account_id, debit: 0, credit: totalDecrease, description: `نقص مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}` })
  }
}

async function createJournalEntry(
  supabase: SupabaseClient<Database>, adjustment: SubmissionAdjustment,
  items: SubmissionItem[], adjustmentId: string, orgId: string,
): Promise<void> {
  const totalIncrease = items.filter((item) => item.difference_qty > 0).reduce((sum, item) => sum + item.value_difference, 0)
  const totalDecrease = items.filter((item) => item.difference_qty < 0).reduce((sum, item) => sum + Math.abs(item.value_difference), 0)
  const journalEntries: JournalEntryLine[] = []
  await appendIncreaseJournalEntries(supabase, adjustment, adjustmentId, orgId, totalIncrease, journalEntries)
  await appendDecreaseJournalEntries(supabase, adjustment, adjustmentId, orgId, totalDecrease, journalEntries)
  if (journalEntries.length === 0) {
    console.warn('⚠️ No journal entries to create')
    return
  }
  const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_create_journal_entry', {
    p_payload: {
      org_id: orgId,
      entry_date: adjustment.posting_date,
      entry_type: 'manual',
      reference_type: 'stock_adjustments',
      reference_number: adjustment.reference_number || adjustment.adjustment_number || `ADJ-${adjustmentId.substring(0, 8)}`,
      description: `تسوية مخزون - ${adjustment.reason}`,
      auto_post: true,
      idempotency_key: `stock-adj-${adjustmentId}`,
      lines: journalEntries.map((entry, idx) => ({
        line_number: idx + 1,
        account_id: entry.account_id,
        debit: entry.debit || 0,
        credit: entry.credit || 0,
        description: entry.description || '',
      })),
    },
  })
  if (rpcError) {
    console.error('Error creating GL entry:', rpcError)
    throw new Error('فشل في إنشاء القيد المحاسبي: ' + rpcError.message)
  }
  const glResult = rpcResult as { success?: boolean; error?: string } | null
  if (!glResult?.success) throw new Error(glResult?.error || 'فشل في إنشاء القيد المحاسبي')
}

async function markAdjustmentSubmitted(
  supabase: SupabaseClient<Database>, adjustmentId: string, orgId: string, userId: string,
): Promise<void> {
  const { error: updateError } = await supabase
    .from('stock_adjustments')
    .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString(), submitted_by: userId })
    .eq('id', adjustmentId)
    .eq('organization_id', orgId)
  if (updateError) throw updateError
}

export async function submitStockAdjustmentDraft({
  supabase, adjustmentId, orgId, userId, validateUom, onJournalWarning,
}: SubmitStockAdjustmentDraftParams): Promise<SubmitStockAdjustmentDraftResult> {
  const context = await loadSubmissionContext(supabase, adjustmentId, orgId)
  if ('message' in context) return { ok: false, message: context.message }
  const { adjustment, items } = context
  const uomError = validateUom(items)
  if (uomError) return { ok: false, message: uomError }
  if (!adjustment.warehouse_id) return { ok: false, message: 'لم يتم تحديد المخزن في التسوية' }

  await insertStockLedgerEntries(supabase, adjustment, items, adjustmentId, orgId, userId)
  try {
    await createJournalEntry(supabase, adjustment, items, adjustmentId, orgId)
  } catch (jeError: any) {
    console.error('Error creating journal entries:', jeError)
    onJournalWarning(jeError.message)
  }
  await markAdjustmentSubmitted(supabase, adjustmentId, orgId, userId)
  return { ok: true }
}
