import { beforeEach, describe, expect, it, vi } from 'vitest'

const state: { savedValue: unknown; upserts: unknown[] } = {
  savedValue: null,
  upserts: [],
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = () => Promise.resolve({
    data: state.savedValue === null ? null : { value: state.savedValue },
    error: null,
  })
  chain.upsert = (row: unknown, options: unknown) => {
    state.upserts.push({ table, row, options })
    return Promise.resolve({ error: null })
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => makeChain(table) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}))

import {
  getUomEngineEnabled,
  setUomEngineEnabled,
  UOM_ENGINE_SETTING_KEY,
} from '../org-settings-service'

describe('UoM engine organization setting', () => {
  beforeEach(() => {
    state.savedValue = null
    state.upserts = []
  })

  it('defaults to false when no setting exists', async () => {
    await expect(getUomEngineEnabled()).resolves.toBe(false)
  })

  it('enables only for the explicit object value', async () => {
    state.savedValue = { enabled: true }
    await expect(getUomEngineEnabled()).resolves.toBe(true)

    state.savedValue = { enabled: false }
    await expect(getUomEngineEnabled()).resolves.toBe(false)

    state.savedValue = true
    await expect(getUomEngineEnabled()).resolves.toBe(false)
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
