import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QualityPolicy } from '@/services/manufacturing/qualityService'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

const mocks = vi.hoisted(() => ({
  policy: null as QualityPolicy | null,
  mutate: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock('@/hooks/manufacturing/useQuality', () => ({
  useQualityPolicy: () => ({
    data: mocks.policy, isLoading: false, isError: false, error: null, refetch: mocks.refetch,
  }),
  useSaveQualityPolicy: () => ({ mutate: mocks.mutate, isPending: false }),
}))

import { QualitySettingsPage } from '../QualitySettingsPage'

function policy(canManage: boolean): QualityPolicy {
  return {
    org_id: 'org-1',
    release_gate_mode: 'off',
    inspection_scope: 'final_only',
    allow_conditional_release: false,
    segregation_of_duties: true,
    admins_subject_to_quality_controls: true,
    version: 4,
    updated_at: null,
    updated_by: null,
    capabilities: {
      can_manage_policy: canManage, can_read: true, can_inspect: false, can_approve_conditional: false,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('QualitySettingsPage', () => {
  it('shows every inventory decision, including the pending scrap-accounting one', () => {
    mocks.policy = policy(true)
    render(<QualitySettingsPage />)
    for (const q of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) {
      expect(screen.getByText(`quality.settings.${q}.title`)).toBeInTheDocument()
    }
    expect(screen.getByText('quality.settings.q4.badge')).toBeInTheDocument()
  })

  it('is read-only when the server says the user cannot manage the policy', () => {
    mocks.policy = policy(false)
    render(<QualitySettingsPage />)
    expect(screen.getByText('quality.settings.readOnly')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'quality.settings.save' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('quality.settings.q5.label')).toBeDisabled()
  })

  it('saves only after a change, with the version it loaded', () => {
    mocks.policy = policy(true)
    render(<QualitySettingsPage />)
    const save = screen.getByRole('button', { name: 'quality.settings.save' })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByLabelText('quality.settings.q5.label'))
    expect(save).toBeEnabled()
    fireEvent.click(save)

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        settings: expect.objectContaining({ segregation_of_duties: false, release_gate_mode: 'off' }),
        expectedVersion: 4,
      },
      expect.any(Object),
    )
  })
})
