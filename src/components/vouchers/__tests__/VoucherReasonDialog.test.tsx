import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoucherReasonDialog, VOUCHER_REASON_MIN_LENGTH } from '../VoucherReasonDialog'

/**
 * The reason rule is the server's: both rpc_reset_*_to_draft and rpc_cancel_*
 * refuse anything shorter than five characters after trimming. These tests pin
 * the client to the same rule so the user is stopped in place rather than by a
 * server refusal — and so the two never drift apart silently.
 */
describe('VoucherReasonDialog', () => {
  const baseProps = {
    open: true,
    title: 'إلغاء السند',
    description: 'يُنهي دورة السند دون حذف أي تاريخ.',
    confirmLabel: 'تأكيد الإلغاء',
    onOpenChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps confirm disabled until the reason is long enough', async () => {
    const onConfirm = vi.fn()
    render(<VoucherReasonDialog {...baseProps} onConfirm={onConfirm} />)

    const confirm = screen.getByRole('button', { name: 'تأكيد الإلغاء' })
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText('السبب *'), 'خطأ')
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText('السبب *'), ' مكرر')
    await waitFor(() => expect(confirm).toBeEnabled())
  })

  it('rejects whitespace padding that only looks long enough', async () => {
    const onConfirm = vi.fn()
    render(<VoucherReasonDialog {...baseProps} onConfirm={onConfirm} />)

    await userEvent.type(screen.getByLabelText('السبب *'), '  خطأ   ')

    // Four characters once trimmed — the server would refuse it too.
    expect(screen.getByRole('button', { name: 'تأكيد الإلغاء' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('passes the trimmed reason to the caller', async () => {
    const onConfirm = vi.fn()
    render(<VoucherReasonDialog {...baseProps} onConfirm={onConfirm} />)

    await userEvent.type(screen.getByLabelText('السبب *'), '   قيد مكرر   ')
    await userEvent.click(screen.getByRole('button', { name: 'تأكيد الإلغاء' }))

    expect(onConfirm).toHaveBeenCalledWith('قيد مكرر')
  })

  it('disables both actions while the call is in flight', () => {
    render(<VoucherReasonDialog {...baseProps} pending onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'تراجع' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'جاري التنفيذ...' })).toBeDisabled()
  })

  it('agrees with the server on the minimum length', () => {
    expect(VOUCHER_REASON_MIN_LENGTH).toBe(5)
  })
})
