from pathlib import Path

HELPER = r'''import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'
import { findUnmappedAdjustmentProductIds } from './stockAdjustmentHelpers'

type Supabase = SupabaseClient<Database>
type SubmissionRecord = any
type SubmissionItem = any

interface SubmitStockAdjustmentParams {
  supabase: Supabase
  adjustmentId: string
  orgId: string
  userId: string
  uomStatus: {
    isEnabled: boolean
    isSuccess: boolean
    needsSetup: (productId: string) => boolean
  }
  onJournalWarning: (message: string) => void
}

export type SubmitStockAdjustmentResult =
  | { ok: true }
  | { ok: false; message: string }

type JournalEntryLine = {
  account_id: string
  debit: number
  credit: number
  description: string
}

async function loadAdjustment(
  supabase: Supabase,
  adjustmentId: string,
  orgId: string,
): Promise<SubmissionRecord | null> {
  const { data: adjustment, error } = await supabase
    .from('stock_adjustments')
    .select('*')
    .eq('id', adjustmentId)
    .eq('organization_id', orgId)
    .single()

  return error || !adjustment ? null : adjustment
}

async function loadAdjustmentItems(
  supabase: Supabase,
  adjustmentId: string,
  orgId: string,
): Promise<SubmissionItem[] | null> {
  const { data: items, error } = await supabase
    .from('stock_adjustment_items')
    .select('*')
    .eq('adjustment_id', adjustmentId)
    .eq('organization_id', orgId)

  return error || !items || items.length === 0 ? null : items
}

function getUomFailure(
  items: SubmissionItem[],
  uomStatus: SubmitStockAdjustmentParams['uomStatus'],
): string | null {
  if (uomStatus.isEnabled && !uomStatus.isSuccess) {
    return 'جارٍ التحقق من إعداد وحدات الأصناف — أعد المحاولة بعد لحظات'
  }
  if (findUnmappedAdjustmentProductIds(items, uomStatus.needsSetup).length > 0) {
    return 'لا يمكن الترحيل: توجد أصناف تحتاج إعداد وحدة في هذه التسوية'
  }
  return null
}

async function insertStockLedgerEntries(
  supabase: Supabase,
  adjustment: SubmissionRecord,
  items: SubmissionItem[],
  adjustmentId: string,
  orgId: string,
  userId: string,
  warehouseId: string,
): Promise<void> {
  const stockLedgerEntries = items.map((item: any) => ({
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

  const { error: ledgerError } = await supabase
    .from('stock_ledger_entries')
    .insert(stockLedgerEntries)

  if (ledgerError) {
    console.error('Error creating stock ledger entries:', ledgerError)
    throw new Error('فشل في إنشاء قيود المخزون: ' + ledgerError.message)
  }
}

async function appendIncreaseJournalLines(
  supabase: Supabase,
  adjustment: SubmissionRecord,
  adjustmentId: string,
  orgId: string,
  totalIncrease: number,
  journalEntries: JournalEntryLine[],
): Promise<void> {
  if (!(totalIncrease > 0 && adjustment.increase_account_id)) return

  const { data: warehouseData } = await supabase
    .from('warehouses')
    .select('inventory_account_id')
    .eq('id', adjustment.warehouse_id)
    .eq('org_id', orgId)
    .single()

  if (warehouseData?.inventory_account_id) {
    journalEntries.push({
      account_id: warehouseData.inventory_account_id,
      debit: totalIncrease,
      credit: 0,
      description: `زيادة مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`,
    })
    journalEntries.push({
      account_id: adjustment.increase_account_id,
      debit: 0,
      credit: totalIncrease,
      description: `زيادة مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`,
    })
  }
}

async function appendDecreaseJournalLines(
  supabase: Supabase,
  adjustment: SubmissionRecord,
  adjustmentId: string,
  orgId: string,
  totalDecrease: number,
  journalEntries: JournalEntryLine[],
): Promise<void> {
  if (!(totalDecrease > 0 && adjustment.decrease_account_id)) return

  const { data: warehouseData } = await supabase
    .from('warehouses')
    .select('inventory_account_id')
    .eq('id', adjustment.warehouse_id)
    .eq('org_id', orgId)
    .single()

  if (warehouseData?.inventory_account_id) {
    journalEntries.push({
      account_id: adjustment.decrease_account_id,
      debit: totalDecrease,
      credit: 0,
      description: `نقص مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`,
    })
    journalEntries.push({
      account_id: warehouseData.inventory_account_id,
      debit: 0,
      credit: totalDecrease,
      description: `نقص مخزون - ${adjustment.adjustment_type} - ${adjustment.reference_number || adjustmentId}`,
    })
  }
}

async function createAccountingJournalEntry(
  supabase: Supabase,
  adjustment: SubmissionRecord,
  items: SubmissionItem[],
  adjustmentId: string,
  orgId: string,
): Promise<void> {
  const totalIncrease = items
    .filter((item: any) => item.difference_qty > 0)
    .reduce((sum: number, item: any) => sum + item.value_difference, 0)

  const totalDecrease = items
    .filter((item: any) => item.difference_qty < 0)
    .reduce((sum: number, item: any) => sum + Math.abs(item.value_difference), 0)

  const journalEntries: JournalEntryLine[] = []

  await appendIncreaseJournalLines(
    supabase,
    adjustment,
    adjustmentId,
    orgId,
    totalIncrease,
    journalEntries,
  )
  await appendDecreaseJournalLines(
    supabase,
    adjustment,
    adjustmentId,
    orgId,
    totalDecrease,
    journalEntries,
  )

  if (journalEntries.length > 0) {
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'rpc_create_journal_entry',
      {
        p_payload: {
          org_id: orgId,
          entry_date: adjustment.posting_date,
          entry_type: 'manual',
          reference_type: 'stock_adjustments',
          reference_number: adjustment.reference_number
            || adjustment.adjustment_number
            || `ADJ-${adjustmentId.substring(0, 8)}`,
          description: `تسوية مخزون - ${adjustment.reason}`,
          auto_post: true,
          idempotency_key: `stock-adj-${adjustmentId}`,
          lines: journalEntries.map((entry: any, idx: number) => ({
            line_number: idx + 1,
            account_id: entry.account_id,
            debit: entry.debit || 0,
            credit: entry.credit || 0,
            description: entry.description || '',
          })),
        },
      },
    )

    if (rpcError) {
      console.error('Error creating GL entry:', rpcError)
      throw new Error('فشل في إنشاء القيد المحاسبي: ' + rpcError.message)
    }
    const glResult = rpcResult as { success?: boolean; error?: string } | null
    if (!glResult?.success) {
      throw new Error(glResult?.error || 'فشل في إنشاء القيد المحاسبي')
    }
  } else {
    console.warn('⚠️ No journal entries to create')
  }
}

async function markAdjustmentSubmitted(
  supabase: Supabase,
  adjustmentId: string,
  orgId: string,
  userId: string,
): Promise<void> {
  const { error: updateError } = await supabase
    .from('stock_adjustments')
    .update({
      status: 'SUBMITTED',
      submitted_at: new Date().toISOString(),
      submitted_by: userId,
    })
    .eq('id', adjustmentId)
    .eq('organization_id', orgId)

  if (updateError) throw updateError
}

export async function submitStockAdjustment({
  supabase,
  adjustmentId,
  orgId,
  userId,
  uomStatus,
  onJournalWarning,
}: SubmitStockAdjustmentParams): Promise<SubmitStockAdjustmentResult> {
  const adjustment = await loadAdjustment(supabase, adjustmentId, orgId)
  if (!adjustment) return { ok: false, message: 'لم يتم العثور على التسوية' }

  if (adjustment.status !== 'DRAFT') {
    return { ok: false, message: 'يمكن فقط ترحيل التسويات بحالة مسودة' }
  }

  const items = await loadAdjustmentItems(supabase, adjustmentId, orgId)
  if (!items) return { ok: false, message: 'لم يتم العثور على بنود التسوية' }

  const uomFailure = getUomFailure(items, uomStatus)
  if (uomFailure) return { ok: false, message: uomFailure }

  const warehouseId = adjustment.warehouse_id
  if (!warehouseId) return { ok: false, message: 'لم يتم تحديد المخزن في التسوية' }

  await insertStockLedgerEntries(
    supabase,
    adjustment,
    items,
    adjustmentId,
    orgId,
    userId,
    warehouseId,
  )

  try {
    await createAccountingJournalEntry(supabase, adjustment, items, adjustmentId, orgId)
  } catch (jeError: any) {
    console.error('Error creating journal entries:', jeError)
    onJournalWarning('تم ترحيل التسوية لكن فشل إنشاء القيود المحاسبية: ' + jeError.message)
  }

  await markAdjustmentSubmitted(supabase, adjustmentId, orgId, userId)
  return { ok: true }
}
'''

HANDLER = r'''  const handleSubmitAdjustment = async (adjustmentId: string) => {
    if (!canApproveAdjustment) {
      toast.error('لا تملك صلاحية ترحيل تسويات المخزون')
      return
    }
    try {
      const supabase = getSupabase()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        toast.error('الرجاء تسجيل الدخول')
        return
      }

      if (!currentOrgId) {
        toast.error('لم يتم تحديد المؤسسة النشطة')
        return
      }

      const result = await submitStockAdjustment({
        supabase,
        adjustmentId,
        orgId: currentOrgId,
        userId: user.id,
        uomStatus: {
          isEnabled: productUomStatus.isEnabled,
          isSuccess: productUomStatus.isSuccess,
          needsSetup: productNeedsUomSetup,
        },
        onJournalWarning: (message) => toast.warning(message),
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      toast.success('✅ تم ترحيل التسوية بنجاح وتحديث قيود المخزون')
      setViewMode(false)
      setSelectedAdjustment(null)
      loadAdjustments()
    } catch (error: any) {
      console.error('Error submitting adjustment:', error)
      toast.error(error.message || 'خطأ في ترحيل التسوية')
    }
  }'''


def strip_trailing(text: str) -> str:
    return '\n'.join(line.rstrip() for line in text.splitlines()) + '\n'


def main() -> None:
    helper_path = Path('src/features/inventory/helpers/stockAdjustmentSubmit.ts')
    if helper_path.exists():
        raise SystemExit('Guard failed: helper already exists')
    helper_path.write_text(strip_trailing(HELPER), encoding='utf-8')

    index_path = Path('src/features/inventory/index.tsx')
    text = index_path.read_text(encoding='utf-8')
    old_import = "  saveStockAdjustmentDraft,\n  updateAdjustmentItemQuantity,"
    new_import = "  saveStockAdjustmentDraft,\n  submitStockAdjustment,\n  updateAdjustmentItemQuantity,"
    if text.count(old_import) != 1:
        raise SystemExit('Guard failed: helper import anchor changed')
    text = text.replace(old_import, new_import, 1)

    start_marker = "  const handleSubmitAdjustment = async (adjustmentId: string) => {"
    end_marker = "\n\n  const filteredProducts = products.filter("
    if text.count(start_marker) != 1 or text.count(end_marker) != 1:
        raise SystemExit('Guard failed: submit handler anchors changed')
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    text = text[:start] + strip_trailing(HANDLER).rstrip('\n') + text[end:]
    index_path.write_text(text, encoding='utf-8')

    helpers_index = Path('src/features/inventory/helpers/index.ts')
    helper_index_text = helpers_index.read_text(encoding='utf-8')
    anchor = "export * from './stockAdjustmentSave';\n"
    if helper_index_text.count(anchor) != 1:
        raise SystemExit('Guard failed: helpers index anchor changed')
    helpers_index.write_text(
        helper_index_text.replace(anchor, anchor + "export * from './stockAdjustmentSubmit';\n", 1),
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()
