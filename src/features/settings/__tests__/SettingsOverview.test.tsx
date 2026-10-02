import { act, render, screen } from '@/test/test-utils'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { SettingsModule } from '../index'

// Decorative SVGs are outside this route/permission/localization contract.
// Keep every heading, link and visibility assertion; avoid cold jsdom SVG style work.
vi.mock('lucide-react', () => ({
  Settings: () => null, Building: () => null, Users: () => null,
  Shield: () => null, Cog: () => null, Database: () => null, ClipboardCheck: () => null,
}))

vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <header>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  ),
}))
vi.mock('../CompanySettings', () => ({ CompanySettings: () => <div>Company settings page</div> }))
vi.mock('../SystemSettingsPage', () => ({ SystemSettingsPage: () => <div>System settings page</div> }))
vi.mock('../BackupSettingsPage', () => ({ BackupSettingsPage: () => <div>Data export page</div> }))
vi.mock('../QualitySettingsPage', () => ({ QualitySettingsPage: () => <div>Quality settings page</div> }))

const hasPermissionKeyMock = vi.fn((_key: string) => true)
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}))

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key))
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings/*" element={<SettingsModule />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Settings overview', () => {
  beforeEach(() => {
    hasPermissionKeyMock.mockReset()
    hasPermissionKeyMock.mockReturnValue(true)
  })

  it('shows only working settings destinations in English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    renderSettings()

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    const exportHeading = screen.getByRole('heading', { name: 'Data Export' })
    expect(exportHeading.closest('a')).toHaveAttribute('href', '/settings/backup')
    expect(screen.queryByText('Integrations')).not.toBeInTheDocument()
    expect(screen.queryByText('Active users')).not.toBeInTheDocument()
    expect(screen.queryByText('System Status')).not.toBeInTheDocument()
    expect(screen.getByText('Manual organization data export for review or transfer')).toBeInTheDocument()
  })

  it('renders the overview in RTL for ar-SA', async () => {
    await act(async () => {
      await i18n.changeLanguage('ar-SA')
    })

    const { container } = renderSettings()

    expect(screen.getByRole('heading', { name: 'الإعدادات' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'تصدير البيانات' })).toBeInTheDocument()
    expect(container.querySelector('[dir="rtl"]')).toBeInTheDocument()
  })

  describe('cards are bound to their exact route-permissions key', () => {
    it('settings.organization.read alone shows Company/System/Backup but not the org-admin cards', async () => {
      await act(async () => { await i18n.changeLanguage('en') })
      setPermissions(['settings.organization.read'])

      renderSettings()

      expect(screen.getByRole('heading', { name: 'Company Profile' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'System Settings' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Data Export' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'User Management' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Security & Access' })).not.toBeInTheDocument()
    })

    it('settings.users.read alone shows User Management but not Security & Access or organization.read cards', async () => {
      await act(async () => { await i18n.changeLanguage('en') })
      setPermissions(['settings.users.read'])

      renderSettings()

      expect(screen.getByRole('heading', { name: 'User Management' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Security & Access' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Company Profile' })).not.toBeInTheDocument()
    })

    it('settings.roles.read alone shows only Security & Access, not User Management or organization.read cards', async () => {
      await act(async () => { await i18n.changeLanguage('en') })
      setPermissions(['settings.roles.read'])

      renderSettings()

      expect(screen.getByRole('heading', { name: 'Security & Access' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'User Management' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Company Profile' })).not.toBeInTheDocument()
    })

    it('no permissions at all renders an empty grid, not every card', async () => {
      await act(async () => { await i18n.changeLanguage('en') })
      setPermissions([])

      renderSettings()

      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Company Profile' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'User Management' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Security & Access' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'System Settings' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Data Export' })).not.toBeInTheDocument()
    })
  })

  it('the Quality card follows manufacturing.quality_inspections.read alone', async () => {
    await act(async () => { await i18n.changeLanguage('en') })
    setPermissions(['manufacturing.quality_inspections.read'])

    renderSettings()

    expect(screen.getByRole('heading', { name: 'Quality' }).closest('a')).toHaveAttribute('href', '/settings/quality')
    expect(screen.queryByRole('heading', { name: 'Company Profile' })).not.toBeInTheDocument()
  })

  it('no quality key, no Quality card', async () => {
    await act(async () => { await i18n.changeLanguage('en') })
    setPermissions(['settings.organization.read'])

    renderSettings()

    expect(screen.queryByRole('heading', { name: 'Quality' })).not.toBeInTheDocument()
  })
})
