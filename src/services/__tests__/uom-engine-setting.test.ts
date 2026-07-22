import { beforeEach, describe, expect, it, vi } from 'vitest'

const state: {
  rpcResult: { data: unknown; error: unknown }
  rpcCalls: Array<{ fn: string; args: unknown }>
  upserts: unknown[]
} = {
  rpcResult: { data: false, error: null },
  rpcCalls: [],
  upserts: [],
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  chain.upsert = (row: unknown, options: unknown) => {
    state.upserts.push({ table, row, options })
    return Promise.resolve({ error: null })
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeChain(table),
    rpc: (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args })
      return Promise.resolve(state.rpcResult)
    },
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}))

import {
  getUomEngineEnabled,
  setUomEngineEnabled,
  UOM_ENGINE_SETTING_KEY,
} from '../org-settings-service'

describe('UoM engine organization setting', () => {
  beforeEach(() => {
    state.rpcResult = { data: false, error: null }
    state.rpcCalls = []
    state.upserts = []
  })

  it('reads the flag through the org-scoped RPC with the explicit org id', async () => {
    state.rpcResult = { data: true, error: null }

    await expect(getUomEngineEnabled('org-7')).resolves.toBe(true)
    expect(state.rpcCalls).toEqual([
      { fn: 'rpc_get_org_uom_engine_enabled', args: { p_org_id: 'org-7' } },
    ])
  })

  it('fails closed for false or null RPC results', async () => {
    state.rpcResult = { data: false, error: null }
    await expect(getUomEngineEnabled('org-1')).resolves.toBe(false)

    state.rpcResult = { data: null, error: null }
    await expect(getUomEngineEnabled('org-1')).resolves.toBe(false)
  })

  it('throws when the RPC returns an error', async () => {
    state.rpcResult = { data: null, error: { message: 'ORG_MEMBERSHIP_REQUIRED' } }

    await expect(getUomEngineEnabled('org-1')).rejects.toThrow('ORG_MEMBERSHIP_REQUIRED')
  })

  it('stores a structured JSONB value under the rollout key', async () => {
    await setUomEngineEnabled(true)

    expect(state.upserts).toHaveLength(1)
    const write = state.upserts[0] as {
      table: string
      row: { org_id: string; key: string; value: unknown }
      options: { onConflict: string }
    }
    expect(write.table).toBe('org_settings')
    expect(write.row).toEqual({
      org_id: 'org-1',
      key: UOM_ENGINE_SETTING_KEY,
      value: { enabled: true },
    })
    expect(write.options.onConflict).toBe('org_id,key')
  })
})
