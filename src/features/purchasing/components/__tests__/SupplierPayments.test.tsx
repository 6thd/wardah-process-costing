import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

import { SupplierPayments } from '../SupplierPayments'

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
    render(<SupplierPayments />)

    expect(await screen.findByText('SP-202608-00001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }))

    expect(await screen.findByText('تعديل مسودة سند الصرف SP-202608-00001')).toBeInTheDocument()
    expect(await screen.findByText('invoice-1')).toBeInTheDocument()
    await waitFor(() => expect(mocks.getSupplierOutstandingInvoices).toHaveBeenCalledWith('vendor-1'))
  })
})
