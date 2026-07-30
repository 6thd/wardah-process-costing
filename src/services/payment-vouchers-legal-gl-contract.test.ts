import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/services/payment-vouchers-service.ts'), 'utf8')
const migration = readFileSync(
  resolve(process.cwd(), 'sql/migrations/153_financial_gl_legal_amount_contract.sql'),
  'utf8'
)

describe('payment voucher legal GL writer contract', () => {
  it('delegates posting exclusively to the atomic voucher RPCs', () => {
    expect(source.match(/rpc_post_customer_receipt/g)).toHaveLength(1)
    expect(source.match(/rpc_post_supplier_payment/g)).toHaveLength(1)
    expect(source).toContain('p_receipt_id: receiptId')
    expect(source).toContain('p_payment_id: paymentId')
    expect(source).not.toContain('rpc_create_journal_entry')
    expect(source).not.toContain(".from('gl_entries')")
    expect(source).not.toContain(".from('gl_entry_lines')")
    expect(source).not.toContain('updateInvoicePaidAmounts')
    expect(source).not.toContain('updateSupplierInvoicePaidAmounts')
    expect(source).not.toContain('updateReceiptStatus')
    expect(source).not.toContain('updatePaymentStatus')
  })

  it('keeps every accounting amount mutation behind the database transaction boundary', () => {
    expect(source).not.toMatch(/\bdebit_amount\s*:/)
    expect(source).not.toMatch(/\bcredit_amount\s*:/)
    expect(source).not.toMatch(/\bdebit\s*:/)
    expect(source).not.toMatch(/\bcredit\s*:/)
    expect(source).not.toContain(".from('sales_invoices').update")
    expect(source).not.toContain(".from('supplier_invoices').update")
  })

  it('guards accounting periods and rejects mismatched idempotent entries', () => {
    expect(migration).toContain(
      'PERFORM public.assert_period_open(p_org, coalesce(p_entry_date, current_date));'
    )
    expect(migration).toContain('VOUCHER_GL_IDEMPOTENCY_CONFLICT')
    expect(migration).toContain('rpc_post_customer_receipt')
    expect(migration).toContain('rpc_post_supplier_payment')
  })
})
