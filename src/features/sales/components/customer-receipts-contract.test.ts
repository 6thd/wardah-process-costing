import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(
  resolve(process.cwd(), 'src/features/sales/components/CustomerReceipts.tsx'),
  'utf8',
)

const migration = readFileSync(
  resolve(process.cwd(), 'sql/migrations/165_voucher_payment_account_method_consistency.sql'),
  'utf8',
)

describe('customer receipt UI contract', () => {
  it('falls back to the database collection_date field', () => {
    expect(component).toContain('receipt.receipt_date || receipt.collection_date')
  })

  it('filters payment accounts by payment method and rejects mismatches', () => {
    expect(component).toContain("method === 'cash' || method === 'check'")
    expect(component).toContain("return new Set(['BANK'])")
    expect(component).toContain('حساب السداد لا يتوافق مع طريقة السداد المختارة')
    expect(component).toContain('compatiblePaymentAccounts.map')
  })
})

describe('voucher database contract', () => {
  it('guards both customer receipts and supplier payments', () => {
    expect(migration).toContain('trg_customer_collection_payment_account_consistency')
    expect(migration).toContain('trg_supplier_payment_account_consistency')
    expect(migration).toContain('VOUCHER_PAYMENT_ACCOUNT_METHOD_MISMATCH')
  })
})
