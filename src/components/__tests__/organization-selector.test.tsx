/**
 * OrganizationSelector component tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import i18n from '@/i18n'
import { OrganizationSelector } from '../organization-selector'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    organizations: [
      {
        org_id: 'org-1',
        role: 'admin',
        organization: {
          name: 'Org One',
          name_ar: 'المنظمة الأولى',
          name_en: 'Organization One',
          code: 'ORG1',
          logo_url: null,
        },
      },
      {
        org_id: 'org-2',
        role: 'manager',
        organization: {
          name: 'Org Two',
          name_ar: 'المنظمة الثانية',
          name_en: 'Organization Two',
          code: 'ORG2',
          logo_url: 'https://example.com/logo.png',
        },
      },
    ],
    currentOrgId: 'org-1',
    setCurrentOrgId: vi.fn(),
  })),
}))

describe('OrganizationSelector', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('ar')
    })
  })

  it('renders the current organization name in Arabic', () => {
    render(<OrganizationSelector />)
    expect(screen.getByRole('combobox')).toHaveTextContent('المنظمة الأولى')
  })

  it('shows the Arabic organization names in the dropdown', () => {
    render(<OrganizationSelector />)

    fireEvent.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: /المنظمة الثانية/ })).toBeInTheDocument()
  })

  it('renders English organization names after switching language', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    render(<OrganizationSelector />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('Organization One')

    fireEvent.click(trigger)

    expect(screen.getByRole('option', { name: /Organization One/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Organization Two/ })).toBeInTheDocument()
    expect(screen.queryByText('المنظمة الثانية')).not.toBeInTheDocument()
  })
})
