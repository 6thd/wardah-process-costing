import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Migration 167 closed every direct write path on the voucher allocation lines,
 * and Migration 168 gave the client atomic RPCs instead. This contract keeps the
 * service from drifting back: the voucher tables may be read, never written.
 *
 * The gate lives here rather than in behavioural tests because a reintroduced
 * `.insert()` would fail against Production only — and only for the org that
 * reached it first.
 */
describe('payment voucher RPC contract', () => {
  const source = readFileSync('src/services/payment-vouchers-service.ts', 'utf8')

  const VOUCHER_TABLES = [
    'customer_collections',
    'customer_collection_lines',
    'supplier_payments',
    'supplier_payment_lines'
  ]

  it('routes create, edit and cancel through the Migration 168 RPCs', () => {
    for (const rpc of [
      'rpc_create_customer_receipt',
      'rpc_create_supplier_payment',
      'rpc_update_customer_receipt_draft',
      'rpc_update_supplier_payment_draft',
      'rpc_cancel_customer_receipt',
      'rpc_cancel_supplier_payment'
    ]) {
      expect(source).toContain(`supabase.rpc('${rpc}'`)
    }
  })

  it('never writes to a voucher table directly', () => {
    // Every `.from('<voucher table>')` chain must terminate in a read.
    for (const table of VOUCHER_TABLES) {
      const chains = source.split(`.from('${table}')`).slice(1)
      for (const chain of chains) {
        const head = chain.slice(0, 400)
        expect(head).not.toMatch(/^\s*\.?\s*(insert|update|delete|upsert)\s*\(/)
        expect(head.split('\n').slice(0, 12).join('\n')).not.toMatch(
          /\.(insert|update|delete|upsert)\s*\(/
        )
      }
    }
  })

  it('does not generate voucher numbers on the client', () => {
    // Numbering belongs to wardah_next_voucher_number under an advisory lock.
    // "read the max and add one" gave two concurrent creations the same number.
    // Reading `collection_number` back for display stays legitimate; scanning
    // it to derive the next one does not.
    expect(source).not.toMatch(/\.like\(\s*'(collection|payment)_number'/)
    expect(source).not.toMatch(/`CR-\$\{/)
    expect(source).not.toMatch(/`SP-\$\{/)
    expect(source).not.toContain('generateReceiptNumber')
    expect(source).not.toContain('generatePaymentNumber')
    expect(source).not.toContain('padStart(5')
  })

  it('keeps the compensating-delete rollback out of the client', () => {
    // The old create path deleted the header when the line insert failed,
    // without checking the delete's error or row count — and the customer has
    // no DELETE policy on customer_collections, so it passed silently.
    expect(source).not.toContain('Rollback receipt')
    expect(source).not.toContain('Rollback payment')
    expect(source).not.toMatch(/\.delete\(\)/)
  })
})
