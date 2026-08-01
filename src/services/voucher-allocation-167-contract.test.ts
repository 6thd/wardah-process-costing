import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'sql/migrations/167_voucher_allocation_lines_hardening.sql'),
  'utf8',
)

describe('Migration 167 voucher allocation hardening contract', () => {
  it('removes public/FOR ALL allocation policies and requires active tenant membership', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS customer_collection_lines_select_policy')
    expect(migration).toContain('DROP POLICY IF EXISTS supplier_payment_lines_select_policy')
    expect(migration).toMatch(/FOR SELECT\s+TO authenticated/g)
    expect(migration).toMatch(/FOR INSERT\s+TO authenticated/g)
    expect(migration).toContain('uo.is_active IS TRUE')
    expect(migration).toContain('public.wardah_org_id(NULL::uuid)')

    const createdPolicies = migration.match(/CREATE POLICY[\s\S]*?;/g) ?? []
    for (const policy of createdPolicies) {
      expect(policy).not.toMatch(/FOR ALL/i)
      expect(policy).not.toMatch(/TO public/i)
    }
  })

  it('keeps only temporary SELECT/INSERT client writes and protects service-role bypass', () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.customer_collection_lines FROM anon',
    )
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.supplier_payment_lines FROM anon',
    )
    expect(migration).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/)
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON TABLE public.customer_collection_lines TO authenticated',
    )
    expect(migration).toContain(
      'GRANT SELECT, INSERT ON TABLE public.supplier_payment_lines TO authenticated',
    )
    expect(migration).toContain('wardah.voucher_lines_write')
    expect(migration).toContain('VOUCHER_ALLOCATION_DIRECT_MUTATION_FORBIDDEN')
  })

  it('makes invoice identity mandatory and preserves reset audit evidence', () => {
    expect(migration.match(/ALTER COLUMN invoice_id SET NOT NULL/g)).toHaveLength(2)
    expect(migration.match(/ON DELETE RESTRICT/g)).toHaveLength(2)
    expect(migration).toContain("'entry_number',v_entry.entry_number")
    expect(migration).toContain("'gl_posted_at',v_entry.posted_at")
    expect(migration).toContain("'allocations',v_allocations")
    expect(migration).toContain("'audit_contract','167'")
  })
})
