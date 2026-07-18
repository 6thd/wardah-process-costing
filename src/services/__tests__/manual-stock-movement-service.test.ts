import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc }),
}))

import { manualStockMovementService } from '../manual-stock-movement-service'

describe('manualStockMovementService', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('delegates the movement to the atomic RPC', async () => {
    rpc.mockResolvedValue({
      data: { applied: true, new_qty: 12 },
      error: null,
    })

    const result = await manualStockMovementService.apply({
      productId: '00000000-0000-0000-0000-000000000010',
      quantity: 2,
      movementType: 'out',
      warehouseId: '00000000-0000-0000-0000-000000000020',
      notes: 'cycle count',
    })

    expect(rpc).toHaveBeenCalledWith('rpc_manual_stock_movement', {
      p_product_id: '00000000-0000-0000-0000-000000000010',
      p_quantity: 2,
      p_movement_type: 'out',
      p_warehouse_id: '00000000-0000-0000-0000-000000000020',
      p_notes: 'cycle count',
    })
    expect(result).toEqual({ applied: true, new_qty: 12 })
  })

  it('rejects invalid quantities before calling the database', async () => {
    await expect(
      manualStockMovementService.apply({
        productId: 'product',
        quantity: -1,
        movementType: 'in',
      }),
    ).rejects.toThrow('Quantity must be a non-negative number')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    const error = new Error('WAREHOUSE_REQUIRED')
    rpc.mockResolvedValue({ data: null, error })

    await expect(
      manualStockMovementService.apply({
        productId: 'product',
        quantity: 1,
        movementType: 'in',
      }),
    ).rejects.toBe(error)
  })
})
