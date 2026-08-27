import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hasPermissionKey = vi.fn((_key: string) => false)

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey }),
}))

vi.mock('../AtomicSupplierInvoiceForm', () => ({
  SupplierInvoiceForm: ({ canApprove }: { canApprove: boolean }) => (
    <div data-testid="atomic-form-approve">{canApprove ? 'approve-enabled' : 'preview-only'}</div>
  ),
}))

import { SupplierInvoiceForm } from '../SupplierInvoiceForm'

describe('SupplierInvoiceForm approve boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasPermissionKey.mockReturnValue(false)
  })

  it('keeps a create-only caller in preview-only mode', () => {
    render(<SupplierInvoiceForm open onOpenChange={vi.fn()} onSuccess={vi.fn()} />)

    expect(hasPermissionKey).toHaveBeenCalledWith('purchasing.purchase_invoices.approve')
    expect(screen.getByTestId('atomic-form-approve')).toHaveTextContent('preview-only')
  })

  it('enables the final atomic action only with the explicit approve key', () => {
    hasPermissionKey.mockImplementation((key: string) => key === 'purchasing.purchase_invoices.approve')

    render(<SupplierInvoiceForm open onOpenChange={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByTestId('atomic-form-approve')).toHaveTextContent('approve-enabled')
  })
})
