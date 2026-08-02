import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { VoucherAllocationsForm } from '../VoucherAllocationsForm'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const openInvoice = {
  id: 'invoice-open',
  invoice_number: 'INV-OPEN',
  total_amount: 100,
  outstanding_balance: 60,
}

function renderForm(overrides: Partial<React.ComponentProps<typeof VoucherAllocationsForm>> = {}) {
  const props: React.ComponentProps<typeof VoucherAllocationsForm> = {
    voucherId: 'voucher-1',
    scopeId: 'scope-1',
    voucherAmount: 75,
    currentLines: [{ invoice_id: 'invoice-closed', allocated_amount: 25 }],
    emptyMessage: 'لا توجد فواتير',
    loadInvoices: vi.fn().mockResolvedValue({ success: true, data: [openInvoice] }),
    updateDraft: vi.fn().mockResolvedValue({ success: true }),
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<VoucherAllocationsForm {...props} />)
  return props
}

describe('VoucherAllocationsForm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps an allocated invoice visible when it is absent from the open list', async () => {
    renderForm()

    expect(await screen.findByText('INV-OPEN')).toBeInTheDocument()
    expect(screen.getByText('invoice-closed')).toBeInTheDocument()
    expect(screen.getByDisplayValue('25')).toBeInTheDocument()
  })

  it('sends the complete replacement set and its recalculated amount', async () => {
    const updateDraft = vi.fn().mockResolvedValue({ success: true })
    const onSuccess = vi.fn()
    renderForm({ updateDraft, onSuccess })
    await screen.findByText('INV-OPEN')

    const inputs = screen.getAllByRole('spinbutton')
    await userEvent.clear(inputs[0])
    await userEvent.type(inputs[0], '40')
    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], '10')
    await userEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }))

    await waitFor(() => expect(updateDraft).toHaveBeenCalledWith('voucher-1', {
      amount: 50,
      lines: [
        { invoice_id: 'invoice-closed', allocated_amount: 10, discount_amount: 0 },
        { invoice_id: 'invoice-open', allocated_amount: 40, discount_amount: 0 },
      ],
    }))
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('sends lines as an explicit empty array without zeroing the voucher amount', async () => {
    const updateDraft = vi.fn().mockResolvedValue({ success: true })
    renderForm({ loadInvoices: vi.fn().mockResolvedValue({ success: true, data: [] }), updateDraft })

    const input = await screen.findByRole('spinbutton')
    await userEvent.clear(input)
    await userEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }))

    await waitFor(() => expect(updateDraft).toHaveBeenCalledWith('voucher-1', {
      amount: 75,
      lines: [],
    }))
    expect(toast.success).toHaveBeenCalledWith('حُذفت كل سطور التخصيص')
  })

  it('blocks repeat submission while the update is in flight', async () => {
    let resolveUpdate: ((value: { success: boolean }) => void) | undefined
    const updateDraft = vi.fn(() => new Promise<{ success: boolean }>(resolve => { resolveUpdate = resolve }))
    renderForm({ updateDraft })
    await screen.findByText('INV-OPEN')

    const save = screen.getByRole('button', { name: 'حفظ التعديل' })
    await userEvent.dblClick(save)
    expect(updateDraft).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'جاري الحفظ...' })).toBeDisabled()

    resolveUpdate?.({ success: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'حفظ التعديل' })).toBeEnabled())
  })

  it('keeps the form open and reports a service refusal', async () => {
    const onSuccess = vi.fn()
    renderForm({ updateDraft: vi.fn().mockResolvedValue({ success: false, error: 'رفض محاسبي' }), onSuccess })
    await screen.findByText('INV-OPEN')

    await userEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('رفض محاسبي'))
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
