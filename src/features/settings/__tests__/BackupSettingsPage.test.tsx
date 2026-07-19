import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { BackupSettingsPage } from '../BackupSettingsPage'

const mocks = vi.hoisted(() => ({
  fetchExportRows: vi.fn(),
  toCSV: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/services/org-settings-service', () => ({
  EXPORTABLE_TABLES: ['products', 'customers'],
  fetchExportRows: mocks.fetchExportRows,
  toCSV: mocks.toCSV,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.success,
    info: mocks.info,
    error: mocks.error,
  },
}))

describe('BackupSettingsPage data export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchExportRows.mockResolvedValue([{ id: '1' }])
    mocks.toCSV.mockReturnValue('id\n1')
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  it('renders accurate English export scope and exports one table', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    render(<BackupSettingsPage />)

    expect(screen.getByRole('heading', { name: 'Data Export' })).toBeInTheDocument()
    expect(screen.getByText(/not a complete restorable backup/i)).toBeInTheDocument()
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'JSON' })[0])

    await waitFor(() => {
      expect(mocks.fetchExportRows).toHaveBeenCalledWith('products')
      expect(mocks.success).toHaveBeenCalled()
    })
  })

  it('uses Arabic RTL labels for ar-SA and reports empty exports', async () => {
    await act(async () => {
      await i18n.changeLanguage('ar-SA')
    })
    mocks.fetchExportRows.mockResolvedValueOnce([])

    const { container } = render(<BackupSettingsPage />)

    expect(screen.getByRole('heading', { name: 'تصدير البيانات' })).toBeInTheDocument()
    expect(screen.getByText('المنتجات')).toBeInTheDocument()
    expect(container.querySelector('[dir="rtl"]')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'JSON' })[0])

    await waitFor(() => {
      expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('لا توجد بيانات'))
    })
  })
})
