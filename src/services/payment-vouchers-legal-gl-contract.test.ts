import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/services/payment-vouchers-service.ts'), 'utf8')

describe('payment voucher legal GL writer contract', () => {
  it('delegates posting exclusively to the atomic voucher RPCs', () => {
    expect(source.match(/rpc_post_customer_receipt/g)).toHaveLength(1)
    expect(source.match(/rpc_post_supplier_payment/g)).toHaveLength(1)
    expect(source).not.toContain('rpc_create_journal_entry')
    expect(source).not.toContain(".from('gl_entries')")
    expect(source).not.toContain(".from('gl_entry_lines')")
  })

  it('never writes legacy or legal GL line amounts from the browser', () => {
    expect(source).not.toMatch(/\bdebit_amount\s*:/)
    expect(source).not.toMatch(/\bcredit_amount\s*:/)
    expect(source).not.toMatch(/\bdebit\s*:/)
    expect(source).not.toMatch(/\bcredit\s*:/)
  })
})
