/**
 * بوابة اعتماد أمر الشراء (Migration 148).
 *
 * أوامر الشراء تُنشأ بحالة draft وهي غير قابلة للاستلام، فالانتقال يمر عبر RPC
 * محروسة على الخادم. هذه الاختبارات تثبت أن الواجهة تعرض الإجراء في الحالات
 * القانونية فقط، وتمرّر المؤسسة المختارة، وتُظهر سبب الرفض بدل ابتلاعه.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  approve: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: 'org-1' }),
}))

vi.mock('@/services/purchasing-service', () => ({
  submitPurchaseOrder: mocks.submit,
  approvePurchaseOrder: mocks.approve,
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

import { PurchaseOrderDetailsDialog } from '../components/PurchaseOrderDetailsDialog'

const baseOrder = {
  id: 'po-1',
  order_number: 'PO-20260724-1',
  order_date: '2026-07-24',
  subtotal: 1000,
  tax_amount: 150,
  total_amount: 1150,
  vendor: { name: 'مورد الاختبار' },
  purchase_order_lines: [],
}

const renderDialog = (status: string, onStatusChanged = vi.fn()) => {
  render(
    <PurchaseOrderDetailsDialog
      order={{ ...baseOrder, status }}
      open
      onOpenChange={vi.fn()}
      onStatusChanged={onStatusChanged}
    />
  )
  return onStatusChanged
}

describe('PurchaseOrderDetailsDialog — بوابة الاعتماد', () => {
  beforeEach(() => vi.clearAllMocks())

  it('أمر draft يعرض الإرسال والاعتماد معًا', () => {
    renderDialog('draft')
    expect(screen.getByRole('button', { name: 'إرسال للاعتماد' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'اعتماد الأمر' })).toBeInTheDocument()
  })

  it('أمر submitted يعرض الاعتماد فقط', () => {
    renderDialog('submitted')
    expect(screen.queryByRole('button', { name: 'إرسال للاعتماد' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'اعتماد الأمر' })).toBeInTheDocument()
  })

  it.each(['approved', 'partially_received', 'fully_received', 'cancelled'])(
    'أمر %s لا يعرض أي إجراء اعتماد',
    (status) => {
      renderDialog(status)
      expect(screen.queryByRole('button', { name: 'إرسال للاعتماد' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'اعتماد الأمر' })).not.toBeInTheDocument()
    }
  )

  it('الاعتماد يمرّر المؤسسة المختارة والأمر ثم يُبلّغ الأب', async () => {
    mocks.approve.mockResolvedValue({ success: true, status: 'approved' })
    const onStatusChanged = renderDialog('submitted')

    await userEvent.click(screen.getByRole('button', { name: 'اعتماد الأمر' }))

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith('org-1', 'po-1'))
    expect(onStatusChanged).toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('الإرسال يستدعي RPC الإرسال لا الاعتماد', async () => {
    mocks.submit.mockResolvedValue({ success: true, status: 'submitted' })
    renderDialog('draft')

    await userEvent.click(screen.getByRole('button', { name: 'إرسال للاعتماد' }))

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith('org-1', 'po-1'))
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('رفض الصلاحية من الخادم يُعرض كرسالة مفهومة ولا يُبلّغ الأب بنجاح', async () => {
    mocks.approve.mockRejectedValue(new Error('NOT_ORG_ADMIN: صلاحية غير كافية'))
    const onStatusChanged = renderDialog('submitted')

    await userEvent.click(screen.getByRole('button', { name: 'اعتماد الأمر' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'اعتماد أمر الشراء يحتاج صلاحية مدير المؤسسة.'
      )
    )
    expect(onStatusChanged).not.toHaveBeenCalled()
  })

  it('خطأ غير معروف لا يُعرض خامًا للمستخدم', async () => {
    mocks.approve.mockRejectedValue(new Error('23514 some raw database detail'))
    renderDialog('submitted')

    await userEvent.click(screen.getByRole('button', { name: 'اعتماد الأمر' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('تعذّر تنفيذ العملية على أمر الشراء.')
    )
  })
})
