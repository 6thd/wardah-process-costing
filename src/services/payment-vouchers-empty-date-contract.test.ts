import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('payment voucher optional date contract', () => {
  it('normalizes empty check dates before database inserts', () => {
    const source = readFileSync('src/services/payment-vouchers-service.ts', 'utf8')
    expect(source).toContain('check_date: receipt.check_date || null')
    expect(source).toContain('check_date: payment.check_date || null')
    expect(source).not.toContain('check_date: receipt.check_date,')
    expect(source).not.toContain('check_date: payment.check_date,')

    // The draft-edit RPC payloads carry the same date field and need the same
    // normalization: `??` would forward an empty string, and only `||` maps it
    // to null. The RPC's own nullif() is the second line of defence, not the first.
    expect(source).toContain('check_date: changes.check_date || null')
    expect(source).not.toContain('check_date: changes.check_date ?? null')
    expect(source).not.toContain('check_date: changes.check_date,')
  })
})
