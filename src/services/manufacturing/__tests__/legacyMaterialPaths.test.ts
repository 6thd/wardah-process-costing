import { describe, expect, it, vi } from 'vitest'
import { supabase } from '@/lib/supabase'
import { inventoryTransactionService } from '@/services/inventory-transaction-service'
import { mesService } from '../mesService'

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
  getEffectiveTenantId: vi.fn(),
}))

describe('retired material write entry points', () => {
  it('rejects the eventless reservation service before any database call', async () => {
    await expect(inventoryTransactionService.consumeReservedMaterials('mo', [])).rejects.toMatchObject({
      code: 'MATERIAL_ISSUE_LEGACY_RETIRED',
    })
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('rejects direct material insert and legacy backflush before any database call', async () => {
    await expect(mesService.consumeMaterial('wo', 'item', 1, 99)).rejects.toThrow('MATERIAL_ISSUE_LEGACY_RETIRED')
    await expect(mesService.backflushMaterials('wo', 1)).rejects.toThrow('BACKFLUSH_RETIRED')
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
