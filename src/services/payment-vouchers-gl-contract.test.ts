import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildCustomerReceiptJournalPayload,
  buildSupplierPaymentJournalPayload
} from './payment-vouchers-service'

function assertCanonicalBalancedPayload(payload: {
  auto_post: boolean
  idempotency_key: string
  lines: Array<Record<string, unknown>>
}): void {
  expect(payload.auto_post).toBe(true)
  expect(payload.idempotency_key).toBeTruthy()
  expect(payload.lines).toHaveLength(2)

  const debit = payload.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
  const credit = payload.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
  expect(debit).toBeGreaterThan(0)
  expect(debit).toBe(credit)

  for (const line of payload.lines) {
    expect(line.account_id).toBeTruthy()
    expect(line).toHaveProperty('debit')
    expect(line).toHaveProperty('credit')
    expect(line).not.toHaveProperty('debit_amount')
    expect(line).not.toHaveProperty('credit_amount')
  }
}

describe('payment voucher canonical GL contract', () => {
  it('builds a posted, balanced, idempotent customer receipt payload', () => {
    const payload = buildCustomerReceiptJournalPayload({
      tenantId: '11111111-1111-1111-1111-111111111111',
      receipt: {
        id: '22222222-2222-2222-2222-222222222222',
        collection_date: '2026-07-31',
        collection_number: 'CR-202607-00001',
        amount: 575
      },
      paymentAccountId: '33333333-3333-3333-3333-333333333333',
      arAccountId: '44444444-4444-4444-4444-444444444444'
    })

    assertCanonicalBalancedPayload(payload)
    expect(payload.reference_type).toBe('CUSTOMER_RECEIPT')
    expect(payload.idempotency_key).toBe(
      'CUSTOMER_RECEIPT:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222'
    )
    expect(payload.lines[0]).toMatchObject({ debit: 575, credit: 0 })
    expect(payload.lines[1]).toMatchObject({ debit: 0, credit: 575 })
  })

  it('builds a posted, balanced, idempotent supplier payment payload', () => {
    const payload = buildSupplierPaymentJournalPayload({
      tenantId: '11111111-1111-1111-1111-111111111111',
      payment: {
        id: '55555555-5555-5555-5555-555555555555',
        payment_date: '2026-07-31',
        payment_number: 'SP-202607-00001',
        amount: 2000
      },
      paymentAccountId: '33333333-3333-3333-3333-333333333333',
      apAccountId: '66666666-6666-6666-6666-666666666666'
    })

    assertCanonicalBalancedPayload(payload)
    expect(payload.reference_type).toBe('SUPPLIER_PAYMENT')
    expect(payload.idempotency_key).toBe(
      'SUPPLIER_PAYMENT:11111111-1111-1111-1111-111111111111:55555555-5555-5555-5555-555555555555'
    )
    expect(payload.lines[0]).toMatchObject({ debit: 2000, credit: 0 })
    expect(payload.lines[1]).toMatchObject({ debit: 0, credit: 2000 })
  })

  it('contains no legacy amount writer in the active payment voucher service', () => {
    const source = readFileSync(new URL('./payment-vouchers-service.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('debit_amount')
    expect(source).not.toContain('credit_amount')
    expect(source).toContain("supabase.rpc('rpc_create_journal_entry'")
  })
})
