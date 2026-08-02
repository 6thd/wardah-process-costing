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

/**
 * The legacy collection writers are gone. They inserted a `customer_collections`
 * header with swallowed errors and then mutated `sales_invoices.paid_amount` and
 * `payment_status` directly — bypassing the voucher, the posting step and the
 * audit trail entirely.
 *
 * They had no caller, which is exactly why they were dangerous: Migration 169
 * revokes the direct write grants, and a dead path that gets revived after that
 * fails at runtime, in Production, for whichever org reaches it first.
 */
describe('legacy collection writers stay removed', () => {
  const COLLECTION_SERVICES = [
    'src/services/enhanced-sales-service.ts',
    'src/services/sales-service.ts'
  ]

  const sources = COLLECTION_SERVICES.map(path => ({
    path,
    source: readFileSync(path, 'utf8')
  }))

  it.each(COLLECTION_SERVICES)('%s exposes no recordCustomerCollection', path => {
    const { source } = sources.find(entry => entry.path === path)!
    expect(source).not.toContain('recordCustomerCollection')
    expect(source).not.toContain('createCollectionAccountingEntry')
  })

  it.each(COLLECTION_SERVICES)('%s never writes to customer_collections', path => {
    const { source } = sources.find(entry => entry.path === path)!
    const chains = source.split(".from('customer_collections')").slice(1)
    for (const chain of chains) {
      expect(chain.split('\n').slice(0, 12).join('\n')).not.toMatch(
        /\.(insert|update|delete|upsert)\s*\(/
      )
    }
  })

  it.each(COLLECTION_SERVICES)('%s never writes paid_amount or payment_status', path => {
    const { source } = sources.find(entry => entry.path === path)!

    // Both fields are derived by the posting RPC from the allocation lines.
    // A client-side write is what let a swallowed header insert leave the
    // invoice marked paid with no collection record behind it.
    const chains = source.split(".from('sales_invoices')").slice(1)
    for (const chain of chains) {
      const head = chain.split('\n').slice(0, 20).join('\n')
      const writes = /\.(update|upsert)\s*\(/.exec(head)
      if (!writes) continue
      const block = head.slice(writes.index)
      expect(block).not.toMatch(/\bpaid_amount\s*:/)
      expect(block).not.toMatch(/\bpayment_status\s*:/)
    }
  })
})
