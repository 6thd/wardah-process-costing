import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PurchaseOrderDetailsDialog } from '../components/PurchaseOrderDetailsDialog'

const order = {
  id: 'po-1',
  order_number: 'PO-20260724-07B821D3',
  order_date: '2026-07-24',
  status: 'draft',
  subtotal: 1000,
  discount_amount: 0,
  tax_amount: 150,
  total_amount: 1150,
  vendor: { name: 'شركة المواد الخام المحدودة' },
  purchase_order_lines: [
    {
      id: 'line-1',
      line_number: 1,
      quantity: 500,
      qty_entered: 0.5,
      conversion_factor_snapshot: 1000,
      unit_price: 2,
      unit_price_entered: 2000,
      discount_percentage: 0,
      tax_percentage: 15,
      line_total: 1150,
      product: { code: 'RM-010', name: 'PP Clear Sheet' },
      uom: { code: 'TON', name: 'Metric ton', name_ar: 'طن', symbol: 't' },
    },
  ],
}

describe('PurchaseOrderDetailsDialog', () => {
  it('shows the stored commercial and base quantity snapshots', () => {
    render(
      <PurchaseOrderDetailsDialog
        order={order}
        open
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.getByText('PO-20260724-07B821D3')).toBeInTheDocument()
    expect(screen.getByText('RM-010 - PP Clear Sheet')).toBeInTheDocument()
    expect(screen.getByText('0.5 طن')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('500 كجم')).toBeInTheDocument()
    expect(screen.getByText('2,000.00')).toBeInTheDocument()
    expect(screen.getAllByText('1,150.00 ريال')).toHaveLength(2)
  })

  it('can be closed from the explicit close button', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <PurchaseOrderDetailsDialog
        order={order}
        open
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'إغلاق' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
