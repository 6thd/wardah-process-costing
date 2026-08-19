import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'
import { calculateAdjustmentTotals, type AdjustmentFormState } from './stockAdjustmentHelpers'

type SelectedAdjustmentForSave = { id: string; isEditing?: boolean } | null | undefined

interface SaveStockAdjustmentDraftParams {
  supabase: SupabaseClient<Database>
  form: AdjustmentFormState
  orgId: string
  userId: string
  selectedAdjustment: SelectedAdjustmentForSave
}

type AdjustmentTotals = ReturnType<typeof calculateAdjustmentTotals>

function throwIfSupabaseError(error: unknown): void {
  if (error) throw error
}

async function updateExistingAdjustment(
  supabase: SupabaseClient<Database>, form: AdjustmentFormState,
  totals: AdjustmentTotals, orgId: string, adjustmentId: string,
) {
  const { data: updatedAdjustment, error: updateError } = await supabase
    .from('stock_adjustments')
    .update({
      adjustment_date: form.adjustment_date,
      posting_date: form.adjustment_date,
      adjustment_type: form.adjustment_type,
      reason: form.reason,
      reference_number: form.reference_number || null,
      warehouse_id: form.warehouse_id,
      increase_account_id: form.increase_account_id,
      decrease_account_id: form.decrease_account_id,
      total_items: totals.totalItems,
      total_qty_difference: totals.totalQtyDiff,
      total_value_difference: totals.totalValueDiff,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adjustmentId)
    .eq('organization_id', orgId)
    .select()
    .single()
  throwIfSupabaseError(updateError)

  const { error: deleteError } = await supabase
    .from('stock_adjustment_items')
    .delete()
    .eq('adjustment_id', adjustmentId)
    .eq('organization_id', orgId)
  throwIfSupabaseError(deleteError)
  return updatedAdjustment!
}

async function createAdjustment(
  supabase: SupabaseClient<Database>, form: AdjustmentFormState,
  totals: AdjustmentTotals, orgId: string, userId: string,
) {
  const { data: newAdjustment, error: adjustmentError } = await supabase
    .from('stock_adjustments')
    .insert({
      organization_id: orgId,
      adjustment_date: form.adjustment_date,
      adjustment_number: `ADJ-${Date.now()}`,
      posting_date: form.adjustment_date,
      adjustment_type: form.adjustment_type,
      reason: form.reason,
      reference_number: form.reference_number || null,
      warehouse_id: form.warehouse_id,
      increase_account_id: form.increase_account_id,
      decrease_account_id: form.decrease_account_id,
      status: 'DRAFT',
      total_items: totals.totalItems,
      total_qty_difference: totals.totalQtyDiff,
      total_value_difference: totals.totalValueDiff,
      created_by: userId,
    })
    .select()
    .single()
  throwIfSupabaseError(adjustmentError)
  return newAdjustment!
}

async function insertAdjustmentItems(
  supabase: SupabaseClient<Database>, form: AdjustmentFormState,
  orgId: string, adjustmentId: string,
): Promise<void> {
  const itemsToInsert = form.items.map((item) => ({
    adjustment_id: adjustmentId,
    organization_id: orgId,
    product_id: item.product_id,
    warehouse_id: item.warehouse_id || form.warehouse_id,
    current_qty: item.current_qty,
    new_qty: item.new_qty,
    difference_qty: item.difference_qty,
    current_rate: item.current_rate,
    value_difference: item.value_difference,
    reason: item.reason || null,
  }))
  const { error: itemsError } = await supabase
    .from('stock_adjustment_items')
    .insert(itemsToInsert)
  throwIfSupabaseError(itemsError)
}

export async function saveStockAdjustmentDraft({
  supabase, form, orgId, userId, selectedAdjustment,
}: SaveStockAdjustmentDraftParams): Promise<{ isEditing: boolean }> {
  const totals = calculateAdjustmentTotals(form.items)
  const isEditing = Boolean(selectedAdjustment?.isEditing)
  const adjustment = selectedAdjustment?.isEditing
    ? await updateExistingAdjustment(supabase, form, totals, orgId, selectedAdjustment.id)
    : await createAdjustment(supabase, form, totals, orgId, userId)
  await insertAdjustmentItems(supabase, form, orgId, adjustment.id)
  return { isEditing }
}
