import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ currentOrgId: 'org-1' as string | null }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))

const service = vi.hoisted(() => ({
  getQualityPolicy: vi.fn(),
  setQualityPolicy: vi.fn(),
  listQualityInspections: vi.fn(),
  getMoQualityStatus: vi.fn(),
  recordQualityInspection: vi.fn(),
  setMoQualityHold: vi.fn(),
}))
vi.mock('@/services/manufacturing/qualityService', () => ({ qualityService: service }))

import {
  qualityKeys,
  useMoQualityStatus,
  useQualityInspections,
  useQualityPolicy,
  useRecordQualityInspection,
  useSaveQualityPolicy,
  useSetMoQualityHold,
} from '../useQuality'

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const SETTINGS = {
  release_gate_mode: 'all_orders' as const,
  inspection_scope: 'final_only' as const,
  allow_conditional_release: false,
  segregation_of_duties: true,
  admins_subject_to_quality_controls: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.currentOrgId = 'org-1'
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

describe('useQuality hooks', () => {
  it('reads the policy for the current organization only', async () => {
    service.getQualityPolicy.mockResolvedValue({ version: 1 })
    const { result } = renderHook(() => useQualityPolicy(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(service.getQualityPolicy).toHaveBeenCalledWith('org-1')
  })

  it('sends nothing without an organization', () => {
    auth.currentOrgId = null
    renderHook(() => useQualityPolicy(), { wrapper })
    renderHook(() => useQualityInspections(), { wrapper })
    expect(service.getQualityPolicy).not.toHaveBeenCalled()
    expect(service.listQualityInspections).not.toHaveBeenCalled()
  })

  it('caches the saved policy under the org key', async () => {
    service.setQualityPolicy.mockResolvedValue({ version: 5 })
    const { result } = renderHook(() => useSaveQualityPolicy(), { wrapper })
    await act(() => result.current.mutateAsync({ settings: SETTINGS, expectedVersion: 4 }))
    expect(service.setQualityPolicy).toHaveBeenCalledWith('org-1', SETTINGS, 4)
    expect(client.getQueryData(qualityKeys.policy('org-1'))).toEqual({ version: 5 })
  })

  it('lists inspections and reads one order release status', async () => {
    service.listQualityInspections.mockResolvedValue([])
    service.getMoQualityStatus.mockResolvedValue({ mo_id: 'mo-1' })
    const list = renderHook(() => useQualityInspections('mo-1'), { wrapper })
    const status = renderHook(() => useMoQualityStatus('mo-1'), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess && status.result.current.isSuccess).toBe(true))
    expect(service.listQualityInspections).toHaveBeenCalledWith('org-1', 'mo-1')
    expect(service.getMoQualityStatus).toHaveBeenCalledWith('mo-1')
  })

  it('writes through the service and refreshes quality queries', async () => {
    service.recordQualityInspection.mockResolvedValue({ inspection_number: 'QI-000001' })
    service.setMoQualityHold.mockResolvedValue({ status: 'quality_check' })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const input = { inspection_type: 'FINAL' as const, result: 'PASS' as const, passed_quantity: 1, failed_quantity: 0 }

    const record = renderHook(() => useRecordQualityInspection(), { wrapper })
    await act(() => record.result.current.mutateAsync({ moId: 'mo-1', requestId: 'req-1', input }))
    expect(service.recordQualityInspection).toHaveBeenCalledWith('mo-1', 'req-1', input)

    const hold = renderHook(() => useSetMoQualityHold(), { wrapper })
    await act(() => hold.result.current.mutateAsync({ moId: 'mo-1', action: 'hold', expectedVersion: 2 }))
    expect(service.setMoQualityHold).toHaveBeenCalledWith('mo-1', 'hold', 2, undefined)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qualityKeys.all })
  })

  it('refuses to save without an organization', async () => {
    auth.currentOrgId = null
    const { result } = renderHook(() => useSaveQualityPolicy(), { wrapper })
    await expect(result.current.mutateAsync({ settings: SETTINGS, expectedVersion: 1 }))
      .rejects.toThrow('ORG_UNRESOLVED')
  })
})
