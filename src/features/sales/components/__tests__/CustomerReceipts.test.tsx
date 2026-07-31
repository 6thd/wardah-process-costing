import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCustomerReceipt: vi.fn(),
  getAllCustomerReceipts: vi.fn(),
  getCustomerOutstandingInvoices: vi.fn(),
  getPaymentAccounts: vi.fn(),
  postCustomerReceipt: vi.fn(),
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
  createCustomerReceipt: mocks.createCustomerReceipt,
  getAllCustomerReceipts: mocks.getAllCustomerReceipts,
  getCustomerOutstandingInvoices: mocks.getCustomerOutstandingInvoices,
  getPaymentAccounts: mocks.getPaymentAccounts,
  postCustomerReceipt: mocks.postCustomerReceipt,
}))

vi.mock('@/services/supabase-service', () => ({
  customersService: {
    getAll: mocks.getCustomers,
  },
}))

import { CustomerReceipts } from '../CustomerReceipts'

const draftReceipt = {
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

const paymentAccounts = [
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

function renderReceipts() {
  return render(
    <BrowserRouter>
      <CustomerReceipts />
    </BrowserRouter>,
  )
}

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
}

describe('CustomerReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllCustomerReceipts.mockResolvedValue({ success: true, data: [draftReceipt] })
    mocks.postCustomerReceipt.mockResolvedValue({ success: true })
    mocks.getCustomers.mockResolvedValue([{ id: 'customer-1', name: 'عميل اختبار' }])
    mocks.getPaymentAccounts.mockResolvedValue({ success: true, data: paymentAccounts })
    mocks.getCustomerOutstandingInvoices.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'invoice-1',
          invoice_number: 'INV-0001',
          invoice_date: '2026-07-20',
          total_amount: 500,
          paid_amount: 0,
          outstanding_balance: 500,
        },
      ],
    })
    mocks.createCustomerReceipt.mockResolvedValue({ success: true, data: { id: 'receipt-2' } })
  })

  it('uses collection_date in the list and details, then posts the draft receipt', async () => {
    renderReceipts()

    expect(await screen.findByText('CR-202607-00001')).toBeInTheDocument()
    expect(screen.getByText('7/31/2026')).toBeInTheDocument()
    expect(screen.getByText('مؤسسة التجارة الكبرى')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'إقرار' }))
    await waitFor(() => expect(mocks.postCustomerReceipt).toHaveBeenCalledWith('receipt-1'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('تم إقرار السند بنجاح')
    await waitFor(() => expect(mocks.getAllCustomerReceipts).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'عرض' }))
    const detailsDialog = await screen.findByRole('dialog')
    expect(within(detailsDialog).getByText('تفاصيل سند القبض')).toBeInTheDocument()

    const dateLabel = within(detailsDialog).getByText('التاريخ')
    expect(dateLabel.parentElement).toHaveTextContent('7/31/2026')
    expect(within(detailsDialog).getByText('invoice-1')).toBeInTheDocument()
    expect(within(detailsDialog).getByText('2415.00 ريال')).toBeInTheDocument()
  })

  it('filters accounts by method, clears an incompatible account, and creates a valid receipt', async () => {
    renderReceipts()
    await screen.findByText('CR-202607-00001')

    fireEvent.click(screen.getByRole('button', { name: 'إضافة سند قبض' }))
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.getCustomers).toHaveBeenCalledTimes(1))

    let comboboxes = within(dialog).getAllByRole('combobox')
    expect(comboboxes).toHaveLength(3)

    openSelect(comboboxes[2])
    expect(await screen.findByRole('option', { name: /110101 - النقدية في الخزينة/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /110202 - بنك الإنماء/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /110101 - النقدية في الخزينة/ }))

    comboboxes = within(dialog).getAllByRole('combobox')
    openSelect(comboboxes[1])
    fireEvent.click(await screen.findByRole('option', { name: 'شيك' }))
    expect(within(dialog).getByText('رقم الشيك')).toBeInTheDocument()
    expect(comboboxes[2]).toHaveTextContent('110101')

    comboboxes = within(dialog).getAllByRole('combobox')
    openSelect(comboboxes[1])
    fireEvent.click(await screen.findByRole('option', { name: 'تحويل بنكي' }))

    comboboxes = within(dialog).getAllByRole('combobox')
    expect(comboboxes[2]).toHaveTextContent('اختر الحساب المتوافق')
    openSelect(comboboxes[2])
    expect(await screen.findByRole('option', { name: /110202 - بنك الإنماء/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /110101 - النقدية في الخزينة/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /110202 - بنك الإنماء/ }))

    comboboxes = within(dialog).getAllByRole('combobox')
    openSelect(comboboxes[0])
    fireEvent.click(await screen.findByRole('option', { name: 'عميل اختبار' }))

    expect(await within(dialog).findByText('INV-0001')).toBeInTheDocument()
    const amountInputs = within(dialog).getAllByRole('spinbutton')
    fireEvent.change(amountInputs[1], { target: { value: '500' } })
    expect(amountInputs[0]).toHaveValue(500)

    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }))

    await waitFor(() => expect(mocks.createCustomerReceipt).toHaveBeenCalledTimes(1))
    expect(mocks.createCustomerReceipt).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 'customer-1',
      amount: 500,
      payment_method: 'bank_transfer',
      payment_account_id: 'bank-1',
      lines: [
        {
          invoice_id: 'invoice-1',
          allocated_amount: 500,
          discount_amount: 0,
        },
      ],
    }))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('تم إنشاء سند القبض بنجاح')
  })
})
