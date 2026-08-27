import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveOrgIdWithFallback = vi.fn(async () => 'org-1')
const listSupplierInvoiceCandidates = vi.fn(async () => [])
const createMatchedSupplierInvoice = vi.fn()

vi.mock('@/lib/supabase', () => ({
  resolveOrgIdWithFallback,
}))

vi.mock('@/services/supplier-invoice-atomic-service', () => ({
  listSupplierInvoiceCandidates,
  createMatchedSupplierInvoice,
  candidateToMatchedLine: vi.fn(),
  stableOperationIdentity: vi.fn(),
}))

// Keep this smoke test focused on the form's orchestration rather than Radix
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
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: ReactNode }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/calendar', () => ({
  Calendar: () => <div data-testid="calendar" />,
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

import { SupplierInvoiceForm } from '../AtomicSupplierInvoiceForm'

describe('AtomicSupplierInvoiceForm smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveOrgIdWithFallback.mockResolvedValue('org-1')
    listSupplierInvoiceCandidates.mockResolvedValue([])
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
})
