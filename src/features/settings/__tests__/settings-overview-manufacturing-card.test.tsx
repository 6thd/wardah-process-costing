import { act, render, screen } from '@/test/test-utils'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { SettingsModule } from '../index'

vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock('../CompanySettings', () => ({ CompanySettings: () => <div>Company settings page</div> }))
vi.mock('../SystemSettingsPage', () => ({ SystemSettingsPage: () => <div>System settings page</div> }))
vi.mock('../BackupSettingsPage', () => ({ BackupSettingsPage: () => <div>Data export page</div> }))
vi.mock('../manufacturing/ManufacturingSettingsPage', () => ({
  ManufacturingSettingsPage: () => <div>Manufacturing settings page</div>,
}))

const keys = { current: [] as string[] }
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => keys.current.includes(key) }),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/*" element={<SettingsModule />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Settings overview — manufacturing settings card', () => {
  beforeEach(async () => {
    await act(async () => { await i18n.changeLanguage('en') })
  })

  it.each([['manufacturing.settings.read'], ['manufacturing.settings.update']])(
    '%s alone shows only the Manufacturing Settings card, linked to /settings/manufacturing',
    (key) => {
      keys.current = [key]
      renderAt('/settings')

      const heading = screen.getByRole('heading', { name: 'Manufacturing Settings' })
      expect(heading.closest('a')).toHaveAttribute('href', '/settings/manufacturing')
      expect(screen.queryByRole('heading', { name: 'Company Profile' })).not.toBeInTheDocument()
    },
  )

  it('manufacturing operation keys and organization keys do not show the card', () => {
    keys.current = ['settings.organization.read', 'manufacturing.orders.read', 'manufacturing.stage_costs.read']
    renderAt('/settings')

    expect(screen.queryByRole('heading', { name: 'Manufacturing Settings' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Company Profile' })).toBeInTheDocument()
  })

  it('routes /settings/manufacturing to the manufacturing settings page', () => {
    keys.current = ['manufacturing.settings.read']
    renderAt('/settings/manufacturing')

    expect(screen.getByText('Manufacturing settings page')).toBeInTheDocument()
  })
})
