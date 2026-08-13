import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllSupplierPayments: vi.fn(),
  getSupplierOutstandingInvoices: vi.fn(),
  updateSupplierPaymentDraft: vi.fn(),
  postSupplierPayment: vi.fn(),
  resetSupplierPaymentToDraft: vi.fn(),
  cancelSupplierPayment: vi.fn(),
  createSupplierPayment: vi.fn(),
  getPaymentAccounts: vi.fn(),
  toastError: vi.fn(),
  permissionKeys: new Set<string>(),
}))

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => mocks.permissionKeys.has(key),
  }),
}))

vi.mock('@/services/payment-vouchers-service', () => ({
  ...mocks,
}))

vi.mock('@/services/supabase-service', () => ({
  vendorsService: { getAll: vi.fn().mockResolvedValue([]) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}))

import { SupplierPayments } from '../SupplierPayments'

function rerenderPayments(rerender: (ui: Parameters<typeof render>[0]) => void) {
  rerender(<SupplierPayments />)
}

describe('SupplierPayments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permissionKeys.clear()
    mocks.getAllSupplierPayments.mockResolvedValue({
      success: true,
      data: [{
        id: 'payment-1',
        payment_number: 'SP-202608-00001',
        vendor_id: 'vendor-1',
        vendor: { name: 'مورد اختبار' },
        payment_date: '2026-08-02',
        amount: 125,
        payment_method: 'cash',
        status: 'draft',
        lines: [{ invoice_id: 'invoice-1', allocated_amount: 125 }],
      }],
    })
    mocks.getSupplierOutstandingInvoices.mockResolvedValue({ success: true, data: [] })
  })

  it('gates cancel and unpost controls on their exact sensitive keys', async () => {
    mocks.getAllSupplierPayments.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'payment-1', payment_number: 'SP-DRAFT', vendor_id: 'vendor-1',
          payment_date: '2026-08-02', amount: 125, payment_method: 'cash', status: 'draft',
        },
        {
          id: 'payment-2', payment_number: 'SP-POSTED', vendor_id: 'vendor-1',
          payment_date: '2026-08-02', amount: 125, payment_method: 'cash', status: 'posted',
        },
      ],
    })

    const initial = render(<SupplierPayments />)
    await screen.findByText('SP-DRAFT')
    expect(screen.queryByRole('button', { name: /إلغاء سند/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /إعادة سند .* إلى مسودة/ })).not.toBeInTheDocument()
    initial.unmount()

    mocks.permissionKeys.add('accounting.vouchers.cancel')
    const cancelOnly = render(<SupplierPayments />)
    expect(await screen.findByRole('button', { name: 'إلغاء سند SP-DRAFT' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /إعادة سند .* إلى مسودة/ })).not.toBeInTheDocument()
    cancelOnly.unmount()

    mocks.permissionKeys.add('accounting.vouchers.unpost')
    render(<SupplierPayments />)
    expect(await screen.findByRole('button', { name: 'إلغاء سند SP-DRAFT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'إعادة سند SP-POSTED إلى مسودة' })).toBeInTheDocument()
  })

  it('opens allocation editing for a draft without losing its existing invoice', async () => {
    mocks.permissionKeys.add('purchasing.payments.update')
    render(<SupplierPayments />)

    expect(await screen.findByText('SP-202608-00001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }))

    expect(await screen.findByText('تعديل مسودة سند الصرف SP-202608-00001')).toBeInTheDocument()
    expect(await screen.findByText('invoice-1')).toBeInTheDocument()
    await waitFor(() => expect(mocks.getSupplierOutstandingInvoices).toHaveBeenCalledWith('vendor-1'))
  })

  describe('screen read vs. purchasing.payments.create/.approve/.update', () => {
    it('hides the add-payment trigger without purchasing.payments.create', async () => {
      render(<SupplierPayments />)

      await screen.findByText('SP-202608-00001')
      expect(screen.queryByRole('button', { name: 'إضافة سند صرف' })).not.toBeInTheDocument()
    })

    it('hides إقرار and never posts without purchasing.payments.approve', async () => {
      render(<SupplierPayments />)

      await screen.findByText('SP-202608-00001')
      expect(screen.queryByRole('button', { name: 'إقرار' })).not.toBeInTheDocument()
      expect(mocks.postSupplierPayment).not.toHaveBeenCalled()
    })

    it('hides تعديل without purchasing.payments.update', async () => {
      render(<SupplierPayments />)

      await screen.findByText('SP-202608-00001')
      expect(screen.queryByRole('button', { name: 'تعديل' })).not.toBeInTheDocument()
    })

    it('revoking update mid-session (edit dialog already open) blocks the actual save', async () => {
      mocks.updateSupplierPaymentDraft.mockResolvedValue({ success: true })
      mocks.permissionKeys.add('purchasing.payments.update')
      const { rerender } = render(<SupplierPayments />)
      await screen.findByText('SP-202608-00001')

      fireEvent.click(screen.getByRole('button', { name: 'تعديل' }))
      await screen.findByText('تعديل مسودة سند الصرف SP-202608-00001')

      mocks.permissionKeys.delete('purchasing.payments.update')
      rerenderPayments(rerender)

      const dialog = screen.getByRole('dialog')
      const saveButton = within(dialog).getByRole('button', { name: /حفظ/ })
      fireEvent.click(saveButton)

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('لا تملك صلاحية تعديل سندات الصرف'))
      expect(mocks.updateSupplierPaymentDraft).not.toHaveBeenCalled()
    })
  })

  describe('revoking cancel/unpost while the reason dialog is already open blocks the actual confirm', () => {
    it('revoking accounting.vouchers.cancel mid-dialog blocks the actual cancel', async () => {
      mocks.getAllSupplierPayments.mockResolvedValue({
        success: true,
        data: [{
          id: 'payment-1', payment_number: 'SP-DRAFT', vendor_id: 'vendor-1',
          payment_date: '2026-08-02', amount: 125, payment_method: 'cash', status: 'draft',
        }],
      })
      mocks.permissionKeys.add('accounting.vouchers.cancel')
      const { rerender } = render(<SupplierPayments />)
      await screen.findByText('SP-DRAFT')

      fireEvent.click(screen.getByRole('button', { name: 'إلغاء سند SP-DRAFT' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('السبب *'), { target: { value: 'سبب اختباري كافٍ' } })

      mocks.permissionKeys.delete('accounting.vouchers.cancel')
      rerenderPayments(rerender)

      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'تأكيد الإلغاء' }))

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('لا تملك صلاحية إلغاء سندات الصرف'))
      expect(mocks.cancelSupplierPayment).not.toHaveBeenCalled()
    })

    it('revoking accounting.vouchers.unpost mid-dialog blocks the actual reset-to-draft', async () => {
      mocks.getAllSupplierPayments.mockResolvedValue({
        success: true,
        data: [{
          id: 'payment-2', payment_number: 'SP-POSTED', vendor_id: 'vendor-1',
          payment_date: '2026-08-02', amount: 125, payment_method: 'cash', status: 'posted',
        }],
      })
      mocks.permissionKeys.add('accounting.vouchers.unpost')
      const { rerender } = render(<SupplierPayments />)
      await screen.findByText('SP-POSTED')

      fireEvent.click(screen.getByRole('button', { name: 'إعادة سند SP-POSTED إلى مسودة' }))
      const dialog = await screen.findByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('السبب *'), { target: { value: 'سبب اختباري كافٍ' } })

      mocks.permissionKeys.delete('accounting.vouchers.unpost')
      rerenderPayments(rerender)

      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'إعادة إلى مسودة' }))

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('لا تملك صلاحية فك ترحيل سندات الصرف'))
      expect(mocks.resetSupplierPaymentToDraft).not.toHaveBeenCalled()
    })
  })
})
