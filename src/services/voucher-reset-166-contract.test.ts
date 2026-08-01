import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'sql/migrations/166_voucher_reset_to_draft_workflow.sql'),
  'utf8',
)

function functionBody(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${escapedName}\\([\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    ),
  )

  expect(match, `Expected function ${name} in Migration 166`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Migration 166 voucher reset contract', () => {
  it('never writes generated invoice balance columns', () => {
    expect(migration).not.toMatch(/\bSET\s+[\s\S]{0,250}?\bbalance\s*=/i)
  })

  it('requires the exact unpost permission instead of module fallback', () => {
    const receiptReset = functionBody('rpc_reset_customer_receipt_to_draft')
    const supplierReset = functionBody('rpc_reset_supplier_payment_to_draft')
    const exactGuard = functionBody('wardah_has_exact_permission')

    expect(receiptReset).toContain(
      "wardah_has_exact_permission(v_actor, v_org, 'accounting.vouchers.unpost')",
    )
    expect(supplierReset).toContain(
      "wardah_has_exact_permission(v_actor, v_org, 'accounting.vouchers.unpost')",
    )
    expect(receiptReset).not.toContain('has_permission(')
    expect(supplierReset).not.toContain('has_permission(')
    expect(exactGuard).toContain('p.permission_key = p_permission_key')
    expect(exactGuard).not.toMatch(/permission_key\s+LIKE/i)
  })

  it('closes the controlled-unpost GUC immediately after each GL update', () => {
    for (const name of [
      'rpc_reset_customer_receipt_to_draft',
      'rpc_reset_supplier_payment_to_draft',
    ]) {
      const body = functionBody(name)
      const enabledAt = body.indexOf("set_config('wardah.voucher_unpost','on',true)")
      const glUpdateAt = body.indexOf('UPDATE public.gl_entries', enabledAt)
      const disabledAt = body.indexOf("set_config('wardah.voucher_unpost','off',true)", glUpdateAt)
      const voucherUpdateAt = body.indexOf(
        name.includes('customer')
          ? 'UPDATE public.customer_collections'
          : 'UPDATE public.supplier_payments',
        glUpdateAt,
      )

      expect(enabledAt).toBeGreaterThanOrEqual(0)
      expect(glUpdateAt).toBeGreaterThan(enabledAt)
      expect(disabledAt).toBeGreaterThan(glUpdateAt)
      expect(voucherUpdateAt).toBeGreaterThan(disabledAt)
    }
  })
})
