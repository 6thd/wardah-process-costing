/**
 * ALIGN-P1 review follow-up: two real functional-authorization dead ends
 * caught in independent review of PR #193 (head d357a2a).
 *
 * 1. Collapsed sidebar always linked a visible GROUP to item.href, even when
 *    the caller was only permitted a CHILD route (e.g. General Ledger-only
 *    access to Accounting) — clicking sent them to a root ModuleGuard would
 *    reject. Fixed by landingHref: falls back to the first visible child.
 * 2. Expanded/mobile rendered a childless-but-visible group (e.g. Settings
 *    for a settings.users.read-only caller, whose only children require
 *    settings.organization.read) as a plain button/div with no navigation
 *    at all — a dead end even though /settings itself is directly
 *    enterable. Fixed by rendering a real link to landingHref when there
 *    are no visible children left to expand into.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { usePermissions } from '@/hooks/usePermissions'
import { useUIStore } from '@/store/ui-store'
import i18n from '@/i18n'

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('@/store/ui-store', () => ({
  useUIStore: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', email: 'test@test.com' },
    session: null,
    organizations: [],
    currentOrgId: 'org-1',
    setCurrentOrgId: vi.fn(),
    signOut: vi.fn(),
    isLoading: false,
  })),
}))

function mockPermissions(hasPermissionKey: (key: string) => boolean) {
  ;(usePermissions as any).mockReturnValue({
    isOrgAdmin: false,
    isSuperAdmin: false,
    hasPermissionKey,
    permissions: [],
    loading: false,
    error: null,
  })
}

function mockUiStore(sidebarCollapsed: boolean) {
  ;(useUIStore as any).mockReturnValue({
    sidebarCollapsed,
    sidebarOpen: false,
    setSidebarOpen: vi.fn(),
  })
}

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar — landingHref (ALIGN-P1 review fixes)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('collapsed: General Ledger-only caller lands on /general-ledger/accounts, never on /accounting', () => {
    mockPermissions(key => key === 'general_ledger.chart_of_accounts.view')
    mockUiStore(true)

    const { container } = renderSidebar()
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'))

    expect(hrefs).toContain('/general-ledger/accounts')
    expect(hrefs).not.toContain('/accounting')
  })

  it('collapsed: a caller who genuinely satisfies the Accounting root still lands on /accounting', () => {
    mockPermissions(key => key === 'accounting.journals.read')
    mockUiStore(true)

    const { container } = renderSidebar()
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'))

    expect(hrefs).toContain('/accounting')
  })

  it('expanded: settings.users.read-only caller gets a real /settings link, not a dead button', () => {
    mockPermissions(key => key === 'settings.users.read')
    mockUiStore(false)

    renderSidebar()

    const settingsLink = screen.getByRole('link', { name: i18n.t('navigation.settings') })
    expect(settingsLink).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button', { name: i18n.t('navigation.settings') })).not.toBeInTheDocument()
  })

  it('expanded: a caller with a visible child still gets an expandable group, not a direct link', () => {
    mockPermissions(key => key === 'settings.organization.read')
    mockUiStore(false)

    renderSidebar()

    expect(screen.getByRole('button', { name: i18n.t('navigation.settings') })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('navigation.settings') })).not.toBeInTheDocument()
  })
})
