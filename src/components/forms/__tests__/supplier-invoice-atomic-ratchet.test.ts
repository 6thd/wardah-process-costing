import source from '@/components/forms/AtomicSupplierInvoiceForm.tsx?raw'
import { describe, expect, it } from 'vitest'

describe('supplier invoice atomic UI ratchet', () => {
  it('contains only the canonical matched-invoice write service', () => {
    expect(source).toContain('createMatchedSupplierInvoice')
    expect(source).not.toContain(".from('supplier_invoices')")
    expect(source).not.toContain(".from('supplier_invoice_lines')")
    expect(source).not.toContain(".from('purchase_orders')")
    expect(source).not.toContain(".from('gl_entries')")
    expect(source).not.toContain(".from('gl_entry_lines')")
    expect(source).not.toContain('createGLEntry')
    expect(source).not.toContain('JE-PI-')
  })

  it('does not restore unsupported direct or pre-receipt modes', () => {
    expect(source).not.toContain("createMode === 'without-po'")
    expect(source).not.toContain('loadPurchasableProducts')
    expect(source).not.toContain('loadPOLines')
    expect(source).not.toContain('loadPurchaseOrders')
  })

  it('reads candidate facts only through the candidate service', () => {
    expect(source).toContain('listSupplierInvoiceCandidates')
    expect(source).toContain('candidateToMatchedLine')
    expect(source).not.toContain(".from('purchase_order_lines')")
    expect(source).not.toContain(".from('goods_receipt_lines')")
  })
})
