/**
 * OrganizationSelector component tests
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
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
  it('renders current organization name', () => {
    render(<OrganizationSelector />)
    expect(screen.getByText(/المنظمة الأولى|Org One/)).toBeInTheDocument()
  })

  it('shows dropdown and allows selection', () => {
    render(<OrganizationSelector />)

    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)

    expect(screen.getByText(/Org Two/)).toBeInTheDocument()
  })
})

