import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc }),
}))

import { stockAdjustmentService } from '../stock-adjustment-service'

describe('stockAdjustmentService atomic write flow', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('creates an adjustment through one RPC and maps legacy account aliases', async () => {
    rpc.mockResolvedValue({
      data: {
        success: true,
        adjustment_id: 'adjustment-id',
        adjustment_number: 'ADJ-1',
      },
      error: null,
    })

    const result = await stockAdjustmentService.createAdjustment({
      adjustment_date: '2026-07-18',
      adjustment_type: 'DAMAGE',
      reason: 'damaged stock',
      total_value_difference: -50,
      status: 'DRAFT',
      requires_approval: false,
      inventory_account_id: 'inventory-account',
      expense_account_id: 'expense-account',
      gain_account_id: 'gain-account',
      items: [
        {
          product_id: 'product-id',
          current_qty: 10,
          new_qty: 9,
          difference_qty: -1,
          current_rate: 50,
          value_difference: -50,
          warehouse_id: 'warehouse-id',
        },
      ],
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'rpc_create_stock_adjustment',
      expect.objectContaining({
        p_payload: expect.objectContaining({
          inventory_account_id: 'inventory-account',
          increase_account_id: 'gain-account',
          decrease_account_id: 'expense-account',
          items: expect.any(Array),
        }),
      }),
    )
    expect(result).toEqual({
      id: 'adjustment-id',
      adjustment_number: 'ADJ-1',
      status: 'DRAFT',
    })
  })

  it('submits through the atomic RPC', async () => {
    rpc.mockResolvedValue({
      data: { success: true, gl_entry_id: 'gl-id' },
      error: null,
    })

    const result = await stockAdjustmentService.submitAdjustment(
      'adjustment-id',
      'legacy-user-id',
    )

    expect(rpc).toHaveBeenCalledWith('rpc_submit_stock_adjustment', {
      p_adjustment_id: 'adjustment-id',
    })
    expect(result.glEntryId).toBe('gl-id')
  })

  it('cancels through the atomic RPC with a mandatory reason', async () => {
    rpc.mockResolvedValue({
      data: { success: true, reversal_gl_entry_id: 'reversal-id' },
      error: null,
    })

    const result = await stockAdjustmentService.cancelAdjustment(
      'adjustment-id',
      'approved correction',
    )

    expect(rpc).toHaveBeenCalledWith('rpc_cancel_stock_adjustment', {
      p_adjustment_id: 'adjustment-id',
      p_reason: 'approved correction',
    })
    expect(result.reversalGlEntryId).toBe('reversal-id')
  })

  it('does not call the database when cancellation reason is empty', async () => {
    await expect(
      stockAdjustmentService.cancelAdjustment('adjustment-id', '   '),
    ).rejects.toThrow('سبب الإلغاء مطلوب')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a logical RPC failure even when transport has no error', async () => {
    rpc.mockResolvedValue({
      data: { success: false, error: 'INVENTORY_ACCOUNT_REQUIRED' },
      error: null,
    })

    await expect(
      stockAdjustmentService.submitAdjustment('adjustment-id', 'user-id'),
    ).rejects.toThrow('INVENTORY_ACCOUNT_REQUIRED')
  })
})
