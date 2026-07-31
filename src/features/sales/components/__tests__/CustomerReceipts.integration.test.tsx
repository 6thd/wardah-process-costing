import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const mocks = vi.hoisted(() => ({
  getAllCustomerReceipts: vi.fn(),
  createCustomerReceipt: vi.fn(),
  postCustomerReceipt: vi.fn(),
  getCustomerOutstandingInvoices: vi.fn(),
  getPaymentAccounts: vi.fn(),
  getCustomers: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

vi.mock('@/services/payment-vouchers-service', () => ({
  getAllCustomerReceipts: mocks.getAllCustomerReceipts,
  createCustomerReceipt: mocks.createCustomerReceipt,
  postCustomerReceipt: mocks.postCustomerReceipt,
  getCustomerOutstandingInvoices: mocks.getCustomerOutstandingInvoices,
  getPaymentAccounts: mocks.getPaymentAccounts,
}))

vi.mock('@/services/supabase-service', () => ({
  customersService: {
    getAll: mocks.getCustomers,
  },
}))

import { CustomerReceipts } from '../CustomerReceipts'

const receipt = {
  id: 'receipt-1',
  receipt_number: 'CR-202607-00001',
  collection_date: '2026-07-31',
  amount: 2415,
  payment_method: 'cash',
  payment_account_id: 'cash-1',
  status: 'draft',
  customer: { name: 'مؤسسة التجارة الكبرى' },
  lines: [
    {
      invoice_id: 'invoice-1',
      allocated_amount: 2415,
      discount_amount: 0,
    },
  ],
}

const accounts = [
  {
    id: 'cash-1',
    code: '110101',
    name: 'Cash',
    name_ar: 'النقدية في الخزينة',
    subtype: 'CASH',
  },
  {
    id: 'bank-1',
    code: '110202',
    name: 'Bank',
    name_ar: 'بنك الإنماء',
    subtype: 'BANK',
  },
]

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
}

describe('CustomerReceipts integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllCustomerReceipts.mockResolvedValue({ success: true, data: [receipt] })
    mocks.postCustomerReceipt.mockResolvedValue({ success: true })
    mocks.getCustomers.mockResolvedValue([{ id: 'customer-1', name: 'عميل اختبار' }])
    mocks.getPaymentAccounts.mockResolvedValue({ success: true, data: accounts })
    mocks.getCustomerOutstandingInvoices.mockResolvedValue({ success: true, data: [] })
    mocks.createCustomerReceipt.mockResolvedValue({ success: true, data: { id: 'receipt-2' } })
  })

  it('renders collection_date, opens details, and posts the draft receipt', async () => {
    render(<CustomerReceipts />)

    expect(await screen.findByText('CR-202607-00001')).toBeInTheDocument()
    expect(screen.getByText('7/31/2026')).toBeInTheDocument()
    expect(screen.getByText('مؤسسة التجارة الكبرى')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'عرض' }))
    const details = await screen.findByRole('dialog')
    expect(within(details).getByText('تفاصيل سند القبض')).toBeInTheDocument()
    expect(within(details).getByText('7/31/2026')).toBeInTheDocument()
    expect(within(details).getByText('invoice-1')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('تفاصيل سند القبض')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'إقرار' }))
    await waitFor(() => expect(mocks.postCustomerReceipt).toHaveBeenCalledWith('receipt-1'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('تم إقرار السند بنجاح')
    await waitFor(() => expect(mocks.getAllCustomerReceipts).toHaveBeenCalledTimes(2))
  })

  it('filters CASH/BANK accounts, clears incompatible selection, and saves a valid receipt', async () => {
    render(<CustomerReceipts />)
    await screen.findByText('CR-202607-00001')

    fireEvent.click(screen.getByRole('button', { name: 'إضافة سند قبض' }))
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())
    await waitFor(() => expect(mocks.getCustomers).toHaveBeenCalled())

    let comboboxes = within(dialog).getAllByRole('combobox')
    expect(comboboxes).toHaveLength(3)

    // Radix يعكس كل عنصر مختار في `<option>` مخفي داخل native select، فالاستعلام
    // النصي العام يلتقط نسختين. الدور `option` يميّز عنصر القائمة الظاهر وحده.
    openSelect(comboboxes[2])
    expect(await screen.findByRole('option', { name: /110101 - النقدية في الخزينة/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /110202 - بنك الإنماء/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /110101 - النقدية في الخزينة/ }))

    comboboxes = within(dialog).getAllByRole('combobox')
    openSelect(comboboxes[1])
    fireEvent.click(await screen.findByRole('option', { name: 'تحويل بنكي' }))

    comboboxes = within(dialog).getAllByRole('combobox')
    expect(comboboxes[2]).toHaveTextContent('اختر الحساب')
    openSelect(comboboxes[2])
    expect(await screen.findByRole('option', { name: /110202 - بنك الإنماء/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /110101 - النقدية في الخزينة/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /110202 - بنك الإنماء/ }))

    comboboxes = within(dialog).getAllByRole('combobox')
    openSelect(comboboxes[0])
    fireEvent.click(await screen.findByRole('option', { name: 'عميل اختبار' }))

    const amount = within(dialog).getByRole('spinbutton')
    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }))

    await waitFor(() => expect(mocks.createCustomerReceipt).toHaveBeenCalledTimes(1))
    expect(mocks.createCustomerReceipt).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 'customer-1',
      amount: 500,
      payment_method: 'bank_transfer',
      payment_account_id: 'bank-1',
    }))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('تم إنشاء سند القبض بنجاح')
  })
})
