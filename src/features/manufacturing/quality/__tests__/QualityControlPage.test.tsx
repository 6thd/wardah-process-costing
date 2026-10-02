import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QualityCapabilities, QualityPolicy } from '@/services/manufacturing/qualityService'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ currentOrgId: 'org-1' }) }))
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermissionKey: () => true }) }))
vi.mock('../InspectionDialog', () => ({ InspectionDialog: () => null }))

const queueQuery = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[]; enabled?: boolean }) => queueQuery(options),
}))

const state = vi.hoisted(() => ({ policy: null as QualityPolicy | null, holdMutate: vi.fn() }))
vi.mock('@/hooks/manufacturing/useQuality', () => ({
  useQualityPolicy: () => ({ data: state.policy, isLoading: false, isError: false, error: null }),
  useQualityInspections: () => ({ data: [], isLoading: false, isError: false }),
  useMoQualityStatus: () => ({ data: undefined, isLoading: true, isError: false }),
  useSetMoQualityHold: () => ({ mutate: state.holdMutate, isPending: false }),
}))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { QualityControlPage } from '../QualityControlPage'

const ORDERS = [
  { id: 'mo-1', order_number: 'MO-1', status: 'in_progress', quantity: 10, maintenance_version: 1 },
  { id: 'mo-2', order_number: 'MO-2', status: 'quality_check', quantity: 5, maintenance_version: 3 },
]

function setPolicy(capabilities: Partial<QualityCapabilities>) {
  state.policy = {
    org_id: 'org-1', release_gate_mode: 'all_orders', inspection_scope: 'final_only',
    allow_conditional_release: false, segregation_of_duties: true,
    admins_subject_to_quality_controls: true, version: 1, updated_at: null, updated_by: null,
    capabilities: {
      can_manage_policy: false, can_read: false, can_inspect: false, can_approve_conditional: false,
      ...capabilities,
    },
  }
}

function renderPage() {
  return render(<MemoryRouter><QualityControlPage /></MemoryRouter>)
}

beforeEach(() => {
  queueQuery.mockImplementation(({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => (
    queryKey[0] === 'manufacturing-quality-queue' && enabled
      ? { data: ORDERS, isLoading: false, isError: false }
      : { data: undefined, isLoading: false, isError: false }
  ))
})

describe('QualityControlPage', () => {
  it('without the read capability it shows why and loads no orders', () => {
    setPolicy({ can_read: false })
    renderPage()
    expect(screen.getByText('quality.page.noReadPermission')).toBeInTheDocument()
    expect(screen.queryByText('MO-1')).not.toBeInTheDocument()
  })

  it('a reader sees the queue and the gate state but no write actions', () => {
    setPolicy({ can_read: true })
    renderPage()
    expect(screen.getByText('MO-1')).toBeInTheDocument()
    expect(screen.getByText('quality.page.gateOn')).toBeInTheDocument()
    expect(screen.getByText('quality.page.noInspectPermission')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'quality.page.actions.inspect' })).not.toBeInTheDocument()
  })

  it('an inspector gets hold for in-progress orders and return for orders under inspection', () => {
    setPolicy({ can_read: true, can_inspect: true })
    renderPage()
    expect(screen.getAllByRole('button', { name: 'quality.page.actions.inspect' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'quality.page.actions.hold' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'quality.page.actions.return' })).toHaveLength(1)
  })

  it('hold sends the loaded version; return requires a reason before it can be sent', () => {
    setPolicy({ can_read: true, can_inspect: true })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'quality.page.actions.hold' }))
    expect(state.holdMutate).toHaveBeenCalledWith(
      { moId: 'mo-1', action: 'hold', expectedVersion: 1 }, expect.any(Object))

    fireEvent.click(screen.getByRole('button', { name: 'quality.page.actions.return' }))
    const confirm = screen.getByRole('button', { name: 'quality.page.returnConfirm' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('quality.page.returnReason'), { target: { value: 'seal leak' } })
    fireEvent.click(confirm)
    expect(state.holdMutate).toHaveBeenLastCalledWith(
      { moId: 'mo-2', action: 'return', expectedVersion: 3, reason: 'seal leak' }, expect.any(Object))
  })
})
