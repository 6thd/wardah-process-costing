import { act, render, screen } from '@/test/test-utils'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { SettingsModule } from '../index'

vi.mock('../CompanySettings', () => ({ CompanySettings: () => <div>Company settings page</div> }))
vi.mock('../SystemSettingsPage', () => ({ SystemSettingsPage: () => <div>System settings page</div> }))
vi.mock('../BackupSettingsPage', () => ({ BackupSettingsPage: () => <div>Data export page</div> }))

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
  it('shows only working settings destinations in English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    renderSettings()

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Data Export' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Data Export/ })).toHaveAttribute('href', '/settings/backup')
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
})
