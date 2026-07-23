import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const inventorySource = readFileSync(
  new URL('../index.tsx', import.meta.url),
  'utf8',
)

function stockAdjustmentsSource(): string {
  const start = inventorySource.indexOf('function StockAdjustments()')
  const end = inventorySource.indexOf('function InventoryValuation()', start)

  if (start < 0 || end < 0) {
    throw new Error('StockAdjustments source boundaries not found')
  }

  return inventorySource.slice(start, end)
}

describe('StockAdjustments organization scope regression', () => {
  const source = stockAdjustmentsSource()

  it('uses the organization selected in AuthContext rather than deriving one with single()', () => {
    expect(source).toContain('const { currentOrgId } = useAuth()')
    expect(source).not.toContain(".from('user_organizations')")
    expect(source).not.toContain('userOrg.org_id')
    expect(source).not.toContain('userOrgs.org_id')
  })

  it('scopes adjustment, product, warehouse, account and posting paths to currentOrgId', () => {
    expect(source).toContain(".from('products')")
    expect(source).toContain(".eq('org_id', currentOrgId)")
    expect(source).toContain(".eq('organization_id', currentOrgId)")
    expect(source).toContain('organization_id: currentOrgId')
    expect(source).toContain('org_id: currentOrgId')
  })

  it('does not retain a warehouse selected under a previously active organization', () => {
    expect(source).toContain(
      'organizationWarehouses.some(warehouse => warehouse.id === prev.warehouse_id)',
    )
    expect(source).toContain("(organizationWarehouses[0]?.id || '')")
  })
})
