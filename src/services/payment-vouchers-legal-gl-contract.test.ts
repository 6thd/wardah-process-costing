import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const servicePath = fileURLToPath(new URL('./payment-vouchers-service.ts', import.meta.url))
const source = readFileSync(servicePath, 'utf8')

describe('payment voucher legal GL writer contract', () => {
  it('uses only the atomic journal RPC for voucher GL creation', () => {
    expect(source.match(/rpc_create_journal_entry/g)).toHaveLength(2)
    expect(source).not.toContain(".from('gl_entries')")
    expect(source).not.toContain(".from('gl_entry_lines')")
  })

  it('writes canonical debit and credit, never legacy amount inputs', () => {
    expect(source).not.toMatch(/debit_amount\s*:/)
    expect(source).not.toMatch(/credit_amount\s*:/)
    expect(source.match(/auto_post:\s*true/g)).toHaveLength(2)
    expect(source).toContain('CUSTOMER_RECEIPT:${receipt.id || receipt.collection_number}')
    expect(source).toContain('SUPPLIER_PAYMENT:${payment.id || payment.payment_number}')
  })

  it('fails before invoice mutation when GL creation fails', () => {
    const receiptPost = source.slice(
      source.indexOf('export async function postCustomerReceipt'),
      source.indexOf('async function createReceiptAccountingEntry')
    )
    expect(receiptPost.indexOf('createReceiptAccountingEntry(receipt)'))
      .toBeLessThan(receiptPost.indexOf('updateInvoicePaidAmounts(receipt.lines)'))

    const paymentPost = source.slice(
      source.indexOf('export async function postSupplierPayment'),
      source.indexOf('async function createPaymentAccountingEntry')
    )
    expect(paymentPost.indexOf('createPaymentAccountingEntry(payment)'))
      .toBeLessThan(paymentPost.indexOf('updateSupplierInvoicePaidAmounts(payment.lines)'))
  })
})
