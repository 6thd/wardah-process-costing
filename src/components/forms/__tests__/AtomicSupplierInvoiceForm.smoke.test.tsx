import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  resolveOrgIdWithFallback,
  listSupplierInvoiceCandidates,
  createMatchedSupplierInvoice,
  candidateToMatchedLine,
  stableOperationIdentity,
  toast,
} = vi.hoisted(() => ({
  resolveOrgIdWithFallback: vi.fn(async () => 'org-1'),
  listSupplierInvoiceCandidates: vi.fn(async () => []),
  createMatchedSupplierInvoice: vi.fn(),
  candidateToMatchedLine: vi.fn((candidate: {
    goods_receipt_line_id: string
    remaining_qty_base: number
    po_unit_price_base: number
    discount_percentage: number
    tax_percentage: number
  }) => ({
    goods_receipt_line_id: candidate.goods_receipt_line_id,
    quantity_base: candidate.remaining_qty_base,
    unit_price: candidate.po_unit_price_base,
    discount_percentage: candidate.discount_percentage,
    tax_percentage: candidate.tax_percentage,
  })),
  stableOperationIdentity: vi.fn((fingerprint: string, previous: { fingerprint: string; key: string } | null) => (
    previous?.fingerprint === fingerprint ? previous : { fingerprint, key: 'idem-1' }
  )),
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  resolveOrgIdWithFallback,
}))

vi.mock('@/services/supplier-invoice-atomic-service', () => ({
  listSupplierInvoiceCandidates,
  createMatchedSupplierInvoice,
  candidateToMatchedLine,
  stableOperationIdentity,
}))

// Keep these tests focused on the form's orchestration rather than Radix
// portal/focus behavior. The production form itself is still imported and
// executed, so it reaches LCOV/Sonar as real new source code.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: {
    value: string
    onValueChange: (value: string) => void
    children: ReactNode
    disabled?: boolean
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)} disabled={disabled}>
      <option value="">--</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, disabled, id }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    id?: string
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(checked)}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

vi.mock('@/components/ui/calendar', () => ({
  Calendar: () => <div data-testid="calendar" />,
}))

vi.mock('sonner', () => ({ toast }))

import { SupplierInvoiceForm } from '../AtomicSupplierInvoiceForm'

const candidate = {
  organization_id: 'org-1',
  vendor_id: 'vendor-1',
  vendor: { id: 'vendor-1', code: 'V1', name: 'Vendor One' },
  purchase_order_id: 'po-1',
  purchase_order_number: 'PO-1',
  purchase_order_status: 'fully_received',
  purchase_order_line_id: 'pol-1',
  goods_receipt_id: 'gr-1',
  goods_receipt_number: 'GR-1',
  goods_receipt_status: 'posted',
  goods_receipt_line_id: 'grl-1',
  quality_status: 'accepted',
  product_id: 'product-1',
  product: { id: 'product-1', code: 'P1', name: 'Product One', name_ar: 'منتج 1' },
  uom_id: 'uom-1',
  uom: { id: 'uom-1', code: 'KG', name: 'Kilogram', name_ar: 'كيلوجرام', symbol: 'kg', decimal_places: 3 },
  conversion_factor_snapshot: 2,
  accepted_qty_base: 20,
  accepted_qty_entered: 10,
  allocated_qty_base: 6,
  allocated_qty_entered: 3,
  remaining_qty_base: 14,
  remaining_qty_entered: 7,
  po_unit_price_base: 4.75,
  po_unit_price_entered: 9.5,
  discount_percentage: 2,
  tax_percentage: 15,
}

describe('AtomicSupplierInvoiceForm orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveOrgIdWithFallback.mockResolvedValue('org-1')
    listSupplierInvoiceCandidates.mockResolvedValue([])
    createMatchedSupplierInvoice.mockResolvedValue({
      success: true,
      invoice_id: 'invoice-1',
      journal_entry_id: 'je-1',
      total_amount: 76.48,
      idempotent_replay: false,
    })
  })

  it('loads server-authorized candidates and keeps create-only users preview-only', async () => {
    await act(async () => {
      render(
        <SupplierInvoiceForm
          open
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          canApprove={false}
        />,
      )
    })

    await waitFor(() => {
      expect(resolveOrgIdWithFallback).toHaveBeenCalledTimes(1)
      expect(listSupplierInvoiceCandidates).toHaveBeenCalledWith({ orgId: 'org-1' })
    })

    expect(screen.getByText('فاتورة مورد مطابقة للاستلام')).toBeInTheDocument()
    expect(screen.getByText(/لديك صلاحية تجهيز الطلب ومعاينته فقط/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'تجهيز المعاينة' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'اعتماد وترحيل' })).not.toBeInTheDocument()
    expect(createMatchedSupplierInvoice).not.toHaveBeenCalled()
  })

  it('posts only the server candidate snapshot through the atomic write service', async () => {
    listSupplierInvoiceCandidates.mockResolvedValue([candidate])
    const onOpenChange = vi.fn()
    const onSuccess = vi.fn()

    render(
      <SupplierInvoiceForm
        open
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        canApprove
      />,
    )

    await waitFor(() => expect(listSupplierInvoiceCandidates).toHaveBeenCalled())

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'vendor-1' } })

    await waitFor(() => {
      expect(screen.getAllByRole('combobox')).toHaveLength(2)
    })
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'po-1' } })

    await waitFor(() => expect(screen.getByText('منتج 1')).toBeInTheDocument())
    const lineCheckbox = screen.getAllByRole('checkbox').find((node) => node.id !== 'supplier-invoice-select-all')
    expect(lineCheckbox).toBeDefined()
    fireEvent.click(lineCheckbox!)

    fireEvent.change(screen.getByPlaceholderText('رقم المستند لدى المورد'), {
      target: { value: 'INV-100' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'تجهيز المعاينة' }))
    expect(toast.success).toHaveBeenCalledWith('تم تجهيز المعاينة محليًا دون حفظ أو ترحيل')
    expect(createMatchedSupplierInvoice).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'اعتماد وترحيل' }))

    await waitFor(() => {
      expect(createMatchedSupplierInvoice).toHaveBeenCalledTimes(1)
    })

    const submitted = createMatchedSupplierInvoice.mock.calls[0][0]
    expect(submitted.org_id).toBe('org-1')
    expect(submitted.vendor_id).toBe('vendor-1')
    expect(submitted.invoice_number).toBe('INV-100')
    expect(submitted.idempotency_key).toBe('idem-1')
    expect(submitted.lines).toEqual([{
      goods_receipt_line_id: 'grl-1',
      quantity_base: 14,
      unit_price: 4.75,
      discount_percentage: 2,
      tax_percentage: 15,
    }])
    expect(candidateToMatchedLine).toHaveBeenCalledWith(candidate)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('maps candidate-load failures without attempting a financial write', async () => {
    listSupplierInvoiceCandidates.mockRejectedValueOnce(new Error('AP_CANDIDATE_PERMISSION_DENIED'))

    render(
      <SupplierInvoiceForm
        open
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
        canApprove
      />,
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(createMatchedSupplierInvoice).not.toHaveBeenCalled()
  })
})
