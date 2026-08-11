/**
 * أهلية حساب السداد في نموذج سند الصرف.
 *
 * يثبّت أن النموذج يعرض ما يقبله wardah_validate_voucher_payment_account وحده،
 * ويصفّر الحساب المختار حين تتغير الطريقة فيفقد توافقه، ويمنع الإرسال قبل أن
 * يصل الطلب إلى الخادم.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
}))

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: () => false }),
}))

vi.mock('@/services/payment-vouchers-service', () => ({ ...mocks }))

vi.mock('@/services/supabase-service', () => ({
  vendorsService: {
    getAll: vi.fn().mockResolvedValue([{ id: 'vendor-1', name: 'مورد اختبار', code: 'V-1' }]),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}))

import { SupplierPayments } from '../SupplierPayments'

// ورقتان قابلتان للترحيل فقط — الأبوان مستبعدان في طبقة الاستعلام.
const accounts = [
  { id: 'acc-cash', code: '110101', name: 'النقدية في الخزينة', name_ar: 'النقدية في الخزينة', subtype: 'CASH', allow_posting: true },
  { id: 'acc-bank', code: '110201', name: 'بنك الراجحي', name_ar: 'بنك الراجحي', subtype: 'BANK', allow_posting: true },
]

async function openCreateForm(user: ReturnType<typeof userEvent.setup>) {
  render(<SupplierPayments />)
  await user.click(await screen.findByRole('button', { name: 'إضافة سند صرف' }))
  expect(await screen.findByText('سند صرف جديد')).toBeInTheDocument()
}

/** يفتح قائمة Radix المرتبطة بتسمية معيّنة ويعيد محتواها. */
async function openSelect(user: ReturnType<typeof userEvent.setup>, labelText: string) {
  const label = screen.getByText(labelText)
  const trigger = within(label.parentElement as HTMLElement).getByRole('combobox')
  await user.click(trigger)
  return screen.findByRole('listbox')
}

describe('SupplierPayments — أهلية حساب السداد', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllSupplierPayments.mockResolvedValue({ success: true, data: [] })
    mocks.getSupplierOutstandingInvoices.mockResolvedValue({ success: true, data: [] })
    mocks.getPaymentAccounts.mockResolvedValue({ success: true, data: accounts })
    mocks.createSupplierPayment.mockResolvedValue({ success: true })
  })

  it('يعرض الحسابات البنكية وحدها مع التحويل البنكي', async () => {
    const user = userEvent.setup()
    await openCreateForm(user)
    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())

    const listbox = await openSelect(user, 'حساب السداد')

    // الطريقة الافتراضية bank_transfer ⇒ BANK وحدها
    expect(within(listbox).getByText(/110201/)).toBeInTheDocument()
    expect(within(listbox).queryByText(/110101/)).not.toBeInTheDocument()
  })

  it('يعرض الحسابات النقدية وحدها مع النقد', async () => {
    const user = userEvent.setup()
    await openCreateForm(user)
    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())

    const methods = await openSelect(user, 'طريقة السداد *')
    await user.click(within(methods).getByText('نقدي'))

    const listbox = await openSelect(user, 'حساب السداد')
    expect(within(listbox).getByText(/110101/)).toBeInTheDocument()
    expect(within(listbox).queryByText(/110201/)).not.toBeInTheDocument()
  })

  it('يعامل الشيك بوصفه بنكيًا في سند الصرف', async () => {
    const user = userEvent.setup()
    await openCreateForm(user)
    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())

    const methods = await openSelect(user, 'طريقة السداد *')
    await user.click(within(methods).getByText('شيك'))

    const listbox = await openSelect(user, 'حساب السداد')
    // على عكس سند القبض، الشيك المصروف يُسحب على البنك لا من الخزينة
    expect(within(listbox).getByText(/110201/)).toBeInTheDocument()
    expect(within(listbox).queryByText(/110101/)).not.toBeInTheDocument()
  })

  it('يصفّر الحساب المختار حين تفقده الطريقة الجديدة توافقه', async () => {
    const user = userEvent.setup()
    await openCreateForm(user)
    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())

    const accountLabel = screen.getByText('حساب السداد')
    const accountTrigger = within(accountLabel.parentElement as HTMLElement).getByRole('combobox')

    const bankList = await openSelect(user, 'حساب السداد')
    await user.click(within(bankList).getByText(/110201/))
    await waitFor(() => expect(accountTrigger).toHaveTextContent(/110201/))

    const methods = await openSelect(user, 'طريقة السداد *')
    await user.click(within(methods).getByText('نقدي'))

    // الحساب البنكي لم يعد متوافقًا فيُصفَّر بدل أن يبقى ويفشل عند الخادم
    await waitFor(() => expect(accountTrigger).toHaveTextContent('اختر الحساب'))
    expect(accountTrigger).not.toHaveTextContent(/110201/)
  })

  it('يمنع الإرسال بلا حساب سداد قبل أن يصل الطلب إلى الخادم', async () => {
    const user = userEvent.setup()
    await openCreateForm(user)
    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'حفظ' }))

    expect(mocks.createSupplierPayment).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('اختر حساب السداد')
  })

  it('يعلن غياب حساب متوافق بدل عرض قائمة فارغة صامتة', async () => {
    mocks.getPaymentAccounts.mockResolvedValue({ success: true, data: [accounts[0]] })
    const user = userEvent.setup()
    await openCreateForm(user)
    await waitFor(() => expect(mocks.getPaymentAccounts).toHaveBeenCalled())

    // نقدي وحده متاح بينما الطريقة الافتراضية تحويل بنكي
    const listbox = await openSelect(user, 'حساب السداد')
    expect(within(listbox).getByText('لا توجد حسابات سداد تناسب طريقة السداد المختارة')).toBeInTheDocument()
  })
})
