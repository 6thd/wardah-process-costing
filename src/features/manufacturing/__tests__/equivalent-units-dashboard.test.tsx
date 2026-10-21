/**
 * Equivalent Units Dashboard — #260 interim honest state.
 * Rejects the former placeholder behaviour: fake actions with success toasts, hard-coded MO-2023-* orders and static
 * EU / cost-per-unit figures. The page must state that the calculation is unavailable, show no figure and offer no action.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../../../test/test-utils'
import { EquivalentUnitsDashboard } from '../equivalent-units-dashboard'

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key'

const from = vi.fn()
const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a), auth: { getUser: vi.fn() } },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('test-tenant-id')),
}))

const toast = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

describe('EquivalentUnitsDashboard (#260 interim)', () => {
  beforeEach(() => {
    from.mockReset()
    rpc.mockReset()
    toast.mockReset()
  })

  it('states that the calculation is unavailable', () => {
    render(<EquivalentUnitsDashboard />)
    expect(screen.getByTestId('equivalent-units-unavailable')).toBeInTheDocument()
    expect(screen.getByText('manufacturing.equivalentUnitsPage.unavailable.title')).toBeInTheDocument()
    expect(screen.getByText('manufacturing.equivalentUnitsPage.unavailable.body')).toBeInTheDocument()
  })

  it('offers no action and no input that could look like a calculation', () => {
    const { container } = render(<EquivalentUnitsDashboard />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelectorAll('input, select, form')).toHaveLength(0)
  })

  it('shows no fabricated order or figure', () => {
    const { container } = render(<EquivalentUnitsDashboard />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/MO-2023/)
    expect(text).not.toMatch(/\d/)
    expect(container.querySelector('.recharts-wrapper, svg.recharts-surface, table')).toBeNull()
  })

  it('makes no request and shows no toast', () => {
    render(<EquivalentUnitsDashboard />)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
