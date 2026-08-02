import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { VoucherReasonActionDialog } from '../VoucherReasonActionDialog'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

const resetDescription = 'يعيد السند وفواتيره إلى حالة التصحيح.'

function renderDialog(overrides: Partial<React.ComponentProps<typeof VoucherReasonActionDialog>> = {}) {
  const props: React.ComponentProps<typeof VoucherReasonActionDialog> = {
    action: { kind: 'reset', voucherId: 'voucher-1' },
    resetDescription,
    resetVoucher: vi.fn().mockResolvedValue({ success: true }),
    cancelVoucher: vi.fn().mockResolvedValue({ success: true }),
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  }
  render(<VoucherReasonActionDialog {...props} />)
  return props
}

async function confirm(label: string) {
  await userEvent.type(screen.getByLabelText('السبب *'), 'تصحيح مبلغ')
  await userEvent.click(screen.getByRole('button', { name: label }))
}

describe('VoucherReasonActionDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs reset, closes, and refreshes after success', async () => {
    const props = renderDialog()
    expect(screen.getByText(resetDescription)).toBeInTheDocument()

    await confirm('إعادة إلى مسودة')

    await waitFor(() => expect(props.resetVoucher).toHaveBeenCalledWith('voucher-1', 'تصحيح مبلغ'))
    expect(toast.success).toHaveBeenCalledWith('أُعيد السند إلى مسودة')
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onChanged).toHaveBeenCalled()
  })

  it('reports an idempotent cancellation as the existing state', async () => {
    const cancelVoucher = vi.fn().mockResolvedValue({ success: true, duplicate: true })
    const props = renderDialog({ action: { kind: 'cancel', voucherId: 'voucher-2' }, cancelVoucher })

    await confirm('تأكيد الإلغاء')

    await waitFor(() => expect(cancelVoucher).toHaveBeenCalledWith('voucher-2', 'تصحيح مبلغ'))
    expect(toast.info).toHaveBeenCalledWith('السند ملغى بالفعل')
    expect(props.onChanged).toHaveBeenCalled()
  })

  it('keeps the dialog open when the service rejects the action', async () => {
    const onClose = vi.fn()
    const onChanged = vi.fn()
    renderDialog({ resetVoucher: vi.fn().mockResolvedValue({ success: false, error: 'رفض محاسبي' }), onClose, onChanged })

    await confirm('إعادة إلى مسودة')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('رفض محاسبي'))
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('turns a thrown non-Error value into a visible message', async () => {
    renderDialog({ resetVoucher: vi.fn().mockRejectedValue('انقطاع') })

    await confirm('إعادة إلى مسودة')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('خطأ: انقطاع'))
  })

  it('does not invoke an action while closed', () => {
    const resetVoucher = vi.fn()
    renderDialog({ action: null, resetVoucher })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(resetVoucher).not.toHaveBeenCalled()
  })
})
